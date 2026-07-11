import React, { useEffect, useState } from 'react';
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, Line, ComposedChart, Legend } from 'recharts';
import { supabase } from '../../lib/supabase';
import { motion } from 'framer-motion';
import { TrendingUp } from 'lucide-react';
import { FilterButton } from '../ui/FilterButton';

interface HistoryRow {
    day: string;
    votes: number | string;
    unique_voters: number | string;
    polls_created: number | string;
}

interface ChartRow {
    date: string;
    votes: number;
    voters: number;
    polls: number;
}

/**
 * Votes / unique voters / polls created per day, from the get_vote_history RPC.
 * Aggregated in Postgres — the old raw-row fetch silently truncated at
 * PostgREST's 1000-row cap once weekly volume passed 1000 votes.
 */
export const VoteHistoryChart: React.FC = () => {
    const [data, setData] = useState<ChartRow[]>([]);
    const [days, setDays] = useState<7 | 30>(7);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                const { data: rows, error } = await supabase.rpc('get_vote_history', { p_days: days });
                if (cancelled) return;
                if (error || !rows) {
                    setFailed(true);
                    return;
                }
                setFailed(false);
                setData((rows as HistoryRow[]).map(r => ({
                    date: new Date(r.day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
                    votes: Number(r.votes),
                    voters: Number(r.unique_voters),
                    polls: Number(r.polls_created),
                })));
            } catch (error) {
                console.error('Error fetching vote history:', error);
                if (!cancelled) setFailed(true);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [days]);

    if (loading && data.length === 0) return <div className="h-64 animate-pulse bg-slate-800/20 rounded-xl"></div>;

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-panel p-6"
        >
            <div className="flex items-start justify-between gap-4 mb-6">
                <div className="flex items-center gap-2">
                    <div className="p-2 bg-indigo-500/10 rounded-lg text-indigo-400">
                        <TrendingUp className="w-5 h-5" />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-white">Voting Trends</h3>
                        <p className="text-slate-400 text-xs">Votes, unique voters &amp; polls created — last {days} days</p>
                    </div>
                </div>
                <div className="flex items-center gap-1 bg-slate-900/50 p-1 rounded-lg border border-slate-700">
                    <FilterButton active={days === 7} onClick={() => setDays(7)}>7D</FilterButton>
                    <FilterButton active={days === 30} onClick={() => setDays(30)}>30D</FilterButton>
                </div>
            </div>

            {failed ? (
                <div className="h-64 flex items-center justify-center text-sm text-slate-500">
                    Couldn't load voting history — is the analytics migration applied?
                </div>
            ) : (
                <div className="h-64 w-full" style={{ width: '100%', height: '300px', minWidth: 0 }}>
                    <ResponsiveContainer width="99%" height="100%">
                        <ComposedChart data={data}>
                            <defs>
                                <linearGradient id="colorVotes" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#818cf8" stopOpacity={0.3} />
                                    <stop offset="95%" stopColor="#818cf8" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                            <XAxis
                                dataKey="date"
                                stroke="#64748b"
                                fontSize={12}
                                tickLine={false}
                                axisLine={false}
                            />
                            <YAxis
                                stroke="#64748b"
                                fontSize={12}
                                tickLine={false}
                                axisLine={false}
                            />
                            <Tooltip
                                contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', color: '#fff' }}
                            />
                            <Legend wrapperStyle={{ fontSize: 12 }} />
                            <Area
                                type="monotone"
                                dataKey="votes"
                                name="Votes"
                                stroke="#818cf8"
                                strokeWidth={3}
                                fillOpacity={1}
                                fill="url(#colorVotes)"
                            />
                            <Line
                                type="monotone"
                                dataKey="voters"
                                name="Unique voters"
                                stroke="#34d399"
                                strokeWidth={2}
                                dot={false}
                            />
                            <Line
                                type="monotone"
                                dataKey="polls"
                                name="Polls created"
                                stroke="#fbbf24"
                                strokeWidth={2}
                                strokeDasharray="5 3"
                                dot={false}
                            />
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>
            )}
        </motion.div>
    );
};
