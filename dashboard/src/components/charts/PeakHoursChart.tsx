import React, { useEffect, useState } from 'react';
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Bar, BarChart } from 'recharts';
import { supabase } from '../../lib/supabase';
import { motion } from 'framer-motion';
import { Clock } from 'lucide-react';

interface PeakHourRow {
    hour: number;
    votes: number | string;
}

interface ChartRow {
    hour: string;
    votes: number;
}

/**
 * Global vote volume by hour of day (UTC), from the get_global_peak_hours RPC.
 * Zero-filled server-side so all 24 buckets always render.
 */
export const PeakHoursChart: React.FC = () => {
    const [data, setData] = useState<ChartRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const { data: rows, error } = await supabase.rpc('get_global_peak_hours', { p_days: 30 });
                if (cancelled) return;
                if (error || !rows) {
                    setFailed(true);
                    return;
                }
                setData((rows as PeakHourRow[]).map(r => ({
                    hour: `${String(r.hour).padStart(2, '0')}:00`,
                    votes: Number(r.votes),
                })));
            } catch (error) {
                console.error('Error fetching peak hours:', error);
                if (!cancelled) setFailed(true);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    if (loading) return <div className="h-64 animate-pulse bg-slate-800/20 rounded-xl"></div>;

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-panel p-6"
        >
            <div className="flex items-center gap-2 mb-6">
                <div className="p-2 bg-violet-500/10 rounded-lg text-violet-400">
                    <Clock className="w-5 h-5" />
                </div>
                <div>
                    <h3 className="text-lg font-bold text-white">Peak Voting Hours</h3>
                    <p className="text-slate-400 text-xs">Votes by hour of day (UTC) — last 30 days</p>
                </div>
            </div>

            {failed ? (
                <div className="h-64 flex items-center justify-center text-sm text-slate-500">
                    Couldn't load peak hours — is the analytics migration applied?
                </div>
            ) : (
                <div className="h-64 w-full" style={{ width: '100%', height: '300px', minWidth: 0 }}>
                    <ResponsiveContainer width="99%" height="100%">
                        <BarChart data={data} barCategoryGap={2}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                            <XAxis
                                dataKey="hour"
                                stroke="#64748b"
                                fontSize={11}
                                tickLine={false}
                                axisLine={false}
                                interval={3}
                            />
                            <YAxis
                                stroke="#64748b"
                                fontSize={12}
                                tickLine={false}
                                axisLine={false}
                            />
                            <Tooltip
                                cursor={{ fill: '#1e293b', opacity: 0.4 }}
                                contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', color: '#fff' }}
                                itemStyle={{ color: '#a78bfa' }}
                                formatter={((value: unknown) => [`${value ?? 0} votes`, 'Votes']) as never}
                            />
                            <Bar dataKey="votes" fill="#a78bfa" fillOpacity={0.85} radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            )}
        </motion.div>
    );
};
