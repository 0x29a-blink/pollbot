import React, { useEffect, useMemo, useState } from 'react';
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Line, LineChart } from 'recharts';
import { adminSupabase } from '../../lib/supabase';
import { Panel } from '../ui/primitives';
import { ChartBody, ChartSummary, DotLegend } from '../admin/adminUi';
import { fmtDayUTC, lastDaysUTC, countAxis } from '../admin/adminFormat';
import { axisProps, chart, gridProps, seriesPalette, tooltipProps } from '../../lib/chartTheme';
import { fmtCount, fmtPct, toNum } from '../../lib/format';

interface UsageSummaryRow {
    day: string;
    source: 'bot' | 'dashboard';
    events: number | string;
    unique_users: number | string;
}

interface ChartRow {
    day: string;
    label: string;
    bot: number;
    dashboard: number;
    bot_users: number;
    dashboard_users: number;
}

const DAYS = 30;
const BOT_COLOR = seriesPalette[0];
const DASH_COLOR = seriesPalette[1];

/**
 * Bot vs dashboard actions per UTC day, from the get_usage_summary RPC
 * (aggregate counts only - no per-user rows reach the client).
 */
export const UsageSourceChart: React.FC<{ refreshKey?: number; className?: string; height?: number }> = ({ refreshKey = 0, className = '', height = 220 }) => {
    const [rows, setRows] = useState<ChartRow[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [retry, setRetry] = useState(0);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const { data, error: rpcError } = await adminSupabase.rpc('get_usage_summary', { p_days: DAYS });
                if (cancelled) return;
                if (rpcError || !Array.isArray(data)) {
                    setError("Couldn't load usage.");
                    return;
                }
                const byDay = new Map<string, ChartRow>(
                    lastDaysUTC(DAYS).map(day => [day, { day, label: fmtDayUTC(day), bot: 0, dashboard: 0, bot_users: 0, dashboard_users: 0 }]),
                );
                for (const r of data as UsageSummaryRow[]) {
                    const entry = byDay.get(String(r.day).slice(0, 10));
                    if (!entry) continue;
                    if (r.source === 'dashboard') {
                        entry.dashboard = toNum(r.events) ?? 0;
                        entry.dashboard_users = toNum(r.unique_users) ?? 0;
                    } else {
                        entry.bot = toNum(r.events) ?? 0;
                        entry.bot_users = toNum(r.unique_users) ?? 0;
                    }
                }
                setRows([...byDay.values()]);
                setError(null);
            } catch (err) {
                console.error('Error fetching usage summary:', err);
                if (!cancelled) setError("Couldn't load usage.");
            }
        })();
        return () => { cancelled = true; };
    }, [refreshKey, retry]);

    const totals = useMemo(() => (rows ?? []).reduce((t, r) => ({ bot: t.bot + r.bot, dashboard: t.dashboard + r.dashboard }), { bot: 0, dashboard: 0 }), [rows]);
    const all = totals.bot + totals.dashboard;
    const allZero = all === 0;
    const loading = rows === null && !error;

    return (
        <Panel
            title="Usage by surface"
            meta="(UTC) · 30 days"
            className={`min-w-0 ${className}`}
            bodyClassName="px-5 pb-4"
            actions={<DotLegend items={[{ label: 'Bot', color: BOT_COLOR }, { label: 'Dashboard', color: DASH_COLOR }]} />}
        >
            <ChartSummary
                loading={loading}
                value={fmtCount(all)}
                caption={allZero ? 'actions in the last 30 days' : `actions · ${fmtPct(totals.dashboard, all)} from the dashboard`}
            />
            <ChartBody
                height={height}
                loading={loading}
                error={error}
                onRetry={() => { setError(null); setRows(null); setRetry(n => n + 1); }}
                empty={allZero}
                emptyText="No bot or dashboard actions in the last 30 days."
            >
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={rows ?? []} margin={{ top: 8, right: 4, bottom: 0, left: -8 }}>
                        <CartesianGrid {...gridProps} />
                        <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={28} />
                        <YAxis {...axisProps} width={44} {...countAxis(Math.max(0, ...(rows ?? []).map(r => Math.max(r.bot, r.dashboard))))} />
                        <Tooltip
                            {...tooltipProps}
                            cursor={{ stroke: chart.grid }}
                            formatter={((value: unknown, name: unknown, item: { payload?: ChartRow }) => {
                                const users = name === 'Bot' ? item?.payload?.bot_users : item?.payload?.dashboard_users;
                                return [`${fmtCount(value)} actions · ${fmtCount(users ?? 0)} users`, String(name)];
                            }) as never}
                        />
                        <Line type="linear" dataKey="bot" name="Bot" stroke={BOT_COLOR} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} isAnimationActive={false} />
                        <Line type="linear" dataKey="dashboard" name="Dashboard" stroke={DASH_COLOR} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} isAnimationActive={false} />
                    </LineChart>
                </ResponsiveContainer>
            </ChartBody>
        </Panel>
    );
};
