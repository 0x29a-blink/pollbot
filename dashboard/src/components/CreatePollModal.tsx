import React, { useState, useEffect, useId } from 'react';
import { AlertCircle, Plus, X, Loader2, Check, ChevronDown } from 'lucide-react';
import type { Channel, Poll, Role } from '../types';
import { Modal } from './ui/Modal';
import { Toggle } from './ui/Toggle';
import { useToast } from './ui/Toast';
import { apiFetch } from '../utils/api';
import { roleHex } from '../lib/format';

interface CreatePollModalProps {
    isOpen: boolean;
    onClose: () => void;
    guildId: string;
    guildName: string;
    onPollCreated: (poll: Poll) => void;
    /**
     * Prefill for "duplicate poll": title/description/options/settings copied
     * from an existing poll. Deliberately excludes channel (re-picked) and
     * ends_at (a stale close time on a fresh poll is a trap).
     */
    initialValues?: {
        title: string;
        description: string;
        options: string[];
        settings: Partial<PollFormData['settings']>;
    };
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

function createInitialFormData(
    initialValues?: CreatePollModalProps['initialValues'],
    channelId = ''
): PollFormData {
    if (initialValues) {
        return {
            channel_id: channelId,
            title: initialValues.title,
            description: initialValues.description,
            options: initialValues.options.length >= 2 ? [...initialValues.options] : ['', ''],
            settings: {
                public: true,
                allow_thread: false,
                allow_close: true,
                allow_exports: true,
                max_votes: 1,
                min_votes: 1,
                allowed_roles: [],
                vote_weights: {},
                ...initialValues.settings,
            },
        };
    }

    return {
        channel_id: channelId,
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
    };
}

/* ---------------------------------------------------------------- pieces */

/** A form section: a 15px title, an optional grey line, then its fields. */
const FormSection: React.FC<{ title: string; description?: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode }> = ({ title, description, aside, children }) => {
    const id = useId();
    return (
        <section aria-labelledby={id} className="pt-6 mt-6 first:pt-0 first:mt-0 border-t border-rule first:border-t-0">
            <div className="flex items-baseline justify-between gap-3 mb-4">
                <div className="min-w-0">
                    <h3 id={id} className="text-[15px] leading-5 font-semibold text-ink">{title}</h3>
                    {description && <p className="text-xs text-faint mt-1">{description}</p>}
                </div>
                {aside && <div className="shrink-0 text-xs text-faint num">{aside}</div>}
            </div>
            {children}
        </section>
    );
};

/** Discord-style role chip used as an M3 filter chip (aria-pressed). */
export const RoleChip: React.FC<{ role: { id: string; name: string; color: number }; selected: boolean; onToggle: () => void }> = ({ role, selected, onToggle }) => (
    <button
        type="button"
        aria-pressed={selected}
        onClick={onToggle}
        className={`inline-flex items-center gap-1.5 h-7 pl-2 pr-2.5 rounded-full text-[13px] font-medium border transition-colors ${selected
            ? 'bg-brand-soft border-[#4a52a0] text-brand-soft-ink'
            : 'bg-[#383838] border-transparent text-muted hover:text-ink hover:bg-[#404040]'
            }`}
    >
        {selected
            ? <Check className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            : <span aria-hidden="true" className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: roleHex(role.color) }} />}
        <span className="truncate max-w-[180px]">{role.name}</span>
    </button>
);

/** Small static picture of the poll image the bot will post (no votes yet). */
const PollImagePreview: React.FC<{ title: string; description: string; options: string[] }> = ({ title, description, options }) => {
    const filled = options.map(o => o.trim()).filter(Boolean);
    const shown = filled.length > 0 ? filled : ['Option 1', 'Option 2'];
    return (
        <div className="rounded-lg bg-[#2b2d31] border-l-4 border-brand p-4 select-none" aria-hidden="true">
            <p className={`text-[15px] leading-5 font-bold break-words ${title.trim() ? 'text-white' : 'text-[#80848e]'}`}>
                {title.trim() || 'Your question'}
            </p>
            {description.trim() && (
                <p className="text-xs leading-4 text-[#dbdee1] mt-1.5 whitespace-pre-wrap break-words line-clamp-3">{description.trim()}</p>
            )}
            <div className="h-px bg-[#3f4147] my-3" />
            <div className="space-y-1.5">
                {shown.slice(0, 8).map((o, i) => (
                    <div key={i} className="flex items-center gap-2 rounded-md bg-[#313338] border border-[#1e1f22] px-2 py-1.5">
                        <span className="num shrink-0 rounded bg-[#404249] text-[#b5bac1] text-[10px] leading-4 px-1">#{i + 1}</span>
                        <span className={`text-xs truncate ${filled.length > 0 ? 'text-white' : 'text-[#80848e]'}`}>{o}</span>
                    </div>
                ))}
                {shown.length > 8 && <p className="text-[11px] text-[#949ba4] pl-1">+{shown.length - 8} more</p>}
            </div>
            <div className="flex items-center gap-1.5 mt-3 text-[11px] text-[#949ba4]">
                <span className="w-2.5 h-2.5 rounded-full bg-brand" />
                Created by you
            </div>
        </div>
    );
};

const labelClass = 'block text-sm font-medium text-ink mb-2';
const helpClass = 'text-xs text-faint mt-1.5';

/* ---------------------------------------------------------------- modal */

export const CreatePollModal: React.FC<CreatePollModalProps> = ({
    isOpen,
    onClose,
    guildId,
    guildName,
    onPollCreated,
    initialValues,
}) => {
    const toast = useToast();
    const uid = useId();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Channel/Role data
    const [channels, setChannels] = useState<Channel[]>([]);
    const [roles, setRoles] = useState<Role[]>([]);
    const [dataLoading, setDataLoading] = useState(true);

    // Collapsible vote-weights list (can be long on big servers)
    const [showWeights, setShowWeights] = useState(false);

    // Auto-close duration in ms ('' = never); ends_at computed at submit time
    const [duration, setDuration] = useState('');

    // Form data
    const [formData, setFormData] = useState<PollFormData>(() => createInitialFormData(initialValues));

    // Reset/prefill form and fetch fresh channels + roles whenever the modal opens
    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;

        (async () => {
            setDataLoading(true);
            setError(null);
            setDuration('');
            setFormData(createInitialFormData(initialValues));

            try {
                const [channelsRes, rolesRes] = await Promise.all([
                    fetch(`/api/user/guilds/${guildId}/channels`, {
                        credentials: 'include',
                    }),
                    fetch(`/api/user/guilds/${guildId}/roles`, {
                        credentials: 'include',
                    }),
                ]);

                if (cancelled) return;

                if (channelsRes.ok) {
                    const data = await channelsRes.json();
                    if (!cancelled) {
                        const loadedChannels: Channel[] = data.channels || [];
                        setChannels(loadedChannels);
                        const firstPostable = loadedChannels.find((c: Channel) => c.bot_can_post);
                        if (firstPostable) {
                            setFormData(prev => (prev.channel_id ? prev : { ...prev, channel_id: firstPostable.id }));
                        }
                    }
                }

                if (rolesRes.ok) {
                    const data = await rolesRes.json();
                    if (!cancelled) {
                        setRoles(data.roles || []);
                    }
                }
            } catch (err) {
                console.error('Failed to fetch guild data:', err);
            } finally {
                if (!cancelled) {
                    setDataLoading(false);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [isOpen, guildId, initialValues]);

    const validOptionsCount = formData.options.filter(o => o.trim() !== '').length;
    const voteLimitsError =
        formData.settings.min_votes < 1
            ? 'Minimum votes must be at least 1.'
            : formData.settings.min_votes > formData.settings.max_votes
                ? 'Minimum votes cannot exceed maximum votes.'
                : validOptionsCount >= 2 && formData.settings.max_votes > validOptionsCount
                    ? `Maximum votes cannot exceed the number of valid options (${validOptionsCount}).`
                    : null;

    const canSubmit = () => {
        return formData.channel_id !== '' &&
            formData.title.trim() !== '' &&
            validOptionsCount >= 2 &&
            voteLimitsError === null;
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

            const res = await apiFetch('/api/user/polls', {
                method: 'POST',
                headers: {
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
                    ends_at: duration ? new Date(Date.now() + parseInt(duration)).toISOString() : undefined,
                }),
            });

            if (res.ok) {
                const poll = await res.json();
                toast.success('Poll created');
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
                setDuration('');
            } else {
                const data = await res.json();
                setError(data.error || 'Failed to create poll');
            }
        } catch {
            setError('Failed to create poll');
        } finally {
            setLoading(false);
        }
    };

    const pickableRoles = roles.filter(r => r.name !== '@everyone');
    const weightRoles = pickableRoles
        .filter(r => formData.settings.allowed_roles.length === 0 || formData.settings.allowed_roles.includes(r.id));
    const weightCount = Object.keys(formData.settings.vote_weights).length;
    const blockedChannels = channels.filter(c => !c.bot_can_post).length;
    const selectedChannel = channels.find(c => c.id === formData.channel_id);
    const restrictedCount = formData.settings.allowed_roles.length;

    const ids = {
        channelHelp: `${uid}-channel-help`,
        titleHelp: `${uid}-title-help`,
        descHelp: `${uid}-desc-help`,
        limits: `${uid}-limits`,
        roles: `${uid}-roles-help`,
    };

    const footerReason = !dataLoading && !canSubmit()
        ? formData.channel_id === ''
            ? 'Pick a channel to post in.'
            : formData.title.trim() === ''
                ? 'Add a title.'
                : validOptionsCount < 2
                    ? 'Add at least two options.'
                    : voteLimitsError ?? undefined
        : undefined;

    return (
        <Modal
            open={isOpen}
            onClose={onClose}
            title="Create poll"
            subtitle={`in ${guildName}`}
            width="max-w-4xl"
            closeOnBackdrop={false}
            footerStart={
                footerReason
                    ? footerReason
                    : selectedChannel
                        ? <>Posts in <span className="text-muted">#{selectedChannel.name}</span>{duration ? ' · closes automatically' : ''}</>
                        : undefined
            }
            footer={
                <>
                    <button type="button" onClick={onClose} className="btn btn-outline">
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={loading || !canSubmit()}
                        className="btn btn-primary min-w-[112px]"
                    >
                        {loading ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                                Creating…
                            </>
                        ) : (
                            'Create poll'
                        )}
                    </button>
                </>
            }
        >
            {dataLoading ? (
                <div className="space-y-6 motion-safe:animate-pulse" role="status" aria-label="Loading channels and roles">
                    <div className="skeleton h-5 w-24" />
                    <div className="grid sm:grid-cols-2 gap-4">
                        <div><div className="skeleton h-4 w-16 mb-2" /><div className="skeleton h-8" /></div>
                        <div><div className="skeleton h-4 w-16 mb-2" /><div className="skeleton h-8" /></div>
                    </div>
                    <div><div className="skeleton h-4 w-24 mb-2" /><div className="skeleton h-16" /></div>
                    <div className="skeleton h-5 w-20" />
                    <div className="space-y-2"><div className="skeleton h-8" /><div className="skeleton h-8" /></div>
                </div>
            ) : (
                <div className="grid md:grid-cols-[minmax(0,1fr)_260px] gap-8">
                    <div className="min-w-0">
                        {/* Question */}
                        <FormSection title="Question">
                            <div className="grid sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4">
                                <div>
                                    <label htmlFor={`${uid}-channel`} className={labelClass}>Channel</label>
                                    <select
                                        id={`${uid}-channel`}
                                        value={formData.channel_id}
                                        onChange={(e) => setFormData({ ...formData, channel_id: e.target.value })}
                                        aria-describedby={blockedChannels > 0 ? ids.channelHelp : undefined}
                                        className="field"
                                    >
                                        <option value="">Select a channel…</option>
                                        {channels.map(ch => (
                                            <option key={ch.id} value={ch.id} disabled={!ch.bot_can_post}>
                                                #{ch.name}{!ch.bot_can_post ? ' — PollBot can\u2019t post here' : ''}
                                            </option>
                                        ))}
                                    </select>
                                    {blockedChannels > 0 && (
                                        <p id={ids.channelHelp} className={helpClass}>
                                            {blockedChannels === 1 ? '1 channel is' : `${blockedChannels} channels are`} unavailable: PollBot lacks permission to post there.
                                        </p>
                                    )}
                                </div>
                                <div>
                                    <label htmlFor={`${uid}-title`} className={labelClass}>Title</label>
                                    <input
                                        id={`${uid}-title`}
                                        type="text"
                                        value={formData.title}
                                        onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                                        placeholder="What would you like to ask?"
                                        maxLength={256}
                                        aria-describedby={ids.titleHelp}
                                        className="field"
                                    />
                                    <p id={ids.titleHelp} className={`${helpClass} num text-right`}>{formData.title.length}/256</p>
                                </div>
                            </div>
                            <div className="mt-3">
                                <label htmlFor={`${uid}-desc`} className={labelClass}>
                                    Description <span className="font-normal text-faint">(optional)</span>
                                </label>
                                <textarea
                                    id={`${uid}-desc`}
                                    value={formData.description}
                                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                    placeholder="Add more context…"
                                    rows={2}
                                    maxLength={4096}
                                    aria-describedby={ids.descHelp}
                                    className="field h-auto py-2 resize-none"
                                />
                                <p id={ids.descHelp} className={`${helpClass} num text-right`}>{formData.description.length}/4096</p>
                            </div>
                        </FormSection>

                        {/* Options */}
                        <FormSection
                            title="Options"
                            description="Between 2 and 25. Empty rows are ignored."
                            aside={`${validOptionsCount} of ${formData.options.length} filled`}
                        >
                            <ol className="space-y-2">
                                {formData.options.map((option, index) => (
                                    <li key={index} className="flex items-center gap-2">
                                        <span className="num w-5 text-right text-sm text-faint shrink-0" aria-hidden="true">{index + 1}</span>
                                        <input
                                            type="text"
                                            value={option}
                                            onChange={(e) => updateOption(index, e.target.value)}
                                            placeholder={`Option ${index + 1}`}
                                            aria-label={`Option ${index + 1}`}
                                            maxLength={100}
                                            className="field"
                                        />
                                        {formData.options.length > 2 && (
                                            <button
                                                type="button"
                                                onClick={() => removeOption(index)}
                                                aria-label={`Remove option ${index + 1}`}
                                                className="btn btn-ghost btn-icon shrink-0"
                                            >
                                                <X className="w-4 h-4" />
                                            </button>
                                        )}
                                    </li>
                                ))}
                            </ol>
                            {formData.options.length < 25 && (
                                <button type="button" onClick={addOption} className="btn btn-ghost btn-sm mt-2 ml-5">
                                    <Plus className="w-4 h-4" aria-hidden="true" />
                                    Add option
                                </button>
                            )}

                            <div className="mt-5">
                                <p className={labelClass} id={`${uid}-limits-label`}>Choices per voter</p>
                                <div className="flex flex-wrap items-center gap-2 text-sm text-muted" role="group" aria-labelledby={`${uid}-limits-label`}>
                                    <span>Pick at least</span>
                                    <input
                                        type="number"
                                        min={1}
                                        max={25}
                                        value={formData.settings.min_votes}
                                        onChange={(e) => setFormData({
                                            ...formData,
                                            settings: { ...formData.settings, min_votes: parseInt(e.target.value) || 1 }
                                        })}
                                        aria-label="Minimum choices"
                                        aria-invalid={voteLimitsError !== null}
                                        aria-describedby={voteLimitsError ? ids.limits : undefined}
                                        className="field num w-16 text-center"
                                    />
                                    <span>and at most</span>
                                    <input
                                        type="number"
                                        min={1}
                                        max={25}
                                        value={formData.settings.max_votes}
                                        onChange={(e) => setFormData({
                                            ...formData,
                                            settings: { ...formData.settings, max_votes: parseInt(e.target.value) || 1 }
                                        })}
                                        aria-label="Maximum choices"
                                        aria-invalid={voteLimitsError !== null}
                                        aria-describedby={voteLimitsError ? ids.limits : undefined}
                                        className="field num w-16 text-center"
                                    />
                                    <span>{formData.settings.max_votes === 1 ? 'option' : 'options'}</span>
                                </div>
                                {voteLimitsError && (
                                    <p id={ids.limits} className="text-xs text-negative flex items-center gap-1.5 mt-2">
                                        <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                                        {voteLimitsError}
                                    </p>
                                )}
                            </div>
                        </FormSection>

                        {/* Who can vote */}
                        <FormSection
                            title="Who can vote"
                            description={restrictedCount === 0 ? 'Everyone in the channel can vote. Select roles to limit voting to them.' : `Only members with ${restrictedCount === 1 ? 'this role' : 'one of these roles'} can vote.`}
                            aside={restrictedCount > 0 ? `${restrictedCount} selected` : undefined}
                        >
                            {pickableRoles.length === 0 ? (
                                <p className="text-sm text-faint">This server has no roles to pick from.</p>
                            ) : (
                                <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto" aria-describedby={ids.roles}>
                                    {pickableRoles.map(role => (
                                        <RoleChip
                                            key={role.id}
                                            role={role}
                                            selected={formData.settings.allowed_roles.includes(role.id)}
                                            onToggle={() => toggleAllowedRole(role.id)}
                                        />
                                    ))}
                                </div>
                            )}
                            <p id={ids.roles} className="sr-only">Toggle a role to allow it to vote.</p>

                            {/* Vote weights */}
                            <div className="mt-5 rounded-card border border-line">
                                <button
                                    type="button"
                                    onClick={() => setShowWeights(!showWeights)}
                                    aria-expanded={showWeights}
                                    className="w-full flex items-center justify-between gap-3 px-4 h-11 rounded-card text-left hover:bg-[var(--state-hover)] transition-colors"
                                >
                                    <span className="text-sm font-medium text-ink">
                                        Vote weights
                                        <span className="font-normal text-faint ml-2">
                                            {weightCount > 0 ? `${weightCount} ${weightCount === 1 ? 'role' : 'roles'} weighted` : 'Every vote counts once'}
                                        </span>
                                    </span>
                                    <ChevronDown className={`w-4 h-4 text-faint transition-transform ${showWeights ? 'rotate-180' : ''}`} aria-hidden="true" />
                                </button>
                                {showWeights && (
                                    <div className="px-4 pb-3 border-t border-rule">
                                        <p className="text-xs text-faint pt-3 pb-2">
                                            A vote from a weighted role counts that many times. Default is 1.
                                            {restrictedCount > 0 && ' Showing only the roles that can vote.'}
                                        </p>
                                        <ul className="max-h-48 overflow-y-auto divide-y divide-rule">
                                            {weightRoles.map(role => (
                                                <li key={role.id} className="flex items-center justify-between gap-3 h-11">
                                                    <span className="inline-flex items-center gap-2 min-w-0 text-sm text-muted">
                                                        <span aria-hidden="true" className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: roleHex(role.color) }} />
                                                        <span className="truncate">{role.name}</span>
                                                    </span>
                                                    <span className="flex items-center gap-1.5 shrink-0">
                                                        <input
                                                            type="number"
                                                            min={1}
                                                            max={100}
                                                            value={formData.settings.vote_weights[role.id] || 1}
                                                            onChange={(e) => setRoleWeight(role.id, parseInt(e.target.value) || 1)}
                                                            aria-label={`Vote weight for ${role.name}`}
                                                            className="field num w-16 text-center"
                                                        />
                                                        <span className="text-xs text-faint" aria-hidden="true">×</span>
                                                    </span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        </FormSection>

                        {/* Results & extras */}
                        <FormSection title="Results and extras">
                            <div className="divide-y divide-rule -my-3">
                                <Toggle
                                    label="Show live results"
                                    tooltip="Voters see the current counts while the poll is open. Off hides results until it closes."
                                    checked={formData.settings.public}
                                    onChange={(v) => setFormData({
                                        ...formData,
                                        settings: { ...formData.settings, public: v }
                                    })}
                                />
                                <Toggle
                                    label="Create thread"
                                    tooltip="Opens a discussion thread on the poll message."
                                    checked={formData.settings.allow_thread}
                                    onChange={(v) => setFormData({
                                        ...formData,
                                        settings: { ...formData.settings, allow_thread: v }
                                    })}
                                />
                                <Toggle
                                    label="Show close button"
                                    tooltip="Adds a button for poll managers to close the poll early. Off means it stays open until closed by command."
                                    checked={formData.settings.allow_close}
                                    onChange={(v) => setFormData({
                                        ...formData,
                                        settings: { ...formData.settings, allow_close: v }
                                    })}
                                />
                                <Toggle
                                    label="Allow exports"
                                    tooltip="Anyone can see results with /view and /export. Off keeps them to server managers and the Poll Manager role."
                                    checked={formData.settings.allow_exports}
                                    onChange={(v) => setFormData({
                                        ...formData,
                                        settings: { ...formData.settings, allow_exports: v }
                                    })}
                                />
                            </div>
                        </FormSection>

                        {/* Schedule */}
                        <FormSection title="Schedule">
                            <label htmlFor={`${uid}-duration`} className={labelClass}>Close automatically</label>
                            <select
                                id={`${uid}-duration`}
                                value={duration}
                                onChange={(e) => setDuration(e.target.value)}
                                className="field sm:max-w-xs"
                            >
                                <option value="">Never (close manually)</option>
                                <option value="3600000">After 1 hour</option>
                                <option value="21600000">After 6 hours</option>
                                <option value="43200000">After 12 hours</option>
                                <option value="86400000">After 24 hours</option>
                                <option value="172800000">After 48 hours</option>
                                <option value="604800000">After 7 days</option>
                            </select>
                        </FormSection>

                        {/* Error */}
                        {error && (
                            <div role="alert" className="mt-6 flex items-start gap-2 rounded-control bg-negative-soft border border-[#5a2f33] px-3 py-2.5 text-sm text-ink">
                                <AlertCircle className="w-4 h-4 mt-0.5 text-negative shrink-0" aria-hidden="true" />
                                {error}
                            </div>
                        )}
                    </div>

                    {/* Live preview of the poll image */}
                    <aside className="hidden md:block" aria-label="Preview">
                        <div className="sticky top-0">
                            <p className="text-xs text-faint mb-2">Preview of the poll image</p>
                            <PollImagePreview title={formData.title} description={formData.description} options={formData.options} />
                        </div>
                    </aside>
                </div>
            )}
        </Modal>
    );
};
