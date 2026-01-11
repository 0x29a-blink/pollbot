import SimpleSolutionsLogo from '../assets/simplesolutions.webp';
import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { motion } from 'framer-motion';
import { Activity, Users, BarChart3, Search, Filter, Server, Trophy, Medal, RefreshCw, Shield, Plus, ExternalLink, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { VoteHistoryChart } from '../components/charts/VoteHistoryChart';
import { LanguagePieChart } from '../components/charts/LanguagePieChart';
import { Leaderboard } from '../components/Leaderboard';
import { useAuth } from '../App';

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

interface UserGuild {
    id: string;
    name: string;
    icon_url: string | null;
    member_count?: number;
    has_bot: boolean;
}

export const Home: React.FC = () => {
    const [stats, setStats] = useState<GlobalStats | null>(null);
    const [guilds, setGuilds] = useState<GuildData[]>([]);
    const [totalServerCount, setTotalServerCount] = useState(0);
    const [totalMembers, setTotalMembers] = useState(0);
    const [topCreators, setTopCreators] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('');
    const [showCurated, setShowCurated] = useState(false); // Only show servers with polls
    const [sort, setSort] = useState<'members_desc' | 'members_asc' | 'recent' | 'polls_desc' | 'ratio_desc'>('members_desc');
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [activePremiumCount, setActivePremiumCount] = useState(0);
    const navigate = useNavigate();
    const { user, logout } = useAuth();

    const ITEMS_PER_PAGE = 24;

    useEffect(() => {
        fetchData(); // Initial load

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

    // Effect to refetch guilds when filters/page change
    useEffect(() => {
        fetchGuildsList();
    }, [page, filter, sort, showCurated]);

    const fetchData = async () => {
        try {
            // Global Stats
            const { data: statsData } = await supabase.from('global_stats').select('*').eq('id', 1).single();
            if (statsData) setStats(statsData);

            // Active Premium Users
            const { data: usersData } = await supabase.from('users').select('last_vote_at');
            if (usersData) {
                const now = new Date().getTime();
                const activeCount = usersData.filter(u => {
                    if (!u.last_vote_at) return false;
                    const diffHours = (now - new Date(u.last_vote_at).getTime()) / (1000 * 60 * 60);
                    return diffHours < 13;
                }).length;
                setActivePremiumCount(activeCount);
            }

            // Calculations for Totals (Servers & Members)
            // Fetch ALL member counts (lightweight query) to sum them up on client
            // Note: For millions of rows this is bad, but for 5100 it's instant.
            const { data: allGuilds, count: totalGuildCount } = await supabase.from('guilds').select('member_count', { count: 'exact' }).limit(1000); // Limit data to 1000 to save bandwidth, but get true count
            if (allGuilds) {
                setTotalServerCount(totalGuildCount || allGuilds.length);
                const sum = allGuilds.reduce((acc, curr) => acc + (curr.member_count || 0), 0);
                // Note: This sum is only for the first 1000 guilds (approx). A true sum requires RPC or iterative fetch.
                // For now, we accept this approximation or we could scale it.
                setTotalMembers(sum);
            }

            // Top Creators
            const { data: pollsData } = await supabase.from('polls').select('creator_id');
            if (pollsData) {
                const counts: Record<string, number> = {};
                pollsData.forEach((p: any) => counts[p.creator_id] = (counts[p.creator_id] || 0) + 1);
                const sorted = Object.entries(counts)
                    .sort(([, a], [, b]) => b - a)
                    .slice(0, 5)
                    .map(([id, count]) => ({
                        id,
                        label: `User ${id.substr(0, 8)}...`,
                        subLabel: 'Poll Creator',
                        value: count,
                        onClick: () => navigate(`/polls?user_id=${id}`) // Add navigation
                    }));
                setTopCreators(sorted);
            }

        } catch (error) {
            console.error('Error fetching data:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleRefreshData = () => {
        fetchData();
        fetchGuildsList();
    };

    // Sync guilds from Discord (admin-only, calls backend)
    const [syncing, setSyncing] = useState(false);
    const [showSyncConfirm, setShowSyncConfirm] = useState(false);

    const handleSyncGuilds = async () => {
        setShowSyncConfirm(false);
        setSyncing(true);

        try {
            const session = localStorage.getItem('dashboard_session');
            const res = await fetch('/api/admin/sync-guilds', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${session}`,
                    'Content-Type': 'application/json'
                }
            });

            if (res.ok) {
                // Wait a moment for sync to complete, then refresh data
                setTimeout(() => {
                    handleRefreshData();
                    setSyncing(false);
                }, 3000);
            } else {
                const err = await res.json();
                alert(`Sync failed: ${err.error}`);
                setSyncing(false);
            }
        } catch (error) {
            console.error('Sync error:', error);
            alert('Failed to sync guilds');
            setSyncing(false);
        }
    };

    // User's manageable guilds (for non-admin view)
    const [userGuildsWithBot, setUserGuildsWithBot] = useState<UserGuild[]>([]);
    const [userGuildsWithoutBot, setUserGuildsWithoutBot] = useState<UserGuild[]>([]);
    const [userGuildsLoading, setUserGuildsLoading] = useState(false);
    const [userGuildsError, setUserGuildsError] = useState<string | null>(null);
    const [lastGuildRefresh, setLastGuildRefresh] = useState<Date | null>(null);
    const [refreshCooldown, setRefreshCooldown] = useState(0); // seconds remaining
    const [isRefreshingGuilds, setIsRefreshingGuilds] = useState(false);

    const fetchUserGuilds = async () => {
        setUserGuildsLoading(true);
        setUserGuildsError(null);

        try {
            const session = localStorage.getItem('dashboard_session');
            const res = await fetch('/api/user/guilds', {
                headers: {
                    'Authorization': `Bearer ${session}`,
                }
            });

            if (res.ok) {
                const data = await res.json();
                setUserGuildsWithBot(data.withBot || []);
                setUserGuildsWithoutBot(data.withoutBot || []);
                if (data.lastRefreshed) {
                    setLastGuildRefresh(new Date(data.lastRefreshed));
                }
            } else if (res.status === 401) {
                setUserGuildsError('Please log out and log back in to see your servers.');
            } else {
                setUserGuildsError('Failed to load your servers.');
            }
        } catch (error) {
            console.error('Error fetching user guilds:', error);
            setUserGuildsError('Failed to load your servers.');
        } finally {
            setUserGuildsLoading(false);
        }
    };

    // Manual refresh with rate limiting
    const refreshUserGuilds = async () => {
        if (isRefreshingGuilds || refreshCooldown > 0) return;

        setIsRefreshingGuilds(true);
        setUserGuildsError(null);

        try {
            const session = localStorage.getItem('dashboard_session');
            const res = await fetch('/api/user/guilds/refresh', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${session}`,
                }
            });

            if (res.ok) {
                const data = await res.json();
                setUserGuildsWithBot(data.withBot || []);
                setUserGuildsWithoutBot(data.withoutBot || []);
                setLastGuildRefresh(new Date());
                // Start 5-minute cooldown
                setRefreshCooldown(300);
            } else if (res.status === 429) {
                const data = await res.json();
                setRefreshCooldown(data.retryAfter || 300);
            } else if (res.status === 401) {
                setUserGuildsError('Please log out and log back in.');
            } else {
                setUserGuildsError('Failed to refresh servers.');
            }
        } catch (error) {
            console.error('Error refreshing guilds:', error);
            setUserGuildsError('Failed to refresh servers.');
        } finally {
            setIsRefreshingGuilds(false);
        }
    };

    // Cooldown timer effect
    useEffect(() => {
        if (refreshCooldown <= 0) return;
        const timer = setInterval(() => {
            setRefreshCooldown(prev => Math.max(0, prev - 1));
        }, 1000);
        return () => clearInterval(timer);
    }, [refreshCooldown]);

    // Fetch user guilds when component mounts (for all users - shown when admin panel is hidden)
    useEffect(() => {
        if (user) {
            fetchUserGuilds();
        }
    }, [user]);

    // Bot invite URL with guild pre-selection
    const getBotInviteUrl = (guildId: string) => {
        const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID || '';
        return `https://discord.com/oauth2/authorize?client_id=${clientId}&scope=bot+applications.commands&permissions=274878024768&guild_id=${guildId}`;
    };

    const fetchGuildsList = async () => {
        setLoading(true);
        try {
            const start = (page - 1) * ITEMS_PER_PAGE;
            const end = start + ITEMS_PER_PAGE - 1;

            let guildIdsToFilter: string[] | null = null;

            // If Curated, first fetch valid guild IDs manually to avoid Foreign Key issues (400 Bad Request)
            if (showCurated) {
                const { data: pollGuilds, error: pollError } = await supabase
                    .from('polls')
                    .select('guild_id');

                if (pollError) throw pollError;

                if (pollGuilds) {
                    // Get unique IDs
                    guildIdsToFilter = Array.from(new Set(pollGuilds.map(p => p.guild_id)));
                } else {
                    guildIdsToFilter = [];
                }
            }

            let query = supabase.from('guilds').select('*', { count: 'exact' });

            // Apply manual filter if needed
            if (showCurated) {
                if (guildIdsToFilter && guildIdsToFilter.length > 0) {
                    query = query.in('id', guildIdsToFilter);
                } else {
                    // If no polls found, return empty result immediately
                    setGuilds([]);
                    setTotalPages(0);
                    setLoading(false);
                    return;
                }
            }

            // Search Filter
            if (filter) query = query.ilike('name', `%${filter}%`);

            // Sorting
            if (sort === 'members_desc') query = query.order('member_count', { ascending: false });
            if (sort === 'members_asc') query = query.order('member_count', { ascending: true });
            if (sort === 'recent') query = query.order('joined_at', { ascending: false });

            // Advanced Analytics Sorting (Client-side mainly since no DB views yet)
            if (sort === 'polls_desc' || sort === 'ratio_desc') {
                // Fetch ALL polls to aggregate stats (Heavy operation, but needed for this specific filter)
                const { data: allPolls } = await supabase.from('polls').select('guild_id, message_id');

                if (allPolls) {
                    const guildStats: Record<string, { polls: number, votes: number }> = {};
                    allPolls.forEach(p => {
                        if (!guildStats[p.guild_id]) guildStats[p.guild_id] = { polls: 0, votes: 0 };
                        guildStats[p.guild_id].polls++;
                    });

                    // For Ratio, we need votes too.
                    if (sort === 'ratio_desc') {
                        const { data: allVotes } = await supabase.from('votes').select('poll_id');
                        const pollToGuild = new Map(allPolls.map(p => [p.message_id, p.guild_id]));

                        if (allVotes) {
                            allVotes.forEach(v => {
                                const gId = pollToGuild.get(v.poll_id);
                                if (gId && guildStats[gId]) {
                                    guildStats[gId].votes++;
                                }
                            });
                        }
                    }

                    // Sort Guild IDs based on stats
                    const sortedGuildIds = Object.entries(guildStats)
                        .sort(([, statA], [, statB]) => {
                            if (sort === 'polls_desc') return statB.polls - statA.polls;
                            if (sort === 'ratio_desc') {
                                const ratioA = statA.polls > 0 ? statA.votes / statA.polls : 0;
                                const ratioB = statB.polls > 0 ? statB.votes / statB.polls : 0;
                                return ratioB - ratioA;
                            }
                            return 0;
                        })
                        .map(([id]) => id);

                    // Now filter the query to these IDs and ideally preserve order (Supabase doesn't preserve order of IN clause easily)
                    // So we fetch matching guilds and sort in memory
                    if (sortedGuildIds.length > 0) {
                        query = query.in('id', sortedGuildIds);
                    } else {
                        setGuilds([]);
                        setLoading(false);
                        return;
                    }

                    // execute query
                    const { data: unsortedData } = await query;

                    if (unsortedData) {
                        // Re-sort client side
                        const sortedData = unsortedData.sort((a, b) => {
                            return sortedGuildIds.indexOf(a.id) - sortedGuildIds.indexOf(b.id);
                        });

                        // Pagination slice handling for client-side sorted list
                        // Note: This logic retrieves ALL matching guilds then slices. 
                        // It defies the backend pagination but is necessary for these computed sorts without DB func.
                        setTotalPages(Math.ceil(sortedData.length / ITEMS_PER_PAGE));
                        setGuilds(sortedData.slice(start, end + 1));
                    }
                    setLoading(false);
                    return; // Return early since we handled data setting
                }
            }

            // Pagination (Standard)
            query = query.range(start, end);

            const { data, count } = await query;

            if (data) {
                setGuilds(data);
                if (count !== null) setTotalPages(Math.ceil(count / ITEMS_PER_PAGE));
            }
        } catch (error) {
            console.error('Error fetching guilds:', error);
            setGuilds([]);
        } finally {
            setLoading(false);
        }
    }


    const handleLogout = async () => {
        await logout();
        navigate('/login');
    };

    // State for showing admin telemetry panel
    const [showTelemetry, setShowTelemetry] = useState(false);

    return (
        <div className="min-h-screen pb-20">
            {/* Header */}
            <header className="glass-panel sticky top-0 z-50 border-t-0 border-r-0 border-l-0 rounded-none bg-opacity-80">
                <div className="container-wide py-4 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center text-indigo-400 overflow-hidden">
                            <img src={SimpleSolutionsLogo} alt="Logo" className="w-full h-full object-contain p-1" />
                        </div>
                        <h1 className="text-xl font-bold title-gradient">Simple Poll Bot Dashboard</h1>
                    </div>

                    <div className="flex items-center gap-4">
                        {/* Admin Panel Toggle - only visible to admins */}
                        {user?.is_admin && (
                            <button
                                onClick={() => setShowTelemetry(!showTelemetry)}
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${showTelemetry
                                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                    : 'bg-slate-800 text-slate-400 hover:text-white border border-slate-700'
                                    }`}
                            >
                                <Shield className="w-4 h-4" />
                                {showTelemetry ? 'Hide Admin Panel' : 'Admin Panel'}
                            </button>
                        )}
                        <div className="h-4 w-px bg-slate-700"></div>
                        {/* User info */}
                        {user && (
                            <div className="flex items-center gap-2">
                                <img
                                    src={user.avatar_url}
                                    alt={user.username}
                                    className="w-8 h-8 rounded-full"
                                />
                                <span className="text-sm text-slate-300">{user.username}</span>
                            </div>
                        )}
                        <button
                            onClick={handleLogout}
                            className="text-sm text-slate-400 hover:text-white transition-colors"
                        >
                            Logout
                        </button>
                    </div>
                </div>
            </header>

            <main className="container-wide mt-8 animate-fade-in">
                {/* Sync Confirmation Modal */}
                {showSyncConfirm && (
                    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="glass-panel p-6 max-w-md mx-4"
                        >
                            <h3 className="text-xl font-bold text-white mb-4">Sync Guild Data?</h3>
                            <p className="text-slate-400 mb-6">
                                This will refresh ALL server data from Discord including names, icons, and member counts.
                                This is a heavy operation and may take a moment.
                            </p>
                            <div className="flex gap-3 justify-end">
                                <button
                                    onClick={() => setShowSyncConfirm(false)}
                                    className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleSyncGuilds}
                                    className="px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-bold hover:bg-amber-400 transition-colors"
                                >
                                    Sync All Guilds
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}

                {/* Admin Telemetry Panel - Only visible when toggled */}
                {user?.is_admin && showTelemetry ? (
                    <>
                        {/* Admin Navigation */}
                        <div className="flex items-center gap-4 mb-6">
                            <button onClick={() => navigate('/polls')} className="text-sm font-bold text-indigo-400 hover:text-indigo-300">Global Polls</button>
                            <button onClick={() => navigate('/voters')} className="text-sm font-bold text-indigo-400 hover:text-indigo-300">Voters</button>
                            <button onClick={handleRefreshData} className="flex items-center gap-2 text-sm font-bold text-emerald-400 hover:text-emerald-300 transition-colors">
                                <RefreshCw className="w-4 h-4" />
                                Refresh View
                            </button>
                            <button
                                onClick={() => setShowSyncConfirm(true)}
                                disabled={syncing}
                                className="flex items-center gap-2 text-sm font-bold text-amber-400 hover:text-amber-300 transition-colors disabled:opacity-50"
                            >
                                <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
                                {syncing ? 'Syncing...' : 'Sync from Discord'}
                            </button>
                        </div>

                        {/* Stats Deck */}
                        <section className="grid-stats">
                            <StatsCard title="Total Polls" value={stats?.total_polls || 0} icon={<BarChart3 className="text-blue-400" />} color="blue" />
                            <StatsCard title="Total Votes" value={stats?.total_votes || 0} icon={<Users className="text-emerald-400" />} color="emerald" />
                            <StatsCard
                                title="Active Servers"
                                value={totalServerCount}
                                subLabel={`${totalMembers.toLocaleString()} Users`}
                                icon={<Server className="text-violet-400" />}
                                color="violet"
                            />
                            <StatsCard title="Active Premium Users" value={activePremiumCount} icon={<Activity className="text-amber-400" />} color="amber" />
                        </section>

                        {/* Analytics Section */}
                        <section className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
                            <div className="md:col-span-2 chart-container" style={{ width: '100%', minHeight: '300px', minWidth: 0 }}>
                                <VoteHistoryChart />
                            </div>
                            <div className="chart-container" style={{ width: '100%', minHeight: '300px', minWidth: 0 }}>
                                <LanguagePieChart />
                            </div>
                        </section>

                        {/* Leaderboards */}
                        <section className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
                            <Leaderboard
                                title="Top Servers"
                                icon={<Trophy className="w-5 h-5" />}
                                color="yellow"
                                items={guilds.slice(0, 5).map(g => ({
                                    id: g.id,
                                    label: g.name,
                                    subLabel: `${g.member_count.toLocaleString()} members`,
                                    value: g.member_count.toLocaleString()
                                }))}
                            />
                            <Leaderboard title="Top Creators" icon={<Medal className="w-5 h-5" />} color="amber" items={topCreators} />
                        </section>

                        {/* Server Browser */}
                        <section className="mt-12">
                            <div className="flex flex-col md:flex-row justify-between items-end md:items-center mb-6 gap-4">
                                <div className="flex items-center gap-4">
                                    <h2 className="text-2xl font-bold text-white">Connected Servers</h2>
                                    <div className="flex items-center gap-2 bg-slate-900/50 p-1 rounded-lg border border-slate-700">
                                        <button
                                            onClick={() => { setShowCurated(false); setPage(1); }}
                                            className={`px-3 py-1 rounded text-xs font-bold transition-all ${!showCurated ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}
                                        >
                                            All
                                        </button>
                                        <button
                                            onClick={() => { setShowCurated(true); setPage(1); }}
                                            className={`px-3 py-1 rounded text-xs font-bold transition-all ${showCurated ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}
                                        >
                                            Curated Polls
                                        </button>
                                    </div>
                                </div>

                                <div className="flex gap-3 w-full md:w-auto">
                                    <div className="relative flex-1 md:w-64">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                                        <input
                                            type="text"
                                            placeholder="Search servers..."
                                            value={filter}
                                            onChange={(e) => { setFilter(e.target.value); setPage(1); }}
                                            className="w-full bg-slate-900/50 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                                        />
                                    </div>
                                    <div className="relative">
                                        <select
                                            value={sort}
                                            onChange={(e) => { setSort(e.target.value as any); setPage(1); }}
                                            className="appearance-none bg-slate-900/50 border border-slate-700 rounded-lg pl-4 pr-10 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 cursor-pointer"
                                        >
                                            <option value="members_desc">Most Members</option>
                                            <option value="members_asc">Least Members</option>
                                            <option value="recent">Recently Joined</option>
                                            <option value="polls_desc">Most Polls</option>
                                            <option value="ratio_desc">Highest Engagement</option>
                                        </select>
                                        <Filter className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                                    </div>
                                </div>
                            </div>

                            <div className="server-grid">
                                {loading ? (
                                    [...Array(6)].map((_, i) => <SkeletonCard key={i} />)
                                ) : guilds.map(guild => (
                                    <ServerCard key={guild.id} guild={guild} onClick={() => navigate(`/server/${guild.id}`)} />
                                ))}
                            </div>

                            {/* Pagination Controls */}
                            <div className="flex justify-center items-center gap-4 mt-8">
                                <button
                                    disabled={page === 1}
                                    onClick={() => setPage(p => Math.max(1, p - 1))}
                                    className="px-4 py-2 rounded-lg bg-slate-800 text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-700 transition-colors"
                                >
                                    Previous
                                </button>
                                <span className="text-slate-400 font-mono text-sm">Page {page} of {totalPages}</span>
                                <button
                                    disabled={page === totalPages}
                                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                                    className="px-4 py-2 rounded-lg bg-slate-800 text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-700 transition-colors"
                                >
                                    Next
                                </button>
                            </div>
                        </section>
                    </>
                ) : (
                    /* User Dashboard - Show their manageable servers */
                    <div className="animate-fade-in">
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.3 }}
                        >
                            <h2 className="text-2xl font-bold text-white mb-2">Welcome, {user?.username}!</h2>
                            <p className="text-slate-400 mb-8">Manage polls in your servers</p>
                        </motion.div>

                        {userGuildsLoading ? (
                            <div className="flex items-center justify-center py-20">
                                <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
                                <span className="ml-3 text-slate-400">Loading your servers...</span>
                            </div>
                        ) : userGuildsError ? (
                            <div className="glass-panel p-8 text-center">
                                <p className="text-amber-400 mb-4">{userGuildsError}</p>
                                <button
                                    onClick={fetchUserGuilds}
                                    className="text-indigo-400 hover:text-indigo-300 text-sm"
                                >
                                    Try Again
                                </button>
                            </div>
                        ) : (
                            <>
                                {/* Servers WITH Bot - Manageable */}
                                <section className="mb-12">
                                    <div className="flex items-center justify-between mb-4">
                                        <div className="flex items-center gap-3">
                                            <Server className="w-5 h-5 text-emerald-400" />
                                            <h3 className="text-lg font-bold text-white">Your Servers</h3>
                                            <span className="text-sm text-slate-500">({userGuildsWithBot.length} servers)</span>
                                        </div>
                                        <button
                                            onClick={refreshUserGuilds}
                                            disabled={isRefreshingGuilds || refreshCooldown > 0}
                                            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${refreshCooldown > 0
                                                ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                                                : isRefreshingGuilds
                                                    ? 'bg-slate-800 text-slate-400'
                                                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white'
                                                }`}
                                            title={refreshCooldown > 0
                                                ? `Wait ${Math.floor(refreshCooldown / 60)}:${(refreshCooldown % 60).toString().padStart(2, '0')}`
                                                : lastGuildRefresh
                                                    ? `Last refreshed: ${lastGuildRefresh.toLocaleString()} - Click to refresh`
                                                    : 'Refresh your server list, channels, and roles from Discord'}
                                        >
                                            <RefreshCw className={`w-4 h-4 ${isRefreshingGuilds ? 'animate-spin' : ''}`} />
                                            {refreshCooldown > 0 ? (
                                                <span>{Math.floor(refreshCooldown / 60)}:{(refreshCooldown % 60).toString().padStart(2, '0')}</span>
                                            ) : (
                                                <span>Refresh</span>
                                            )}
                                        </button>
                                    </div>

                                    {userGuildsWithBot.length > 0 ? (
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                            {userGuildsWithBot.map(guild => (
                                                <motion.div
                                                    key={guild.id}
                                                    whileHover={{ y: -4 }}
                                                    onClick={() => navigate(`/manage/${guild.id}`)}
                                                    className="glass-panel p-4 cursor-pointer hover:border-emerald-500/30 transition-colors group"
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
                                                            <h4 className="text-white font-medium truncate group-hover:text-emerald-400 transition-colors">{guild.name}</h4>
                                                            {guild.member_count && (
                                                                <div className="flex items-center gap-2 text-xs text-slate-500 mt-1">
                                                                    <Users className="w-3 h-3" />
                                                                    <span>{guild.member_count.toLocaleString()} members</span>
                                                                </div>
                                                            )}
                                                        </div>
                                                        <ExternalLink className="w-4 h-4 text-slate-500 group-hover:text-emerald-400 transition-colors" />
                                                    </div>
                                                </motion.div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="glass-panel p-8 text-center">
                                            <p className="text-slate-400">No servers with the bot installed yet.</p>
                                        </div>
                                    )}
                                </section>

                                {/* Servers WITHOUT Bot - Can Add */}
                                {userGuildsWithoutBot.length > 0 && (
                                    <section>
                                        <div className="flex items-center gap-3 mb-4">
                                            <Plus className="w-5 h-5 text-indigo-400" />
                                            <h3 className="text-lg font-bold text-white">Add Bot to These Servers</h3>
                                            <span className="text-sm text-slate-500">({userGuildsWithoutBot.length} servers)</span>
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                            {userGuildsWithoutBot.map(guild => (
                                                <motion.a
                                                    key={guild.id}
                                                    whileHover={{ y: -4 }}
                                                    href={getBotInviteUrl(guild.id)}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="glass-panel p-4 hover:border-indigo-500/30 transition-colors group block"
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
                                                            <h4 className="text-white font-medium truncate group-hover:text-indigo-400 transition-colors">{guild.name}</h4>
                                                            <div className="flex items-center gap-2 text-xs text-indigo-400 mt-1">
                                                                <Plus className="w-3 h-3" />
                                                                <span>Click to add bot</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </motion.a>
                                            ))}
                                        </div>
                                    </section>
                                )}

                                {/* Empty state if no servers at all */}
                                {userGuildsWithBot.length === 0 && userGuildsWithoutBot.length === 0 && (
                                    <div className="glass-panel p-12 text-center">
                                        <div className="w-16 h-16 rounded-2xl bg-slate-800 flex items-center justify-center mx-auto mb-4">
                                            <Server className="w-8 h-8 text-slate-500" />
                                        </div>
                                        <h3 className="text-xl font-bold text-white mb-2">No Servers Found</h3>
                                        <p className="text-slate-400 max-w-md mx-auto">
                                            You need the <strong>Manage Server</strong> permission in a Discord server to manage polls here.
                                        </p>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                )}
            </main>
        </div>
    );
};

const StatsCard = ({ title, value, subLabel, icon, color }: any) => (
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
            <div className="flex items-baseline gap-2">
                <div className="text-4xl font-bold text-white tracking-tight">
                    {value.toLocaleString()}
                </div>
                {subLabel && <span className="text-sm text-slate-500 font-medium">{subLabel}</span>}
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
