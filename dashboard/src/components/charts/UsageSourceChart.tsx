import React, { useEffect, useState } from 'react';
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart, Legend } from 'recharts';
import { supabase } from '../../lib/supabase';
import { motion } from 'framer-motion';
import { GitCompareArrows } from 'lucide-react';

interface UsageSummaryRow {
    day: string;
    source: 'bot' | 'dashboard';
    events: number | string;
    unique_users: number | string;
}

interface ChartRow {
    date: string;
    bot: number;
    dashboard: number;
    bot_users: number;
    dashboard_users: number;
}

/**
 * Bot vs dashboard usage per day, from the get_usage_summary RPC
 * (aggregate counts only — no per-user rows reach the client).
 */
export const UsageSourceChart: React.FC = () => {
    const [data, setData] = useState<ChartRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [empty, setEmpty] = useState(false);

    useEffect(() => {
        fetchSummary();
    }, []);

    const fetchSummary = async () => {
        try {
            const { data: rows, error } = await supabase.rpc('get_usage_summary', { p_days: 30 });
            if (error || !rows || rows.length === 0) {
                setEmpty(true);
                return;
            }

            const byDay = new Map<string, ChartRow>();
            (rows as UsageSummaryRow[]).forEach(r => {
                const date = new Date(r.day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                const entry = byDay.get(r.day) ?? { date, bot: 0, dashboard: 0, bot_users: 0, dashboard_users: 0 };
                if (r.source === 'bot') {
                    entry.bot = Number(r.events);
                    entry.bot_users = Number(r.unique_users);
                } else {
                    entry.dashboard = Number(r.events);
                    entry.dashboard_users = Number(r.unique_users);
                }
                byDay.set(r.day, entry);
            });

            setData([...byDay.values()]);
        } catch (error) {
            console.error('Error fetching usage summary:', error);
            setEmpty(true);
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
                <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-400">
                    <GitCompareArrows className="w-5 h-5" />
                </div>
                <div>
                    <h3 className="text-lg font-bold text-white">Usage by Surface</h3>
                    <p className="text-slate-400 text-xs">Bot commands vs dashboard actions — last 30 days</p>
                </div>
            </div>

            {empty ? (
                <div className="h-64 flex items-center justify-center text-sm text-slate-500">
                    No usage data yet — events appear once the usage_events migration is applied and actions occur.
                </div>
            ) : (
                <div className="h-64 w-full" style={{ width: '100%', height: '300px', minWidth: 0 }}>
                    <ResponsiveContainer width="99%" height="100%">
                        <AreaChart data={data}>
                            <defs>
                                <linearGradient id="colorBot" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#818cf8" stopOpacity={0.3} />
                                    <stop offset="95%" stopColor="#818cf8" stopOpacity={0} />
                                </linearGradient>
                                <linearGradient id="colorDashboard" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#34d399" stopOpacity={0.3} />
                                    <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                            <XAxis dataKey="date" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                            <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                            <Tooltip
                                contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', color: '#fff' }}
                                formatter={((value: unknown, name: unknown, item: { payload?: ChartRow }) => {
                                    const users = name === 'Bot'
                                        ? item?.payload?.bot_users
                                        : item?.payload?.dashboard_users;
                                    return [`${value ?? 0} actions (${users ?? 0} users)`, String(name)];
                                    // Recharts' Formatter generic is stricter than useful here
                                }) as never}
                            />
                            <Legend wrapperStyle={{ fontSize: 12 }} />
                            <Area type="monotone" dataKey="bot" name="Bot" stroke="#818cf8" strokeWidth={3} fillOpacity={1} fill="url(#colorBot)" />
                            <Area type="monotone" dataKey="dashboard" name="Dashboard" stroke="#34d399" strokeWidth={3} fillOpacity={1} fill="url(#colorDashboard)" />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            )}
        </motion.div>
    );
};
