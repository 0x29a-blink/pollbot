import React, { useEffect, useState } from 'react';
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart, Legend } from 'recharts';
import { supabase } from '../../lib/supabase';
import { apiFetch } from '../../utils/api';
import { motion } from 'framer-motion';
import { Heart, Trophy } from 'lucide-react';
import { FilterButton } from '../ui/FilterButton';

interface HistoryRow {
    day: string;
    source: 'topgg' | 'discordforge';
    votes: number | string;
    unique_voters: number | string;
}

interface ChartRow {
    date: string;
    topgg: number;
    discordforge: number;
}

interface TotalsRow {
    source: 'topgg' | 'discordforge';
    votes_total: number | string;
    voters_total: number | string;
    votes_30d: number | string;
    voters_30d: number | string;
}

interface TopVoter {
    user_id: string;
    username: string | null;
    avatar_url: string | null;
    votes: number | string;
    sources: string[];
    last_vote_at: string;
}

const SOURCE_LABELS: Record<string, string> = {
    topgg: 'Top.gg',
    discordforge: 'DiscordForge',
};

/**
 * Bot-list voting analytics (admin panel): votes per day per listing site
 * from the aggregate-only get_botlist_vote_history RPC, headline totals, and
 * the top voters. Per-user rows come from the authenticated admin API — the
 * RPC behind it is service_role-only.
 */
export const BotListVotesPanel: React.FC = () => {
    const [data, setData] = useState<ChartRow[]>([]);
    const [totals, setTotals] = useState<TotalsRow[]>([]);
    const [topVoters, setTopVoters] = useState<TopVoter[]>([]);
    const [days, setDays] = useState<7 | 30>(30);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                const [historyRes, adminRes] = await Promise.all([
                    supabase.rpc('get_botlist_vote_history', { p_days: days }),
                    apiFetch(`/api/admin/vote-analytics?days=${days}`),
                ]);
                if (cancelled) return;

                if (historyRes.error || !historyRes.data) {
                    setFailed(true);
                    return;
                }
                setFailed(false);

                // Pivot (day, source) rows into one row per day with a column per source.
                const byDay = new Map<string, ChartRow>();
                for (const row of historyRes.data as HistoryRow[]) {
                    const date = new Date(row.day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
                    const entry = byDay.get(row.day) ?? { date, topgg: 0, discordforge: 0 };
                    entry[row.source] = Number(row.votes);
                    byDay.set(row.day, entry);
                }
                setData([...byDay.values()]);

                if (adminRes.ok) {
                    const adminData = await adminRes.json();
                    if (!cancelled) {
                        setTotals(adminData.totals ?? []);
                        setTopVoters(adminData.topVoters ?? []);
                    }
                }
            } catch (error) {
                console.error('Error fetching bot-list vote analytics:', error);
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
                    <div className="p-2 bg-rose-500/10 rounded-lg text-rose-400">
                        <Heart className="w-5 h-5" />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-white">Bot List Votes</h3>
                        <p className="text-slate-400 text-xs">Top.gg &amp; DiscordForge votes — last {days} days</p>
                    </div>
                </div>
                <div className="flex items-center gap-1 bg-slate-900/50 p-1 rounded-lg border border-slate-700">
                    <FilterButton active={days === 7} onClick={() => setDays(7)}>7D</FilterButton>
                    <FilterButton active={days === 30} onClick={() => setDays(30)}>30D</FilterButton>
                </div>
            </div>

            {failed ? (
                <div className="h-64 flex items-center justify-center text-sm text-slate-500">
                    Couldn't load bot-list votes — is the botlist_votes migration applied?
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-2">
                        {/* Totals strip */}
                        <div className="grid grid-cols-2 gap-3 mb-4">
                            {totals.map(t => (
                                <div key={t.source} className="bg-slate-900/50 border border-slate-700/50 rounded-lg px-4 py-3">
                                    <p className="text-xs text-slate-400 font-bold">{SOURCE_LABELS[t.source] ?? t.source}</p>
                                    <p className="text-xl font-bold text-white">{Number(t.votes_30d).toLocaleString()} <span className="text-xs font-normal text-slate-500">votes / 30d</span></p>
                                    <p className="text-xs text-slate-500">{Number(t.voters_30d).toLocaleString()} voters · {Number(t.votes_total).toLocaleString()} all-time</p>
                                </div>
                            ))}
                        </div>

                        <div className="h-56 w-full" style={{ width: '100%', minWidth: 0 }}>
                            <ResponsiveContainer width="99%" height="100%">
                                <AreaChart data={data}>
                                    <defs>
                                        <linearGradient id="colorTopgg" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#fb7185" stopOpacity={0.3} />
                                            <stop offset="95%" stopColor="#fb7185" stopOpacity={0} />
                                        </linearGradient>
                                        <linearGradient id="colorForge" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#818cf8" stopOpacity={0.3} />
                                            <stop offset="95%" stopColor="#818cf8" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                                    <XAxis dataKey="date" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                                    <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', color: '#fff' }}
                                    />
                                    <Legend wrapperStyle={{ fontSize: 12 }} />
                                    <Area type="monotone" dataKey="topgg" name="Top.gg" stackId="votes" stroke="#fb7185" strokeWidth={2} fillOpacity={1} fill="url(#colorTopgg)" />
                                    <Area type="monotone" dataKey="discordforge" name="DiscordForge" stackId="votes" stroke="#818cf8" strokeWidth={2} fillOpacity={1} fill="url(#colorForge)" />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Top voters (admin API) */}
                    <div>
                        <div className="flex items-center gap-2 mb-3">
                            <Trophy className="w-4 h-4 text-amber-400" />
                            <h4 className="text-sm font-bold text-white">Top Voters</h4>
                        </div>
                        {topVoters.length === 0 ? (
                            <p className="text-xs text-slate-500">No votes recorded yet.</p>
                        ) : (
                            <ul className="space-y-2">
                                {topVoters.map((v, i) => (
                                    <li key={v.user_id} className="flex items-center gap-3 bg-slate-900/40 border border-slate-800 rounded-lg px-3 py-2">
                                        <span className="text-xs font-bold text-slate-500 w-4">{i + 1}</span>
                                        {v.avatar_url ? (
                                            <img src={v.avatar_url} alt="" className="w-6 h-6 rounded-full" />
                                        ) : (
                                            <div className="w-6 h-6 rounded-full bg-slate-700" />
                                        )}
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm text-slate-200 truncate">{v.username || v.user_id}</p>
                                            <p className="text-[10px] text-slate-500">{v.sources.map(s => SOURCE_LABELS[s] ?? s).join(' · ')}</p>
                                        </div>
                                        <span className="text-sm font-bold text-white">{Number(v.votes).toLocaleString()}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>
            )}
        </motion.div>
    );
};
