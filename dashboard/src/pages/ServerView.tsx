import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { ArrowLeft } from 'lucide-react';
import { PollCard } from '../components/PollCard';
import type { Poll, GuildData } from '../types';

export const ServerView: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();

    const [guild, setGuild] = useState<GuildData | null>(null);
    const [polls, setPolls] = useState<Poll[]>([]);
    const [voteCounts, setVoteCounts] = useState<Record<string, Record<number, number>>>({}); // pollId -> optionIndex -> count
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<'all' | 'active' | 'closed'>('all');

    useEffect(() => {
        if (id) fetchServerData(id);
    }, [id]);

    const fetchServerData = async (guildId: string) => {
        setLoading(true);
        try {
            // Fetch Guild
            const { data: guildData } = await supabase
                .from('guilds')
                .select('*')
                .eq('id', guildId)
                .single();
            setGuild(guildData);

            // Fetch Polls
            const { data: pollsData } = await supabase
                .from('polls')
                .select('*')
                .eq('guild_id', guildId)
                .order('created_at', { ascending: false });

            if (pollsData) {
                setPolls(pollsData);

                // Fetch Votes for these polls
                const pollIds = pollsData.map(p => p.message_id);
                if (pollIds.length > 0) {
                    const { data: votesData } = await supabase
                        .from('votes')
                        .select('poll_id, option_index')
                        .in('poll_id', pollIds);

                    if (votesData) {
                        // Aggregate votes
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

    const filteredPolls = polls.filter(poll => {
        if (filter === 'active') return poll.active;
        if (filter === 'closed') return !poll.active;
        return true;
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

                {loading ? (
                    <div className="text-white">Loading details...</div>
                ) : (
                    <>
                        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-10">
                            <div className="flex items-center gap-6">
                                {guild?.icon_url ? (
                                    <img src={guild.icon_url} alt={guild?.name} className="w-20 h-20 rounded-2xl bg-slate-800" />
                                ) : (
                                    <div className="w-20 h-20 rounded-2xl bg-slate-800 flex items-center justify-center text-3xl font-bold text-slate-500">
                                        {guild?.name?.charAt(0)}
                                    </div>
                                )}
                                <div>
                                    <h1 className="text-4xl font-bold text-white mb-2">{guild?.name}</h1>
                                    <div className="flex gap-4 text-slate-400 text-sm">
                                        <span className="bg-slate-800 px-3 py-1 rounded-full">{polls.length} Polls Created</span>
                                        <span className="bg-slate-800 px-3 py-1 rounded-full">{guild?.member_count?.toLocaleString() || 0} Members</span>
                                        <span className="bg-slate-800 px-3 py-1 rounded-full">ID: {guild?.id}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Filter Controls */}
                            <div className="flex bg-slate-900/50 p-1 rounded-lg border border-slate-700">
                                <FilterButton active={filter === 'all'} onClick={() => setFilter('all')}>All</FilterButton>
                                <FilterButton active={filter === 'active'} onClick={() => setFilter('active')}>Active</FilterButton>
                                <FilterButton active={filter === 'closed'} onClick={() => setFilter('closed')}>Closed</FilterButton>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 gap-6">
                            {filteredPolls.length === 0 ? (
                                <div className="glass-panel p-12 text-center text-slate-500">No polls found for this filter.</div>
                            ) : (
                                filteredPolls.map(poll => <PollCard key={poll.message_id} poll={poll} votes={voteCounts[poll.message_id] || {}} />)
                            )}
                        </div>
                    </>
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
