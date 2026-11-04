import React, { useEffect, useMemo, useState } from 'react';
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart } from 'recharts';
import { adminSupabase } from '../../lib/supabase';
import { Panel } from '../ui/primitives';
import { ChartBody, ChartSummary, Segmented } from '../admin/adminUi';
import { fmtDayUTC, lastDaysUTC, countAxis } from '../admin/adminFormat';
import { axisProps, chart, gridProps, tooltipProps } from '../../lib/chartTheme';
import { fmtCount, toNum } from '../../lib/format';

interface HistoryRow {
    day: string;
    votes: number | string;
    unique_voters: number | string;
    polls_created: number | string;
}

interface ChartRow {
    day: string;
    label: string;
    votes: number;
    voters: number;
    polls: number;
}

type Metric = 'votes' | 'voters' | 'polls';

const METRICS: { value: Metric; label: string; caption: (d: number) => string; unit: string }[] = [
    { value: 'votes', label: 'Votes', caption: d => `votes in the last ${d} days`, unit: 'votes' },
    { value: 'voters', label: 'Voters', caption: d => `unique voters per day, ${d}-day average`, unit: 'voters' },
    { value: 'polls', label: 'Polls', caption: d => `polls created in the last ${d} days`, unit: 'polls' },
];

/**
 * Votes / unique voters / polls created per UTC day, from the get_vote_history
 * RPC (aggregated in Postgres, so it never hits PostgREST's 1000-row cap).
 * One series at a time; the segmented control switches the metric.
 */
export const VoteHistoryChart: React.FC<{ refreshKey?: number; className?: string; height?: number }> = ({ refreshKey = 0, className = '', height = 240 }) => {
    const [rows, setRows] = useState<ChartRow[] | null>(null);
    const [days, setDays] = useState<7 | 30>(30);
    const [metric, setMetric] = useState<Metric>('votes');
    const [error, setError] = useState<string | null>(null);
    const [retry, setRetry] = useState(0);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const { data, error: rpcError } = await adminSupabase.rpc('get_vote_history', { p_days: days });
                if (cancelled) return;
                if (rpcError || !Array.isArray(data)) {
                    setError("Couldn't load vote history.");
                    return;
                }
                // Zero-fill the window so a quiet day is drawn as zero, not skipped.
                const byDay = new Map((data as HistoryRow[]).map(r => [String(r.day).slice(0, 10), r]));
                setRows(lastDaysUTC(days).map(day => {
                    const r = byDay.get(day);
                    return {
                        day,
                        label: fmtDayUTC(day),
                        votes: toNum(r?.votes) ?? 0,
                        voters: toNum(r?.unique_voters) ?? 0,
                        polls: toNum(r?.polls_created) ?? 0,
                    };
                }));
                setError(null);
            } catch (err) {
                console.error('Error fetching vote history:', err);
                if (!cancelled) setError("Couldn't load vote history.");
            }
        })();
        return () => { cancelled = true; };
    }, [days, refreshKey, retry]);

    const m = METRICS.find(x => x.value === metric)!;
    const total = useMemo(() => (rows ?? []).reduce((s, r) => s + r[metric], 0), [rows, metric]);
    const allZero = total === 0;
    const loading = rows === null && !error;

    return (
        <Panel
            title="Activity per day"
            meta="(UTC)"
            className={`min-w-0 ${className}`}
            bodyClassName="px-5 pb-4"
            actions={
                <div className="flex items-center gap-2">
                    <Segmented label="Metric" value={metric} onChange={setMetric} options={METRICS.map(x => ({ value: x.value, label: x.label }))} className="hidden sm:inline-flex" />
                    <Segmented label="Range" value={days} onChange={v => { setDays(v); }} options={[{ value: 7, label: '7d' }, { value: 30, label: '30d' }]} />
                </div>
            }
        >
            <Segmented label="Metric" value={metric} onChange={setMetric} options={METRICS.map(x => ({ value: x.value, label: x.label }))} className="sm:hidden mb-2" />
            <ChartSummary
                loading={loading}
                value={fmtCount(metric === 'voters' ? Math.round(total / days) : total)}
                caption={m.caption(days)}
            />
            <ChartBody
                height={height}
                loading={loading}
                error={error}
                onRetry={() => { setError(null); setRows(null); setRetry(n => n + 1); }}
                empty={allZero}
                emptyText={`No ${m.unit} in the last ${days} days.`}
            >
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={rows ?? []} margin={{ top: 8, right: 4, bottom: 0, left: -8 }}>
                        <CartesianGrid {...gridProps} />
                        <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={28} />
                        <YAxis {...axisProps} width={44} {...countAxis(Math.max(0, ...(rows ?? []).map(r => r[metric])))} />
                        <Tooltip
                            {...tooltipProps}
                            cursor={{ stroke: chart.grid }}
                            formatter={((value: unknown) => [fmtCount(value), m.label]) as never}
                        />
                        <Area
                            type="linear"
                            dataKey={metric}
                            name={m.label}
                            stroke={chart.data}
                            strokeWidth={2}
                            fill={chart.data}
                            fillOpacity={0.12}
                            dot={false}
                            activeDot={{ r: 4, strokeWidth: 0, fill: chart.data }}
                            isAnimationActive={false}
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </ChartBody>
        </Panel>
    );
};
