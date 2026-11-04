import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { X } from 'lucide-react';
import { adminSupabase } from '../lib/supabase';
import { PollCard } from '../components/PollCard';
import { AppShell } from '../components/shell/AppShell';
import { AdminSidebar } from '../components/shell/Sidebars';
import { EmptyBlock, InlineError, PageHeader, SearchField } from '../components/ui/primitives';
import { Segmented } from '../components/admin/adminUi';
import { fmtCount } from '../lib/format';
import type { Poll } from '../types';

type PollWithGuild = Poll & {
    guilds?: { id: string; name: string; icon_url: string | null } | null;
};

type StatusFilter = 'all' | 'active' | 'closed' | 'scheduled';
type SortMode = 'recent' | 'oldest' | 'popular';

const DATE_RANGES: { key: string; label: string; days: number | null; phrase: string }[] = [
    { key: '24h', label: '24h', days: 1, phrase: 'created in the last 24 hours' },
    { key: '7d', label: '7d', days: 7, phrase: 'created in the last 7 days' },
    { key: '30d', label: '30d', days: 30, phrase: 'created in the last 30 days' },
    { key: '90d', label: '90d', days: 90, phrase: 'created in the last 90 days' },
    { key: 'all', label: 'All time', days: null, phrase: 'all time' },
];

const PAGE_SIZES = [20, 50, 100];

/** Every poll across every server, newest first, with filters. */
export const PollsView: React.FC = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const userIdFilter = searchParams.get('user_id');
    const [polls, setPolls] = useState<PollWithGuild[]>([]);
    const [voteCounts, setVoteCounts] = useState<Record<string, Record<number, number>>>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [status, setStatus] = useState<StatusFilter>('all');
    const [sort, setSort] = useState<SortMode>('recent');
    const [dateRange, setDateRange] = useState('all');
    const [pageSize, setPageSize] = useState(20);
    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const [totalCount, setTotalCount] = useState<number | null>(null);
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(true);
    const [retry, setRetry] = useState(0);
    // Bump per fetch so out-of-order responses (fast filter toggling) are dropped.
    const requestRef = useRef(0);

    // Debounce the search box so we don't query per keystroke
    useEffect(() => {
        const t = setTimeout(() => setSearch(searchInput.trim()), 300);
        return () => clearTimeout(t);
    }, [searchInput]);

    const runPollsQuery = useCallback(async (pageToFetch: number, reset: boolean) => {
        const reqId = ++requestRef.current;
        try {
            const start = (pageToFetch - 1) * pageSize;
            const end = start + pageSize - 1;

            let query = adminSupabase
                .from('polls')
                .select('*, guilds(id, name, icon_url)', reset ? { count: 'exact' } : {})
                .range(start, end);

            if (userIdFilter) query = query.eq('creator_id', userIdFilter);

            if (status === 'active') query = query.eq('active', true);
            if (status === 'closed') query = query.eq('active', false);
            if (status === 'scheduled') query = query.eq('active', true).not('ends_at', 'is', null);

            const range = DATE_RANGES.find(r => r.key === dateRange);
            if (range?.days) {
                query = query.gte('created_at', new Date(Date.now() - range.days * 86400000).toISOString());
            }

            if (search) {
                // Escape ilike wildcards so a literal % or _ in the box behaves
                query = query.ilike('title', `%${search.replace(/[\\%_]/g, m => `\\${m}`)}%`);
            }

            query = query.order('created_at', { ascending: sort === 'oldest' });

            const { data: pollsData, count, error: qError } = await query;
            if (reqId !== requestRef.current) return; // stale response — a newer filter won
            if (qError) throw qError;

            if (pollsData) {
                const typedPolls = pollsData as PollWithGuild[];
                if (reset) {
                    setPage(1);
                    setTotalCount(count ?? 0);
                }
                setHasMore(typedPolls.length === pageSize);
                setPolls(prev => (reset ? typedPolls : [...prev, ...typedPolls]));
                setError(null);

                // Batch vote counts via RPC — a raw votes .in() select silently
                // truncates at PostgREST's 1000-row cap on vote-heavy batches.
                const pollIds = typedPolls.map(p => p.message_id);
                if (pollIds.length > 0) {
                    const { data: countsData } = await adminSupabase.rpc('get_poll_vote_counts', { p_poll_ids: pollIds });
                    if (reqId !== requestRef.current) return;
                    const nextCounts = (countsData as Record<string, Record<number, number>> | null) || {};
                    setVoteCounts(prev => (reset ? nextCounts : { ...prev, ...nextCounts }));
                } else if (reset) {
                    setVoteCounts({});
                }
            }
        } catch (err) {
            console.error(err);
            if (reqId === requestRef.current) setError("Couldn't load polls.");
        } finally {
            if (reqId === requestRef.current) setLoading(false);
        }
    }, [pageSize, userIdFilter, status, dateRange, search, sort]);

    useEffect(() => {
        (async () => {
            setLoading(true);
            setPolls([]);
            setVoteCounts({});
            setTotalCount(null);
            await runPollsQuery(1, true);
        })();
    }, [runPollsQuery, retry]);

    const loadMore = () => {
        const nextPage = page + 1;
        setPage(nextPage);
        setLoading(true);
        void runPollsQuery(nextPage, false);
    };

    const getVoteTotal = (pollId: string) => {
        const votes = voteCounts[pollId] || {};
        return Object.values(votes).reduce((a, b) => a + b, 0);
    };

    // 'Most votes' sorts the loaded buffer by vote volume (server-side sort would
    // need a cached vote_count column; buffer sort covers the loaded pages).
    const displayPolls = [...polls].sort((a, b) => {
        if (sort === 'popular') {
            return getVoteTotal(b.message_id) - getVoteTotal(a.message_id);
        }
        return 0; // already sorted by date from the DB
    });

    const rangeLabel = DATE_RANGES.find(r => r.key === dateRange)?.phrase ?? 'all time';
    const remaining = Math.max((totalCount ?? 0) - polls.length, 0);

    return (
        <AppShell sidebar={<AdminSidebar />} mobileTitle="Polls">
            <PageHeader
                title="Polls"
                subtitle={totalCount === null ? 'Every poll on every server' : `${fmtCount(totalCount)} ${totalCount === 1 ? 'poll' : 'polls'} · ${rangeLabel}`}
            />

            {userIdFilter && (
                <div className="flex items-center gap-2 mb-4">
                    <span className="chip h-7 pl-3 pr-1 gap-2 text-[13px]">
                        Created by <span className="font-mono text-faint">{userIdFilter}</span>
                        <button
                            type="button"
                            onClick={() => navigate('/polls')}
                            aria-label="Clear creator filter"
                            className="w-5 h-5 rounded-full flex items-center justify-center text-faint hover:text-ink hover:bg-[var(--state-hover)]"
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    </span>
                </div>
            )}

            {/* Toolbar: search and scope on the left, order on the right */}
            <div className="flex flex-col gap-3 mb-4">
                <div className="flex flex-wrap items-center gap-3">
                    <SearchField value={searchInput} onChange={setSearchInput} placeholder="Search poll titles" className="w-full sm:w-72" />
                    <div className="flex items-center gap-3 sm:ml-auto">
                        <label className="flex items-center gap-2 text-[13px] text-faint">
                            Sort
                            <select className="field w-40" value={sort} onChange={e => setSort(e.target.value as SortMode)}>
                                <option value="recent">Newest first</option>
                                <option value="oldest">Oldest first</option>
                                <option value="popular">Most votes (loaded)</option>
                            </select>
                        </label>
                        <label className="flex items-center gap-2 text-[13px] text-faint">
                            Show
                            <select className="field w-20" value={pageSize} onChange={e => setPageSize(Number(e.target.value))}>
                                {PAGE_SIZES.map(size => <option key={size} value={size}>{size}</option>)}
                            </select>
                        </label>
                    </div>
                </div>
                <div className="flex items-center gap-3 overflow-x-auto [scrollbar-width:none] -mx-4 px-4 sm:mx-0 sm:px-0">
                    <Segmented
                        label="Status"
                        value={status}
                        onChange={setStatus}
                        options={[
                            { value: 'all', label: 'All' },
                            { value: 'active', label: 'Open' },
                            { value: 'closed', label: 'Closed' },
                            { value: 'scheduled', label: 'Auto-closing' },
                        ]}
                    />
                    <Segmented label="Created" value={dateRange} onChange={setDateRange} options={DATE_RANGES.map(r => ({ value: r.key, label: r.label }))} />
                </div>
            </div>

            {error && polls.length === 0 ? (
                <div className="panel"><InlineError message={error} onRetry={() => setRetry(n => n + 1)} /></div>
            ) : displayPolls.length === 0 && !loading ? (
                <div className="panel">
                    <EmptyBlock title="No polls match these filters">
                        {search ? 'Try a shorter search, or widen the date range.' : 'Widen the date range or clear the status filter.'}
                    </EmptyBlock>
                </div>
            ) : (
                <div className="flex flex-col gap-2">
                    {displayPolls.map(poll => (
                        <PollCard
                            key={poll.message_id}
                            poll={poll}
                            votes={voteCounts[poll.message_id] || {}}
                            guild={poll.guilds || undefined}
                            showSupporterCard
                        />
                    ))}
                    {loading && Array.from({ length: polls.length ? 2 : 6 }, (_, i) => (
                        <div key={`s${i}`} className="panel h-[66px] px-5 flex items-center gap-3" aria-hidden="true">
                            <div className="skeleton w-4 h-4" />
                            <div className="flex-1 space-y-2"><div className="skeleton h-3.5 w-1/2" /><div className="skeleton h-3 w-1/4" /></div>
                            <div className="skeleton h-5 w-16 rounded-full" />
                            <div className="skeleton h-4 w-12" />
                        </div>
                    ))}
                </div>
            )}

            {error && polls.length > 0 && <div className="panel mt-2"><InlineError message={error} onRetry={loadMore} /></div>}

            {displayPolls.length > 0 && (
                <div className="mt-4 flex items-center justify-between gap-3">
                    <span className="num text-[13px] text-faint">
                        Showing {fmtCount(displayPolls.length)}{totalCount != null ? ` of ${fmtCount(totalCount)}` : ''}
                    </span>
                    {!loading && hasMore && remaining > 0 && (
                        <button type="button" onClick={loadMore} className="btn btn-outline">
                            Load {fmtCount(Math.min(pageSize, remaining))} more
                        </button>
                    )}
                </div>
            )}
        </AppShell>
    );
};
