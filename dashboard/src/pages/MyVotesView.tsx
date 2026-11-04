import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { AppShell } from '../components/shell/AppShell';
import { HomeSidebar } from '../components/shell/Sidebars';
import { EmptyBlock, GuildIcon, InlineError, PageHeader, Panel, PollStatusChip, SearchField } from '../components/ui/primitives';
import { apiFetch } from '../utils/api';
import { fmtCount, fmtDateTime, fmtRelative, plural } from '../lib/format';
import type { MyVote } from '../types';

const PAGE_SIZE = 25;

/**
 * Every poll the signed-in user voted in.
 * Question: "What did I vote for, and where?" A list of ballots, newest first,
 * each linking back to the poll message in Discord.
 */
export const MyVotesView: React.FC = () => {
    const [votes, setVotes] = useState<MyVote[]>([]);
    const [total, setTotal] = useState<number | null>(null);
    const [offset, setOffset] = useState(0);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [query, setQuery] = useState('');

    const fetchVotes = useCallback(async (nextOffset: number) => {
        setError(null);
        try {
            const res = await apiFetch(`/api/user/votes?limit=${PAGE_SIZE}&offset=${nextOffset}`);
            if (!res.ok) {
                setError("Couldn't load your votes.");
                return;
            }
            const data = await res.json();
            const page: MyVote[] = data.votes || [];
            // A multi-select ballot can straddle two pages; merge by poll so a
            // poll is never listed twice.
            setVotes(prev => {
                if (nextOffset === 0) return page;
                const byPoll = new Map(prev.map(v => [v.poll_id, v]));
                for (const v of page) {
                    const existing = byPoll.get(v.poll_id);
                    byPoll.set(v.poll_id, existing
                        ? { ...existing, chosen_options: [...new Set([...existing.chosen_options, ...v.chosen_options])] }
                        : v);
                }
                return [...byPoll.values()];
            });
            setTotal(typeof data.total === 'number' ? data.total : null);
            setOffset(nextOffset + PAGE_SIZE);
        } catch (err) {
            console.error('Error fetching votes:', err);
            setError("Couldn't load your votes.");
        }
    }, []);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            await fetchVotes(0);
            if (!cancelled) setLoading(false);
        })();
        return () => { cancelled = true; };
    }, [fetchVotes]);

    const loadMore = async () => {
        setLoadingMore(true);
        await fetchVotes(offset);
        setLoadingMore(false);
    };

    const hasMore = total !== null && offset < total;
    const servers = useMemo(() => new Set(votes.map(v => v.guild_id)).size, [votes]);
    const open = useMemo(() => votes.filter(v => v.active && !v.discord_deleted).length, [votes]);

    const rows = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return votes;
        return votes.filter(v => v.title.toLowerCase().includes(q) || v.guild_name.toLowerCase().includes(q) || v.chosen_options.some(o => o.toLowerCase().includes(q)));
    }, [votes, query]);

    const subtitle = loading
        ? 'Loading your votes…'
        : total === null
            ? 'Every poll you voted in'
            : total === 0
                ? 'You haven’t voted in any PollBot polls yet'
                : `${plural(total, 'poll')} you voted in${votes.length >= (total ?? 0) ? ` across ${plural(servers, 'server')} · ${fmtCount(open)} still open` : ''}`;

    return (
        <AppShell sidebar={<HomeSidebar />} mobileTitle="My votes">
            <PageHeader title="My votes" subtitle={subtitle} />

            <Panel
                title="Ballots"
                meta={!loading && !error && votes.length ? 'Newest first' : undefined}
                actions={votes.length > 8 ? <SearchField value={query} onChange={setQuery} placeholder="Find a poll or server" className="w-60" /> : undefined}
            >
                {error && votes.length === 0 ? (
                    <InlineError message={error} onRetry={() => { setLoading(true); void fetchVotes(0).then(() => setLoading(false)); }} />
                ) : loading ? (
                    <ul aria-hidden="true">
                        {[0, 1, 2, 3, 4].map(i => (
                            <li key={i} className="h-[68px] px-5 flex items-center gap-3 border-t border-rule">
                                <div className="skeleton w-9 h-9 rounded-xl" />
                                <div className="flex-1">
                                    <div className="skeleton h-4 w-64 max-w-full" />
                                    <div className="skeleton h-3 w-40 mt-2" />
                                </div>
                            </li>
                        ))}
                    </ul>
                ) : votes.length === 0 ? (
                    <EmptyBlock title="No votes yet">
                        When you vote on a PollBot poll in any server, it shows up here with the option you picked.
                    </EmptyBlock>
                ) : rows.length === 0 ? (
                    <EmptyBlock title={`Nothing matches “${query}”`} />
                ) : (
                    <ul>
                        {rows.map(v => (
                            <li key={v.poll_id} className="border-t border-rule">
                                <div className="min-h-[68px] px-5 py-3 flex flex-col sm:flex-row sm:items-center gap-x-4 gap-y-2">
                                    <div className="flex items-center gap-3 min-w-0 flex-1">
                                        <GuildIcon name={v.guild_name} iconUrl={v.guild_icon_url} size={36} radius="12px" />
                                        <div className="min-w-0">
                                            <div className="text-[15px] leading-5 font-medium text-ink truncate">{v.title}</div>
                                            <div className="text-xs text-faint truncate mt-0.5">
                                                {v.guild_name} · <span title={fmtDateTime(v.voted_at)}>{fmtRelative(v.voted_at)}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 flex-wrap sm:justify-end pl-12 sm:pl-0">
                                        <span className="text-sm text-muted max-w-[260px] truncate" title={v.chosen_options.join(', ')}>
                                            <span className="text-faint">Picked </span>
                                            <span className="text-ink">{v.chosen_options.join(', ')}</span>
                                        </span>
                                        {v.weight > 1 && <span className="chip num" title="Your vote counted more than once because of a weighted role">×{v.weight}</span>}
                                        <PollStatusChip active={v.active} deleted={!!v.discord_deleted} endsAt={v.ends_at} />
                                        {!v.discord_deleted && (
                                            <a
                                                href={`https://discord.com/channels/${v.guild_id}/${v.channel_id}/${v.poll_id}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="btn btn-ghost btn-sm btn-icon"
                                                aria-label={`Open “${v.title}” in Discord`}
                                                title="Open in Discord"
                                            >
                                                <ExternalLink className="w-3.5 h-3.5" />
                                            </a>
                                        )}
                                    </div>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
                {hasMore && !query && (
                    <div className="border-t border-rule px-5 py-3 flex items-center justify-between">
                        <span className="text-xs text-faint num">Showing {fmtCount(votes.length)} of {fmtCount(total)}</span>
                        <button type="button" onClick={loadMore} disabled={loadingMore} className="btn btn-outline btn-sm">
                            {loadingMore && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                            Load more
                        </button>
                    </div>
                )}
                {error && votes.length > 0 && <InlineError message={error} onRetry={loadMore} className="border-t border-rule" />}
            </Panel>
        </AppShell>
    );
};
