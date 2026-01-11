import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, AlertCircle, Plus, Trash2, Users, Scale, Loader2, HelpCircle } from 'lucide-react';
import type { Channel, Role } from '../types';



interface CreatePollModalProps {
    isOpen: boolean;
    onClose: () => void;
    guildId: string;
    guildName: string;
    onPollCreated: (poll: any) => void;
}

interface PollFormData {
    channel_id: string;
    title: string;
    description: string;
    options: string[];
    settings: {
        public: boolean;
        allow_thread: boolean;
        allow_close: boolean;
        allow_exports: boolean;
        max_votes: number;
        min_votes: number;
        allowed_roles: string[];
        vote_weights: Record<string, number>;
    };
}

export const CreatePollModal: React.FC<CreatePollModalProps> = ({
    isOpen,
    onClose,
    guildId,
    guildName,
    onPollCreated,
}) => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Channel/Role data
    const [channels, setChannels] = useState<Channel[]>([]);
    const [roles, setRoles] = useState<Role[]>([]);
    const [dataLoading, setDataLoading] = useState(true);

    // Collapsible sections
    const [showWeights, setShowWeights] = useState(false);
    const [showRestrictions, setShowRestrictions] = useState(false);

    // Form data
    const [formData, setFormData] = useState<PollFormData>({
        channel_id: '',
        title: '',
        description: '',
        options: ['', ''],
        settings: {
            public: true,
            allow_thread: false,
            allow_close: true,
            allow_exports: true,
            max_votes: 1,
            min_votes: 1,
            allowed_roles: [],
            vote_weights: {},
        },
    });

    // Fetch channels and roles on mount
    useEffect(() => {
        if (isOpen) {
            fetchGuildData();
        }
    }, [isOpen, guildId]);

    const fetchGuildData = async () => {
        setDataLoading(true);
        try {
            const session = localStorage.getItem('dashboard_session');
            const [channelsRes, rolesRes] = await Promise.all([
                fetch(`/api/user/guilds/${guildId}/channels`, {
                    headers: { Authorization: `Bearer ${session}` },
                }),
                fetch(`/api/user/guilds/${guildId}/roles`, {
                    headers: { Authorization: `Bearer ${session}` },
                }),
            ]);

            if (channelsRes.ok) {
                const data = await channelsRes.json();
                setChannels(data.channels || []);
                // Auto-select first channel where bot can post
                const firstPostable = (data.channels || []).find((c: Channel) => c.bot_can_post);
                if (firstPostable && !formData.channel_id) {
                    setFormData(prev => ({ ...prev, channel_id: firstPostable.id }));
                }
            }

            if (rolesRes.ok) {
                const data = await rolesRes.json();
                setRoles(data.roles || []);
            }
        } catch (err) {
            console.error('Failed to fetch guild data:', err);
        } finally {
            setDataLoading(false);
        }
    };

    const canSubmit = () => {
        return formData.channel_id !== '' &&
            formData.title.trim() !== '' &&
            formData.options.filter(o => o.trim() !== '').length >= 2;
    };

    const addOption = () => {
        if (formData.options.length < 25) {
            setFormData({
                ...formData,
                options: [...formData.options, ''],
            });
        }
    };

    const removeOption = (index: number) => {
        if (formData.options.length > 2) {
            setFormData({
                ...formData,
                options: formData.options.filter((_, i) => i !== index),
            });
        }
    };

    const updateOption = (index: number, value: string) => {
        const newOptions = [...formData.options];
        newOptions[index] = value;
        setFormData({ ...formData, options: newOptions });
    };

    const toggleAllowedRole = (roleId: string) => {
        const current = formData.settings.allowed_roles;
        const newRoles = current.includes(roleId)
            ? current.filter(id => id !== roleId)
            : [...current, roleId];
        setFormData({
            ...formData,
            settings: { ...formData.settings, allowed_roles: newRoles },
        });
    };

    const setRoleWeight = (roleId: string, weight: number) => {
        const newWeights = { ...formData.settings.vote_weights };
        if (weight <= 1) {
            delete newWeights[roleId];
        } else {
            newWeights[roleId] = weight;
        }
        setFormData({
            ...formData,
            settings: { ...formData.settings, vote_weights: newWeights },
        });
    };

    const handleSubmit = async () => {
        setLoading(true);
        setError(null);

        try {
            // Build role metadata for all roles that are either restricted or weighted
            const roleIds = new Set([
                ...formData.settings.allowed_roles,
                ...Object.keys(formData.settings.vote_weights)
            ]);
            const roleMetadata: Record<string, { name: string; color: number }> = {};
            roleIds.forEach(roleId => {
                const role = roles.find(r => r.id === roleId);
                if (role) {
                    roleMetadata[roleId] = { name: role.name, color: role.color };
                }
            });

            const session = localStorage.getItem('dashboard_session');
            const res = await fetch('/api/user/polls', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${session}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    guild_id: guildId,
                    channel_id: formData.channel_id,
                    title: formData.title.trim(),
                    description: formData.description.trim(),
                    options: formData.options.filter(o => o.trim() !== ''),
                    settings: {
                        ...formData.settings,
                        role_metadata: Object.keys(roleMetadata).length > 0 ? roleMetadata : undefined,
                    },
                }),
            });

            if (res.ok) {
                const poll = await res.json();
                onPollCreated(poll);
                onClose();
                // Reset form
                setFormData({
                    channel_id: '',
                    title: '',
                    description: '',
                    options: ['', ''],
                    settings: {
                        public: true,
                        allow_thread: false,
                        allow_close: true,
                        allow_exports: true,
                        max_votes: 1,
                        min_votes: 1,
                        allowed_roles: [],
                        vote_weights: {},
                    },
                });
            } else {
                const data = await res.json();
                setError(data.error || 'Failed to create poll');
            }
        } catch (err) {
            setError('Failed to create poll');
        } finally {
            setLoading(false);
        }
    };

    const getRoleColor = (color: number) => {
        if (color === 0) return '#99AAB5';
        return `#${color.toString(16).padStart(6, '0')}`;
    };

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="glass-panel w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
                >
                    {/* Header */}
                    <div className="flex items-center justify-between p-5 border-b border-slate-700">
                        <div>
                            <h2 className="text-xl font-bold text-white">Create Poll</h2>
                            <p className="text-sm text-slate-400">in {guildName}</p>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-2 text-slate-400 hover:text-white transition-colors rounded-lg hover:bg-slate-800"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-y-auto p-5">
                        {dataLoading ? (
                            <div className="flex items-center justify-center py-12">
                                <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
                            </div>
                        ) : (
                            <div className="space-y-5">
                                {/* Row 1: Channel + Title */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-300 mb-2">
                                            Channel *
                                        </label>
                                        <select
                                            value={formData.channel_id}
                                            onChange={(e) => setFormData({ ...formData, channel_id: e.target.value })}
                                            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                                        >
                                            <option value="">Select channel...</option>
                                            {channels.map(ch => (
                                                <option key={ch.id} value={ch.id} disabled={!ch.bot_can_post}>
                                                    # {ch.name} {!ch.bot_can_post ? '(No access)' : ''}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-300 mb-2">
                                            Title *
                                        </label>
                                        <input
                                            type="text"
                                            value={formData.title}
                                            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                                            placeholder="What would you like to ask?"
                                            maxLength={256}
                                            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                                        />
                                    </div>
                                </div>

                                {/* Description */}
                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-2">
                                        Description <span className="text-slate-500">(optional)</span>
                                    </label>
                                    <textarea
                                        value={formData.description}
                                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                        placeholder="Add more context..."
                                        rows={2}
                                        maxLength={4096}
                                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 resize-none"
                                    />
                                </div>

                                {/* Options */}
                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-2">
                                        Options * <span className="text-slate-500">(2-25)</span>
                                    </label>
                                    <div className="space-y-2">
                                        {formData.options.map((option, index) => (
                                            <div key={index} className="flex items-center gap-2">
                                                <span className="text-slate-500 text-sm w-5">{index + 1}.</span>
                                                <input
                                                    type="text"
                                                    value={option}
                                                    onChange={(e) => updateOption(index, e.target.value)}
                                                    placeholder={`Option ${index + 1}`}
                                                    maxLength={100}
                                                    className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                                                />
                                                {formData.options.length > 2 && (
                                                    <button
                                                        onClick={() => removeOption(index)}
                                                        className="p-2 text-red-400 hover:bg-red-500/20 rounded-lg transition-colors"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                    {formData.options.length < 25 && (
                                        <button
                                            onClick={addOption}
                                            className="mt-2 flex items-center gap-2 text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
                                        >
                                            <Plus className="w-4 h-4" />
                                            Add Option
                                        </button>
                                    )}
                                </div>

                                {/* Settings Grid */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-3">
                                        <Toggle
                                            label="Show live results"
                                            tooltip="When enabled, voters can see the current vote counts while the poll is open. When disabled, results are hidden until the poll closes."
                                            checked={formData.settings.public}
                                            onChange={(v) => setFormData({
                                                ...formData,
                                                settings: { ...formData.settings, public: v }
                                            })}
                                        />
                                        <Toggle
                                            label="Create thread"
                                            tooltip="When enabled, automatically creates a discussion thread attached to the poll message for voters to chat."
                                            checked={formData.settings.allow_thread}
                                            onChange={(v) => setFormData({
                                                ...formData,
                                                settings: { ...formData.settings, allow_thread: v }
                                            })}
                                        />
                                    </div>
                                    <div className="space-y-3">
                                        <Toggle
                                            label="Show close button"
                                            tooltip="When enabled, adds a button for poll managers to manually close the poll early. When disabled, the poll stays open until closed via command."
                                            checked={formData.settings.allow_close}
                                            onChange={(v) => setFormData({
                                                ...formData,
                                                settings: { ...formData.settings, allow_close: v }
                                            })}
                                        />
                                        <Toggle
                                            label="Allow exports"
                                            tooltip="When enabled, all users can view poll results using the /view and /export commands. When disabled, results are completely private except to server managers and users with the Poll Manager role."
                                            checked={formData.settings.allow_exports}
                                            onChange={(v) => setFormData({
                                                ...formData,
                                                settings: { ...formData.settings, allow_exports: v }
                                            })}
                                        />
                                    </div>
                                </div>

                                {/* Min/Max Votes */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-300 mb-2">Min Votes</label>
                                        <input
                                            type="number"
                                            min={1}
                                            max={25}
                                            value={formData.settings.min_votes}
                                            onChange={(e) => setFormData({
                                                ...formData,
                                                settings: { ...formData.settings, min_votes: parseInt(e.target.value) || 1 }
                                            })}
                                            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-300 mb-2">Max Votes</label>
                                        <input
                                            type="number"
                                            min={1}
                                            max={25}
                                            value={formData.settings.max_votes}
                                            onChange={(e) => setFormData({
                                                ...formData,
                                                settings: { ...formData.settings, max_votes: parseInt(e.target.value) || 1 }
                                            })}
                                            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                                        />
                                    </div>
                                </div>

                                {/* Collapsible: Role Restrictions */}
                                <div className="border border-slate-700 rounded-lg overflow-hidden">
                                    <button
                                        onClick={() => setShowRestrictions(!showRestrictions)}
                                        className="w-full flex items-center justify-between p-3 bg-slate-800/50 hover:bg-slate-700/50 transition-colors"
                                    >
                                        <div className="flex items-center gap-2">
                                            <Users className="w-4 h-4 text-indigo-400" />
                                            <span className="text-sm font-medium text-slate-300">Role Restrictions</span>
                                            {formData.settings.allowed_roles.length > 0 && (
                                                <span className="text-xs bg-indigo-500/20 text-indigo-400 px-2 py-0.5 rounded">
                                                    {formData.settings.allowed_roles.length} selected
                                                </span>
                                            )}
                                        </div>
                                        <span className="text-slate-500 text-xs">{showRestrictions ? '▲' : '▼'}</span>
                                    </button>
                                    {showRestrictions && (
                                        <div className="p-3 border-t border-slate-700">
                                            <p className="text-xs text-slate-500 mb-3">
                                                Only selected roles can vote. Leave empty for everyone.
                                            </p>
                                            <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
                                                {roles.filter(r => r.name !== '@everyone').map(role => (
                                                    <button
                                                        key={role.id}
                                                        onClick={() => toggleAllowedRole(role.id)}
                                                        className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all ${formData.settings.allowed_roles.includes(role.id)
                                                            ? 'ring-2 ring-offset-1 ring-offset-slate-900'
                                                            : 'opacity-60 hover:opacity-100'
                                                            }`}
                                                        style={{
                                                            backgroundColor: `${getRoleColor(role.color)}20`,
                                                            color: getRoleColor(role.color),
                                                        }}
                                                    >
                                                        {role.name}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Collapsible: Vote Weights */}
                                <div className="border border-slate-700 rounded-lg overflow-hidden">
                                    <button
                                        onClick={() => setShowWeights(!showWeights)}
                                        className="w-full flex items-center justify-between p-3 bg-slate-800/50 hover:bg-slate-700/50 transition-colors"
                                    >
                                        <div className="flex items-center gap-2">
                                            <Scale className="w-4 h-4 text-amber-400" />
                                            <span className="text-sm font-medium text-slate-300">Vote Weights</span>
                                            {Object.keys(formData.settings.vote_weights).length > 0 && (
                                                <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded">
                                                    {Object.keys(formData.settings.vote_weights).length} configured
                                                </span>
                                            )}
                                        </div>
                                        <span className="text-slate-500 text-xs">{showWeights ? '▲' : '▼'}</span>
                                    </button>
                                    {showWeights && (
                                        <div className="p-3 border-t border-slate-700">
                                            <p className="text-xs text-slate-500 mb-3">
                                                Set custom weights for roles. Default is 1.
                                                {formData.settings.allowed_roles.length > 0 && (
                                                    <span className="text-indigo-400"> Only showing restricted roles.</span>
                                                )}
                                            </p>
                                            <div className="space-y-2 max-h-40 overflow-y-auto">
                                                {roles
                                                    .filter(r => r.name !== '@everyone')
                                                    .filter(r => formData.settings.allowed_roles.length === 0 || formData.settings.allowed_roles.includes(r.id))
                                                    .map(role => (
                                                        <div key={role.id} className="flex items-center justify-between p-2 rounded bg-slate-800/50">
                                                            <span
                                                                className="text-sm"
                                                                style={{ color: getRoleColor(role.color) }}
                                                            >
                                                                {role.name}
                                                            </span>
                                                            <input
                                                                type="number"
                                                                min={1}
                                                                max={100}
                                                                value={formData.settings.vote_weights[role.id] || 1}
                                                                onChange={(e) => setRoleWeight(role.id, parseInt(e.target.value) || 1)}
                                                                className="w-14 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-white text-center text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                                                            />
                                                        </div>
                                                    ))}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Error */}
                                {error && (
                                    <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm flex items-center gap-2">
                                        <AlertCircle className="w-4 h-4" />
                                        {error}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="flex items-center justify-end gap-3 p-5 border-t border-slate-700">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-slate-400 hover:text-white transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSubmit}
                            disabled={loading || !canSubmit()}
                            className="flex items-center gap-2 px-5 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {loading ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Creating...
                                </>
                            ) : (
                                'Create Poll'
                            )}
                        </button>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
};

// Compact toggle component with visible tooltip
const Toggle: React.FC<{
    label: string;
    tooltip?: string;
    checked: boolean;
    onChange: (value: boolean) => void;
}> = ({ label, tooltip, checked, onChange }) => (
    <div className="relative group">
        <div
            onClick={() => onChange(!checked)}
            className="flex items-center justify-between p-2.5 rounded-lg bg-slate-800/50 cursor-pointer hover:bg-slate-700/50 transition-colors border border-slate-700/50"
        >
            <div className="flex items-center gap-1.5">
                <span className="text-sm text-slate-300">{label}</span>
                {tooltip && (
                    <HelpCircle className="w-3.5 h-3.5 text-slate-500 group-hover:text-slate-400" />
                )}
            </div>
            <div
                className="w-10 h-6 rounded-full transition-colors flex items-center px-1"
                style={{ backgroundColor: checked ? '#4f46e5' : '#475569' }}
            >
                <div
                    className="w-4 h-4 rounded-full bg-white shadow-sm transition-all duration-200"
                    style={{ marginLeft: checked ? '16px' : '0px' }}
                />
            </div>
        </div>
        {tooltip && (
            <div className="absolute left-0 right-0 bottom-full mb-2 px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-300 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 shadow-xl">
                {tooltip}
                <div className="absolute left-4 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-slate-700" />
            </div>
        )}
    </div>
);
