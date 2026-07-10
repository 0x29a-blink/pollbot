import React, { useState } from 'react';
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart, Bar, BarChart } from 'recharts';
import { ChevronDown, ChevronUp, TrendingUp, Clock, Trophy, Lock, BarChart3 } from 'lucide-react';
import { apiFetch } from '../../utils/api';
import { PremiumGateModal } from '../PremiumGateModal';
import { Skeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';

interface AnalyticsData {
    days: number;
    activity: { day: string; votes: number; unique_voters: number }[];
    peakHours: { hour: number; votes: number }[];
    topVoters: { user_id: string; username: string | null; avatar_url: string | null; votes: number }[];
}

interface GuildAnalyticsPanelProps {
    guildId: string;
}

const tooltipStyle = { backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', color: '#fff' };

/**
 * Premium-gated per-server vote analytics. Fetches lazily on first expand so
 * non-premium users don't pay the request on page load; a premium 403 shows
 * the locked state + gate modal instead of data.
 */
export const GuildAnalyticsPanel: React.FC<GuildAnalyticsPanelProps> = ({ guildId }) => {
    const [expanded, setExpanded] = useState(false);
    const [loading, setLoading] = useState(false);
    const [fetched, setFetched] = useState(false);
    const [data, setData] = useState<AnalyticsData | null>(null);
    const [locked, setLocked] = useState(false);
    const [voteUrl, setVoteUrl] = useState('');
    const [showGate, setShowGate] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchAnalytics = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await apiFetch(`/api/user/guilds/${guildId}/analytics?days=30`);
            if (res.status === 403) {
                const body = await res.json();
                if (body.voteUrl) {
                    setLocked(true);
                    setVoteUrl(body.voteUrl);
                } else {
                    setError(body.error || 'Not allowed');
                }
            } else if (res.ok) {
                setLocked(false);
                setData(await res.json());
            } else {
                setError('Failed to load analytics.');
            }
        } catch (err) {
            console.error('Analytics fetch failed:', err);
            setError('Failed to load analytics.');
        } finally {
            setLoading(false);
            setFetched(true);
        }
    };

    const toggle = () => {
        const next = !expanded;
        setExpanded(next);
        if (next && !fetched) fetchAnalytics();
    };

    const refreshPremium = async (): Promise<boolean> => {
        try {
            const res = await apiFetch('/api/user/premium/refresh', { method: 'POST' });
            if (res.ok) {
                const status = await res.json();
                if (status.isPremium) {
                    await fetchAnalytics();
                    return true;
                }
            }
        } catch (err) {
            console.error('Premium refresh failed:', err);
        }
        return false;
    };

    const hourLabel = (h: number) => `${h.toString().padStart(2, '0')}:00`;

    return (
        <section className="mt-8">
            <button
                onClick={toggle}
                aria-expanded={expanded}
                className="w-full glass-panel p-4 flex items-center justify-between hover:bg-slate-800/30 transition-colors"
            >
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-violet-500/10 rounded-lg text-violet-400">
                        <BarChart3 className="w-5 h-5" />
                    </div>
                    <div className="text-left">
                        <h3 className="text-lg font-bold text-white flex items-center gap-2">
                            Vote Analytics
                            <span className="px-2 py-0.5 rounded-full text-[10px] uppercase font-bold bg-amber-500/20 text-amber-400">Premium</span>
                        </h3>
                        <p className="text-xs text-slate-400">Activity trends, peak hours, and top voters — last 30 days</p>
                    </div>
                </div>
                {expanded ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
            </button>

            {expanded && (
                <div className="mt-4">
                    {loading ? (
                        <Skeleton height="h-64" />
                    ) : locked ? (
                        <div className="glass-panel p-8 text-center">
                            <div className="w-12 h-12 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center mx-auto mb-4">
                                <Lock className="w-6 h-6" />
                            </div>
                            <h4 className="text-white font-semibold mb-1">Vote Analytics is a premium feature</h4>
                            <p className="text-sm text-slate-400 mb-4">Vote for PollBot on top.gg to unlock it for 12 hours.</p>
                            <button
                                onClick={() => setShowGate(true)}
                                className="px-5 py-2.5 bg-gradient-to-r from-amber-500 to-orange-600 text-white rounded-lg font-bold hover:from-amber-400 hover:to-orange-500 transition-all shadow-lg shadow-amber-500/25"
                            >
                                Unlock with a vote
                            </button>
                        </div>
                    ) : error ? (
                        <div className="glass-panel">
                            <EmptyState icon={<BarChart3 className="w-6 h-6" />} title="Couldn't load analytics" subtitle={error} />
                        </div>
                    ) : data && data.activity.length === 0 && data.peakHours.length === 0 ? (
                        <div className="glass-panel">
                            <EmptyState icon={<BarChart3 className="w-6 h-6" />} title="No votes in this period" subtitle="Analytics appear once this server has votes in the last 30 days." />
                        </div>
                    ) : data ? (
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <div className="glass-panel p-5 lg:col-span-2">
                                <div className="flex items-center gap-2 mb-4">
                                    <TrendingUp className="w-4 h-4 text-indigo-400" />
                                    <h4 className="text-white font-semibold text-sm">Votes per day</h4>
                                </div>
                                <div style={{ width: '100%', height: 220, minWidth: 0 }}>
                                    <ResponsiveContainer width="99%" height="100%">
                                        <AreaChart data={data.activity.map(a => ({ ...a, label: new Date(a.day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }))}>
                                            <defs>
                                                <linearGradient id="colorGuildVotes" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="#818cf8" stopOpacity={0.3} />
                                                    <stop offset="95%" stopColor="#818cf8" stopOpacity={0} />
                                                </linearGradient>
                                            </defs>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                                            <XAxis dataKey="label" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                                            <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                                            <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: '#818cf8' }} />
                                            <Area type="monotone" dataKey="votes" stroke="#818cf8" strokeWidth={3} fillOpacity={1} fill="url(#colorGuildVotes)" />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>

                            <div className="glass-panel p-5">
                                <div className="flex items-center gap-2 mb-4">
                                    <Clock className="w-4 h-4 text-emerald-400" />
                                    <h4 className="text-white font-semibold text-sm">Peak voting hours (UTC)</h4>
                                </div>
                                <div style={{ width: '100%', height: 220, minWidth: 0 }}>
                                    <ResponsiveContainer width="99%" height="100%">
                                        <BarChart data={data.peakHours.map(p => ({ ...p, label: hourLabel(p.hour) }))}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                                            <XAxis dataKey="label" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                                            <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                                            <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: '#34d399' }} cursor={{ fill: 'rgba(51, 65, 85, 0.3)' }} />
                                            <Bar dataKey="votes" fill="#34d399" radius={[4, 4, 0, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>

                            <div className="glass-panel p-5">
                                <div className="flex items-center gap-2 mb-4">
                                    <Trophy className="w-4 h-4 text-amber-400" />
                                    <h4 className="text-white font-semibold text-sm">Most active voters</h4>
                                </div>
                                {data.topVoters.length === 0 ? (
                                    <p className="text-sm text-slate-500 py-6 text-center">No voters in this period.</p>
                                ) : (
                                    <div className="space-y-3">
                                        {data.topVoters.map((v, i) => (
                                            <div key={v.user_id} className="flex items-center gap-3">
                                                <div className={`w-7 h-7 flex items-center justify-center rounded-full font-bold text-xs ${i === 0 ? 'bg-yellow-500/20 text-yellow-400' : i === 1 ? 'bg-slate-400/20 text-slate-300' : i === 2 ? 'bg-amber-700/20 text-amber-600' : 'bg-slate-800 text-slate-500'}`}>
                                                    {i + 1}
                                                </div>
                                                {v.avatar_url ? (
                                                    <img src={v.avatar_url} alt="" className="w-7 h-7 rounded-full bg-slate-800" />
                                                ) : (
                                                    <div className="w-7 h-7 rounded-full bg-slate-800" />
                                                )}
                                                <span className="flex-1 text-sm text-white truncate">
                                                    {v.username ?? `User ${v.user_id.substring(0, 8)}…`}
                                                </span>
                                                <span className="font-mono font-bold text-sm text-violet-400">{v.votes}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : null}
                </div>
            )}

            <PremiumGateModal
                isOpen={showGate}
                onClose={() => setShowGate(false)}
                voteUrl={voteUrl}
                onRefresh={refreshPremium}
                featureName="Vote Analytics"
            />
        </section>
    );
};
