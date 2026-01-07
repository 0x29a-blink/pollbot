import React, { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart } from 'recharts';
import { supabase } from '../../lib/supabase';
import { motion } from 'framer-motion';
import { TrendingUp } from 'lucide-react';

export const VoteHistoryChart: React.FC = () => {
    const [data, setData] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchHistory();
    }, []);

    const fetchHistory = async () => {
        try {
            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(endDate.getDate() - 7);

            const { data: votes } = await supabase
                .from('votes')
                .select('created_at')
                .gte('created_at', startDate.toISOString())
                .order('created_at', { ascending: true });

            if (votes) {
                // Initialize last 7 days with 0
                const days: Record<string, number> = {};
                for (let i = 6; i >= 0; i--) {
                    const d = new Date();
                    d.setDate(d.getDate() - i);
                    days[d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })] = 0;
                }

                // Fill with data
                votes.forEach((v: any) => {
                    const d = new Date(v.created_at);
                    const key = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                    if (days[key] !== undefined) days[key]++;
                });

                const chartData = Object.entries(days).map(([date, count]) => ({
                    date,
                    votes: count
                }));

                setData(chartData);
            }
        } catch (error) {
            console.error('Error fetching vote history:', error);
        } finally {
            setLoading(false);
        }
    };

    if (loading) return <div className="h-64 animate-pulse bg-slate-800/20 rounded-xl"></div>;

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-panel p-6"
        >
            <div className="flex items-center gap-2 mb-6">
                <div className="p-2 bg-indigo-500/10 rounded-lg text-indigo-400">
                    <TrendingUp className="w-5 h-5" />
                </div>
                <div>
                    <h3 className="text-lg font-bold text-white">Voting Trends</h3>
                    <p className="text-slate-400 text-xs">Last 7 Days</p>
                </div>
            </div>

            <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data}>
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
                            itemStyle={{ color: '#818cf8' }}
                        />
                        <Area
                            type="monotone"
                            dataKey="votes"
                            stroke="#818cf8"
                            strokeWidth={3}
                            fillOpacity={1}
                            fill="url(#colorVotes)"
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </motion.div>
    );
};
