import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { ArrowLeft, SortDesc, SortAsc, TrendingUp, X, BarChart3, Search } from 'lucide-react';
import { PollCard } from '../components/PollCard';
import { FilterButton } from '../components/ui/FilterButton';
import { SkeletonList } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';

type StatusFilter = 'all' | 'active' | 'closed' | 'scheduled';
type SortMode = 'recent' | 'oldest' | 'popular';

const DATE_RANGES: { key: string; label: string; days: number | null }[] = [
    { key: '24h', label: '24h', days: 1 },
    { key: '7d', label: '7 days', days: 7 },
    { key: '30d', label: '30 days', days: 30 },
    { key: '90d', label: '90 days', days: 90 },
    { key: 'all', label: 'All time', days: null },
];

const PAGE_SIZES = [20, 50, 100];

export const PollsView: React.FC = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const userIdFilter = searchParams.get('user_id');
    const [polls, setPolls] = useState<any[]>([]);
    const [voteCounts, setVoteCounts] = useState<Record<string, Record<number, number>>>({});
    const [loading, setLoading] = useState(true);
    const [status, setStatus] = useState<StatusFilter>('all');
    const [sort, setSort] = useState<SortMode>('recent');
    const [dateRange, setDateRange] = useState('all');
    const [pageSize, setPageSize] = useState(20);
    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const [totalCount, setTotalCount] = useState<number | null>(null);
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(true);
    // Bump per fetch so out-of-order responses (fast filter toggling) are dropped.
    const requestRef = useRef(0);

    // Debounce the search box so we don't query per keystroke
    useEffect(() => {
        const t = setTimeout(() => setSearch(searchInput.trim()), 300);
        return () => clearTimeout(t);
    }, [searchInput]);

    useEffect(() => {
        setPolls([]);
        setVoteCounts({});
        setPage(1);
        setHasMore(true);
        setTotalCount(null);
        fetchPolls(1, true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userIdFilter, status, sort, dateRange, search, pageSize]);

    const fetchPolls = async (pageToFetch: number, reset = false) => {
        const reqId = ++requestRef.current;
        setLoading(true);
        try {
            const start = (pageToFetch - 1) * pageSize;
            const end = start + pageSize - 1;

            let query = supabase
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

            const { data: pollsData, count } = await query;
            if (reqId !== requestRef.current) return; // stale response — a newer filter won

            if (pollsData) {
                if (reset && count !== null && count !== undefined) setTotalCount(count);
                setHasMore(pollsData.length === pageSize);
                setPolls(prev => (reset ? pollsData : [...prev, ...pollsData]));

                // Batch vote counts via RPC — a raw votes .in() select silently
                // truncates at PostgREST's 1000-row cap on vote-heavy batches.
                const pollIds = pollsData.map(p => p.message_id);
                if (pollIds.length > 0) {
                    const { data: countsData } = await supabase.rpc('get_poll_vote_counts', { p_poll_ids: pollIds });
                    if (reqId !== requestRef.current) return;
                    if (countsData) {
                        setVoteCounts(prev => (reset ? countsData : { ...prev, ...countsData }));
                    }
                }
            }
        } catch (error) {
            console.error(error);
        } finally {
            if (reqId === requestRef.current) setLoading(false);
        }
    };

    const loadMore = () => {
        const nextPage = page + 1;
        setPage(nextPage);
        fetchPolls(nextPage);
    };

    const getVoteTotal = (pollId: string) => {
        const votes = voteCounts[pollId] || {};
        return Object.values(votes).reduce((a, b) => a + b, 0);
    };

    // 'Popular' sorts the loaded buffer by vote volume (server-side sort would
    // need a cached vote_count column; buffer sort covers the loaded pages).
    const displayPolls = [...polls].sort((a, b) => {
        if (sort === 'popular') {
            return getVoteTotal(b.message_id) - getVoteTotal(a.message_id);
        }
        return 0; // already sorted by date from the DB
    });

    const rangeLabel = DATE_RANGES.find(r => r.key === dateRange)?.label ?? 'All time';

    return (
        <div className="min-h-screen pb-20 p-8">
            <div className="container-wide animate-fade-in">
                <button
                    onClick={() => navigate('/dashboard')}
                    className="flex items-center gap-2 text-slate-400 hover:text-white mb-6 transition-colors"
                >
                    <ArrowLeft className="w-4 h-4" />
                    Back to Dashboard
                </button>

                <div className="flex flex-col gap-6 mb-10">
                    <div>
                        <h1 className="text-3xl font-bold text-white mb-2">Global Polls View</h1>
                        <p className="text-slate-400">
                            {totalCount === null
                                ? 'Loading polls…'
                                : `${totalCount.toLocaleString()} poll${totalCount === 1 ? '' : 's'} match (${rangeLabel.toLowerCase()}) — showing ${displayPolls.length.toLocaleString()}`}
                        </p>
                        {userIdFilter && (
                            <div className="flex items-center gap-2 mt-4 bg-indigo-500/20 w-fit px-3 py-1 rounded-lg border border-indigo-500/30">
                                <span className="text-indigo-300 text-sm">Filtered by Creator: <span className="font-mono">{userIdFilter}</span></span>
                                <button
                                    onClick={() => navigate('/polls')}
                                    className="p-1 hover:bg-indigo-500/20 rounded-full text-indigo-400 transition-colors"
                                >
                                    <X className="w-3 h-3" />
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Filter bar */}
                    <div className="flex flex-col gap-3">
                        <div className="flex flex-col sm:flex-row gap-3">
                            <div className="relative flex-1 max-w-md">
                                <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                                <input
                                    type="text"
                                    value={searchInput}
                                    onChange={e => setSearchInput(e.target.value)}
                                    placeholder="Search poll titles…"
                                    className="w-full bg-slate-900/50 border border-slate-700 rounded-lg pl-9 pr-9 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
                                />
                                {searchInput && (
                                    <button
                                        onClick={() => setSearchInput('')}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-white transition-colors"
                                        aria-label="Clear search"
                                    >
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                )}
                            </div>

                            <div className="flex items-center gap-2">
                                <span className="text-xs text-slate-500 uppercase tracking-wide">Per page</span>
                                <div className="flex bg-slate-900/50 p-1 rounded-lg border border-slate-700">
                                    {PAGE_SIZES.map(size => (
                                        <FilterButton key={size} active={pageSize === size} onClick={() => setPageSize(size)}>
                                            {size}
                                        </FilterButton>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-wrap gap-3">
                            <div className="flex bg-slate-900/50 p-1 rounded-lg border border-slate-700">
                                <FilterButton active={status === 'all'} onClick={() => setStatus('all')}>All</FilterButton>
                                <FilterButton active={status === 'active'} onClick={() => setStatus('active')}>Active</FilterButton>
                                <FilterButton active={status === 'closed'} onClick={() => setStatus('closed')}>Closed</FilterButton>
                                <FilterButton active={status === 'scheduled'} onClick={() => setStatus('scheduled')}>Auto-closing</FilterButton>
                            </div>

                            <div className="flex bg-slate-900/50 p-1 rounded-lg border border-slate-700">
                                {DATE_RANGES.map(r => (
                                    <FilterButton key={r.key} active={dateRange === r.key} onClick={() => setDateRange(r.key)}>
                                        {r.label}
                                    </FilterButton>
                                ))}
                            </div>

                            <div className="flex bg-slate-900/50 p-1 rounded-lg border border-slate-700">
                                <FilterButton active={sort === 'recent'} onClick={() => setSort('recent')}>
                                    <div className="flex items-center gap-2"><SortDesc className="w-4 h-4" /> Recent</div>
                                </FilterButton>
                                <FilterButton active={sort === 'oldest'} onClick={() => setSort('oldest')}>
                                    <div className="flex items-center gap-2"><SortAsc className="w-4 h-4" /> Oldest</div>
                                </FilterButton>
                                <FilterButton active={sort === 'popular'} onClick={() => setSort('popular')}>
                                    <div className="flex items-center gap-2" title="Sorts the polls loaded so far by vote volume"><TrendingUp className="w-4 h-4" /> Popular</div>
                                </FilterButton>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-4">
                    {displayPolls.length === 0 && !loading ? (
                        <div className="glass-panel">
                            <EmptyState
                                icon={<BarChart3 className="w-6 h-6" />}
                                title="No polls found"
                                subtitle="No polls match the current filters."
                            />
                        </div>
                    ) : (
                        displayPolls.map(poll => (
                            <PollCard
                                key={poll.message_id}
                                poll={poll}
                                votes={voteCounts[poll.message_id] || {}}
                                guild={poll.guilds}
                                showSupporterCard
                            />
                        ))
                    )}
                </div>

                {loading && (
                    <div className="mt-4">
                        <SkeletonList rows={4} height="h-24" />
                    </div>
                )}

                {!loading && hasMore && displayPolls.length > 0 && (
                    <div className="mt-8 text-center">
                        <button
                            onClick={loadMore}
                            className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold transition-colors shadow-lg shadow-indigo-500/20"
                        >
                            Load {Math.min(pageSize, Math.max((totalCount ?? pageSize) - polls.length, 0)) || pageSize} More
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};
