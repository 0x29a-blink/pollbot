import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Line, LineChart } from 'recharts';
import { adminSupabase } from '../../lib/supabase';
import { apiFetch } from '../../utils/api';
import { Avatar, Panel } from '../ui/primitives';
import { ChartBody, DotLegend, Segmented } from '../admin/adminUi';
import { fmtDayUTC, lastDaysUTC, countAxis } from '../admin/adminFormat';
import { axisProps, chart, gridProps, seriesPalette, tooltipProps } from '../../lib/chartTheme';
import { fmtCount, toNum } from '../../lib/format';

interface HistoryRow {
    day: string;
    source: 'topgg' | 'discordforge';
    votes: number | string;
    unique_voters: number | string;
}

interface ChartRow {
    day: string;
    label: string;
    topgg: number;
    discordforge: number;
}

interface TotalsRow {
    source: 'topgg' | 'discordforge';
    votes_total: number | string;
    voters_total: number | string;
    votes_30d: number | string;
    voters_30d: number | string;
}

interface TopVoter {
    user_id: string;
    username: string | null;
    avatar_url: string | null;
    votes: number | string;
    sources: string[];
    last_vote_at: string;
}

const SOURCES = [
    { key: 'topgg' as const, label: 'Top.gg', color: seriesPalette[0] },
    { key: 'discordforge' as const, label: 'DiscordForge', color: seriesPalette[1] },
];
const SOURCE_LABELS: Record<string, string> = { topgg: 'Top.gg', discordforge: 'DiscordForge' };
const TOP_ROWS = 5;

/**
 * Bot-list voting (Top.gg + DiscordForge): votes per UTC day per list from the
 * aggregate-only get_botlist_vote_history RPC, the per-list totals and the top
 * voters from the authenticated admin API (its RPCs are service_role-only).
 */
export const BotListVotesPanel: React.FC<{ refreshKey?: number; className?: string }> = ({ refreshKey = 0, className = '' }) => {
    const [rows, setRows] = useState<ChartRow[] | null>(null);
    const [totals, setTotals] = useState<TotalsRow[] | null>(null);
    const [topVoters, setTopVoters] = useState<TopVoter[] | null>(null);
    const [days, setDays] = useState<7 | 30>(30);
    const [error, setError] = useState<string | null>(null);
    const [retry, setRetry] = useState(0);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const [historyRes, adminRes] = await Promise.all([
                    adminSupabase.rpc('get_botlist_vote_history', { p_days: days }),
                    apiFetch(`/api/admin/vote-analytics?days=${days}`),
                ]);
                if (cancelled) return;
                if (historyRes.error || !Array.isArray(historyRes.data)) {
                    setError("Couldn't load bot-list votes.");
                    return;
                }
                const byDay = new Map<string, ChartRow>(lastDaysUTC(days).map(day => [day, { day, label: fmtDayUTC(day), topgg: 0, discordforge: 0 }]));
                for (const r of historyRes.data as HistoryRow[]) {
                    const entry = byDay.get(String(r.day).slice(0, 10));
                    if (entry && (r.source === 'topgg' || r.source === 'discordforge')) entry[r.source] = toNum(r.votes) ?? 0;
                }
                setRows([...byDay.values()]);
                setError(null);

                if (adminRes.ok) {
                    const adminData = await adminRes.json();
                    if (cancelled) return;
                    setTotals(adminData.totals ?? []);
                    setTopVoters(adminData.topVoters ?? []);
                } else {
                    setTotals([]);
                    setTopVoters([]);
                }
            } catch (err) {
                console.error('Error fetching bot-list vote analytics:', err);
                if (!cancelled) setError("Couldn't load bot-list votes.");
            }
        })();
        return () => { cancelled = true; };
    }, [days, refreshKey, retry]);

    const windowTotal = useMemo(() => (rows ?? []).reduce((s, r) => s + r.topgg + r.discordforge, 0), [rows]);
    const allZero = windowTotal === 0;
    const loading = rows === null && !error;

    return (
        <Panel
            title="Bot-list votes"
            meta="(UTC)"
            className={`min-w-0 ${className}`}
            actions={
                <div className="flex items-center gap-4">
                    <span className="hidden md:block"><DotLegend items={SOURCES.map(s => ({ label: s.label, color: s.color }))} /></span>
                    <Segmented label="Range" value={days} onChange={setDays} options={[{ value: 7, label: '7d' }, { value: 30, label: '30d' }]} />
                </div>
            }
        >
            <div className="grid grid-cols-1 lg:grid-cols-3">
                <div className="lg:col-span-2 px-5 pb-4 min-w-0">
                    {/* Per-list totals: one divided row, no tiles */}
                    <div className="grid grid-cols-2 border border-rule rounded-lg mb-3">
                        {SOURCES.map((s, i) => {
                            const t = totals?.find(x => x.source === s.key);
                            return (
                                <div key={s.key} className={`px-4 py-3 min-w-0 ${i > 0 ? 'border-l border-rule' : ''}`}>
                                    <div className="flex items-center gap-1.5 text-[13px] text-faint">
                                        <span aria-hidden="true" className="w-2 h-2 rounded-full" style={{ background: s.color }} />
                                        {s.label}
                                    </div>
                                    {totals === null ? (
                                        <div className="skeleton h-6 w-24 mt-1.5" />
                                    ) : (
                                        <div className="mt-0.5 flex items-baseline gap-1.5 flex-wrap">
                                            <span className="num text-xl leading-7 font-semibold text-ink">{fmtCount(t?.votes_30d ?? 0)}</span>
                                            <span className="text-xs text-faint">votes in 30 days</span>
                                        </div>
                                    )}
                                    <div className="num text-xs text-faint mt-0.5 truncate">
                                        {totals === null ? '\u00a0' : `${fmtCount(t?.voters_30d ?? 0)} voters · ${fmtCount(t?.votes_total ?? 0)} all time`}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    <span className="md:hidden block mb-2"><DotLegend items={SOURCES.map(s => ({ label: s.label, color: s.color }))} /></span>
                    <ChartBody
                        height={200}
                        loading={loading}
                        error={error}
                        onRetry={() => { setError(null); setRows(null); setRetry(n => n + 1); }}
                        empty={allZero}
                        emptyText={`No bot-list votes in the last ${days} days.`}
                    >
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={rows ?? []} margin={{ top: 8, right: 4, bottom: 0, left: -8 }}>
                                <CartesianGrid {...gridProps} />
                                <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={28} />
                                <YAxis {...axisProps} width={44} {...countAxis(Math.max(0, ...(rows ?? []).map(r => Math.max(r.topgg, r.discordforge))))} />
                                <Tooltip {...tooltipProps} cursor={{ stroke: chart.grid }} formatter={((value: unknown, name: unknown) => [fmtCount(value), String(name)]) as never} />
                                {SOURCES.map(s => (
                                    <Line key={s.key} type="linear" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} isAnimationActive={false} />
                                ))}
                            </LineChart>
                        </ResponsiveContainer>
                    </ChartBody>
                </div>

                {/* Top voters (admin API) */}
                <div className="px-5 pb-4 lg:border-l border-t lg:border-t-0 border-rule pt-3 lg:pt-0 min-w-0 flex flex-col">
                    <div className="flex items-baseline justify-between h-8">
                        <h3 className="text-sm font-semibold text-ink">Top voters</h3>
                        <span className="text-xs text-faint">last {days} days</span>
                    </div>
                    {topVoters === null ? (
                        <ul aria-busy="true">
                            {Array.from({ length: TOP_ROWS }, (_, i) => (
                                <li key={i} className="h-11 flex items-center gap-3"><div className="skeleton w-6 h-6 rounded-full" /><div className="skeleton h-3.5 flex-1" /></li>
                            ))}
                        </ul>
                    ) : topVoters.length === 0 ? (
                        <p className="text-sm text-faint py-4">No bot-list votes in this window.</p>
                    ) : (
                        <ol>
                            {topVoters.slice(0, TOP_ROWS).map((v, i) => (
                                <li key={v.user_id} className="h-11 flex items-center gap-3 min-w-0">
                                    <span className="num text-xs text-faint w-4 shrink-0">{i + 1}.</span>
                                    <Avatar name={v.username || '?'} url={v.avatar_url} size={24} id={v.user_id} />
                                    <div className="min-w-0 flex-1">
                                        <div className="text-sm text-ink truncate">{v.username || 'Unknown user'}</div>
                                        <div className="text-xs text-faint truncate">{(v.sources ?? []).map(s => SOURCE_LABELS[s] ?? s).join(' · ')}</div>
                                    </div>
                                    <span className="num text-sm text-ink shrink-0">{fmtCount(v.votes)}</span>
                                </li>
                            ))}
                        </ol>
                    )}
                    <Link to="/voters" className="mt-auto pt-2 text-sm text-brand-text hover:underline self-start">View all voters</Link>
                </div>
            </div>
        </Panel>
    );
};
