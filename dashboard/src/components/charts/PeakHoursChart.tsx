import React, { useEffect, useMemo, useState } from 'react';
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Bar, BarChart, Cell } from 'recharts';
import { adminSupabase } from '../../lib/supabase';
import { Panel } from '../ui/primitives';
import { ChartBody, ChartSummary } from '../admin/adminUi';
import { hourLabel, countAxis } from '../admin/adminFormat';
import { axisProps, chart, gridProps, tooltipProps } from '../../lib/chartTheme';
import { fmtCount, fmtPct, toNum } from '../../lib/format';

interface PeakHourRow {
    hour: number;
    votes: number | string;
}

interface ChartRow {
    hour: number;
    label: string;
    votes: number;
}

/**
 * Global vote volume by hour of day (UTC), last 30 days, from the
 * get_global_peak_hours RPC. All 24 buckets are always drawn.
 */
export const PeakHoursChart: React.FC<{ refreshKey?: number; className?: string; height?: number }> = ({ refreshKey = 0, className = '', height = 240 }) => {
    const [rows, setRows] = useState<ChartRow[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [retry, setRetry] = useState(0);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const { data, error: rpcError } = await adminSupabase.rpc('get_global_peak_hours', { p_days: 30 });
                if (cancelled) return;
                if (rpcError || !Array.isArray(data)) {
                    setError("Couldn't load peak hours.");
                    return;
                }
                const byHour = new Map((data as PeakHourRow[]).map(r => [Number(r.hour), toNum(r.votes) ?? 0]));
                setRows(Array.from({ length: 24 }, (_, h) => ({ hour: h, label: hourLabel(h), votes: byHour.get(h) ?? 0 })));
                setError(null);
            } catch (err) {
                console.error('Error fetching peak hours:', err);
                if (!cancelled) setError("Couldn't load peak hours.");
            }
        })();
        return () => { cancelled = true; };
    }, [refreshKey, retry]);

    const { total, peak } = useMemo(() => {
        const list = rows ?? [];
        const t = list.reduce((s, r) => s + r.votes, 0);
        const p = list.reduce<ChartRow | null>((best, r) => (!best || r.votes > best.votes ? r : best), null);
        return { total: t, peak: p };
    }, [rows]);
    const allZero = total === 0;
    const loading = rows === null && !error;

    return (
        <Panel title="Votes by hour" meta="(UTC) · 30 days" className={`min-w-0 ${className}`} bodyClassName="px-5 pb-4">
            <ChartSummary
                loading={loading}
                value={allZero || !peak ? '0' : peak.label}
                caption={allZero || !peak ? 'votes in the last 30 days' : `busiest hour · ${fmtPct(peak.votes, total)} of votes`}
            />
            <ChartBody
                height={height}
                loading={loading}
                error={error}
                onRetry={() => { setError(null); setRows(null); setRetry(n => n + 1); }}
                empty={allZero}
                emptyText="No votes in the last 30 days."
            >
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={rows ?? []} margin={{ top: 8, right: 4, bottom: 0, left: -8 }} barCategoryGap={2}>
                        <CartesianGrid {...gridProps} />
                        <XAxis dataKey="label" {...axisProps} ticks={['00:00', '06:00', '12:00', '18:00']} />
                        <YAxis {...axisProps} width={44} {...countAxis(peak?.votes ?? 0)} />
                        <Tooltip {...tooltipProps} formatter={((value: unknown) => [fmtCount(value), 'Votes']) as never} />
                        <Bar dataKey="votes" radius={[2, 2, 0, 0]} isAnimationActive={false}>
                            {(rows ?? []).map(r => (
                                <Cell key={r.hour} fill={!allZero && peak && r.hour === peak.hour ? chart.data2 : chart.data} />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </ChartBody>
        </Panel>
    );
};
