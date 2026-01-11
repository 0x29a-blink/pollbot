import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, BarChart3, Users, Clock, CheckCircle, XCircle, Loader2, Eye, EyeOff, Vote, Download, Lock, MessageSquare, Settings2, Scale, HelpCircle, ChevronDown, ChevronUp, Plus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../App';
import { CreatePollModal } from '../components/CreatePollModal';
import { EditPollModal } from '../components/EditPollModal';
import type { Poll, PollSettings, GuildInfo } from '../types';


export const UserServerView: React.FC = () => {
    const { guildId } = useParams<{ guildId: string }>();
    const navigate = useNavigate();
    const { user } = useAuth();

    const [guild, setGuild] = useState<GuildInfo | null>(null);
    const [polls, setPolls] = useState<Poll[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [editingPoll, setEditingPoll] = useState<Poll | null>(null);
    const [roles, setRoles] = useState<Array<{ id: string; name: string; color: number; position: number; managed: boolean }>>([]);
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

    const handleStatusChange = async (pollId: string, active: boolean) => {
        const session = localStorage.getItem('dashboard_session');
        try {
            const res = await fetch(`/api/user/polls/${pollId}/status`, {
                method: 'PATCH',
                headers: {
                    Authorization: `Bearer ${session}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ active }),
            });

            if (res.ok) {
                // Update local state immediately
                setPolls(prev => prev.map(p =>
                    p.message_id === pollId ? { ...p, active } : p
                ));
            } else if (res.status === 410) {
                // Discord message was deleted - mark the poll as deleted
                setPolls(prev => prev.map(p =>
                    p.message_id === pollId ? { ...p, discord_deleted: true } : p
                ));
            } else {
                console.error('Failed to update poll status');
            }
        } catch (err) {
            console.error('Error updating poll status:', err);
        }
    };

    const handleDeletePoll = async (pollId: string) => {
        const session = localStorage.getItem('dashboard_session');
        try {
            const res = await fetch(`/api/user/polls/${pollId}`, {
                method: 'DELETE',
                headers: {
                    Authorization: `Bearer ${session}`,
                },
            });

            if (res.ok) {
                // Remove from local state
                setPolls(prev => prev.filter(p => p.message_id !== pollId));
            } else {
                console.error('Failed to delete poll');
            }
        } catch (err) {
            console.error('Error deleting poll:', err);
        }
    };

    const handleEditPoll = async (poll: Poll) => {
        // Fetch roles if we don't have them
        if (roles.length === 0) {
            const session = localStorage.getItem('dashboard_session');
            try {
                const res = await fetch(`/api/user/guilds/${guildId}/roles`, {
                    headers: { Authorization: `Bearer ${session}` },
                });
                if (res.ok) {
                    const data = await res.json();
                    setRoles(data.roles || []);
                }
            } catch (err) {
                console.error('Error fetching roles:', err);
            }
        }
        setEditingPoll(poll);
    };

    const handleSaveSettings = async (pollId: string, newSettings: PollSettings) => {
        const session = localStorage.getItem('dashboard_session');
        try {
            const res = await fetch(`/api/user/polls/${pollId}`, {
                method: 'PATCH',
                headers: {
                    Authorization: `Bearer ${session}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ settings: newSettings }),
            });

            if (res.ok) {
                const updatedPoll = await res.json();
                // Update local state
                setPolls(prev => prev.map(p =>
                    p.message_id === pollId ? { ...p, settings: updatedPoll.settings } : p
                ));
            } else {
                console.error('Failed to save poll settings');
            }
        } catch (err) {
            console.error('Error saving poll settings:', err);
        }
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
                        <div className="flex items-center gap-4">
                            <button
                                onClick={() => setShowCreateModal(true)}
                                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-500 transition-colors"
                            >
                                <Plus className="w-4 h-4" />
                                Create Poll
                            </button>
                            <div className="flex items-center gap-2">
                                <img src={user.avatar_url} alt={user.username} className="w-8 h-8 rounded-full" />
                                <span className="text-sm text-slate-300">{user.username}</span>
                            </div>
                        </div>
                    )}
                </div>
            </header>

            {/* Create Poll Modal */}
            {guild && (
                <CreatePollModal
                    isOpen={showCreateModal}
                    onClose={() => setShowCreateModal(false)}
                    guildId={guildId || ''}
                    guildName={guild.name}
                    onPollCreated={(poll) => {
                        setPolls(prev => [poll, ...prev]);
                    }}
                />
            )}

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
                                <PollCard
                                    key={poll.message_id}
                                    poll={poll}
                                    formatDate={formatDate}
                                    onStatusChange={handleStatusChange}
                                    onDeletePoll={handleDeletePoll}
                                    onEditPoll={handleEditPoll}
                                />
                            ))}
                        </div>
                    )}
                </motion.div>
            </main>

            {/* Edit Poll Modal */}
            {editingPoll && (
                <EditPollModal
                    isOpen={!!editingPoll}
                    onClose={() => setEditingPoll(null)}
                    poll={editingPoll}
                    roles={roles}
                    onSave={handleSaveSettings}
                />
            )}
        </div>
    );
};

const PollCard: React.FC<{
    poll: Poll;
    formatDate: (d: string) => string;
    onStatusChange: (pollId: string, active: boolean) => Promise<void>;
    onDeletePoll: (pollId: string) => Promise<void>;
    onEditPoll: (poll: Poll) => void;
}> = ({ poll, formatDate, onStatusChange, onDeletePoll, onEditPoll }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [isUpdating, setIsUpdating] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const voteCounts = poll.vote_counts || {};
    const maxVotes = Math.max(...Object.values(voteCounts), 1);
    const settings = poll.settings || {};

    const handleStatusToggle = async (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsUpdating(true);
        try {
            await onStatusChange(poll.message_id, !poll.active);
        } finally {
            setIsUpdating(false);
        }
    };

    const handleDelete = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!confirm('Are you sure you want to delete this poll from the database? This cannot be undone.')) {
            return;
        }
        setIsDeleting(true);
        try {
            await onDeletePoll(poll.message_id);
        } finally {
            setIsDeleting(false);
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="glass-panel overflow-hidden"
        >
            {/* Compact Header - Always visible */}
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full p-4 flex items-center justify-between hover:bg-slate-800/30 transition-colors text-left"
            >
                <div className="flex items-center gap-4 flex-1 min-w-0">
                    <h3 className="text-lg font-bold text-white truncate">{poll.title}</h3>
                    <div className="flex items-center gap-4 text-xs text-slate-500 shrink-0">
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
                <div className="flex items-center gap-3 shrink-0">
                    <div className={`px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 ${poll.discord_deleted
                        ? 'bg-amber-500/20 text-amber-400'
                        : !poll.active
                            ? 'bg-slate-700 text-slate-400'
                            : 'bg-emerald-500/20 text-emerald-400'
                        }`}>
                        {poll.discord_deleted ? (
                            <>
                                <XCircle className="w-3 h-3" />
                                Deleted
                            </>
                        ) : !poll.active ? (
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
                    {isExpanded ? (
                        <ChevronUp className="w-5 h-5 text-slate-400" />
                    ) : (
                        <ChevronDown className="w-5 h-5 text-slate-400" />
                    )}
                </div>
            </button>

            {/* Expanded Content */}
            <AnimatePresence>
                {isExpanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                    >
                        <div className="px-6 pb-6 pt-2 border-t border-slate-700/50">
                            <div className="flex gap-6">
                                {/* Left side - Poll content */}
                                <div className="flex-1 min-w-0">
                                    {poll.description && (
                                        <p className="text-sm text-slate-400 mb-4" style={{ whiteSpace: 'pre-line' }}>
                                            {poll.description}
                                        </p>
                                    )}

                                    {/* Options with vote bars */}
                                    <div className="space-y-2">
                                        {poll.options.map((option, index) => {
                                            const votes = voteCounts[index] || 0;
                                            const totalVotes = poll.total_votes || 0;
                                            const percentage = totalVotes > 0 ? (votes / totalVotes) * 100 : 0;
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
                                            roleDetails={settings.allowed_roles && settings.role_metadata
                                                ? settings.allowed_roles.map(roleId => ({
                                                    id: roleId,
                                                    name: settings.role_metadata?.[roleId]?.name || roleId,
                                                    color: settings.role_metadata?.[roleId]?.color || 0,
                                                }))
                                                : undefined
                                            }
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
                                            roleDetails={settings.vote_weights && settings.role_metadata
                                                ? Object.entries(settings.vote_weights).map(([roleId, weight]) => ({
                                                    id: roleId,
                                                    name: settings.role_metadata?.[roleId]?.name || roleId,
                                                    color: settings.role_metadata?.[roleId]?.color || 0,
                                                    weight: weight,
                                                }))
                                                : undefined
                                            }
                                        />
                                    </div>

                                    {/* Actions */}
                                    <div className="mt-4 pt-4 border-t border-slate-700/50 space-y-2">
                                        {poll.discord_deleted ? (
                                            <>
                                                <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-center">
                                                    <p className="text-amber-400 text-xs font-medium">
                                                        ⚠️ Discord message deleted
                                                    </p>
                                                    <p className="text-slate-400 text-xs mt-1">
                                                        This poll no longer exists in Discord
                                                    </p>
                                                </div>
                                                <button
                                                    onClick={handleDelete}
                                                    disabled={isDeleting}
                                                    className="w-full py-2 px-4 rounded-lg font-medium text-sm transition-colors flex items-center justify-center gap-2 bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    {isDeleting ? (
                                                        <Loader2 className="w-4 h-4 animate-spin" />
                                                    ) : (
                                                        <>
                                                            <XCircle className="w-4 h-4" />
                                                            Delete from Database
                                                        </>
                                                    )}
                                                </button>
                                            </>
                                        ) : (
                                            <button
                                                onClick={handleStatusToggle}
                                                disabled={isUpdating}
                                                className={`w-full py-2 px-4 rounded-lg font-medium text-sm transition-colors flex items-center justify-center gap-2 ${poll.active
                                                    ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30'
                                                    : 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/30'
                                                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                                            >
                                                {isUpdating ? (
                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                ) : poll.active ? (
                                                    <>
                                                        <XCircle className="w-4 h-4" />
                                                        Close Poll
                                                    </>
                                                ) : (
                                                    <>
                                                        <CheckCircle className="w-4 h-4" />
                                                        Reopen Poll
                                                    </>
                                                )}
                                            </button>
                                        )}

                                        {/* Edit Settings Button */}
                                        {!poll.discord_deleted && (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onEditPoll(poll);
                                                }}
                                                className="w-full py-2 px-4 rounded-lg font-medium text-sm transition-colors flex items-center justify-center gap-2 bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30 border border-indigo-500/30"
                                            >
                                                <Settings2 className="w-4 h-4" />
                                                Edit Settings
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
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
    roleDetails?: Array<{ id: string; name: string; color: number; weight?: number }>;
}> = ({ icon, label, value, enabled, tooltip, variant = 'default', roleDetails }) => {
    const [showTooltip, setShowTooltip] = useState(false);
    const [tooltipPos, setTooltipPos] = useState({ top: 0, left: 0 });
    const rowRef = useRef<HTMLDivElement>(null);

    const handleMouseEnter = () => {
        if (rowRef.current) {
            const rect = rowRef.current.getBoundingClientRect();
            setTooltipPos({
                top: rect.top,
                left: rect.left - 8
            });
            setShowTooltip(true);
        }
    };

    const getValueClasses = () => {
        if (variant === 'warning' && enabled) return 'text-amber-400';
        if (variant === 'purple' && enabled) return 'text-violet-400';
        return enabled ? 'text-emerald-400' : 'text-slate-500';
    };

    const getRoleColor = (color: number) => {
        if (color === 0) return '#99AAB5';
        return `#${color.toString(16).padStart(6, '0')}`;
    };

    return (
        <>
            <div
                ref={rowRef}
                className="relative group"
                onMouseEnter={handleMouseEnter}
                onMouseLeave={() => setShowTooltip(false)}
            >
                <div className={`flex items-center justify-between px-2 py-1.5 rounded-md text-xs transition-colors ${enabled ? 'bg-slate-700/30' : 'bg-slate-800/30'
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
            </div>

            {showTooltip && createPortal(
                <div
                    className="fixed z-[9999] w-56 p-2 bg-slate-900 border border-slate-700 rounded-lg shadow-xl text-xs text-slate-300 pointer-events-none"
                    style={{
                        top: tooltipPos.top,
                        left: tooltipPos.left,
                        transform: 'translateX(-100%)',
                    }}
                >
                    <div className="absolute top-2 -right-1 w-2 h-2 bg-slate-900 border-r border-t border-slate-700 transform rotate-45" />
                    <p className="mb-2">{tooltip}</p>
                    {roleDetails && roleDetails.length > 0 && (
                        <div className="pt-2 border-t border-slate-700/50">
                            <div className="flex flex-wrap gap-1.5">
                                {roleDetails.map(role => (
                                    <span
                                        key={role.id}
                                        className="px-2 py-0.5 rounded-full text-[10px] font-medium"
                                        style={{
                                            backgroundColor: `${getRoleColor(role.color)}20`,
                                            color: getRoleColor(role.color),
                                        }}
                                    >
                                        {role.name}{role.weight && role.weight > 1 ? ` (×${role.weight})` : ''}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                </div>,
                document.body
            )}
        </>
    );
};
