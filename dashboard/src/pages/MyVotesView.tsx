import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Vote, CheckCircle, XCircle, Scale } from 'lucide-react';
import { apiFetch } from '../utils/api';
import { SkeletonList } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import type { MyVote } from '../types';

const PAGE_SIZE = 25;

export const MyVotesView: React.FC = () => {
    const navigate = useNavigate();
    const [votes, setVotes] = useState<MyVote[]>([]);
    const [total, setTotal] = useState(0);
    const [offset, setOffset] = useState(0);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchVotes = async (nextOffset: number) => {
        try {
            const res = await apiFetch(`/api/user/votes?limit=${PAGE_SIZE}&offset=${nextOffset}`);
            if (!res.ok) {
                setError('Failed to load your votes.');
                return;
            }
            const data = await res.json();
            setVotes(prev => nextOffset === 0 ? data.votes : [...prev, ...data.votes]);
            setTotal(data.total ?? 0);
            setOffset(nextOffset + PAGE_SIZE);
        } catch (err) {
            console.error('Error fetching votes:', err);
            setError('Failed to load your votes.');
        }
    };

    useEffect(() => {
        fetchVotes(0).finally(() => setLoading(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const loadMore = async () => {
        setLoadingMore(true);
        await fetchVotes(offset);
        setLoadingMore(false);
    };

    const hasMore = offset < total;

    return (
        <div className="min-h-screen pb-20 p-8">
            <div className="container-wide animate-fade-in">
                <button
                    onClick={() => navigate('/dashboard')}
                    aria-label="Back to Dashboard"
                    className="flex items-center gap-2 text-slate-400 hover:text-white mb-6 transition-colors"
                >
                    <ArrowLeft className="w-4 h-4" />
                    Back to Dashboard
                </button>

                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                        <Vote className="w-7 h-7 text-indigo-400" />
                        My Votes
                    </h1>
                    <p className="text-slate-400 mt-1 text-sm">Every poll you've voted in, across all servers the bot is in.</p>
                </div>

                {loading ? (
                    <SkeletonList rows={5} height="h-24" />
                ) : error ? (
                    <div className="glass-panel">
                        <EmptyState
                            icon={<XCircle className="w-6 h-6" />}
                            title="Something went wrong"
                            subtitle={error}
                        />
                    </div>
                ) : votes.length === 0 ? (
                    <div className="glass-panel">
                        <EmptyState
                            icon={<Vote className="w-6 h-6" />}
                            title="No votes yet"
                            subtitle="Votes you cast on polls will show up here."
                        />
                    </div>
                ) : (
                    <div className="space-y-4">
                        {votes.map(v => (
                            <div key={v.poll_id} className="glass-panel p-4 flex flex-col md:flex-row md:items-center gap-4">
                                <div className="flex items-center gap-3 min-w-0 md:w-56 shrink-0">
                                    {v.guild_icon_url ? (
                                        <img src={v.guild_icon_url} alt={v.guild_name} className="w-10 h-10 rounded-xl bg-slate-800 object-cover" />
                                    ) : (
                                        <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center text-slate-500 font-bold">
                                            {v.guild_name.charAt(0)}
                                        </div>
                                    )}
                                    <span className="text-sm text-slate-400 truncate">{v.guild_name}</span>
                                </div>

                                <div className="flex-1 min-w-0">
                                    <h3 className="text-white font-semibold truncate">{v.title}</h3>
                                    <p className="text-sm text-slate-400 truncate">
                                        Voted: <span className="text-indigo-300">{v.chosen_options.join(', ')}</span>
                                    </p>
                                </div>

                                <div className="flex items-center gap-3 shrink-0">
                                    {v.weight > 1 && (
                                        <div className="px-2 py-1 rounded-full text-xs font-bold bg-violet-500/20 text-violet-300 flex items-center gap-1">
                                            <Scale className="w-3 h-3" />
                                            {v.weight}x
                                        </div>
                                    )}
                                    <div className={`px-2 py-1 rounded-full text-[10px] uppercase font-bold flex items-center gap-1 ${v.active ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700 text-slate-400'}`}>
                                        {v.active ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                                        {v.active ? 'Active' : 'Closed'}
                                    </div>
                                    <span className="text-xs text-slate-500 whitespace-nowrap">{new Date(v.voted_at).toLocaleString()}</span>
                                </div>
                            </div>
                        ))}

                        {hasMore && (
                            <div className="text-center pt-4">
                                <button
                                    onClick={loadMore}
                                    disabled={loadingMore}
                                    className="px-6 py-3 bg-primary-strong hover:bg-primary text-white rounded-xl font-bold transition-colors shadow-lg shadow-indigo-500/20 disabled:opacity-50"
                                >
                                    {loadingMore ? 'Loading…' : 'Load More'}
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
