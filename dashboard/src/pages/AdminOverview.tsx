import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Info, RefreshCw } from 'lucide-react';
import { supabase, adminSupabase } from '../lib/supabase';
import { apiFetch } from '../utils/api';
import { AppShell } from '../components/shell/AppShell';
import { AdminSidebar } from '../components/shell/Sidebars';
import { Avatar, Freshness, GuildIcon, InlineError, Kpi, KpiStrip, PageHeader } from '../components/ui/primitives';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useToast } from '../components/ui/Toast';
import { Leaderboard, type LeaderboardItem } from '../components/Leaderboard';
import { VoteHistoryChart } from '../components/charts/VoteHistoryChart';
import { PeakHoursChart } from '../components/charts/PeakHoursChart';
import { UsageSourceChart } from '../components/charts/UsageSourceChart';
import { LanguageBreakdown } from '../components/charts/LanguagePieChart';
import { BotListVotesPanel } from '../components/charts/BotListVotesPanel';
import { shortId } from '../components/admin/adminFormat';
import { fmtCompact, fmtCount, fmtDate, plural, toNum } from '../lib/format';

interface Totals {
    servers: number | null;
    members: number | null;
    polls: number | null;
    openPolls: number | null;
    votes: number | null;
    ballots: number | null;
    /** 'rpc' = get_global_totals (exact); 'counters' = global_stats running counters. */
    source: 'rpc' | 'counters';
}

interface Section<T> {
    data: T | null;
    error: string | null;
}

const empty = <T,>(): Section<T> => ({ data: null, error: null });
const IS_MOCK = import.meta.env.VITE_MOCK_API === '1';

/** A KPI value; a missing figure is a small grey note, never a 24px dash. */
const kpiValue = (n: number | null | undefined): React.ReactNode =>
    n == null ? <span className="text-sm font-normal text-faint">Not available</span> : fmtCount(n);

/**
 * Bot admin overview: "Is PollBot healthy and growing?" Global totals, the
 * vote trend, when people vote, where usage comes from, bot-list votes and
 * the capped leaderboards. The server browser lives on /admin/servers.
 */
export const AdminOverview: React.FC = () => {
    const navigate = useNavigate();
    const toast = useToast();

    const [totals, setTotals] = useState<Section<Totals>>(empty);
    const [withPolls, setWithPolls] = useState<number | null>(null);
    const [premium, setPremium] = useState<number | null>(null);
    const [largest, setLargest] = useState<Section<LeaderboardItem[]>>(empty);
    const [active, setActive] = useState<Section<LeaderboardItem[]>>(empty);
    const [creators, setCreators] = useState<Section<LeaderboardItem[]>>(empty);
    const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
    const [refreshing, setRefreshing] = useState(true);
    const [refreshKey, setRefreshKey] = useState(0);

    const [syncing, setSyncing] = useState(false);
    const [showSyncConfirm, setShowSyncConfirm] = useState(false);
    const mounted = useRef(true);
    useEffect(() => () => { mounted.current = false; }, []);

    /* ------------------------------------------------------------ totals */

    const loadTotals = useCallback(async () => {
        try {
            const rpc = await adminSupabase.rpc('get_global_totals');
            const row = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data;
            if (!rpc.error && row) {
                setTotals({
                    error: null,
                    data: {
                        servers: toNum(row.servers),
                        members: toNum(row.members),
                        polls: toNum(row.total_polls),
                        openPolls: toNum(row.active_polls),
                        votes: toNum(row.vote_rows ?? row.weighted_votes),
                        ballots: toNum(row.ballots),
                        source: 'rpc',
                    },
                });
                return;
            }
            // Fallback (migration 31 not applied): the running counters.
            const [stats, guildCount, members, open] = await Promise.all([
                adminSupabase.from('global_stats').select('*').eq('id', 1).maybeSingle(),
                adminSupabase.from('guilds').select('id', { count: 'exact', head: true }).is('left_at', null),
                adminSupabase.rpc('get_total_members'),
                adminSupabase.from('polls').select('message_id', { count: 'exact', head: true }).eq('active', true),
            ]);
            if (stats.error && guildCount.error) throw stats.error;
            const s = stats.data as { total_polls?: number | string; total_votes?: number | string } | null;
            setTotals({
                error: null,
                data: {
                    servers: guildCount.error ? null : toNum(guildCount.count),
                    members: members.error ? null : toNum(members.data),
                    polls: toNum(s?.total_polls),
                    openPolls: open.error ? null : toNum(open.count),
                    votes: toNum(s?.total_votes),
                    ballots: null,
                    source: 'counters',
                },
            });
        } catch (err) {
            console.error('Error fetching totals:', err);
            setTotals(t => ({ data: t.data, error: "Couldn't load totals." }));
        }
    }, []);

    /* ------------------------------------------------------- everything */

    // Callers flip `refreshing` on; this only ever sets state after a request.
    const fetchData = useCallback(async () => {
        await Promise.all([
            loadTotals(),

            // Servers that have at least one poll (adoption); quiet if the RPC is missing.
            (async () => {
                const { data, error } = await adminSupabase.rpc('get_guild_browser', { p_search: null, p_sort: 'members_desc', p_curated: true, p_offset: 0, p_limit: 1 });
                setWithPolls(!error && Array.isArray(data) ? (data.length ? toNum(data[0].total_count) : 0) : null);
            })().catch(() => setWithPolls(null)),

            // Premium voters right now - aggregate RPC, no user rows.
            (async () => {
                const { data, error } = await adminSupabase.rpc('get_active_voter_count');
                setPremium(error ? null : toNum(data));
            })().catch(() => setPremium(null)),

            // Largest servers by members (independent of the browser's filters).
            (async () => {
                const { data, error } = await adminSupabase
                    .from('guilds')
                    .select('id, name, icon_url, member_count, locale, joined_at')
                    .is('left_at', null)
                    .order('member_count', { ascending: false, nullsFirst: false })
                    .limit(5);
                if (error) throw error;
                setLargest({
                    error: null,
                    data: (data as { id: string; name: string; icon_url: string | null; member_count: number | null; locale: string | null; joined_at: string | null }[]).map(g => ({
                        id: g.id,
                        label: g.name,
                        subLabel: [g.locale, g.joined_at ? `joined ${fmtDate(g.joined_at)}` : null].filter(Boolean).join(' · ') || undefined,
                        value: fmtCount(g.member_count),
                        leading: <GuildIcon name={g.name} iconUrl={g.icon_url} size={28} radius="8px" />,
                        onClick: () => navigate(`/server/${g.id}`),
                    })),
                });
            })().catch(err => { console.error(err); setLargest(s => ({ data: s.data, error: "Couldn't load servers." })); }),

            // Most active servers by vote volume, last 30 days.
            (async () => {
                const { data, error } = await adminSupabase.rpc('get_top_guilds', { p_days: 30, p_limit: 5 });
                if (error) throw error;
                setActive({
                    error: null,
                    data: ((data ?? []) as { guild_id: string; guild_name: string | null; votes: number | string; polls: number | string }[]).map(g => {
                        const name = g.guild_name || 'Unknown server';
                        return {
                            id: g.guild_id,
                            label: name,
                            subLabel: `${plural(toNum(g.polls) ?? 0, 'poll')} voted on`,
                            value: fmtCount(g.votes),
                            leading: <GuildIcon name={name} iconUrl={null} size={28} radius="8px" />,
                            onClick: () => navigate(`/server/${g.guild_id}`),
                        };
                    }),
                });
            })().catch(err => { console.error(err); setActive(s => ({ data: s.data, error: "Couldn't load active servers." })); }),

            // Top poll creators (aggregate RPC; v2 includes username/avatar).
            (async () => {
                const v2 = await adminSupabase.rpc('get_top_creators_v2', { p_limit: 5 });
                const { data, error } = v2.error ? await adminSupabase.rpc('get_top_creators', { p_limit: 5 }) : v2;
                if (error) throw error;
                setCreators({
                    error: null,
                    data: ((data ?? []) as { creator_id: string; polls: number | string; username?: string | null; avatar_url?: string | null }[]).map(c => ({
                        id: c.creator_id,
                        label: c.username || 'Unknown user',
                        subLabel: <span className="font-mono">{shortId(c.creator_id)}</span>,
                        value: fmtCount(c.polls),
                        leading: <Avatar name={c.username || '?'} url={c.avatar_url} size={28} id={c.creator_id} />,
                        onClick: () => navigate(`/polls?user_id=${c.creator_id}`),
                    })),
                });
            })().catch(err => { console.error(err); setCreators(s => ({ data: s.data, error: "Couldn't load creators." })); }),
        ]);
        if (!mounted.current) return;
        setUpdatedAt(new Date());
        setRefreshing(false);
    }, [loadTotals, navigate]);

    const refreshAll = useCallback(() => {
        setRefreshing(true);
        setRefreshKey(k => k + 1);
        void fetchData();
    }, [fetchData]);

    /* ------------------------------------------- realtime, throttled */

    useEffect(() => {
        void (async () => {
            await fetchData();
        })();

        // Throttle Realtime-driven refreshes to at most once per 15s (trailing)
        // and pause background queries while the tab is hidden so bursts of
        // votes across 13k+ servers cannot stampede PostgREST.
        const THROTTLE_MS = 15_000;
        let lastFetchedAt = Date.now();
        let throttleTimer: ReturnType<typeof setTimeout> | null = null;
        let pendingWhileHidden = false;

        const run = () => {
            lastFetchedAt = Date.now();
            setRefreshing(true);
            setRefreshKey(k => k + 1);
            void fetchData();
        };

        const scheduleFetch = () => {
            if (document.visibilityState === 'hidden') {
                pendingWhileHidden = true;
                return;
            }
            const elapsed = Date.now() - lastFetchedAt;
            if (elapsed >= THROTTLE_MS) {
                run();
            } else if (!throttleTimer) {
                throttleTimer = setTimeout(() => {
                    throttleTimer = null;
                    if (document.visibilityState === 'hidden') {
                        pendingWhileHidden = true;
                        return;
                    }
                    run();
                }, THROTTLE_MS - elapsed);
            }
        };

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible' && pendingWhileHidden) {
                pendingWhileHidden = false;
                run();
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);

        // Only `global_stats` is readable with the public anon key, and the
        // bot's counters update it on every poll and vote - one channel on
        // that row is an adequate "something changed" signal. The mock API
        // has no Supabase backend, so previews skip the subscription.
        const channel = IS_MOCK
            ? null
            : supabase
                .channel('admin-overview-updates')
                .on('postgres_changes', { event: '*', schema: 'public', table: 'global_stats' }, scheduleFetch)
                .subscribe();

        return () => {
            if (throttleTimer) clearTimeout(throttleTimer);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            if (channel) void supabase.removeChannel(channel);
        };
    }, [fetchData]);

    /* --------------------------------------------------------- sync */

    const handleSyncGuilds = async () => {
        setShowSyncConfirm(false);
        setSyncing(true);
        try {
            const res = await apiFetch('/api/admin/sync-guilds', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
            if (res.ok) {
                toast.success('Server sync started');
                // Give the shards a moment, then reload the numbers.
                setTimeout(() => {
                    if (!mounted.current) return;
                    refreshAll();
                    setSyncing(false);
                }, 3000);
            } else {
                const err = await res.json().catch(() => ({}));
                toast.error(`Sync failed: ${err.error || res.statusText}`);
                setSyncing(false);
            }
        } catch (error) {
            console.error('Sync error:', error);
            toast.error("Couldn't start the sync");
            setSyncing(false);
        }
    };

    /* --------------------------------------------------------- view */

    const t = totals.data;
    const kpiLoading = !t && !totals.error;
    const avgMembers = t?.servers && t.members != null ? Math.round(t.members / t.servers) : null;

    return (
        <AppShell sidebar={<AdminSidebar serverCount={t?.servers ?? null} />} mobileTitle="Overview">
            <PageHeader
                title="Overview"
                subtitle={
                    t
                        ? `${fmtCount(t.servers)} servers · ${fmtCompact(t.members)} members`
                        : totals.error ? 'Every server PollBot is in' : 'Loading totals…'
                }
                actions={
                    <>
                        <Freshness updatedAt={updatedAt} onRefresh={refreshAll} refreshing={refreshing} />
                        <button type="button" className="btn btn-outline" onClick={() => setShowSyncConfirm(true)} disabled={syncing}>
                            <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} aria-hidden="true" />
                            {syncing ? 'Syncing…' : 'Sync from Discord'}
                        </button>
                    </>
                }
            />

            {totals.error && !t ? (
                <div className="panel">
                    <InlineError message={totals.error} onRetry={() => void loadTotals()} />
                </div>
            ) : (
                <KpiStrip className="max-[720px]:[&>*:last-child:nth-child(odd)]:col-span-2">
                    <Kpi tone="brand" label="Servers" loading={kpiLoading} value={kpiValue(t?.servers)} caption={withPolls != null ? `${fmtCount(withPolls)} with polls` : undefined} />
                    <Kpi tone="cyan" label="Members" loading={kpiLoading} value={kpiValue(t?.members)} caption={avgMembers != null ? `${fmtCount(avgMembers)} per server on average` : undefined} />
                    <Kpi tone="positive" label="Polls" loading={kpiLoading} value={kpiValue(t?.polls)} caption={t?.openPolls != null ? `${fmtCount(t.openPolls)} open` : undefined} />
                    <Kpi tone="brand" label="Votes" loading={kpiLoading} value={kpiValue(t?.votes)} caption={t?.ballots != null ? `${fmtCount(t.ballots)} ballots cast` : 'all time'} />
                    <Kpi tone="warning" label="Premium voters now" loading={premium === null && !updatedAt} value={kpiValue(premium)} caption="voted in the last 12 hours" />
                </KpiStrip>
            )}
            {t?.source === 'counters' && (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-faint">
                    <Info className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    Poll and vote totals come from the running counters; exact totals and ballots need migration 31.
                </p>
            )}

            <section className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4" aria-label="Voting">
                <VoteHistoryChart refreshKey={refreshKey} className="lg:col-span-2" />
                <PeakHoursChart refreshKey={refreshKey} />
            </section>

            <section className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4" aria-label="Usage">
                <UsageSourceChart refreshKey={refreshKey} />
                <LanguageBreakdown refreshKey={refreshKey} />
            </section>

            <section className="mt-4" aria-label="Bot-list votes">
                <BotListVotesPanel refreshKey={refreshKey} />
            </section>

            <section className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4" aria-label="Leaderboards">
                <Leaderboard
                    title="Largest servers"
                    subtitle="by members"
                    items={largest.data ?? []}
                    loading={!largest.data && !largest.error}
                    error={largest.data ? null : largest.error}
                    onRetry={refreshAll}
                    emptyText="No servers yet."
                    action={<button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/admin/servers')}>View all</button>}
                />
                <Leaderboard
                    title="Most active servers"
                    subtitle="by votes · 30 days"
                    items={active.data ?? []}
                    loading={!active.data && !active.error}
                    error={active.data ? null : active.error}
                    onRetry={refreshAll}
                    emptyText="No votes in the last 30 days."
                />
                <Leaderboard
                    title="Top creators"
                    subtitle="by polls created"
                    items={creators.data ?? []}
                    loading={!creators.data && !creators.error}
                    error={creators.data ? null : creators.error}
                    onRetry={refreshAll}
                    emptyText="No polls yet."
                    action={<button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/polls')}>View all</button>}
                />
            </section>

            <ConfirmDialog
                open={showSyncConfirm}
                title="Sync every server from Discord?"
                message="This refreshes names, icons and member counts for every server PollBot is in. It's a heavy operation and can take a few minutes."
                confirmLabel="Sync all servers"
                busy={syncing}
                onConfirm={() => void handleSyncGuilds()}
                onCancel={() => setShowSyncConfirm(false)}
            />
        </AppShell>
    );
};
