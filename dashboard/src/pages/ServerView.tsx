import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { adminSupabase } from '../lib/supabase';
import { PollCard } from '../components/PollCard';
import { AppShell } from '../components/shell/AppShell';
import { AdminSidebar } from '../components/shell/Sidebars';
import { EmptyBlock, GuildIcon, InlineError, Kpi, KpiStrip, PageHeader } from '../components/ui/primitives';
import { Segmented } from '../components/admin/adminUi';
import { localeName } from '../components/admin/adminFormat';
import { fmtCount, fmtDate, toNum } from '../lib/format';
import type { Poll } from '../types';

interface AdminGuild {
    id: string;
    name: string;
    icon_url: string | null;
    member_count: number | null;
    joined_at: string | null;
    locale: string | null;
    left_at?: string | null;
}

type Filter = 'all' | 'active' | 'closed';
const PAGE_SIZE = 20;

/** A KPI value; a missing figure is a small grey note, never a 24px dash. */
const kpiValue = (n: number | null | undefined, missing = 'Not synced'): React.ReactNode =>
    n == null ? <span className="text-sm font-normal text-faint">{missing}</span> : fmtCount(n);

/**
 * One server, seen by the bot admin: what it is (members, language, when the
 * bot joined) and its polls, paged from the database with exact head counts.
 */
export const ServerView: React.FC = () => {
    const { id } = useParams<{ id: string }>();

    const [guild, setGuild] = useState<AdminGuild | null>(null);
    const [guildState, setGuildState] = useState<'loading' | 'ok' | 'missing' | 'error'>('loading');
    const [counts, setCounts] = useState<{ total: number | null; open: number | null } | null>(null);
    const [polls, setPolls] = useState<Poll[]>([]);
    const [voteCounts, setVoteCounts] = useState<Record<string, Record<number, number>>>({}); // pollId -> optionIndex -> count
    const [filter, setFilter] = useState<Filter>('all');
    const [listLoading, setListLoading] = useState(true);
    const [listError, setListError] = useState<string | null>(null);
    const [hasMore, setHasMore] = useState(false);
    const [retry, setRetry] = useState(0);
    const requestRef = useRef(0);

    // Server row + exact poll counts (head requests: no rows transferred, no 1000 cap)
    useEffect(() => {
        if (!id) return;
        let cancelled = false;
        (async () => {
            setGuildState('loading');
            try {
                const [g, total, open] = await Promise.all([
                    adminSupabase.from('guilds').select('id, name, icon_url, member_count, joined_at, locale, left_at').eq('id', id).maybeSingle(),
                    adminSupabase.from('polls').select('message_id', { count: 'exact', head: true }).eq('guild_id', id),
                    adminSupabase.from('polls').select('message_id', { count: 'exact', head: true }).eq('guild_id', id).eq('active', true),
                ]);
                if (cancelled) return;
                if (g.error) throw g.error;
                setGuild(g.data as AdminGuild | null);
                setGuildState(g.data ? 'ok' : 'missing');
                setCounts({ total: total.error ? null : toNum(total.count), open: open.error ? null : toNum(open.count) });
            } catch (err) {
                console.error(err);
                if (!cancelled) setGuildState('error');
            }
        })();
        return () => { cancelled = true; };
    }, [id, retry]);

    const fetchPage = useCallback(async (offset: number, reset: boolean) => {
        if (!id) return;
        const reqId = ++requestRef.current;
        try {
            let query = adminSupabase.from('polls').select('*').eq('guild_id', id);
            if (filter === 'active') query = query.eq('active', true);
            if (filter === 'closed') query = query.eq('active', false);
            const { data, error } = await query.order('created_at', { ascending: false }).range(offset, offset + PAGE_SIZE - 1);
            if (reqId !== requestRef.current) return;
            if (error) throw error;
            const page = (data ?? []) as Poll[];
            setPolls(prev => (reset ? page : [...prev, ...page]));
            setHasMore(page.length === PAGE_SIZE);
            setListError(null);

            // Weighted vote counts for just this page (immune to the 1000-row cap)
            const ids = page.map(p => p.message_id);
            if (ids.length) {
                const { data: countsData } = await adminSupabase.rpc('get_poll_vote_counts', { p_poll_ids: ids });
                if (reqId !== requestRef.current) return;
                if (countsData && typeof countsData === 'object') {
                    setVoteCounts(prev => ({ ...(reset ? {} : prev), ...(countsData as Record<string, Record<number, number>>) }));
                }
            } else if (reset) {
                setVoteCounts({});
            }
        } catch (err) {
            console.error(err);
            if (reqId === requestRef.current) setListError("Couldn't load this server's polls.");
        } finally {
            if (reqId === requestRef.current) setListLoading(false);
        }
    }, [id, filter]);

    // The first page replaces the list when it lands; callers flip listLoading on.
    useEffect(() => {
        void (async () => {
            await fetchPage(0, true);
        })();
    }, [fetchPage, retry]);

    const loadMore = () => {
        setListLoading(true);
        void fetchPage(polls.length, false);
    };
    const reload = () => {
        setListLoading(true);
        setRetry(n => n + 1);
    };

    const total = counts?.total ?? null;
    const open = counts?.open ?? null;
    const closed = total != null && open != null ? total - open : null;
    const listTotal = filter === 'all' ? total : filter === 'active' ? open : closed;
    const name = guild?.name || (guildState === 'missing' ? 'Unknown server' : 'Server');

    const subtitle = guildState === 'loading'
        ? 'Loading server…'
        : guildState === 'missing'
            ? `No server with ID ${id} is in the database.`
            : guild
                ? [
                    guild.left_at ? `PollBot left ${fmtDate(guild.left_at)}` : guild.joined_at ? `Joined ${fmtDate(guild.joined_at)}` : 'Join date unknown',
                    guild.locale ? localeName(guild.locale) : null,
                ].filter(Boolean).join(' · ')
                : '';

    const segLabel = (label: string, n: number | null) => (
        <>{label}{n != null && <span className="num text-faint">{fmtCount(n)}</span>}</>
    );

    return (
        <AppShell sidebar={<AdminSidebar />} mobileTitle={name}>
            <PageHeader
                leading={guildState === 'loading' ? <div className="skeleton w-12 h-12 rounded-xl" /> : <GuildIcon name={name} iconUrl={guild?.icon_url} size={48} radius="14px" />}
                title={guildState === 'loading' ? <span className="skeleton inline-block h-7 w-56 align-middle" /> : name}
                subtitle={<>{subtitle}{id && <span className="text-faint"> · <span className="font-mono text-[13px]">{id}</span></span>}</>}
            />

            {guildState === 'error' ? (
                <div className="panel"><InlineError message="Couldn't load this server." onRetry={reload} /></div>
            ) : (
                <KpiStrip>
                    <Kpi tone="brand" label="Members" loading={guildState === 'loading'} value={kpiValue(guild?.member_count)} />
                    <Kpi tone="cyan" label="Polls" loading={counts === null} value={kpiValue(total, 'Not available')} />
                    <Kpi tone="positive" label="Open" loading={counts === null} value={kpiValue(open, 'Not available')} />
                    <Kpi label="Closed" loading={counts === null} value={kpiValue(closed, 'Not available')} />
                </KpiStrip>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 mt-6 mb-3">
                <h2 className="text-base font-semibold text-ink">Polls</h2>
                <Segmented
                    label="Status"
                    value={filter}
                    onChange={v => { if (v !== filter) { setFilter(v); setPolls([]); setListLoading(true); } }}
                    options={[
                        { value: 'all', label: segLabel('All', total) },
                        { value: 'active', label: segLabel('Open', open) },
                        { value: 'closed', label: segLabel('Closed', closed) },
                    ]}
                />
            </div>

            {listError && polls.length === 0 ? (
                <div className="panel"><InlineError message={listError} onRetry={reload} /></div>
            ) : polls.length === 0 && !listLoading ? (
                <div className="panel">
                    <EmptyBlock title={filter === 'all' ? 'No polls on this server yet' : filter === 'active' ? 'No open polls' : 'No closed polls'}>
                        {filter === 'all' ? 'Polls appear here once someone runs /poll in this server.' : 'Switch the filter to see the rest.'}
                    </EmptyBlock>
                </div>
            ) : (
                <div className="flex flex-col gap-2">
                    {polls.map(poll => <PollCard key={poll.message_id} poll={poll} votes={voteCounts[poll.message_id] || {}} />)}
                    {listLoading && Array.from({ length: polls.length ? 2 : 4 }, (_, i) => (
                        <div key={`s${i}`} className="panel h-[66px] px-5 flex items-center gap-3" aria-hidden="true">
                            <div className="skeleton w-4 h-4" />
                            <div className="flex-1 space-y-2"><div className="skeleton h-3.5 w-1/2" /><div className="skeleton h-3 w-1/4" /></div>
                            <div className="skeleton h-5 w-16 rounded-full" />
                            <div className="skeleton h-4 w-12" />
                        </div>
                    ))}
                </div>
            )}

            {listError && polls.length > 0 && <div className="panel mt-2"><InlineError message={listError} onRetry={loadMore} /></div>}

            {polls.length > 0 && (
                <div className="mt-4 flex items-center justify-between gap-3">
                    <span className="num text-[13px] text-faint">
                        Showing {fmtCount(polls.length)}{listTotal != null ? ` of ${fmtCount(listTotal)}` : ''}
                    </span>
                    {!listLoading && hasMore && (listTotal == null || polls.length < listTotal) && (
                        <button type="button" className="btn btn-outline" onClick={loadMore}>
                            Load {fmtCount(Math.min(PAGE_SIZE, listTotal != null ? listTotal - polls.length : PAGE_SIZE))} more
                        </button>
                    )}
                </div>
            )}
        </AppShell>
    );
};
