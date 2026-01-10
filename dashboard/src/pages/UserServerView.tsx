import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, BarChart3, Users, Clock, CheckCircle, XCircle, Loader2, Eye, EyeOff, Vote, Download, Lock, MessageSquare, Settings2, Scale, HelpCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../App';

interface PollSettings {
    public?: boolean;
    allow_thread?: boolean;
    allow_close?: boolean;
    max_votes?: number;
    min_votes?: number;
    allowed_roles?: string[];
    vote_weights?: Record<string, number>;
    allow_exports?: boolean;
}

interface Poll {
    message_id: string;
    guild_id: string;
    channel_id: string;
    creator_id: string;
    title: string;
    description: string;
    options: string[];
    active: boolean;
    created_at: string;
    settings: PollSettings;
    vote_counts: Record<number, number>;
    total_votes: number;
}

interface GuildInfo {
    id: string;
    name: string;
    icon_url: string | null;
    member_count: number;
}

export const UserServerView: React.FC = () => {
    const { guildId } = useParams<{ guildId: string }>();
    const navigate = useNavigate();
    const { user } = useAuth();

    const [guild, setGuild] = useState<GuildInfo | null>(null);
    const [polls, setPolls] = useState<Poll[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const hasInitialData = useRef(false);

    useEffect(() => {
        if (guildId) {
            fetchPolls(true); // Initial load
        }
    }, [guildId]);

    // Real-time subscription for new polls and vote updates
    useEffect(() => {
        if (!guildId) return;

        const channel = supabase
            .channel(`user-polls-${guildId}`)
            // Listen for new/updated polls in this guild
            .on('postgres_changes',
                { event: '*', schema: 'public', table: 'polls', filter: `guild_id=eq.${guildId}` },
                () => {
                    // Refetch polls when any poll changes (silent refresh)
                    fetchPolls(false);
                }
            )
            // Listen for vote changes
            .on('postgres_changes',
                { event: '*', schema: 'public', table: 'votes' },
                () => {
                    // Refetch polls to get updated vote counts (silent refresh)
                    fetchPolls(false);
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [guildId]);

    const fetchPolls = async (isInitialLoad: boolean = false) => {
        // Don't show loading state for background refreshes
        if (!isInitialLoad && hasInitialData.current) {
            setIsRefreshing(true);
        }

        try {
            const session = localStorage.getItem('dashboard_session');
            const res = await fetch(`/api/user/polls/${guildId}`, {
                headers: {
                    'Authorization': `Bearer ${session}`,
                }
            });

            if (res.ok) {
                const data = await res.json();
                setGuild(data.guild);
                setPolls(data.polls);
                setError(null);
                hasInitialData.current = true;
            } else if (res.status === 503) {
                // Temporary unavailability - don't show error if we have data
                if (!hasInitialData.current) {
                    setError('Service temporarily unavailable, please try again');
                }
                // Silently ignore for background refreshes - keep existing data
                console.warn('API temporarily unavailable, keeping existing data');
            } else if (res.status === 401) {
                // Auth error - always show
                const err = await res.json();
                setError(err.error || 'Please log in again');
            } else {
                // Other errors - only show on initial load
                if (!hasInitialData.current || isInitialLoad) {
                    const err = await res.json();
                    setError(err.error || 'Failed to load polls');
                }
            }
        } catch (err) {
            console.error('Error fetching polls:', err);
            // Network errors - only show on initial load
            if (!hasInitialData.current || isInitialLoad) {
                setError('Failed to load polls');
            }
        } finally {
            setLoading(false);
            setIsRefreshing(false);
        }
    };

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-950">
                <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-950">
                <div className="glass-panel p-8 text-center max-w-md">
                    <XCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
                    <h2 className="text-xl font-bold text-white mb-2">Access Denied</h2>
                    <p className="text-slate-400 mb-6">{error}</p>
                    <button
                        onClick={() => navigate('/dashboard')}
                        className="px-4 py-2 bg-indigo-500 text-white rounded-lg hover:bg-indigo-400 transition-colors"
                    >
                        Back to Dashboard
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen pb-20">
            {/* Header */}
            <header className="glass-panel sticky top-0 z-50 border-t-0 border-r-0 border-l-0 rounded-none">
                <div className="container-wide py-4 flex justify-between items-center">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => navigate('/dashboard')}
                            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 transition-colors"
                        >
                            <ArrowLeft className="w-5 h-5 text-slate-400" />
                        </button>
                        {guild && (
                            <div className="flex items-center gap-3">
                                {guild.icon_url ? (
                                    <img src={guild.icon_url} alt={guild.name} className="w-10 h-10 rounded-xl" />
                                ) : (
                                    <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center text-slate-400 font-bold">
                                        {guild.name.charAt(0)}
                                    </div>
                                )}
                                <div>
                                    <h1 className="text-lg font-bold text-white">{guild.name}</h1>
                                    <span className="text-xs text-slate-500">{guild.member_count?.toLocaleString()} members</span>
                                </div>
                            </div>
                        )}
                    </div>

                    {user && (
                        <div className="flex items-center gap-2">
                            <img src={user.avatar_url} alt={user.username} className="w-8 h-8 rounded-full" />
                            <span className="text-sm text-slate-300">{user.username}</span>
                        </div>
                    )}
                </div>
            </header>

            <main className="container-wide mt-8">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                >
                    <h2 className="text-2xl font-bold text-white mb-2">Server Polls</h2>
                    <p className="text-slate-400 mb-8">
                        {polls.length} poll{polls.length !== 1 ? 's' : ''} in this server
                        <span className="text-xs ml-2 text-emerald-400">• Live updates enabled</span>
                    </p>

                    {polls.length === 0 ? (
                        <div className="glass-panel p-12 text-center">
                            <BarChart3 className="w-12 h-12 text-slate-500 mx-auto mb-4" />
                            <h3 className="text-xl font-bold text-white mb-2">No Polls Yet</h3>
                            <p className="text-slate-400">
                                No polls have been created in this server yet.
                            </p>
                        </div>
                    ) : (
                        <div className="grid gap-4">
                            {polls.map(poll => (
                                <PollCard key={poll.message_id} poll={poll} formatDate={formatDate} />
                            ))}
                        </div>
                    )}
                </motion.div>
            </main>
        </div>
    );
};

const PollCard: React.FC<{ poll: Poll; formatDate: (d: string) => string }> = ({ poll, formatDate }) => {
    const maxVotes = Math.max(...Object.values(poll.vote_counts), 1);
    const settings = poll.settings || {};

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="glass-panel p-6"
        >
            <div className="flex gap-6">
                {/* Left side - Poll content */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between mb-4">
                        <div className="flex-1">
                            <h3 className="text-lg font-bold text-white mb-1">{poll.title}</h3>
                            {poll.description && (
                                <p className="text-sm text-slate-400 mb-2">{poll.description}</p>
                            )}
                            <div className="flex items-center gap-4 text-xs text-slate-500">
                                <span className="flex items-center gap-1">
                                    <Clock className="w-3 h-3" />
                                    {formatDate(poll.created_at)}
                                </span>
                                <span className="flex items-center gap-1">
                                    <Users className="w-3 h-3" />
                                    {poll.total_votes} vote{poll.total_votes !== 1 ? 's' : ''}
                                </span>
                            </div>
                        </div>
                        <div className={`px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 ${!poll.active
                            ? 'bg-slate-700 text-slate-400'
                            : 'bg-emerald-500/20 text-emerald-400'
                            }`}>
                            {!poll.active ? (
                                <>
                                    <XCircle className="w-3 h-3" />
                                    Closed
                                </>
                            ) : (
                                <>
                                    <CheckCircle className="w-3 h-3" />
                                    Active
                                </>
                            )}
                        </div>
                    </div>

                    {/* Options with vote bars */}
                    <div className="space-y-2">
                        {poll.options.map((option, index) => {
                            const votes = poll.vote_counts[index] || 0;
                            const percentage = poll.total_votes > 0 ? (votes / poll.total_votes) * 100 : 0;
                            const barWidth = (votes / maxVotes) * 100;

                            return (
                                <div key={index} className="relative">
                                    <div
                                        className="absolute inset-0 bg-indigo-500/20 rounded-lg transition-all duration-500"
                                        style={{ width: `${barWidth}%` }}
                                    />
                                    <div className="relative px-4 py-2 flex justify-between items-center">
                                        <span className="text-white text-sm font-medium">{option}</span>
                                        <span className="text-slate-400 text-sm">
                                            {votes} ({percentage.toFixed(1)}%)
                                        </span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Right side - Settings panel */}
                <div className="w-56 shrink-0 border-l border-slate-700/50 pl-6">
                    <div className="flex items-center gap-2 mb-3">
                        <Settings2 className="w-4 h-4 text-slate-500" />
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-wide">Settings</span>
                    </div>
                    <div className="space-y-1.5">
                        {/* Vote visibility */}
                        <SettingRow
                            icon={settings.public !== false ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                            label="Visibility"
                            value={settings.public !== false ? 'Public' : 'Hidden'}
                            enabled={settings.public !== false}
                            tooltip="Whether vote counts are visible to all users before the poll closes"
                        />

                        {/* Min/Max votes */}
                        <SettingRow
                            icon={<Vote className="w-3.5 h-3.5" />}
                            label="Choices"
                            value={settings.min_votes === settings.max_votes
                                ? `${settings.max_votes || 1}`
                                : `${settings.min_votes || 1}-${settings.max_votes || 1}`
                            }
                            enabled={true}
                            tooltip="How many options each user can select (min-max range)"
                        />

                        {/* Exports allowed */}
                        <SettingRow
                            icon={<Download className="w-3.5 h-3.5" />}
                            label="Exports"
                            value={settings.allow_exports !== false ? 'Allowed' : 'Disabled'}
                            enabled={settings.allow_exports !== false}
                            tooltip="Whether users can export detailed voting results"
                        />

                        {/* Discussion thread */}
                        <SettingRow
                            icon={<MessageSquare className="w-3.5 h-3.5" />}
                            label="Thread"
                            value={settings.allow_thread ? 'Created' : 'None'}
                            enabled={!!settings.allow_thread}
                            tooltip="Whether a discussion thread was created for this poll"
                        />

                        {/* Role restriction */}
                        <SettingRow
                            icon={<Lock className="w-3.5 h-3.5" />}
                            label="Restricted"
                            value={settings.allowed_roles && settings.allowed_roles.length > 0 
                                ? `${settings.allowed_roles.length} role${settings.allowed_roles.length > 1 ? 's' : ''}`
                                : 'No'
                            }
                            enabled={!!(settings.allowed_roles && settings.allowed_roles.length > 0)}
                            variant={settings.allowed_roles && settings.allowed_roles.length > 0 ? 'warning' : 'default'}
                            tooltip="Role restrictions limiting who can vote on this poll"
                        />

                        {/* Vote weights */}
                        <SettingRow
                            icon={<Scale className="w-3.5 h-3.5" />}
                            label="Weighted"
                            value={settings.vote_weights && Object.keys(settings.vote_weights).length > 0 
                                ? `${Object.keys(settings.vote_weights).length} role${Object.keys(settings.vote_weights).length > 1 ? 's' : ''}`
                                : 'No'
                            }
                            enabled={!!(settings.vote_weights && Object.keys(settings.vote_weights).length > 0)}
                            variant={settings.vote_weights && Object.keys(settings.vote_weights).length > 0 ? 'purple' : 'default'}
                            tooltip="Vote weighting where some roles count for more than others"
                        />
                    </div>
                </div>
            </div>
        </motion.div>
    );
};

const SettingRow: React.FC<{
    icon: React.ReactNode;
    label: string;
    value: string;
    enabled: boolean;
    tooltip: string;
    variant?: 'default' | 'warning' | 'purple';
}> = ({ icon, label, value, enabled, tooltip, variant = 'default' }) => {
    const [showTooltip, setShowTooltip] = useState(false);

    const getValueClasses = () => {
        if (variant === 'warning' && enabled) return 'text-amber-400';
        if (variant === 'purple' && enabled) return 'text-violet-400';
        return enabled ? 'text-emerald-400' : 'text-slate-500';
    };

    return (
        <div 
            className="relative group"
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
        >
            <div className={`flex items-center justify-between px-2 py-1.5 rounded-md text-xs transition-colors ${
                enabled ? 'bg-slate-700/30' : 'bg-slate-800/30'
            }`}>
                <div className={`flex items-center gap-2 ${enabled ? 'text-slate-300' : 'text-slate-500'}`}>
                    {icon}
                    <span>{label}</span>
                </div>
                <div className="flex items-center gap-1">
                    <span className={`font-medium ${getValueClasses()}`}>{value}</span>
                    <HelpCircle className="w-3 h-3 text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
            </div>
            
            {/* Tooltip */}
            {showTooltip && (
                <div className="absolute z-50 right-0 top-full mt-1 w-48 p-2 bg-slate-900 border border-slate-700 rounded-lg shadow-xl text-xs text-slate-300">
                    <div className="absolute -top-1 right-4 w-2 h-2 bg-slate-900 border-l border-t border-slate-700 transform rotate-45" />
                    {tooltip}
                </div>
            )}
        </div>
    );
};
