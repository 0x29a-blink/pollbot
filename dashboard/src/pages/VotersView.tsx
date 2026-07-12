import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
    AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
} from 'recharts';
import {
    ArrowLeft, Search, CheckCircle, XCircle, Clock, Users, Heart, Flame,
    Trophy, Globe, CalendarDays, Megaphone, Activity, RefreshCw,
} from 'lucide-react';
import { apiFetch } from '../utils/api';
import { FilterButton } from '../components/ui/FilterButton';

// ---------------------------------------------------------------------------
// Types mirroring the /api/admin/vote-analytics and /api/admin/voters payloads
// ---------------------------------------------------------------------------

interface HistoryRow { day: string; source: 'topgg' | 'discordforge'; votes: number; unique_voters: number }
interface HourRow { hour: number; votes: number }
interface WeekdayRow { dow: number; votes: number }
interface NewReturningRow { day: string; new_voters: number; returning_voters: number }
interface OverlapData { topgg_only: number; discordforge_only: number; both: number }
interface WeekendData { weekend_votes: number; total_votes: number }
interface CampaignRow { campaign: string; votes: number }

interface AnalyticsBundle {
    history: HistoryRow[];
    hours: HourRow[];
    weekdays: WeekdayRow[];
    new_returning: NewReturningRow[];
    overlap: OverlapData | null;
    weekend: WeekendData | null;
    campaigns: CampaignRow[];
}

interface TopVoter {
    user_id: string; username: string | null; avatar_url: string | null;
    votes: number; sources: string[]; last_vote_at: string;
}

interface RecentVote {
    id: number; source: string; user_id: string; username: string | null;
    weight: number; is_test: boolean; is_weekend: boolean | null;
    weekly_votes: number | null; total_votes: number | null; created_at: string;
}

interface DirectoryRow {
    user_id: string; username: string | null; avatar_url: string | null;
    votes: number; weighted_votes: number; sources: string[];
    first_vote_at: string; last_botlist_vote_at: string;
    df_weekly_votes: number | null; df_total_votes: number | null;
    streak_days: number; premium_last_vote_at: string | null; premium_active: boolean;
}

type SourceFilter = 'all' | 'topgg' | 'discordforge';
type SortMode = 'votes' | 'streak' | 'weighted' | 'recent';

const SOURCE_LABELS: Record<string, string> = { topgg: 'Top.gg', discordforge: 'DiscordForge' };
const SOURCE_COLORS: Record<string, string> = { topgg: '#fb7185', discordforge: '#818cf8' };
const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const PAGE_SIZE = 25;

const TOOLTIP_STYLE = { backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', color: '#fff' } as const;

const fmtDay = (day: string) =>
    new Date(day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

// ---------------------------------------------------------------------------

export const VotersView: React.FC = () => {
    const navigate = useNavigate();

    // Shared filters
    const [days, setDays] = useState<7 | 30 | 90 | 365>(30);
    const [source, setSource] = useState<SourceFilter>('all');

    // Analytics bundle
    const [analytics, setAnalytics] = useState<AnalyticsBundle | null>(null);
    const [topVoters, setTopVoters] = useState<TopVoter[]>([]);
    const [recentVotes, setRecentVotes] = useState<RecentVote[]>([]);
    const [analyticsLoading, setAnalyticsLoading] = useState(true);
    const [analyticsFailed, setAnalyticsFailed] = useState(false);

    // Voter directory
    const [rows, setRows] = useState<DirectoryRow[]>([]);
    const [total, setTotal] = useState(0);
    const [offset, setOffset] = useState(0);
    const [sort, setSort] = useState<SortMode>('votes');
    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const [dirLoading, setDirLoading] = useState(true);

    useEffect(() => {
        const t = setTimeout(() => setSearch(searchInput.trim()), 300);
        return () => clearTimeout(t);
    }, [searchInput]);

    // Analytics fetch
    useEffect(() => {
        let cancelled = false;
        (async () => {
            setAnalyticsLoading(true);
            try {
                const res = await apiFetch(`/api/admin/vote-analytics?days=${days}${source === 'all' ? '' : `&source=${source}`}`);
                if (cancelled) return;
                if (!res.ok) { setAnalyticsFailed(true); return; }
                const data = await res.json();
                if (cancelled) return;
                setAnalyticsFailed(false);
                setAnalytics(data.analytics ?? null);
                setTopVoters(data.topVoters ?? []);
                setRecentVotes(data.recentVotes ?? []);
            } catch (err) {
                console.error('Error fetching vote analytics:', err);
                if (!cancelled) setAnalyticsFailed(true);
            } finally {
                if (!cancelled) setAnalyticsLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [days, source]);

    // Directory fetch
    const fetchDirectory = async (newOffset: number, append: boolean) => {
        setDirLoading(true);
        try {
            const params = new URLSearchParams({ days: String(days), sort, limit: String(PAGE_SIZE), offset: String(newOffset) });
            if (source !== 'all') params.set('source', source);
            if (search) params.set('search', search);
            const res = await apiFetch(`/api/admin/voters?${params}`);
            if (res.ok) {
                const data = await res.json();
                setTotal(data.total ?? 0);
                setRows(prev => (append ? [...prev, ...(data.rows ?? [])] : (data.rows ?? [])));
                setOffset(newOffset);
            }
        } catch (err) {
            console.error('Error fetching voter directory:', err);
        } finally {
            setDirLoading(false);
        }
    };

    useEffect(() => {
        fetchDirectory(0, false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [days, source, sort, search]);

    // Derived chart data --------------------------------------------------

    const historyByDay = React.useMemo(() => {
        const byDay = new Map<string, { date: string; topgg: number; discordforge: number }>();
        for (const r of analytics?.history ?? []) {
            const entry = byDay.get(r.day) ?? { date: fmtDay(r.day), topgg: 0, discordforge: 0 };
            entry[r.source] = Number(r.votes);
            byDay.set(r.day, entry);
        }
        return [...byDay.values()];
    }, [analytics]);

    const newReturning = (analytics?.new_returning ?? []).map(r => ({
        date: fmtDay(r.day), new: Number(r.new_voters), returning: Number(r.returning_voters),
    }));

    const hourly = (analytics?.hours ?? []).map(h => ({ hour: `${h.hour}:00`, votes: Number(h.votes) }));
    const weekdays = (analytics?.weekdays ?? []).map(w => ({ day: WEEKDAY_NAMES[w.dow - 1] ?? String(w.dow), votes: Number(w.votes) }));

    const overlapData = analytics?.overlap ? [
        { name: 'Top.gg only', value: Number(analytics.overlap.topgg_only), color: SOURCE_COLORS.topgg },
        { name: 'DiscordForge only', value: Number(analytics.overlap.discordforge_only), color: SOURCE_COLORS.discordforge },
        { name: 'Both lists', value: Number(analytics.overlap.both), color: '#34d399' },
    ].filter(d => d.value > 0) : [];

    const windowVotes = historyByDay.reduce((a, d) => a + d.topgg + d.discordforge, 0);
    const windowVoters = analytics?.overlap
        ? Number(analytics.overlap.topgg_only) + Number(analytics.overlap.discordforge_only) + Number(analytics.overlap.both)
        : 0;
    const weekendShare = analytics?.weekend && Number(analytics.weekend.total_votes) > 0
        ? Math.round((Number(analytics.weekend.weekend_votes) / Number(analytics.weekend.total_votes)) * 100)
        : 0;

    // ----------------------------------------------------------------------

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

                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-8">
                    <div>
                        <h1 className="text-3xl font-bold text-white mb-2">Voter Analytics</h1>
                        <p className="text-slate-400">Bot-list voting across Top.gg &amp; DiscordForge — trends, voters, and premium status</p>
                    </div>

                    <div className="flex flex-wrap gap-3">
                        <div className="flex bg-slate-900/50 p-1 rounded-lg border border-slate-700">
                            <FilterButton active={days === 7} onClick={() => setDays(7)}>7D</FilterButton>
                            <FilterButton active={days === 30} onClick={() => setDays(30)}>30D</FilterButton>
                            <FilterButton active={days === 90} onClick={() => setDays(90)}>90D</FilterButton>
                            <FilterButton active={days === 365} onClick={() => setDays(365)}>1Y</FilterButton>
                        </div>
                        <div className="flex bg-slate-900/50 p-1 rounded-lg border border-slate-700">
                            <FilterButton active={source === 'all'} onClick={() => setSource('all')}>All Lists</FilterButton>
                            <FilterButton active={source === 'topgg'} onClick={() => setSource('topgg')}>Top.gg</FilterButton>
                            <FilterButton active={source === 'discordforge'} onClick={() => setSource('discordforge')}>DiscordForge</FilterButton>
                        </div>
                    </div>
                </div>

                {analyticsFailed ? (
                    <div className="glass-panel p-8 text-center text-sm text-slate-500 mb-8">
                        Couldn't load voter analytics — are migrations 25–27 applied and are you signed in as an admin?
                    </div>
                ) : analyticsLoading && !analytics ? (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                        {[...Array(4)].map((_, i) => <div key={i} className="h-24 animate-pulse bg-slate-800/20 rounded-xl" />)}
                    </div>
                ) : (
                    <>
                        {/* Stat cards */}
                        <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                            <StatCard icon={<Heart className="w-5 h-5" />} tint="rose" label={`Votes (${days}d)`} value={windowVotes.toLocaleString()} />
                            <StatCard icon={<Users className="w-5 h-5" />} tint="indigo" label={`Unique voters (${days}d)`} value={windowVoters.toLocaleString()} />
                            <StatCard icon={<Globe className="w-5 h-5" />} tint="emerald" label="Voting on both lists" value={(analytics?.overlap?.both ?? 0).toLocaleString()} />
                            <StatCard icon={<CalendarDays className="w-5 h-5" />} tint="amber" label="Weekend vote share" value={`${weekendShare}%`} sub="Top.gg weekends count 2x" />
                        </section>

                        {/* Row 1: votes over time + new vs returning */}
                        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                            <ChartPanel title="Votes Over Time" subtitle={`Per list, last ${days} days`} icon={<Heart className="w-5 h-5" />} tint="rose">
                                <ResponsiveContainer width="99%" height={240}>
                                    <AreaChart data={historyByDay}>
                                        <defs>
                                            <linearGradient id="gTopgg" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor={SOURCE_COLORS.topgg} stopOpacity={0.3} />
                                                <stop offset="95%" stopColor={SOURCE_COLORS.topgg} stopOpacity={0} />
                                            </linearGradient>
                                            <linearGradient id="gForge" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor={SOURCE_COLORS.discordforge} stopOpacity={0.3} />
                                                <stop offset="95%" stopColor={SOURCE_COLORS.discordforge} stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                                        <XAxis dataKey="date" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                                        <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                                        <Tooltip contentStyle={TOOLTIP_STYLE} />
                                        <Legend wrapperStyle={{ fontSize: 12 }} />
                                        <Area type="monotone" dataKey="topgg" name="Top.gg" stackId="v" stroke={SOURCE_COLORS.topgg} strokeWidth={2} fill="url(#gTopgg)" />
                                        <Area type="monotone" dataKey="discordforge" name="DiscordForge" stackId="v" stroke={SOURCE_COLORS.discordforge} strokeWidth={2} fill="url(#gForge)" />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </ChartPanel>

                            <ChartPanel title="New vs Returning Voters" subtitle="First-ever vote vs repeat voters, per day" icon={<Users className="w-5 h-5" />} tint="emerald">
                                <ResponsiveContainer width="99%" height={240}>
                                    <BarChart data={newReturning}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                                        <XAxis dataKey="date" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                                        <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                                        <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'rgba(148,163,184,0.06)' }} />
                                        <Legend wrapperStyle={{ fontSize: 12 }} />
                                        <Bar dataKey="new" name="New voters" stackId="nr" fill="#34d399" radius={[0, 0, 0, 0]} />
                                        <Bar dataKey="returning" name="Returning" stackId="nr" fill="#818cf8" radius={[3, 3, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </ChartPanel>
                        </section>

                        {/* Row 2: hourly + weekday + overlap */}
                        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
                            <ChartPanel title="Votes by Hour" subtitle="UTC, all days in range" icon={<Clock className="w-5 h-5" />} tint="indigo">
                                <ResponsiveContainer width="99%" height={200}>
                                    <BarChart data={hourly}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                                        <XAxis dataKey="hour" stroke="#64748b" fontSize={10} tickLine={false} axisLine={false} interval={3} />
                                        <YAxis stroke="#64748b" fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} />
                                        <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'rgba(148,163,184,0.06)' }} />
                                        <Bar dataKey="votes" name="Votes" fill="#818cf8" radius={[3, 3, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </ChartPanel>

                            <ChartPanel title="Votes by Weekday" subtitle="Weekend votes count double on Top.gg" icon={<CalendarDays className="w-5 h-5" />} tint="amber">
                                <ResponsiveContainer width="99%" height={200}>
                                    <BarChart data={weekdays}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                                        <XAxis dataKey="day" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                                        <YAxis stroke="#64748b" fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} />
                                        <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'rgba(148,163,184,0.06)' }} />
                                        <Bar dataKey="votes" name="Votes" fill="#fbbf24" radius={[3, 3, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </ChartPanel>

                            <ChartPanel title="Platform Overlap" subtitle={`Where voters vote, last ${days} days`} icon={<Globe className="w-5 h-5" />} tint="emerald">
                                {overlapData.length === 0 ? (
                                    <EmptyNote>No votes recorded in this window.</EmptyNote>
                                ) : (
                                    <div className="flex items-center gap-4">
                                        <ResponsiveContainer width="60%" height={200}>
                                            <PieChart>
                                                <Pie data={overlapData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75} paddingAngle={3} stroke="none">
                                                    {overlapData.map(d => <Cell key={d.name} fill={d.color} />)}
                                                </Pie>
                                                <Tooltip contentStyle={TOOLTIP_STYLE} />
                                            </PieChart>
                                        </ResponsiveContainer>
                                        <div className="space-y-2 text-xs">
                                            {overlapData.map(d => (
                                                <div key={d.name} className="flex items-center gap-2">
                                                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                                                    <span className="text-slate-300">{d.name}</span>
                                                    <span className="text-white font-bold ml-auto">{d.value.toLocaleString()}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </ChartPanel>
                        </section>

                        {/* Row 3: top voters + campaigns + live feed */}
                        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-10">
                            <ChartPanel title="Top Voters" subtitle={`Most bot-list votes, last ${days} days`} icon={<Trophy className="w-5 h-5" />} tint="amber">
                                {topVoters.length === 0 ? (
                                    <EmptyNote>No votes recorded yet.</EmptyNote>
                                ) : (
                                    <ul className="space-y-2">
                                        {topVoters.slice(0, 8).map((v, i) => (
                                            <li key={v.user_id} className="flex items-center gap-3 bg-slate-900/40 border border-slate-800 rounded-lg px-3 py-2">
                                                <span className="text-xs font-bold text-slate-500 w-4">{i + 1}</span>
                                                <Avatar url={v.avatar_url} />
                                                <div className="min-w-0 flex-1">
                                                    <p className="text-sm text-slate-200 truncate">{v.username || v.user_id}</p>
                                                    <p className="text-[10px] text-slate-500">{v.sources.map(s => SOURCE_LABELS[s] ?? s).join(' · ')}</p>
                                                </div>
                                                <span className="text-sm font-bold text-white">{Number(v.votes).toLocaleString()}</span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </ChartPanel>

                            <ChartPanel title="Vote Campaigns" subtitle="From ?source= params on Top.gg vote links" icon={<Megaphone className="w-5 h-5" />} tint="indigo">
                                {(analytics?.campaigns ?? []).length === 0 ? (
                                    <EmptyNote>No campaign-tagged votes in this window.</EmptyNote>
                                ) : (
                                    <ul className="space-y-2">
                                        {(analytics?.campaigns ?? []).map(c => (
                                            <li key={c.campaign} className="flex items-center justify-between bg-slate-900/40 border border-slate-800 rounded-lg px-3 py-2">
                                                <span className="text-sm text-slate-300 font-mono truncate">{c.campaign}</span>
                                                <span className="text-sm font-bold text-white">{Number(c.votes).toLocaleString()}</span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </ChartPanel>

                            <ChartPanel title="Latest Votes" subtitle="Most recent bot-list vote events" icon={<Activity className="w-5 h-5" />} tint="rose">
                                {recentVotes.length === 0 ? (
                                    <EmptyNote>Nothing yet — votes appear here in real time.</EmptyNote>
                                ) : (
                                    <ul className="space-y-2 max-h-72 overflow-y-auto pr-1">
                                        {recentVotes.map(v => (
                                            <li key={v.id} className="flex items-center gap-3 bg-slate-900/40 border border-slate-800 rounded-lg px-3 py-2">
                                                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: SOURCE_COLORS[v.source] ?? '#64748b' }} />
                                                <div className="min-w-0 flex-1">
                                                    <p className="text-sm text-slate-200 truncate">
                                                        {v.username || v.user_id}
                                                        {v.is_test && <span className="ml-2 text-[10px] font-bold text-amber-400">TEST</span>}
                                                        {v.weight > 1 && <span className="ml-2 text-[10px] font-bold text-emerald-400">{v.weight}x</span>}
                                                    </p>
                                                    <p className="text-[10px] text-slate-500">
                                                        {SOURCE_LABELS[v.source] ?? v.source} · {new Date(v.created_at).toLocaleString()}
                                                    </p>
                                                </div>
                                                {v.total_votes != null && (
                                                    <span className="text-[10px] text-slate-500 shrink-0">{v.total_votes} total</span>
                                                )}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </ChartPanel>
                        </section>
                    </>
                )}

                {/* Voter directory */}
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
                    <div>
                        <h2 className="text-2xl font-bold text-white">Voter Directory</h2>
                        <p className="text-slate-400 text-sm">
                            {total.toLocaleString()} voter{total === 1 ? '' : 's'} in the last {days} days — streaks, list activity &amp; premium status
                        </p>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                            <input
                                type="text"
                                placeholder="Search user ID or username…"
                                value={searchInput}
                                onChange={(e) => setSearchInput(e.target.value)}
                                className="w-full md:w-64 bg-slate-900/50 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                            />
                        </div>
                        <div className="flex bg-slate-900/50 p-1 rounded-lg border border-slate-700">
                            <FilterButton active={sort === 'votes'} onClick={() => setSort('votes')}>Most votes</FilterButton>
                            <FilterButton active={sort === 'streak'} onClick={() => setSort('streak')}>Streak</FilterButton>
                            <FilterButton active={sort === 'recent'} onClick={() => setSort('recent')}>Recent</FilterButton>
                        </div>
                    </div>
                </div>

                <div className="glass-panel overflow-x-auto">
                    <table className="w-full text-left text-sm text-slate-400">
                        <thead className="bg-slate-900/50 text-xs uppercase font-bold text-slate-500">
                            <tr>
                                <th className="p-4">Voter</th>
                                <th className="p-4">Lists</th>
                                <th className="p-4">Votes ({days}d)</th>
                                <th className="p-4">Streak</th>
                                <th className="p-4">DiscordForge W/T</th>
                                <th className="p-4">Last Vote</th>
                                <th className="p-4">Premium</th>
                                <th className="p-4 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800">
                            {dirLoading && rows.length === 0 ? (
                                [...Array(5)].map((_, i) => (
                                    <tr key={i}>
                                        <td colSpan={8} className="p-3"><div className="h-8 rounded-lg animate-pulse bg-slate-800/40" /></td>
                                    </tr>
                                ))
                            ) : rows.length === 0 ? (
                                <tr>
                                    <td colSpan={8} className="p-8">
                                        <div className="text-center">
                                            <Users className="w-6 h-6 text-slate-600 mx-auto mb-2" />
                                            <div className="text-white font-semibold text-sm">No voters found</div>
                                            <div className="text-xs text-slate-500 mt-1">No bot-list votes match the current filters.</div>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                rows.map(v => (
                                    <tr key={v.user_id} className="hover:bg-slate-800/30 transition-colors">
                                        <td className="p-4">
                                            <div className="flex items-center gap-3">
                                                <Avatar url={v.avatar_url} />
                                                <div className="min-w-0">
                                                    <div className="text-white font-medium truncate max-w-[180px]">{v.username || 'Unknown'}</div>
                                                    <div className="font-mono text-[11px] text-slate-500">{v.user_id}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="p-4">
                                            <div className="flex gap-1.5">
                                                {v.sources.map(s => (
                                                    <span
                                                        key={s}
                                                        className="px-2 py-0.5 rounded-full text-[10px] font-bold"
                                                        style={{ backgroundColor: `${SOURCE_COLORS[s] ?? '#64748b'}20`, color: SOURCE_COLORS[s] ?? '#94a3b8' }}
                                                    >
                                                        {SOURCE_LABELS[s] ?? s}
                                                    </span>
                                                ))}
                                            </div>
                                        </td>
                                        <td className="p-4">
                                            <span className="text-white font-bold">{v.votes}</span>
                                            {v.weighted_votes > v.votes && (
                                                <span className="text-[10px] text-emerald-400 ml-1.5" title="Weighted (weekend votes count double)">({v.weighted_votes}w)</span>
                                            )}
                                        </td>
                                        <td className="p-4">
                                            {v.streak_days > 1 ? (
                                                <span className="inline-flex items-center gap-1 text-amber-400 font-bold">
                                                    <Flame className="w-3.5 h-3.5" /> {v.streak_days}d
                                                </span>
                                            ) : (
                                                <span className="text-slate-600">—</span>
                                            )}
                                        </td>
                                        <td className="p-4">
                                            {v.df_total_votes != null ? (
                                                <span className="font-mono text-xs">{v.df_weekly_votes ?? 0} / {v.df_total_votes}</span>
                                            ) : (
                                                <span className="text-slate-600">—</span>
                                            )}
                                        </td>
                                        <td className="p-4">
                                            <div className="flex items-center gap-2 text-xs">
                                                <Clock className="w-3 h-3" />
                                                {new Date(v.last_botlist_vote_at).toLocaleString()}
                                            </div>
                                        </td>
                                        <td className="p-4"><PremiumBadge lastVote={v.premium_last_vote_at} /></td>
                                        <td className="p-4 text-right">
                                            <button
                                                onClick={() => navigate(`/polls?user_id=${v.user_id}`)}
                                                className="text-indigo-400 hover:text-indigo-300 text-xs font-bold"
                                            >
                                                VIEW POLLS
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {!dirLoading && rows.length < total && (
                    <div className="mt-6 text-center">
                        <button
                            onClick={() => fetchDirectory(offset + PAGE_SIZE, true)}
                            className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold transition-colors shadow-lg shadow-indigo-500/20 inline-flex items-center gap-2"
                        >
                            <RefreshCw className="w-4 h-4" />
                            Load {Math.min(PAGE_SIZE, total - rows.length)} More
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

const TINTS: Record<string, string> = {
    rose: 'bg-rose-500/10 text-rose-400',
    indigo: 'bg-indigo-500/10 text-indigo-400',
    emerald: 'bg-emerald-500/10 text-emerald-400',
    amber: 'bg-amber-500/10 text-amber-400',
};

const StatCard = ({ icon, tint, label, value, sub }: { icon: React.ReactNode; tint: string; label: string; value: string; sub?: string }) => (
    <div className="glass-panel p-4 flex items-center gap-3">
        <div className={`p-2.5 rounded-lg ${TINTS[tint]}`}>{icon}</div>
        <div className="min-w-0">
            <p className="text-xs text-slate-400 font-bold truncate">{label}</p>
            <p className="text-xl font-bold text-white">{value}</p>
            {sub && <p className="text-[10px] text-slate-500">{sub}</p>}
        </div>
    </div>
);

const ChartPanel = ({ title, subtitle, icon, tint, children }: { title: string; subtitle: string; icon: React.ReactNode; tint: string; children: React.ReactNode }) => (
    <div className="glass-panel p-6" style={{ minWidth: 0 }}>
        <div className="flex items-center gap-2 mb-4">
            <div className={`p-2 rounded-lg ${TINTS[tint]}`}>{icon}</div>
            <div>
                <h3 className="text-base font-bold text-white">{title}</h3>
                <p className="text-slate-400 text-xs">{subtitle}</p>
            </div>
        </div>
        {children}
    </div>
);

const EmptyNote = ({ children }: { children: React.ReactNode }) => (
    <div className="h-40 flex items-center justify-center text-sm text-slate-500">{children}</div>
);

const Avatar = ({ url }: { url: string | null }) => (
    url
        ? <img src={url} alt="" className="w-7 h-7 rounded-full shrink-0" />
        : <div className="w-7 h-7 rounded-full bg-slate-700 shrink-0" />
);

const PremiumBadge = ({ lastVote }: { lastVote: string | null }) => {
    if (!lastVote) {
        return (
            <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold bg-slate-700/40 text-slate-500">
                <XCircle className="w-3 h-3" /> NEVER
            </div>
        );
    }
    const diffHours = (Date.now() - new Date(lastVote).getTime()) / 36e5;
    if (diffHours < 12) {
        return (
            <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400">
                <CheckCircle className="w-3 h-3" /> PREMIUM
            </div>
        );
    }
    if (diffHours < 13) {
        return (
            <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-400">
                <Clock className="w-3 h-3" /> GRACE
            </div>
        );
    }
    return (
        <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold bg-rose-500/10 text-rose-400">
            <XCircle className="w-3 h-3" /> EXPIRED
        </div>
    );
};
