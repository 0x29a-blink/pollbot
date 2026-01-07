import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { motion } from 'framer-motion';
import { Activity, Users, BarChart3, Search, Filter, Server, Trophy, Medal } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { VoteHistoryChart } from '../components/charts/VoteHistoryChart';
import { LanguagePieChart } from '../components/charts/LanguagePieChart';
import { Leaderboard } from '../components/Leaderboard';
// import { ActivityTicker } from '../components/ActivityTicker';

interface GlobalStats {
    total_polls: number;
    total_votes: number;
    peak_active_servers: number;
}

interface GuildData {
    id: string;
    name: string;
    member_count: number;
    icon_url: string | null;
    joined_at: string;
}

export const Home: React.FC = () => {
    const [stats, setStats] = useState<GlobalStats | null>(null);
    const [guilds, setGuilds] = useState<GuildData[]>([]); // Only stores loaded subset (top 100)
    const [totalServerCount, setTotalServerCount] = useState(0); // Stores total DB count
    const [topCreators, setTopCreators] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('');
    const [sort, setSort] = useState<'members_desc' | 'members_asc' | 'recent'>('members_desc');
    const [activePremiumCount, setActivePremiumCount] = useState(0);
    const navigate = useNavigate();

    useEffect(() => {
        fetchData();

        // Subscribe to real-time events for dashboard updates
        const channel = supabase
            .channel('dashboard-updates')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'polls' }, () => fetchData())
            .on('postgres_changes', { event: '*', schema: 'public', table: 'votes' }, () => fetchData())
            .on('postgres_changes', { event: '*', schema: 'public', table: 'guilds' }, () => fetchData())
            .on('postgres_changes', { event: '*', schema: 'public', table: 'global_stats' }, () => fetchData())
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    const fetchData = async () => {
        // setLoading(true); // Don't trigger loading state on refresh to avoid UI flash
        try {
            // Fetch Global Stats
            const { data: statsData } = await supabase
                .from('global_stats')
                .select('*')
                .eq('id', 1)
                .single();

            if (statsData) setStats(statsData);

            // Fetch Guilds Count (Real Total)
            const { count: totalGuilds } = await supabase
                .from('guilds')
                .select('*', { count: 'exact', head: true });

            if (totalGuilds !== null) setActivePremiumCount(prev => prev); // Hack: We need a state for totalGuilds. 
            // Better: Let's create a new state or just use the guilds.length if small, but here we expect >1000.
            // Let's assume we need a new state: [totalServerCount, setTotalServerCount]

            // Fetch Recent/Top Guilds for List (Limit 100 for performance)
            const { data: guildsData } = await supabase
                .from('guilds')
                .select('*')
                .order('member_count', { ascending: false }) // Default to largest first
                .limit(100);

            if (guildsData) setGuilds(guildsData);
            if (totalGuilds !== null) setTotalServerCount(totalGuilds);

            // Fetch Active Premium Users
            const { data: usersData } = await supabase
                .from('users')
                .select('last_vote_at');

            if (usersData) {
                const now = new Date().getTime();
                const activeCount = usersData.filter(u => {
                    if (!u.last_vote_at) return false;
                    const voteTime = new Date(u.last_vote_at).getTime();
                    const diffHours = (now - voteTime) / (1000 * 60 * 60);
                    return diffHours < 13; // Active (<12) or Grace (<13)
                }).length;
                setActivePremiumCount(activeCount);
            }

            // Fetch Top Creators (Aggregation)
            const { data: pollsData } = await supabase
                .from('polls')
                .select('creator_id');

            if (pollsData) {
                const counts: Record<string, number> = {};
                pollsData.forEach((p: any) => {
                    counts[p.creator_id] = (counts[p.creator_id] || 0) + 1;
                });

                const sorted = Object.entries(counts)
                    .sort(([, a], [, b]) => b - a)
                    .slice(0, 5)
                    .map(([id, count]) => ({
                        id,
                        label: `User ${id.substr(0, 8)}...`, // Truncate ID for UI
                        subLabel: 'Poll Creator',
                        value: count
                    }));

                setTopCreators(sorted);
            }

        } catch (error) {
            console.error('Error fetching data:', error);
        } finally {
            setLoading(false);
        }
    };

    const filteredGuilds = guilds
        .filter(g => g.name.toLowerCase().includes(filter.toLowerCase()))
        .sort((a, b) => {
            if (sort === 'members_desc') return b.member_count - a.member_count;
            if (sort === 'members_asc') return a.member_count - b.member_count;
            if (sort === 'recent') return new Date(b.joined_at).getTime() - new Date(a.joined_at).getTime();
            return 0;
        });

    return (
        <div className="min-h-screen pb-20">
            {/* Header */}
            <header className="glass-panel sticky top-0 z-50 border-t-0 border-r-0 border-l-0 rounded-none bg-opacity-80">
                {/* <ActivityTicker /> Removed by user request */}
                <div className="container-wide py-4 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center text-indigo-400">
                            <Activity className="w-6 h-6" />
                        </div>
                        <h1 className="text-xl font-bold title-gradient">Pollbot Telemetry</h1>
                    </div>

                    <div className="flex items-center gap-4">
                        <button onClick={() => navigate('/polls')} className="text-sm font-bold text-indigo-400 hover:text-indigo-300">Global Polls</button>
                        <button onClick={() => navigate('/voters')} className="text-sm font-bold text-indigo-400 hover:text-indigo-300">Voters</button>
                        <div className="h-4 w-px bg-slate-700"></div>
                        <button
                            onClick={() => { localStorage.removeItem('telemetry_key'); navigate('/login'); }}
                            className="text-sm text-slate-400 hover:text-white transition-colors"
                        >
                            Logout
                        </button>
                    </div>
                </div>
            </header>

            <main className="container-wide mt-8 animate-fade-in">
                {/* Stats Deck */}
                <section className="grid-stats">
                    <StatsCard
                        title="Total Polls"
                        value={stats?.total_polls || 0}
                        icon={<BarChart3 className="text-blue-400" />}
                        color="blue"
                    />
                    <StatsCard
                        title="Total Votes"
                        value={stats?.total_votes || 0}
                        icon={<Users className="text-emerald-400" />}
                        color="emerald"
                    />
                    <StatsCard
                        title="Active Servers"
                        value={totalServerCount}
                        icon={<Server className="text-violet-400" />}
                        color="violet"
                    />
                    <StatsCard
                        title="Active Premium Users"
                        value={activePremiumCount}
                        icon={<Activity className="text-amber-400" />}
                        color="amber"
                    />
                </section>

                {/* Analytics Section */}
                <section className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
                    <div className="md:col-span-2 chart-container" style={{ width: '100%', minHeight: '300px' }}>
                        <VoteHistoryChart />
                    </div>
                    <div className="chart-container" style={{ width: '100%', minHeight: '300px' }}>
                        <LanguagePieChart />
                    </div>
                </section>

                {/* Leaderboards */}
                <section className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
                    <Leaderboard
                        title="Top Servers"
                        icon={<Trophy className="w-5 h-5" />}
                        color="yellow"
                        items={guilds
                            .sort((a, b) => b.member_count - a.member_count)
                            .slice(0, 5)
                            .map(g => ({
                                id: g.id,
                                label: g.name,
                                subLabel: `${g.member_count.toLocaleString()} members`,
                                value: g.member_count.toLocaleString()
                            }))
                        }
                    />
                    <Leaderboard
                        title="Top Creators"
                        icon={<Medal className="w-5 h-5" />}
                        color="amber"
                        items={topCreators}
                    />
                </section>

                {/* Server Browser */}
                <section className="mt-12">
                    <div className="flex flex-col md:flex-row justify-between items-end md:items-center mb-6 gap-4">
                        <h2 className="text-2xl font-bold text-white">Connected Servers</h2>

                        <div className="flex gap-3 w-full md:w-auto">
                            <div className="relative flex-1 md:w-64">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                                <input
                                    type="text"
                                    placeholder="Search servers..."
                                    value={filter}
                                    onChange={(e) => setFilter(e.target.value)}
                                    className="w-full bg-slate-900/50 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                                />
                            </div>
                            <div className="relative">
                                <select
                                    value={sort}
                                    onChange={(e) => setSort(e.target.value as any)}
                                    className="appearance-none bg-slate-900/50 border border-slate-700 rounded-lg pl-4 pr-10 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 cursor-pointer"
                                >
                                    <option value="members_desc">Most Members</option>
                                    <option value="members_asc">Least Members</option>
                                    <option value="recent">Recently Joined</option>
                                </select>
                                <Filter className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                            </div>
                        </div>
                    </div>

                    <div className="server-grid">
                        {loading ? (
                            [...Array(6)].map((_, i) => <SkeletonCard key={i} />)
                        ) : filteredGuilds.map(guild => (
                            <ServerCard key={guild.id} guild={guild} onClick={() => navigate(`/server/${guild.id}`)} />
                        ))}
                    </div>
                </section>
            </main>
        </div>
    );
};

const StatsCard = ({ title, value, icon, color }: any) => (
    <div className={`glass-panel p-6 relative overflow-hidden group`}>
        <div className={`absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity`}>
            {React.cloneElement(icon, { className: `w-24 h-24` })}
        </div>
        <div className="relative z-10">
            <div className="flex items-center gap-3 mb-2">
                <div className={`p-2 rounded-lg bg-${color}-500/10`}>
                    {icon}
                </div>
                <span className="text-slate-400 font-medium">{title}</span>
            </div>
            <div className="text-4xl font-bold text-white tracking-tight">
                {value.toLocaleString()}
            </div>
        </div>
    </div>
);

const ServerCard = ({ guild, onClick }: { guild: GuildData, onClick: () => void }) => (
    <motion.div
        whileHover={{ y: -4 }}
        onClick={onClick}
        className="glass-panel p-4 cursor-pointer hover:border-indigo-500/30 transition-colors group"
    >
        <div className="flex items-center gap-4">
            {guild.icon_url ? (
                <img src={guild.icon_url} alt={guild.name} className="w-12 h-12 rounded-xl object-cover bg-slate-800" />
            ) : (
                <div className="w-12 h-12 rounded-xl bg-slate-800 flex items-center justify-center text-slate-500 text-lg font-bold">
                    {guild.name.charAt(0)}
                </div>
            )}
            <div className="flex-1 min-w-0">
                <h3 className="text-white font-medium truncate group-hover:text-indigo-400 transition-colors">{guild.name}</h3>
                <div className="flex items-center gap-2 text-xs text-slate-500 mt-1">
                    <Users className="w-3 h-3" />
                    <span>{guild.member_count.toLocaleString()} members</span>
                </div>
            </div>
        </div>
    </motion.div>
);

const SkeletonCard = () => (
    <div className="glass-panel p-4 h-20 animate-pulse bg-slate-800/20" />
);
