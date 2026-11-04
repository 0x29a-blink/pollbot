import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Lock } from 'lucide-react';
import { AppShell } from '../components/shell/AppShell';
import { GuildSidebar } from '../components/shell/Sidebars';
import { Avatar, EmptyBlock, InlineError, Kpi, KpiStrip, PageHeader, Panel, ShareBar } from '../components/ui/primitives';
import { PremiumGateModal } from '../components/PremiumGateModal';
import { apiFetch } from '../utils/api';
import { axisProps, chart, gridProps, tooltipProps } from '../lib/chartTheme';
import { fmtCount, plural } from '../lib/format';

interface AnalyticsData {
    days: number;
    activity: { day: string; votes: number; unique_voters: number }[];
    peakHours: { hour: number; votes: number }[];
    topVoters: { user_id: string; username: string | null; avatar_url: string | null; votes: number }[];
}

const RANGES = [7, 30, 90] as const;
type Range = typeof RANGES[number];

const utcDay = (key: string, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }) =>
    new Date(`${key}T00:00:00Z`).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });
const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;

/** Fill every UTC day in the window so quiet days draw as zero, not as gaps. */
function zeroFillDays(rows: AnalyticsData['activity'], days: number) {
    const byDay = new Map(rows.map(r => [r.day.slice(0, 10), r]));
    const today = new Date();
    const out: AnalyticsData['activity'] = [];
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
        const key = d.toISOString().slice(0, 10);
        const r = byDay.get(key);
        out.push({ day: key, votes: r ? Number(r.votes) : 0, unique_voters: r ? Number(r.unique_voters) : 0 });
    }
    return out;
}

function zeroFillHours(rows: AnalyticsData['peakHours']) {
    const byHour = new Map(rows.map(r => [Number(r.hour), Number(r.votes)]));
    return Array.from({ length: 24 }, (_, h) => ({ hour: h, votes: byHour.get(h) ?? 0 }));
}

/**
 * Premium per-server analytics.
 * Question: "When and how much does this server vote, and who votes most?"
 */
export const GuildAnalyticsView: React.FC = () => {
    const { guildId = '' } = useParams<{ guildId: string }>();
    const [range, setRange] = useState<Range>(30);
    const [data, setData] = useState<AnalyticsData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [locked, setLocked] = useState(false);
    const [voteUrl, setVoteUrl] = useState('');
    const [secondaryVoteUrl, setSecondaryVoteUrl] = useState<string | undefined>(undefined);
    const [showGate, setShowGate] = useState(false);

    const fetchAnalytics = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await apiFetch(`/api/user/guilds/${guildId}/analytics?days=${range}`);
            if (res.status === 403) {
                const body = await res.json().catch(() => ({}));
                if (body.voteUrl) {
                    setLocked(true);
                    setVoteUrl(body.voteUrl);
                    if (body.secondaryVoteUrl) setSecondaryVoteUrl(body.secondaryVoteUrl);
                } else {
                    setError(body.error || "You don't have access to this server's analytics.");
                }
            } else if (res.ok) {
                setLocked(false);
                setData(await res.json());
            } else {
                setError("Couldn't load analytics.");
            }
        } catch (err) {
            console.error('Analytics fetch failed:', err);
            setError("Couldn't load analytics.");
        } finally {
            setLoading(false);
        }
    }, [guildId, range]);

    useEffect(() => {
        void (async () => { await fetchAnalytics(); })();
    }, [fetchAnalytics]);

    const refreshPremium = async (): Promise<boolean> => {
        try {
            const res = await apiFetch('/api/user/premium/refresh', { method: 'POST' });
            if (res.ok && (await res.json()).isPremium) {
                await fetchAnalytics();
                return true;
            }
        } catch (err) {
            console.error('Premium refresh failed:', err);
        }
        return false;
    };

    const view = useMemo(() => {
        if (!data) return null;
        const activity = zeroFillDays(data.activity || [], range).map(a => ({ ...a, label: utcDay(a.day) }));
        const hours = zeroFillHours(data.peakHours || []);
        const total = activity.reduce((s, a) => s + a.votes, 0);
        const busiest = activity.reduce<typeof activity[number] | null>((b, a) => (a.votes > (b?.votes ?? 0) ? a : b), null);
        const peak = hours.reduce<{ hour: number; votes: number } | null>((b, h) => (h.votes > (b?.votes ?? 0) ? h : b), null);
        const activeDays = activity.filter(a => a.votes > 0).length;
        return { activity, hours, total, busiest, peak, activeDays };
    }, [data, range]);

    const topMax = data?.topVoters.reduce((m, v) => Math.max(m, v.votes), 0) ?? 0;

    return (
        <AppShell sidebar={<GuildSidebar guildId={guildId} section="analytics" />} mobileTitle="Analytics">
            <PageHeader
                title="Analytics"
                subtitle={locked ? 'Vote trends, peak hours and top voters for this server' : `Votes in the last ${range} days, counted in UTC`}
                actions={!locked && (
                    <div className="segmented" role="group" aria-label="Time range">
                        {RANGES.map(r => (
                            <button key={r} type="button" aria-pressed={range === r} onClick={() => setRange(r)}>
                                {r} days
                            </button>
                        ))}
                    </div>
                )}
            />

            {locked ? (
                <Panel>
                    <div className="px-6 py-12 flex flex-col items-center text-center">
                        <Lock className="w-5 h-5 text-faint" aria-hidden="true" />
                        <p className="mt-3 text-[15px] font-semibold text-ink">Analytics is a premium feature</p>
                        <p className="mt-1 text-sm text-faint max-w-md">
                            Vote for Simple Poll Bot on top.gg to unlock vote trends, peak hours and your most active voters for 12 hours (vote on DiscordForge too to stack extra time).
                        </p>
                        <button type="button" className="btn btn-primary mt-5" onClick={() => setShowGate(true)}>
                            Unlock with a vote
                        </button>
                    </div>
                </Panel>
            ) : error ? (
                <Panel><InlineError message={error} onRetry={fetchAnalytics} /></Panel>
            ) : (
                <>
                    <KpiStrip className="mb-4">
                        <Kpi tone="brand" label="Ballots cast" value={view ? fmtCount(view.total) : ''} caption={view ? `Last ${range} days` : undefined} loading={loading || !view} lead />
                        <Kpi
                            tone="positive"
                            label="Busiest day"
                            value={view?.busiest ? fmtCount(view.busiest.votes) : '0'}
                            unit={view?.busiest ? 'ballots' : undefined}
                            caption={view?.busiest ? utcDay(view.busiest.day, { weekday: 'short', month: 'short', day: 'numeric' }) : 'No votes yet'}
                            loading={loading || !view}
                        />
                        <Kpi
                            tone="cyan"
                            label="Peak hour (UTC)"
                            value={view?.peak ? hourLabel(view.peak.hour) : '—'}
                            caption={view?.peak ? `${plural(view.peak.votes, 'ballot')} in that hour` : 'No votes yet'}
                            loading={loading || !view}
                        />
                        <Kpi
                            tone="warning"
                            label="Days with votes"
                            value={view ? fmtCount(view.activeDays) : ''}
                            unit={`/ ${range}`}
                            caption={view && view.activeDays ? `${fmtCount(Math.round(view.total / view.activeDays))} ballots on an active day` : undefined}
                            loading={loading || !view}
                        />
                    </KpiStrip>

                    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-4 items-start">
                        <div className="flex flex-col gap-4 min-w-0">
                            <Panel title="Ballots per day" meta="UTC">
                                <div className="px-3 pb-4 h-[260px]">
                                    {loading || !view ? (
                                        <div className="skeleton h-full mx-2" />
                                    ) : (
                                        <ResponsiveContainer width="100%" height="100%">
                                            <BarChart data={view.activity} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                                                <CartesianGrid {...gridProps} />
                                                <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={28} />
                                                <YAxis {...axisProps} allowDecimals={false} width={40} />
                                                <Tooltip {...tooltipProps} formatter={(v) => [fmtCount(v), 'Ballots']} />
                                                <Bar dataKey="votes" fill={chart.data} radius={[2, 2, 0, 0]} maxBarSize={28} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    )}
                                </div>
                            </Panel>
                            <Panel title="When people vote" meta={view?.peak ? `Peak ${hourLabel(view.peak.hour)} UTC` : 'UTC'}>
                                <div className="px-3 pb-4 h-[180px]">
                                    {loading || !view ? (
                                        <div className="skeleton h-full mx-2" />
                                    ) : (
                                        <ResponsiveContainer width="100%" height="100%">
                                            <BarChart data={view.hours} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                                                <CartesianGrid {...gridProps} />
                                                <XAxis dataKey="hour" {...axisProps} tickFormatter={hourLabel} interval={2} />
                                                <YAxis {...axisProps} allowDecimals={false} width={40} />
                                                <Tooltip {...tooltipProps} labelFormatter={(h) => `${hourLabel(Number(h))} UTC`} formatter={(v) => [fmtCount(v), 'Ballots']} />
                                                <Bar dataKey="votes" radius={[2, 2, 0, 0]}>
                                                    {view.hours.map(h => (
                                                        <Cell key={h.hour} fill={view.peak && h.hour === view.peak.hour ? chart.data2 : chart.data} />
                                                    ))}
                                                </Bar>
                                            </BarChart>
                                        </ResponsiveContainer>
                                    )}
                                </div>
                            </Panel>
                        </div>

                        <Panel title="Most active voters" meta="Polls voted in">
                            {loading || !data ? (
                                <ul aria-hidden="true">
                                    {[0, 1, 2, 3, 4, 5].map(i => (
                                        <li key={i} className="px-5 h-12 flex items-center gap-3 border-t border-rule">
                                            <div className="skeleton w-7 h-7 rounded-full" />
                                            <div className="skeleton h-4 w-32" />
                                        </li>
                                    ))}
                                </ul>
                            ) : data.topVoters.length === 0 ? (
                                <EmptyBlock title="No voters in this period" />
                            ) : (
                                <ol>
                                    {data.topVoters.map((v, i) => {
                                        const gone = !v.username || v.username === 'Unknown' || v.username === 'Left Server';
                                        return (
                                            <li key={v.user_id} className="px-5 py-2.5 border-t border-rule">
                                                <div className="flex items-center gap-3">
                                                    <span className="num text-xs text-faint w-4 text-right shrink-0">{i + 1}</span>
                                                    <Avatar name={v.username || '?'} url={v.avatar_url} size={28} id={v.user_id} />
                                                    <span className={`flex-1 min-w-0 truncate text-sm ${gone ? 'text-faint' : 'text-ink'}`}>
                                                        {gone ? (v.username === 'Left Server' ? 'Left the server' : `Unknown user ${v.user_id.slice(-4)}`) : v.username}
                                                    </span>
                                                    <span className="num text-sm text-ink">{fmtCount(v.votes)}</span>
                                                </div>
                                                <div className="pl-[60px] mt-1.5">
                                                    <ShareBar value={v.votes} max={topMax} tone={i === 0 ? 'data' : 'muted'} height={2} />
                                                </div>
                                            </li>
                                        );
                                    })}
                                </ol>
                            )}
                        </Panel>
                    </div>
                </>
            )}

            <PremiumGateModal
                isOpen={showGate}
                onClose={() => setShowGate(false)}
                voteUrl={voteUrl}
                secondaryVoteUrl={secondaryVoteUrl}
                onRefresh={refreshPremium}
                featureName="Analytics"
            />
        </AppShell>
    );
};
