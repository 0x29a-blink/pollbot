import React, { useEffect, useState } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { supabase } from '../../lib/supabase';
import { motion } from 'framer-motion';
import { Globe } from 'lucide-react';

const COLORS = ['#818cf8', '#34d399', '#f472b6', '#facc15', '#60a5fa'];

export const LanguagePieChart: React.FC = () => {
    const [data, setData] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchLanguages();
    }, []);

    const fetchLanguages = async () => {
        try {
            // Note: In a real scenario, we'd group by SQL, but Supabase JS client doesn't support easy GROUP BY aggregation directly without RPC or raw SQL.
            // For now, fetching all settings is fine for small scale, or we should use an RPC. Assuming small scale for telemetry.
            // Fetch locales from all connected guilds
            const { data: guilds } = await supabase
                .from('guilds')
                .select('locale');

            if (guilds) {
                const counts: Record<string, number> = {};
                guilds.forEach((g: any) => {
                    const loc = g.locale || 'en-US'; // Default to en-US
                    counts[loc] = (counts[loc] || 0) + 1;
                });

                const chartData = Object.entries(counts)
                    .map(([name, value]) => ({ name, value }))
                    .sort((a, b) => b.value - a.value)
                    .slice(0, 5); // Top 5

                setData(chartData);
            }
        } catch (error) {
            console.error('Error fetching languages:', error);
        } finally {
            setLoading(false);
        }
    };

    if (loading) return <div className="h-64 animate-pulse bg-slate-800/20 rounded-xl"></div>;

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="glass-panel p-6"
        >
            <div className="flex items-center gap-2 mb-6">
                <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-400">
                    <Globe className="w-5 h-5" />
                </div>
                <div>
                    <h3 className="text-lg font-bold text-white">Demographics</h3>
                    <p className="text-slate-400 text-xs">Server Locales</p>
                </div>
            </div>

            <div className="h-64 w-full flex items-center justify-center" style={{ width: '100%', height: '300px' }}>
                {data.length > 0 ? (
                    <ResponsiveContainer width="99%" height="100%">
                        <PieChart>
                            <Pie
                                data={data}
                                innerRadius={60}
                                outerRadius={80}
                                paddingAngle={5}
                                dataKey="value"
                            >
                                {data.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} stroke="rgba(0,0,0,0)" />
                                ))}
                            </Pie>
                            <Tooltip
                                contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', color: '#fff' }}
                                itemStyle={{ color: '#fff' }}
                                formatter={(value: number, name: string) => [`${value} Servers`, name]}
                            />
                            <Legend iconType="circle" />
                        </PieChart>
                    </ResponsiveContainer>
                ) : (
                    <div className="text-slate-500 text-sm">No locale data available</div>
                )}
            </div>
        </motion.div>
    );
};
