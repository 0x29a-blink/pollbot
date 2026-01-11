import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2, Settings2, Users, Scale, HelpCircle } from 'lucide-react';

interface PollSettings {
    public?: boolean;
    allow_close?: boolean;
    allow_exports?: boolean;
    allowed_roles?: string[];
    vote_weights?: Record<string, number>;
    role_metadata?: Record<string, { name: string; color: number }>;
}

interface Role {
    id: string;
    name: string;
    color: number;
    position: number;
    managed: boolean;
}

interface EditPollModalProps {
    isOpen: boolean;
    onClose: () => void;
    poll: {
        message_id: string;
        title: string;
        settings: PollSettings;
    };
    roles: Role[];
    onSave: (pollId: string, settings: PollSettings) => Promise<void>;
}

export const EditPollModal: React.FC<EditPollModalProps> = ({
    isOpen,
    onClose,
    poll,
    roles,
    onSave,
}) => {
    const [settings, setSettings] = useState<PollSettings>(poll.settings || {});
    const [loading, setLoading] = useState(false);
    const [showRoleRestrictions, setShowRoleRestrictions] = useState(false);
    const [showVoteWeights, setShowVoteWeights] = useState(false);

    // Reset form when poll changes
    useEffect(() => {
        setSettings(poll.settings || {});
    }, [poll]);

    const handleSubmit = async () => {
        setLoading(true);
        try {
            // Build role metadata
            const roleIds = new Set([
                ...(settings.allowed_roles || []),
                ...Object.keys(settings.vote_weights || {})
            ]);
            const roleMetadata: Record<string, { name: string; color: number }> = {};
            roleIds.forEach(roleId => {
                const role = roles.find(r => r.id === roleId);
                if (role) {
                    roleMetadata[roleId] = { name: role.name, color: role.color };
                }
            });

            await onSave(poll.message_id, {
                ...settings,
                role_metadata: Object.keys(roleMetadata).length > 0 ? roleMetadata : undefined,
            });
            onClose();
        } finally {
            setLoading(false);
        }
    };

    const toggleRoleRestriction = (roleId: string) => {
        const current = settings.allowed_roles || [];
        const updated = current.includes(roleId)
            ? current.filter(r => r !== roleId)
            : [...current, roleId];
        setSettings({ ...settings, allowed_roles: updated });
    };

    const updateVoteWeight = (roleId: string, weight: number) => {
        const current = { ...(settings.vote_weights || {}) };
        if (weight <= 1) {
            delete current[roleId];
        } else {
            current[roleId] = weight;
        }
        setSettings({ ...settings, vote_weights: current });
    };

    const sortedRoles = [...(roles || [])]
        .filter(r => !r.managed && r.name !== '@everyone')
        .sort((a, b) => b.position - a.position);

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
                onClick={onClose}
            >
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 20 }}
                    className="glass-panel w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col"
                    onClick={(e: React.MouseEvent) => e.stopPropagation()}
                >
                    {/* Header */}
                    <div className="flex items-center justify-between p-5 border-b border-slate-700">
                        <div>
                            <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                <Settings2 className="w-5 h-5 text-indigo-400" />
                                Edit Poll Settings
                            </h2>
                            <p className="text-sm text-slate-400 mt-1 truncate max-w-xs">{poll.title}</p>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-2 text-slate-400 hover:text-white transition-colors rounded-lg hover:bg-slate-800"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-y-auto p-5 space-y-4">
                        {/* Toggle Settings */}
                        <div className="space-y-3">
                            <Toggle
                                label="Show live results"
                                value={settings.public !== false}
                                onChange={v => setSettings({ ...settings, public: v })}
                                tooltip="When enabled, voters can see the current vote counts while the poll is open"
                            />
                            <Toggle
                                label="Show close button"
                                value={settings.allow_close !== false}
                                onChange={v => setSettings({ ...settings, allow_close: v })}
                                tooltip="When enabled, adds a button for poll managers to manually close the poll"
                            />
                            <Toggle
                                label="Allow exports"
                                value={settings.allow_exports !== false}
                                onChange={v => setSettings({ ...settings, allow_exports: v })}
                                tooltip="When enabled, all users can use /view and /export commands"
                            />
                        </div>

                        {/* Role Restrictions */}
                        <div className="border border-slate-700 rounded-lg overflow-hidden">
                            <button
                                onClick={() => setShowRoleRestrictions(!showRoleRestrictions)}
                                className="w-full flex items-center justify-between p-3 bg-slate-800/50 hover:bg-slate-700/50 transition-colors"
                            >
                                <div className="flex items-center gap-2">
                                    <Users className="w-4 h-4 text-indigo-400" />
                                    <span className="text-sm font-medium text-slate-300">Role Restrictions</span>
                                    {(settings.allowed_roles?.length || 0) > 0 && (
                                        <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full">
                                            {settings.allowed_roles?.length} selected
                                        </span>
                                    )}
                                </div>
                                <span className="text-slate-500 text-xs">{showRoleRestrictions ? '▲' : '▼'}</span>
                            </button>
                            {showRoleRestrictions && (
                                <div className="p-3 border-t border-slate-700 max-h-40 overflow-y-auto space-y-1">
                                    {sortedRoles.map(role => {
                                        const isChecked = settings.allowed_roles?.includes(role.id) || false;
                                        return (
                                            <label
                                                key={role.id}
                                                className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-800/50 cursor-pointer transition-colors"
                                            >
                                                <div
                                                    onClick={() => toggleRoleRestriction(role.id)}
                                                    className={`w-5 h-5 rounded flex items-center justify-center border-2 transition-all ${isChecked
                                                            ? 'bg-indigo-500 border-indigo-500'
                                                            : 'border-slate-600 hover:border-slate-500'
                                                        }`}
                                                >
                                                    {isChecked && (
                                                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                                        </svg>
                                                    )}
                                                </div>
                                                <span
                                                    className="text-sm font-medium"
                                                    style={{ color: role.color ? `#${role.color.toString(16).padStart(6, '0')}` : '#99AAB5' }}
                                                >
                                                    {role.name}
                                                </span>
                                            </label>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Vote Weights */}
                        <div className="border border-slate-700 rounded-lg overflow-hidden">
                            <button
                                onClick={() => setShowVoteWeights(!showVoteWeights)}
                                className="w-full flex items-center justify-between p-3 bg-slate-800/50 hover:bg-slate-700/50 transition-colors"
                            >
                                <div className="flex items-center gap-2">
                                    <Scale className="w-4 h-4 text-amber-400" />
                                    <span className="text-sm font-medium text-slate-300">Vote Weights</span>
                                    {Object.keys(settings.vote_weights || {}).length > 0 && (
                                        <span className="text-xs bg-violet-500/20 text-violet-400 px-2 py-0.5 rounded-full">
                                            {Object.keys(settings.vote_weights || {}).length} weighted
                                        </span>
                                    )}
                                </div>
                                <span className="text-slate-500 text-xs">{showVoteWeights ? '▲' : '▼'}</span>
                            </button>
                            {showVoteWeights && (
                                <div className="p-3 border-t border-slate-700 max-h-40 overflow-y-auto space-y-2">
                                    {/* Filter roles: if role restrictions are set, only show those roles */}
                                    {(() => {
                                        const rolesToShow = (settings.allowed_roles?.length || 0) > 0
                                            ? sortedRoles.filter(r => settings.allowed_roles?.includes(r.id))
                                            : sortedRoles;

                                        if (rolesToShow.length === 0) {
                                            return (
                                                <p className="text-xs text-slate-500 text-center py-2">
                                                    Select roles above to configure weights
                                                </p>
                                            );
                                        }

                                        return rolesToShow.map(role => {
                                            const weight = settings.vote_weights?.[role.id] || 1;
                                            return (
                                                <div key={role.id} className="flex items-center justify-between p-2 rounded-lg hover:bg-slate-800/50 transition-colors">
                                                    <span
                                                        className="text-sm font-medium"
                                                        style={{ color: role.color ? `#${role.color.toString(16).padStart(6, '0')}` : '#99AAB5' }}
                                                    >
                                                        {role.name}
                                                    </span>
                                                    <div className="flex items-center gap-2">
                                                        <input
                                                            type="number"
                                                            min="1"
                                                            max="100"
                                                            value={weight}
                                                            onChange={e => updateVoteWeight(role.id, parseInt(e.target.value) || 1)}
                                                            className="w-16 bg-slate-800 border border-slate-600 rounded-lg px-2 py-1.5 text-sm text-white text-center focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-colors"
                                                        />
                                                        <span className="text-xs text-slate-500 font-medium">×</span>
                                                    </div>
                                                </div>
                                            );
                                        });
                                    })()}
                                </div>
                            )}
                        </div>
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
                            disabled={loading}
                            className="flex items-center gap-2 px-5 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                            Save Changes
                        </button>
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
};

// Toggle component
const Toggle: React.FC<{
    label: string;
    value: boolean;
    onChange: (value: boolean) => void;
    tooltip: string;
}> = ({ label, value, onChange, tooltip }) => {
    const [showTooltip, setShowTooltip] = useState(false);

    return (
        <div className="relative group">
            <div
                onClick={() => onChange(!value)}
                className="flex items-center justify-between p-2.5 rounded-lg bg-slate-800/50 cursor-pointer hover:bg-slate-700/50 transition-colors border border-slate-700/50"
            >
                <div className="flex items-center gap-1.5">
                    <span className="text-sm text-slate-300">{label}</span>
                    <div
                        onMouseEnter={() => setShowTooltip(true)}
                        onMouseLeave={() => setShowTooltip(false)}
                        className="relative"
                    >
                        <HelpCircle className="w-3.5 h-3.5 text-slate-500 group-hover:text-slate-400" />
                        {showTooltip && (
                            <div className="absolute left-0 bottom-full mb-2 w-48 px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-300 z-50 shadow-xl">
                                {tooltip}
                            </div>
                        )}
                    </div>
                </div>
                <div
                    className="w-10 h-6 rounded-full transition-colors flex items-center px-1"
                    style={{ backgroundColor: value ? 'rgb(79, 70, 229)' : 'rgb(71, 85, 105)' }}
                >
                    <div
                        className="w-4 h-4 rounded-full bg-white shadow-sm transition-all duration-200"
                        style={{ marginLeft: value ? '16px' : '0px' }}
                    />
                </div>
            </div>
        </div>
    );
};
