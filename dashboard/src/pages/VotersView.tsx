import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    LineChart, Line, BarChart, Bar,
} from 'recharts';
import { apiFetch } from '../utils/api';
import { AppShell } from '../components/shell/AppShell';
import { AdminSidebar } from '../components/shell/Sidebars';
import { Avatar, Dash, InlineError, Kpi, KpiStrip, PageHeader, Panel, SearchField, ShareBar } from '../components/ui/primitives';
import { ChartBody, DotLegend, Segmented } from '../components/admin/adminUi';
import { fmtDayUTC, hourLabel, countAxis } from '../components/admin/adminFormat';
import { axisProps, chart, gridProps, seriesPalette, tooltipProps } from '../lib/chartTheme';
import { fmtCount, fmtDateTime, fmtPct, fmtRelative, toNum } from '../lib/format';

// ---------------------------------------------------------------------------
// Types mirroring the /api/admin/vote-analytics and /api/admin/voters payloads
// ---------------------------------------------------------------------------

interface HistoryRow { day: string; source: 'topgg' | 'discordforge'; votes: number; unique_voters: number }
interface HourRow { hour: number; votes: number }
interface WeekdayRow { dow: number; votes: number }
interface NewReturningRow { day: string; new_voters: number; returning_voters: number }
interface OverlapData { topgg_only: number; discordforge_only: number; both: number }
interface WeekendData { weekend_votes: number; total_votes: number }
interface CampaignRow { campaign: string; votes: number }

interface AnalyticsBundle {
    history: HistoryRow[];
    hours: HourRow[];
    weekdays: WeekdayRow[];
    new_returning: NewReturningRow[];
    overlap: OverlapData | null;
    weekend: WeekendData | null;
    campaigns: CampaignRow[];
}

interface TopVoter {
    user_id: string; username: string | null; avatar_url: string | null;
    votes: number; sources: string[]; last_vote_at: string;
}

interface RecentVote {
    id: number; source: string; user_id: string; username: string | null; avatar_url: string | null;
    weight: number; is_test: boolean; is_weekend: boolean | null;
    weekly_votes: number | null; total_votes: number | null; created_at: string;
}

interface DirectoryRow {
    user_id: string; username: string | null; avatar_url: string | null;
    votes: number; weighted_votes: number; sources: string[];
    first_vote_at: string; last_botlist_vote_at: string;
    df_weekly_votes: number | null; df_total_votes: number | null;
    streak_days: number; premium_last_vote_at: string | null; premium_expires_at?: string | null; premium_active: boolean;
}

type SourceFilter = 'all' | 'topgg' | 'discordforge';
type SortMode = 'votes' | 'streak' | 'weighted' | 'recent';
type Days = 7 | 30 | 90 | 365;

const SOURCE_LABELS: Record<string, string> = { topgg: 'Top.gg', discordforge: 'DiscordForge' };
const SOURCE_COLORS: Record<string, string> = { topgg: seriesPalette[0], discordforge: seriesPalette[1] };
const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const PAGE_SIZE = 25;
const PLOT_H = 200;
const LIST_ROWS = 8;

const sourcesText = (sources: string[] | null | undefined) => (sources ?? []).map(s => SOURCE_LABELS[s] ?? s).join(' · ');

// ---------------------------------------------------------------------------

/** Bot-list voting (Top.gg, DiscordForge): trends, who votes, premium status. */
export const VotersView: React.FC = () => {
    const navigate = useNavigate();

    // Shared filters
    const [days, setDays] = useState<Days>(30);
    const [source, setSource] = useState<SourceFilter>('all');

    // Analytics bundle
    const [analytics, setAnalytics] = useState<AnalyticsBundle | null>(null);
    const [topVoters, setTopVoters] = useState<TopVoter[]>([]);
    const [recentVotes, setRecentVotes] = useState<RecentVote[]>([]);
    const [analyticsLoading, setAnalyticsLoading] = useState(true);
    const [analyticsFailed, setAnalyticsFailed] = useState(false);
    const [analyticsTry, setAnalyticsTry] = useState(0);

    // Voter directory
    const [rows, setRows] = useState<DirectoryRow[]>([]);
    const [total, setTotal] = useState<number | null>(null);
    const [offset, setOffset] = useState(0);
    const [sort, setSort] = useState<SortMode>('votes');
    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const [dirLoading, setDirLoading] = useState(true);
    const [dirFailed, setDirFailed] = useState(false);
    const [dirTry, setDirTry] = useState(0);
    const [nowMs, setNowMs] = useState(() => Date.now());

    useEffect(() => {
        const t = setTimeout(() => setSearch(searchInput.trim()), 300);
        return () => clearTimeout(t);
    }, [searchInput]);

    // Analytics fetch
    useEffect(() => {
        let cancelled = false;
        (async () => {
            setAnalyticsLoading(true);
            try {
                const res = await apiFetch(`/api/admin/vote-analytics?days=${days}${source === 'all' ? '' : `&source=${source}`}`);
                if (cancelled) return;
                if (!res.ok) { setAnalyticsFailed(true); return; }
                const data = await res.json();
                if (cancelled) return;
                setAnalyticsFailed(false);
                setAnalytics(data.analytics ?? null);
                setTopVoters(data.topVoters ?? []);
                setRecentVotes(data.recentVotes ?? []);
            } catch (err) {
                console.error('Error fetching vote analytics:', err);
                if (!cancelled) setAnalyticsFailed(true);
            } finally {
                if (!cancelled) setAnalyticsLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [days, source, analyticsTry]);

    // Directory fetch (append = load more)
    const fetchDirectory = async (newOffset: number, append: boolean) => {
        setDirLoading(true);
        try {
            const params = new URLSearchParams({ days: String(days), sort, limit: String(PAGE_SIZE), offset: String(newOffset) });
            if (source !== 'all') params.set('source', source);
            if (search) params.set('search', search);
            const res = await apiFetch(`/api/admin/voters?${params}`);
            if (!res.ok) { setDirFailed(true); return; }
            const data = await res.json();
            setNowMs(Date.now());
            setTotal(toNum(data.total) ?? 0);
            setRows(prev => (append ? [...prev, ...(data.rows ?? [])] : (data.rows ?? [])));
            setOffset(newOffset);
            setDirFailed(false);
        } catch (err) {
            console.error('Error fetching voter directory:', err);
            setDirFailed(true);
        } finally {
            setDirLoading(false);
        }
    };

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setDirLoading(true);
            try {
                const params = new URLSearchParams({ days: String(days), sort, limit: String(PAGE_SIZE), offset: '0' });
                if (source !== 'all') params.set('source', source);
                if (search) params.set('search', search);
                const res = await apiFetch(`/api/admin/voters?${params}`);
                if (cancelled) return;
                if (!res.ok) { setDirFailed(true); return; }
                const data = await res.json();
                if (cancelled) return;
                setNowMs(Date.now());
                setTotal(toNum(data.total) ?? 0);
                setRows(data.rows ?? []);
                setOffset(0);
                setDirFailed(false);
            } catch (err) {
                console.error('Error fetching voter directory:', err);
                if (!cancelled) setDirFailed(true);
            } finally {
                if (!cancelled) setDirLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [days, source, sort, search, dirTry]);

    // Derived chart data --------------------------------------------------

    const visibleSources = source === 'all' ? ['topgg', 'discordforge'] as const : [source] as const;

    const historyByDay = useMemo(() => {
        const byDay = new Map<string, { day: string; label: string; topgg: number; discordforge: number }>();
        for (const r of analytics?.history ?? []) {
            const key = String(r.day).slice(0, 10);
            const entry = byDay.get(key) ?? { day: key, label: fmtDayUTC(key), topgg: 0, discordforge: 0 };
            if (r.source === 'topgg' || r.source === 'discordforge') entry[r.source] = Number(r.votes);
            byDay.set(key, entry);
        }
        return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
    }, [analytics]);

    const newReturning = (analytics?.new_returning ?? []).map(r => ({
        label: fmtDayUTC(String(r.day)), new: Number(r.new_voters), returning: Number(r.returning_voters),
    }));
    const hourly = (analytics?.hours ?? []).map(h => ({ label: hourLabel(Number(h.hour)), votes: Number(h.votes) }));
    const weekdays = (analytics?.weekdays ?? []).map(w => ({ label: WEEKDAY_NAMES[w.dow - 1] ?? String(w.dow), votes: Number(w.votes) }));

    const ov = analytics?.overlap;
    const overlapRows = ov ? [
        { name: 'Top.gg only', value: Number(ov.topgg_only) },
        { name: 'DiscordForge only', value: Number(ov.discordforge_only) },
        { name: 'Both lists', value: Number(ov.both) },
    ] : [];
    const overlapTotal = overlapRows.reduce((s, r) => s + r.value, 0);
    const overlapMax = overlapRows.reduce((m, r) => Math.max(m, r.value), 0);

    const windowVotes = historyByDay.reduce((a, d) => a + d.topgg + d.discordforge, 0);
    // The overlap block ignores the source filter on purpose, so derive the
    // unique voters for the selected list from it: that list's own voters plus
    // the ones on both lists.
    const windowVoters = ov
        ? source === 'topgg' ? Number(ov.topgg_only) + Number(ov.both)
            : source === 'discordforge' ? Number(ov.discordforge_only) + Number(ov.both)
                : overlapTotal
        : null;
    const weekendShare = analytics?.weekend && Number(analytics.weekend.total_votes) > 0
        ? fmtPct(Number(analytics.weekend.weekend_votes), Number(analytics.weekend.total_votes))
        : null;

    const histZero = windowVotes === 0;
    const nrZero = newReturning.every(r => r.new + r.returning === 0);
    const hourZero = hourly.every(r => r.votes === 0);
    const wdZero = weekdays.every(r => r.votes === 0);
    const firstLoad = analyticsLoading && !analytics;
    const retryAnalytics = () => { setAnalyticsFailed(false); setAnalyticsTry(n => n + 1); };
    const chartError = analyticsFailed ? "Couldn't load voter analytics." : null;
    const sourceLabel = source === 'all' ? 'Top.gg and DiscordForge' : SOURCE_LABELS[source];
    const periodLabel = days === 365 ? 'the last year' : `the last ${days} days`;

    // ----------------------------------------------------------------------

    return (
        <AppShell sidebar={<AdminSidebar />} mobileTitle="Voters">
            <PageHeader title="Voters" subtitle={`Bot-list votes on ${sourceLabel} in ${periodLabel}`} />

            {/* Page-level scope: period, then list */}
            <div className="flex items-center gap-3 mb-4 overflow-x-auto [scrollbar-width:none] -mx-4 px-4 sm:mx-0 sm:px-0">
                <Segmented
                    label="Period"
                    value={days}
                    onChange={setDays}
                    options={[{ value: 7, label: '7d' }, { value: 30, label: '30d' }, { value: 90, label: '90d' }, { value: 365, label: '1y' }]}
                />
                <Segmented
                    label="List"
                    value={source}
                    onChange={setSource}
                    options={[{ value: 'all', label: 'All lists' }, { value: 'topgg', label: 'Top.gg' }, { value: 'discordforge', label: 'DiscordForge' }]}
                />
            </div>

            {analyticsFailed && !analytics ? (
                <div className="panel">
                    <InlineError message="Couldn't load voter analytics. Are migrations 25–27 applied?" onRetry={retryAnalytics} />
                </div>
            ) : (
                <KpiStrip>
                    <Kpi tone="brand" label="Votes" loading={firstLoad} value={fmtCount(windowVotes)} caption={periodLabel} />
                    <Kpi tone="cyan" label="Unique voters" loading={firstLoad} value={windowVoters == null ? <span className="text-sm font-normal text-faint">Not available</span> : fmtCount(windowVoters)} caption={source === 'all' ? 'on either list' : `on ${SOURCE_LABELS[source]}`} />
                    <Kpi tone="positive" label="Voting on both lists" loading={firstLoad} value={fmtCount(ov?.both ?? 0)} caption={overlapTotal ? `${fmtPct(Number(ov?.both ?? 0), overlapTotal)} of all voters` : periodLabel} />
                    <Kpi tone="warning" label="Weekend share" loading={firstLoad} value={weekendShare ?? <span className="text-sm font-normal text-faint">No votes</span>} caption="Top.gg counts weekend votes twice" />
                </KpiStrip>
            )}

            {/* Row 1: votes over time + new vs returning */}
            <section className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4" aria-label="Trends">
                <Panel
                    title="Votes per day"
                    meta="(UTC)"
                    className="min-w-0"
                    bodyClassName="px-5 pb-4"
                    actions={visibleSources.length > 1 ? <DotLegend items={visibleSources.map(s => ({ label: SOURCE_LABELS[s], color: SOURCE_COLORS[s] }))} /> : undefined}
                >
                    <ChartBody height={PLOT_H} loading={firstLoad} error={chartError} onRetry={retryAnalytics} empty={histZero} emptyText={`No votes in ${periodLabel}.`}>
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={historyByDay} margin={{ top: 8, right: 4, bottom: 0, left: -8 }}>
                                <CartesianGrid {...gridProps} />
                                <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={28} />
                                <YAxis {...axisProps} width={44} {...countAxis(Math.max(0, ...historyByDay.map(r => Math.max(source === 'discordforge' ? 0 : r.topgg, source === 'topgg' ? 0 : r.discordforge))))} />
                                <Tooltip {...tooltipProps} cursor={{ stroke: chart.grid }} formatter={((v: unknown, n: unknown) => [fmtCount(v), String(n)]) as never} />
                                {visibleSources.map(s => (
                                    <Line key={s} type="linear" dataKey={s} name={SOURCE_LABELS[s]} stroke={source === 'all' ? SOURCE_COLORS[s] : chart.data} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} isAnimationActive={false} />
                                ))}
                            </LineChart>
                        </ResponsiveContainer>
                    </ChartBody>
                </Panel>

                <Panel
                    title="New and returning voters"
                    meta="(UTC)"
                    className="min-w-0"
                    bodyClassName="px-5 pb-4"
                    actions={<DotLegend items={[{ label: 'New', color: seriesPalette[0] }, { label: 'Returning', color: seriesPalette[1] }]} />}
                >
                    <ChartBody height={PLOT_H} loading={firstLoad} error={chartError} onRetry={retryAnalytics} empty={nrZero} emptyText={`No voters in ${periodLabel}.`}>
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={newReturning} margin={{ top: 8, right: 4, bottom: 0, left: -8 }}>
                                <CartesianGrid {...gridProps} />
                                <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={28} />
                                <YAxis {...axisProps} width={44} {...countAxis(Math.max(0, ...newReturning.map(r => r.new + r.returning)))} />
                                <Tooltip {...tooltipProps} formatter={((v: unknown, n: unknown) => [fmtCount(v), String(n)]) as never} />
                                {/* 1px surface-coloured stroke = the seam between stacked segments */}
                                <Bar dataKey="new" name="New" stackId="nr" fill={seriesPalette[0]} stroke="#2e3139" strokeWidth={1} isAnimationActive={false} />
                                <Bar dataKey="returning" name="Returning" stackId="nr" fill={seriesPalette[1]} stroke="#2e3139" strokeWidth={1} radius={[2, 2, 0, 0]} isAnimationActive={false} />
                            </BarChart>
                        </ResponsiveContainer>
                    </ChartBody>
                </Panel>
            </section>

            {/* Row 2: hourly + weekday + where votes come from */}
            <section className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4" aria-label="Patterns">
                <Panel title="Votes by hour" meta="(UTC)" className="min-w-0" bodyClassName="px-5 pb-4">
                    <ChartBody height={PLOT_H} loading={firstLoad} error={chartError} onRetry={retryAnalytics} empty={hourZero} emptyText="No votes in this period.">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={hourly} margin={{ top: 8, right: 4, bottom: 0, left: -8 }} barCategoryGap={1}>
                                <CartesianGrid {...gridProps} />
                                <XAxis dataKey="label" {...axisProps} ticks={['00:00', '06:00', '12:00', '18:00']} />
                                <YAxis {...axisProps} width={44} {...countAxis(Math.max(0, ...hourly.map(r => r.votes)))} />
                                <Tooltip {...tooltipProps} formatter={((v: unknown) => [fmtCount(v), 'Votes']) as never} />
                                <Bar dataKey="votes" fill={chart.data} radius={[2, 2, 0, 0]} isAnimationActive={false} />
                            </BarChart>
                        </ResponsiveContainer>
                    </ChartBody>
                </Panel>

                <Panel title="Votes by weekday" meta="(UTC)" className="min-w-0" bodyClassName="px-5 pb-4">
                    <ChartBody height={PLOT_H} loading={firstLoad} error={chartError} onRetry={retryAnalytics} empty={wdZero} emptyText="No votes in this period.">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={weekdays} margin={{ top: 8, right: 4, bottom: 0, left: -8 }}>
                                <CartesianGrid {...gridProps} />
                                <XAxis dataKey="label" {...axisProps} />
                                <YAxis {...axisProps} width={44} {...countAxis(Math.max(0, ...weekdays.map(r => r.votes)))} />
                                <Tooltip {...tooltipProps} formatter={((v: unknown) => [fmtCount(v), 'Votes']) as never} />
                                <Bar dataKey="votes" fill={chart.data} radius={[2, 2, 0, 0]} isAnimationActive={false} />
                            </BarChart>
                        </ResponsiveContainer>
                    </ChartBody>
                </Panel>

                <Panel title="Where voters vote" meta={periodLabel} className="min-w-0" bodyClassName="px-5 pb-4">
                    <div style={{ height: PLOT_H }} className="flex flex-col">
                        {chartError && !analytics ? (
                            <div className="h-full flex items-center"><InlineError message={chartError} onRetry={retryAnalytics} className="w-full" /></div>
                        ) : firstLoad ? (
                            <div className="skeleton w-full h-full" />
                        ) : (
                            <>
                                <ul>
                                    {overlapRows.map(r => (
                                        <li key={r.name} className="h-10 flex flex-col justify-center gap-1.5">
                                            <div className="flex items-baseline gap-2 text-sm">
                                                <span className="text-ink flex-1 truncate">{r.name}</span>
                                                <span className="num text-ink">{fmtCount(r.value)}</span>
                                                <span className="num text-xs text-faint w-12 text-right">{fmtPct(r.value, overlapTotal)}</span>
                                            </div>
                                            <ShareBar value={r.value} max={overlapMax} />
                                        </li>
                                    ))}
                                </ul>
                                <h3 className="text-[13px] text-faint mt-3 mb-1">Campaign links</h3>
                                {(analytics?.campaigns ?? []).length === 0 ? (
                                    <p className="text-sm text-faint">No votes came from a tagged link.</p>
                                ) : (
                                    <ul className="min-h-0 overflow-hidden">
                                        {(analytics?.campaigns ?? []).slice(0, 2).map(c => (
                                            <li key={c.campaign} className="h-7 flex items-center gap-2 text-sm">
                                                <span className="font-mono text-[13px] text-muted truncate flex-1">{c.campaign}</span>
                                                <span className="num text-ink">{fmtCount(c.votes)}</span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </>
                        )}
                    </div>
                </Panel>
            </section>

            {/* Row 3: top voters + live feed, capped to the same length */}
            <section className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4" aria-label="People">
                <Panel title="Top voters" meta={periodLabel} className="min-w-0" bodyClassName="pb-2">
                    <PeopleList
                        loading={firstLoad}
                        error={chartError && !analytics ? chartError : null}
                        onRetry={retryAnalytics}
                        empty="No bot-list votes in this period."
                        rows={topVoters.slice(0, LIST_ROWS).map((v, i) => ({
                            key: v.user_id,
                            lead: <span className="num text-[13px] text-faint w-5 shrink-0">{i + 1}.</span>,
                            avatar: <Avatar name={v.username || '?'} url={v.avatar_url} size={28} id={v.user_id} />,
                            title: v.username || 'Unknown user',
                            sub: sourcesText(v.sources),
                            value: fmtCount(v.votes),
                        }))}
                    />
                </Panel>
                <Panel title="Latest votes" meta="all lists · newest first" className="min-w-0" bodyClassName="pb-2">
                    <PeopleList
                        loading={firstLoad}
                        error={chartError && !analytics ? chartError : null}
                        onRetry={retryAnalytics}
                        empty="No votes yet. They appear here as they arrive."
                        rows={recentVotes.slice(0, LIST_ROWS).map(v => ({
                            key: String(v.id),
                            avatar: <Avatar name={v.username || '?'} url={v.avatar_url} size={28} id={v.user_id} />,
                            title: (
                                <>
                                    {v.username || 'Unknown user'}
                                    {v.is_test && <span className="chip chip-warning h-5 ml-2 text-[11px]">Test</span>}
                                </>
                            ),
                            sub: `${SOURCE_LABELS[v.source] ?? v.source}${v.weight > 1 ? ` · counts ×${v.weight}` : ''}${v.total_votes != null ? ` · ${fmtCount(v.total_votes)} total` : ''}`,
                            value: <span className="text-[13px] text-faint" title={fmtDateTime(v.created_at)}>{fmtRelative(v.created_at, nowMs)}</span>,
                        }))}
                    />
                </Panel>
            </section>

            {/* Voter directory */}
            <section className="mt-8" aria-label="Voter directory">
                <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
                    <div>
                        <h2 className="text-xl font-semibold text-ink">Directory</h2>
                        <p className="text-sm text-muted">
                            {total == null ? 'Everyone who voted in this period' : `${fmtCount(total)} ${total === 1 ? 'voter' : 'voters'} in ${periodLabel}`}
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
                        <SearchField value={searchInput} onChange={setSearchInput} placeholder="Search name or user ID" className="w-full sm:w-64" />
                        <Segmented
                            label="Sort"
                            value={sort}
                            onChange={setSort}
                            options={[{ value: 'votes', label: 'Most votes' }, { value: 'weighted', label: 'Weighted' }, { value: 'streak', label: 'Streak' }, { value: 'recent', label: 'Recent' }]}
                        />
                    </div>
                </div>

                <div className="panel">
                    {dirFailed && rows.length === 0 ? (
                        <InlineError message="Couldn't load the voter directory." onRetry={() => setDirTry(n => n + 1)} />
                    ) : !dirLoading && rows.length === 0 ? (
                        <div className="px-5 py-10 text-center">
                            <p className="text-sm font-semibold text-ink">No voters found</p>
                            <p className="text-sm text-faint mt-1">No bot-list votes match these filters.</p>
                        </div>
                    ) : (
                        <>
                            <table className={`data-table hidden md:table ${dirLoading && rows.length ? 'opacity-60' : ''}`}>
                                <thead>
                                    <tr>
                                        <th className="sticky top-0 bg-surface rounded-tl-lg pl-5 w-[30%]">Voter</th>
                                        <th className="sticky top-0 bg-surface">Lists</th>
                                        <th className="sticky top-0 bg-surface num">Votes</th>
                                        <th className="sticky top-0 bg-surface num">Streak</th>
                                        <th className="sticky top-0 bg-surface num" title="DiscordForge weekly / total votes">Forge week / total</th>
                                        <th className="sticky top-0 bg-surface num">Last vote</th>
                                        <th className="sticky top-0 bg-surface">Premium</th>
                                        <th className="sticky top-0 bg-surface rounded-tr-lg pr-5"><span className="sr-only">Actions</span></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {dirLoading && rows.length === 0
                                        ? Array.from({ length: 6 }, (_, i) => (
                                            <tr key={i}>
                                                <td className="pl-5"><div className="flex items-center gap-3"><div className="skeleton w-7 h-7 rounded-full" /><div className="skeleton h-3.5 w-32" /></div></td>
                                                <td><div className="skeleton h-3.5 w-20" /></td>
                                                {Array.from({ length: 4 }, (__, j) => <td key={j} className="num"><div className="skeleton h-3.5 w-10 ml-auto" /></td>)}
                                                <td><div className="skeleton h-5 w-16 rounded-full" /></td>
                                                <td className="pr-5" />
                                            </tr>
                                        ))
                                        : rows.map(v => (
                                            <tr key={v.user_id}>
                                                <td className="pl-5 max-w-0">
                                                    <div className="flex items-center gap-3 min-w-0">
                                                        <Avatar name={v.username || '?'} url={v.avatar_url} size={28} id={v.user_id} />
                                                        <div className="min-w-0">
                                                            <div className="text-ink truncate">{v.username || 'Unknown user'}</div>
                                                            <div className="font-mono text-xs text-faint truncate">{v.user_id}</div>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="whitespace-nowrap">{sourcesText(v.sources)}</td>
                                                <td className="num">
                                                    <div className="text-ink">{fmtCount(v.votes)}</div>
                                                    {Number(v.weighted_votes) > Number(v.votes) && <div className="text-xs text-faint" title="Weekend votes count double on Top.gg">{fmtCount(v.weighted_votes)} weighted</div>}
                                                </td>
                                                <td className="num">{Number(v.streak_days) > 1 ? `${fmtCount(v.streak_days)} days` : <Dash title="No streak" />}</td>
                                                <td className="num">{v.df_total_votes != null ? `${fmtCount(v.df_weekly_votes ?? 0)} / ${fmtCount(v.df_total_votes)}` : <Dash />}</td>
                                                <td className="num whitespace-nowrap" title={fmtDateTime(v.last_botlist_vote_at)}>{fmtRelative(v.last_botlist_vote_at, nowMs)}</td>
                                                <td><PremiumChip lastVote={v.premium_last_vote_at} expiresAt={v.premium_expires_at} nowMs={nowMs} /></td>
                                                <td className="pr-5 text-right">
                                                    <button type="button" onClick={() => navigate(`/polls?user_id=${v.user_id}`)} className="btn btn-ghost btn-sm whitespace-nowrap">
                                                        Polls created
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                </tbody>
                            </table>

                            {/* Phone/tablet: two-line rows */}
                            <ul className={`md:hidden ${dirLoading && rows.length ? 'opacity-60' : ''}`}>
                                {(dirLoading && rows.length === 0 ? [] : rows).map(v => (
                                    <li key={v.user_id} className="px-4 py-3 flex items-center gap-3 border-t border-rule first:border-t-0">
                                        <Avatar name={v.username || '?'} url={v.avatar_url} size={32} id={v.user_id} />
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm text-ink truncate flex-1">{v.username || 'Unknown user'}</span>
                                                <span className="num text-sm text-ink">{fmtCount(v.votes)}</span>
                                            </div>
                                            <div className="flex items-center gap-2 mt-0.5">
                                                <span className="text-[13px] text-faint truncate flex-1">
                                                    {sourcesText(v.sources)} · {fmtRelative(v.last_botlist_vote_at, nowMs)}{Number(v.streak_days) > 1 ? ` · ${v.streak_days}-day streak` : ''}
                                                </span>
                                                <PremiumChip lastVote={v.premium_last_vote_at} expiresAt={v.premium_expires_at} nowMs={nowMs} />
                                            </div>
                                            <button type="button" onClick={() => navigate(`/polls?user_id=${v.user_id}`)} className="text-[13px] text-brand-text mt-1 min-h-[28px]">
                                                Polls created
                                            </button>
                                        </div>
                                    </li>
                                ))}
                                {dirLoading && rows.length === 0 && Array.from({ length: 5 }, (_, i) => (
                                    <li key={i} className="px-4 py-3 flex items-center gap-3 border-t border-rule first:border-t-0">
                                        <div className="skeleton w-8 h-8 rounded-full" />
                                        <div className="flex-1 space-y-2"><div className="skeleton h-3.5 w-1/2" /><div className="skeleton h-3 w-2/3" /></div>
                                    </li>
                                ))}
                            </ul>

                            <div className="flex items-center justify-between gap-3 px-5 h-14 border-t border-rule">
                                <span className="num text-[13px] text-faint">
                                    {total == null ? '\u00a0' : `Showing ${fmtCount(rows.length)} of ${fmtCount(total)}`}
                                </span>
                                {dirFailed && rows.length > 0 ? (
                                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => void fetchDirectory(offset + PAGE_SIZE, true)}>Retry</button>
                                ) : !dirLoading && total != null && rows.length < total ? (
                                    <button type="button" onClick={() => void fetchDirectory(offset + PAGE_SIZE, true)} className="btn btn-outline btn-sm">
                                        Load {fmtCount(Math.min(PAGE_SIZE, total - rows.length))} more
                                    </button>
                                ) : null}
                            </div>
                        </>
                    )}
                </div>
            </section>
        </AppShell>
    );
};

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

interface PersonRow {
    key: string;
    lead?: React.ReactNode;
    avatar: React.ReactNode;
    title: React.ReactNode;
    sub: React.ReactNode;
    value: React.ReactNode;
}

/** A fixed-length list of people (LIST_ROWS rows) so paired cards end level. */
const PeopleList: React.FC<{ rows: PersonRow[]; loading: boolean; error: string | null; onRetry: () => void; empty: string }> = ({ rows, loading, error, onRetry, empty }) => {
    const h = LIST_ROWS * 52;
    if (error) return <div className="flex items-center" style={{ height: h }}><InlineError message={error} onRetry={onRetry} className="w-full" /></div>;
    if (loading) {
        return (
            <ul aria-busy="true">
                {Array.from({ length: LIST_ROWS }, (_, i) => (
                    <li key={i} className="h-[52px] px-5 flex items-center gap-3"><div className="skeleton w-7 h-7 rounded-full" /><div className="flex-1 space-y-1.5"><div className="skeleton h-3.5 w-2/5" /><div className="skeleton h-3 w-1/4" /></div></li>
                ))}
            </ul>
        );
    }
    if (rows.length === 0) {
        return (
            <div className="px-5" style={{ height: h }}>
                <div className="h-full flex items-center justify-center text-sm text-faint border border-dashed border-line rounded-lg px-6 text-center">{empty}</div>
            </div>
        );
    }
    return (
        <ol>
            {rows.map(r => (
                <li key={r.key} className="h-[52px] px-5 flex items-center gap-3 min-w-0">
                    {r.lead}
                    {r.avatar}
                    <div className="min-w-0 flex-1">
                        <div className="text-sm text-ink truncate flex items-center">{r.title}</div>
                        <div className="text-xs text-faint truncate">{r.sub}</div>
                    </div>
                    <span className="num text-sm text-ink shrink-0 text-right">{r.value}</span>
                </li>
            ))}
        </ol>
    );
};

/** Premium status from stacked `premium_expires_at` (or `lastVote + 13h`): active > 1 h left, grace <= 1 h left, then expired. */
const PremiumChip: React.FC<{ lastVote: string | null; expiresAt?: string | null; nowMs: number }> = ({ lastVote, expiresAt, nowMs }) => {
    if (!lastVote && !expiresAt) return <span className="chip">Never</span>;
    const expiryMs = expiresAt
        ? new Date(expiresAt).getTime()
        : (lastVote ? new Date(lastVote).getTime() + 13 * 36e5 : NaN);
    const remainingHours = (expiryMs - nowMs) / 36e5;
    if (remainingHours > 1) return <span className="chip chip-positive chip-dot">Premium</span>;
    if (remainingHours > 0) return <span className="chip chip-warning chip-dot">Grace</span>;
    return <span className="chip">Expired</span>;
};
