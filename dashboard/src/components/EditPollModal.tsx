import React, { useState } from 'react';
import { Loader2, ChevronDown } from 'lucide-react';
import { Modal } from './ui/Modal';
import { Toggle } from './ui/Toggle';
import { RoleChip } from './CreatePollModal';
import { roleHex } from '../lib/format';

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
    onSave: (pollId: string, settings: PollSettings) => Promise<boolean>;
}

/** A form section: a 15px title, an optional grey line, then its fields. */
const Section: React.FC<{ title: string; description?: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode }> = ({ title, description, aside, children }) => (
    <section className="pt-6 mt-6 first:pt-0 first:mt-0 border-t border-rule first:border-t-0">
        <div className="flex items-baseline justify-between gap-3 mb-4">
            <div className="min-w-0">
                <h3 className="text-[15px] leading-5 font-semibold text-ink">{title}</h3>
                {description && <p className="text-xs text-faint mt-1">{description}</p>}
            </div>
            {aside && <div className="shrink-0 text-xs text-faint num">{aside}</div>}
        </div>
        {children}
    </section>
);

export const EditPollModal: React.FC<EditPollModalProps> = ({
    isOpen,
    onClose,
    poll,
    roles,
    onSave,
}) => {
    const [settings, setSettings] = useState<PollSettings>(() => poll.settings || {});
    const [loading, setLoading] = useState(false);
    const [showVoteWeights, setShowVoteWeights] = useState(false);

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

            const saved = await onSave(poll.message_id, {
                ...settings,
                role_metadata: Object.keys(roleMetadata).length > 0 ? roleMetadata : undefined,
            });
            if (saved) {
                onClose();
            }
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

    // If role restrictions are set, only those roles can carry a weight
    const restrictedCount = settings.allowed_roles?.length || 0;
    const rolesToWeight = restrictedCount > 0
        ? sortedRoles.filter(r => settings.allowed_roles?.includes(r.id))
        : sortedRoles;
    const weightCount = Object.keys(settings.vote_weights || {}).length;

    return (
        <Modal
            open={isOpen}
            onClose={onClose}
            title="Edit poll settings"
            subtitle={poll.title}
            width="max-w-xl"
            footer={
                <>
                    <button type="button" onClick={onClose} className="btn btn-outline">
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={loading}
                        className="btn btn-primary"
                    >
                        {loading && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                        Save changes
                    </button>
                </>
            }
        >
            <Section title="Results and extras">
                <div className="divide-y divide-rule -my-3">
                    <Toggle
                        label="Show live results"
                        checked={settings.public !== false}
                        onChange={v => setSettings({ ...settings, public: v })}
                        tooltip="Voters see the current counts while the poll is open."
                    />
                    <Toggle
                        label="Show close button"
                        checked={settings.allow_close !== false}
                        onChange={v => setSettings({ ...settings, allow_close: v })}
                        tooltip="Adds a button for poll managers to close the poll early."
                    />
                    <Toggle
                        label="Allow exports"
                        checked={settings.allow_exports !== false}
                        onChange={v => setSettings({ ...settings, allow_exports: v })}
                        tooltip="Anyone can use /view and /export on this poll."
                    />
                </div>
            </Section>

            <Section
                title="Who can vote"
                description={restrictedCount === 0 ? 'Everyone in the channel can vote. Select roles to limit voting to them.' : `Only members with ${restrictedCount === 1 ? 'this role' : 'one of these roles'} can vote.`}
                aside={restrictedCount > 0 ? `${restrictedCount} selected` : undefined}
            >
                {sortedRoles.length === 0 ? (
                    <p className="text-sm text-faint">This server has no roles to pick from.</p>
                ) : (
                    <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto">
                        {sortedRoles.map(role => (
                            <RoleChip
                                key={role.id}
                                role={role}
                                selected={settings.allowed_roles?.includes(role.id) || false}
                                onToggle={() => toggleRoleRestriction(role.id)}
                            />
                        ))}
                    </div>
                )}

                <div className="mt-5 rounded-card border border-line">
                    <button
                        type="button"
                        onClick={() => setShowVoteWeights(!showVoteWeights)}
                        aria-expanded={showVoteWeights}
                        className="w-full flex items-center justify-between gap-3 px-4 h-11 rounded-card text-left hover:bg-[var(--state-hover)] transition-colors"
                    >
                        <span className="text-sm font-medium text-ink">
                            Vote weights
                            <span className="font-normal text-faint ml-2">
                                {weightCount > 0 ? `${weightCount} ${weightCount === 1 ? 'role' : 'roles'} weighted` : 'Every vote counts once'}
                            </span>
                        </span>
                        <ChevronDown className={`w-4 h-4 text-faint transition-transform ${showVoteWeights ? 'rotate-180' : ''}`} aria-hidden="true" />
                    </button>
                    {showVoteWeights && (
                        <div className="px-4 pb-3 border-t border-rule">
                            {rolesToWeight.length === 0 ? (
                                <p className="text-xs text-faint py-3">Select roles above to configure weights.</p>
                            ) : (
                                <>
                                    <p className="text-xs text-faint pt-3 pb-2">
                                        A vote from a weighted role counts that many times. Default is 1.
                                    </p>
                                    <ul className="max-h-48 overflow-y-auto divide-y divide-rule">
                                        {rolesToWeight.map(role => {
                                            const weight = settings.vote_weights?.[role.id] || 1;
                                            return (
                                                <li key={role.id} className="flex items-center justify-between gap-3 h-11">
                                                    <span className="inline-flex items-center gap-2 min-w-0 text-sm text-muted">
                                                        <span aria-hidden="true" className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: roleHex(role.color) }} />
                                                        <span className="truncate">{role.name}</span>
                                                    </span>
                                                    <span className="flex items-center gap-1.5 shrink-0">
                                                        <input
                                                            type="number"
                                                            min="1"
                                                            max="100"
                                                            value={weight}
                                                            onChange={e => updateVoteWeight(role.id, parseInt(e.target.value) || 1)}
                                                            aria-label={`Vote weight for ${role.name}`}
                                                            className="field num w-16 text-center"
                                                        />
                                                        <span className="text-xs text-faint" aria-hidden="true">×</span>
                                                    </span>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                </>
                            )}
                        </div>
                    )}
                </div>
            </Section>
        </Modal>
    );
};
