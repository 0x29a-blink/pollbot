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
    const [polls, setPolls] = useState<Poll[]>([]);
    const [voteCounts, setVoteCounts] = useState<Record<string, Record<number, number>>>({});
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<'all' | 'active' | 'closed'>('all');
    const [sort, setSort] = useState<'recent' | 'popular'>('recent');

    useEffect(() => {
        fetchPolls();
    }, [userIdFilter]);

    const fetchPolls = async () => {
        setLoading(true);
        try {
            let query = supabase
                .from('polls')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(50); // Fetch last 50 polls for now

            if (userIdFilter) {
                query = query.eq('creator_id', userIdFilter);
            }

            const { data: pollsData } = await query;

            if (pollsData) {
                setPolls(pollsData);

                const pollIds = pollsData.map(p => p.message_id);
                if (pollIds.length > 0) {
                    const { data: votesData } = await supabase
                        .from('votes')
                        .select('poll_id, option_index')
                        .in('poll_id', pollIds);

                    if (votesData) {
                        const counts: Record<string, Record<number, number>> = {};
                        votesData.forEach((vote: any) => {
                            if (!counts[vote.poll_id]) counts[vote.poll_id] = {};
                            if (!counts[vote.poll_id][vote.option_index]) counts[vote.poll_id][vote.option_index] = 0;
                            counts[vote.poll_id][vote.option_index]++;
                        });
                        setVoteCounts(counts);
                    }
                }
            }
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    const getVoteTotal = (pollId: string) => {
        const votes = voteCounts[pollId] || {};
        return Object.values(votes).reduce((a, b) => a + b, 0);
    };

    const processedPolls = polls
        .filter(poll => {
            if (filter === 'active') return poll.active;
            if (filter === 'closed') return !poll.active;
            return true;
        })
        .sort((a, b) => {
            if (sort === 'popular') {
                return getVoteTotal(b.message_id) - getVoteTotal(a.message_id);
            }
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
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
                        <p className="text-slate-400">Viewing latest 50 polls across all servers</p>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-4">
                        {/* Sort Controls */}
                        <div className="flex bg-slate-900/50 p-1 rounded-lg border border-slate-700">
                            <FilterButton active={sort === 'recent'} onClick={() => setSort('recent')}>
                                <div className="flex items-center gap-2"><SortDesc className="w-4 h-4" /> Recent</div>
                            </FilterButton>
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

                <div className="grid grid-cols-1 gap-6">
                    {processedPolls.length === 0 ? (
                        <div className="glass-panel p-12 text-center text-slate-500">No polls found matching criteria.</div>
                    ) : (
                        processedPolls.map(poll => (
                            <PollCard key={poll.message_id} poll={poll} votes={voteCounts[poll.message_id] || {}} />
                        ))
                    )}
                </div>
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
