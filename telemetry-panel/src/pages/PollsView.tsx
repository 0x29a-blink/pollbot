import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { ArrowLeft, Filter, SortDesc, TrendingUp } from 'lucide-react';
import { PollCard } from '../components/PollCard';
import type { Poll } from '../types';

export const PollsView: React.FC = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const userIdFilter = searchParams.get('user_id');
    const [polls, setPolls] = useState<any[]>([]);
    const [voteCounts, setVoteCounts] = useState<Record<string, Record<number, number>>>({});
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<'all' | 'active' | 'closed'>('all');
    const [sort, setSort] = useState<'recent' | 'popular'>('recent');
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(true);
    const ITEMS_PER_PAGE = 20;

    useEffect(() => {
        setPolls([]);
        setPage(1);
        setHasMore(true);
        fetchPolls(1, true);
    }, [userIdFilter, filter, sort]); // Reset on filter change

    const fetchPolls = async (pageToFetch: number, reset = false) => {
        setLoading(true);
        try {
            const start = (pageToFetch - 1) * ITEMS_PER_PAGE;
            const end = start + ITEMS_PER_PAGE - 1;

            let query = supabase
                .from('polls')
                .select('*, guilds(id, name, icon_url)')
                .range(start, end);

            // Apply Filters
            if (userIdFilter) query = query.eq('creator_id', userIdFilter);
            if (filter === 'active') query = query.eq('active', true);
            if (filter === 'closed') query = query.eq('active', false);

            // Apply Sort
            if (sort === 'recent') {
                query = query.order('created_at', { ascending: false });
            } else {
                // For popular, we ideally need a joined vote count or a cached column.
                // Since 'polls' doesn't have vote_count, client-side sort of THIS page is all we can do easily without RPC.
                // We'll stick to 'created_at' for backend query and maybe warn user 'popular' is approximation or just sort the fetched batch.
                // Let's stick to created_at desc for fetching, then client sort if needed, but pagination makes that hard.
                // Fallback: Just order by created_at for now if sort is popular, or we add a helper column later.
                query = query.order('created_at', { ascending: false });
            }

            const { data: pollsData } = await query;

            if (pollsData) {
                if (pollsData.length < ITEMS_PER_PAGE) {
                    setHasMore(false);
                }

                const newPolls = reset ? pollsData : [...polls, ...pollsData];

                // If sorting by popular mixed with pagination, it's tricky. 
                // We'll just append for now.

                setPolls(newPolls);

                // Fetch Votes for batch
                const pollIds = pollsData.map(p => p.message_id);
                if (pollIds.length > 0) {
                    const { data: votesData } = await supabase
                        .from('votes')
                        .select('poll_id, option_index')
                        .in('poll_id', pollIds);

                    if (votesData) {
                        setVoteCounts(prev => {
                            const counts = { ...prev };
                            votesData.forEach((vote: any) => {
                                if (!counts[vote.poll_id]) counts[vote.poll_id] = {};
                                if (!counts[vote.poll_id][vote.option_index]) counts[vote.poll_id][vote.option_index] = 0;
                                counts[vote.poll_id][vote.option_index]++;
                            });
                            return counts;
                        });
                    }
                }
            }
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
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

    // Client-side sort for the current buffer if 'popular' allowed (imperfect with pagination)
    const displayPolls = [...polls].sort((a, b) => {
        if (sort === 'popular') {
            return getVoteTotal(b.message_id) - getVoteTotal(a.message_id);
        }
        return 0; // Already sorted by date from DB
    });

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

                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-10">
                    <div>
                        <h1 className="text-3xl font-bold text-white mb-2">Global Polls View</h1>
                        <p className="text-slate-400">Viewing latest {displayPolls.length} polls across all servers</p>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-4">
                        {/* Sort Controls */}
                        <div className="flex bg-slate-900/50 p-1 rounded-lg border border-slate-700">
                            <FilterButton active={sort === 'recent'} onClick={() => setSort('recent')}>
                                <div className="flex items-center gap-2"><SortDesc className="w-4 h-4" /> Recent</div>
                            </FilterButton>
                            {/* Popular sort with pagination is complex without DB aggregation, maybe disable or note limitation */}
                            <FilterButton active={sort === 'popular'} onClick={() => setSort('popular')}>
                                <div className="flex items-center gap-2"><TrendingUp className="w-4 h-4" /> Popular</div>
                            </FilterButton>
                        </div>

                        {/* Filter Controls */}
                        <div className="flex bg-slate-900/50 p-1 rounded-lg border border-slate-700">
                            <FilterButton active={filter === 'all'} onClick={() => setFilter('all')}>All</FilterButton>
                            <FilterButton active={filter === 'active'} onClick={() => setFilter('active')}>Active</FilterButton>
                            <FilterButton active={filter === 'closed'} onClick={() => setFilter('closed')}>Closed</FilterButton>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-4">
                    {displayPolls.length === 0 && !loading ? (
                        <div className="glass-panel p-12 text-center text-slate-500">No polls found matching criteria.</div>
                    ) : (
                        displayPolls.map(poll => (
                            <PollCard
                                key={poll.message_id}
                                poll={poll}
                                votes={voteCounts[poll.message_id] || {}}
                                guild={poll.guilds} // Pass joined guild info
                            />
                        ))
                    )}
                </div>

                {loading && (
                    <div className="text-center py-8 text-slate-500">Loading polls...</div>
                )}

                {!loading && hasMore && displayPolls.length > 0 && (
                    <div className="mt-8 text-center">
                        <button
                            onClick={loadMore}
                            className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold transition-colors shadow-lg shadow-indigo-500/20"
                        >
                            Load More Polls
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

const FilterButton = ({ active, children, onClick }: any) => (
    <button
        onClick={onClick}
        className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${active ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
    >
        {children}
    </button>
);
