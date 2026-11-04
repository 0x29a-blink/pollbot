import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
    ChevronDown, CopyPlus, ExternalLink, FileSpreadsheet, Hash, Loader2, Lock, LockOpen, Plus, Settings2, Trash2, Users,
} from 'lucide-react';
import { AppShell } from '../components/shell/AppShell';
import { GuildSidebar, type ChannelPollCount } from '../components/shell/Sidebars';
import {
    Dash, EmptyBlock, Freshness, InlineError, PageHeader, Panel, PollStatusChip, SearchField,
} from '../components/ui/primitives';
import { CreatePollModal } from '../components/CreatePollModal';
import { EditPollModal } from '../components/EditPollModal';
import { PremiumGateModal } from '../components/PremiumGateModal';
import { VoterViewModal } from '../components/VoterViewModal';
import { ExportModal } from '../components/ExportModal';
import { PermissionErrorBanner } from '../components/PermissionErrorBanner';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useToast } from '../components/ui/Toast';
import { apiFetch } from '../utils/api';
import { DASH, fmtCount, fmtDateTime, fmtPct, fmtRelative, plural, roleHex } from '../lib/format';
import type {
    ExportResponse, GuildInfo, PermissionError, Poll, PollSettings, PremiumStatus, Role, VoterResponse,
} from '../types';

type StatusFilter = 'all' | 'active' | 'closed';

interface PollsSummary {
    total: number;
    active: number;
    closed: number;
    channels: { channel_id: string; count: number; open: number }[];
}

interface ChannelInfo { id: string; name: string; bot_can_post?: boolean }

const PAGE_SIZE = 50;
const REFRESH_MS = 12_000;
const COOLDOWN_DURATION = 30_000; // after a permission error

/**
 * One server's polls.
 * Question: "What's running in this server, and what do I need to do to it?"
 * The poll list is the screen. Counts sit in the status filter itself; the
 * sidebar lists the channels that have polls, like Discord's channel list.
 */
export const UserServerView: React.FC = () => {
    const { guildId = '' } = useParams<{ guildId: string }>();
    // Keyed so switching servers starts from a clean state.
    return <ServerPolls key={guildId} guildId={guildId} />;
};

const ServerPolls: React.FC<{ guildId: string }> = ({ guildId }) => {
    const navigate = useNavigate();
    const toast = useToast();
    const [searchParams, setSearchParams] = useSearchParams();
    const channelFilter = searchParams.get('channel');

    const [guild, setGuild] = useState<GuildInfo | null>(null);
    const [polls, setPolls] = useState<Poll[]>([]);
    const [total, setTotal] = useState<number | null>(null);
    const [serverSummary, setServerSummary] = useState<PollsSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [fatalError, setFatalError] = useState<string | null>(null);
    const [listError, setListError] = useState<string | null>(null);
    const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

    const [status, setStatus] = useState<StatusFilter>('all');
    const [query, setQuery] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');

    const [channels, setChannels] = useState<ChannelInfo[]>([]);
    const [roles, setRoles] = useState<Role[]>([]);

    const [showCreateModal, setShowCreateModal] = useState(false);
    const [duplicateSource, setDuplicateSource] = useState<Poll | null>(null);
    const [editingPoll, setEditingPoll] = useState<Poll | null>(null);
    const [permissionError, setPermissionError] = useState<PermissionError | null>(null);
    const [cooldownPolls, setCooldownPolls] = useState<Map<string, number>>(new Map());
    const [expanded, setExpanded] = useState<Set<string>>(new Set());

    const [hasData, setHasData] = useState(false);
    const loadedCount = useRef(0);
    useEffect(() => { loadedCount.current = polls.length; }, [polls.length]);

    // Debounce search
    useEffect(() => {
        const t = setTimeout(() => setDebouncedQuery(query.trim()), 300);
        return () => clearTimeout(t);
    }, [query]);

    const buildUrl = useCallback((offset: number, limit: number) => {
        const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
        if (status !== 'all') params.set('status', status);
        if (channelFilter) params.set('channel', channelFilter);
        if (debouncedQuery) params.set('search', debouncedQuery);
        return `/api/user/polls/${guildId}?${params}`;
    }, [guildId, status, channelFilter, debouncedQuery]);

    /**
     * Load the first page (mode 'reset'), the next page ('more'), or silently
     * refresh what's on screen ('refresh').
     */
    const fetchPolls = useCallback(async (mode: 'reset' | 'more' | 'refresh') => {
        if (!guildId) return;
        const offset = mode === 'more' ? loadedCount.current : 0;
        const limit = mode === 'refresh' ? Math.min(Math.max(loadedCount.current, PAGE_SIZE), 100) : PAGE_SIZE;
        if (mode === 'more') setLoadingMore(true);
        if (mode === 'reset') {
            setLoading(true);
            setExpanded(new Set());
        }
        try {
            const res = await fetch(buildUrl(offset, limit), { credentials: 'include' });
            if (res.ok) {
                const data = await res.json();
                const page: Poll[] = data.polls || [];
                setGuild(data.guild);
                if (mode === 'more') {
                    setPolls(prev => {
                        const seen = new Set(prev.map(p => p.message_id));
                        return [...prev, ...page.filter(p => !seen.has(p.message_id))];
                    });
                } else if (mode === 'refresh') {
                    setPolls(prev => {
                        const fresh = new Set(page.map(p => p.message_id));
                        return [...page, ...prev.slice(page.length).filter(p => !fresh.has(p.message_id))];
                    });
                } else {
                    setPolls(page);
                }
                setTotal(typeof data.total === 'number' ? data.total : null);
                if (data.summary) setServerSummary(data.summary);
                setFatalError(null);
                setListError(null);
                setUpdatedAt(new Date());
                setHasData(true);
            } else if (res.status === 401 || res.status === 403 || res.status === 404) {
                const err = await res.json().catch(() => ({}));
                if (!hasData || mode === 'reset') {
                    setFatalError(err.error || (res.status === 404 ? 'PollBot is not in this server.' : "You don't have access to this server."));
                }
            } else if (res.status === 503) {
                if (!hasData) setListError('PollBot is temporarily unavailable. Try again in a moment.');
            } else if (mode !== 'refresh') {
                const err = await res.json().catch(() => ({}));
                setListError(err.error || "Couldn't load this server's polls.");
            }
        } catch (err) {
            console.error('Error fetching polls:', err);
            if (mode !== 'refresh') setListError("Couldn't load this server's polls.");
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    }, [guildId, buildUrl, hasData]);

    // First page whenever a filter changes
    useEffect(() => {
        void (async () => { await fetchPolls('reset'); })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [buildUrl]);

    // Live-ish refresh while the tab is visible (authenticated API, guild-scoped)
    useEffect(() => {
        if (!guildId) return;
        const tick = () => {
            if (document.visibilityState === 'visible') void fetchPolls('refresh');
        };
        const interval = setInterval(tick, REFRESH_MS);
        document.addEventListener('visibilitychange', tick);
        return () => {
            clearInterval(interval);
            document.removeEventListener('visibilitychange', tick);
        };
    }, [guildId, fetchPolls]);

    // Channel names (sidebar + rows) and role names (settings + edit modal)
    useEffect(() => {
        if (!guildId) return;
        let cancelled = false;
        void (async () => {
            try {
                const [cRes, rRes] = await Promise.all([
                    fetch(`/api/user/guilds/${guildId}/channels`, { credentials: 'include' }),
                    fetch(`/api/user/guilds/${guildId}/roles`, { credentials: 'include' }),
                ]);
                if (cancelled) return;
                if (cRes.ok) setChannels(((await cRes.json()).channels || []) as ChannelInfo[]);
                if (rRes.ok) setRoles(((await rRes.json()).roles || []) as Role[]);
            } catch (err) {
                console.error('Error fetching channels/roles:', err);
            }
        })();
        return () => { cancelled = true; };
    }, [guildId]);

    const channelName = useCallback((id: string) => channels.find(c => c.id === id)?.name ?? null, [channels]);
    const roleById = useMemo(() => new Map(roles.map(r => [r.id, r])), [roles]);

    // Summary: from the server when available, otherwise from what's loaded
    const summary: PollsSummary = useMemo(() => {
        if (serverSummary) return serverSummary;
        const byChannel = new Map<string, { count: number; open: number }>();
        polls.forEach(p => {
            const c = byChannel.get(p.channel_id) || { count: 0, open: 0 };
            c.count++;
            if (p.active) c.open++;
            byChannel.set(p.channel_id, c);
        });
        return {
            total: polls.length,
            active: polls.filter(p => p.active).length,
            closed: polls.filter(p => !p.active).length,
            channels: [...byChannel.entries()].map(([channel_id, v]) => ({ channel_id, ...v })),
        };
    }, [serverSummary, polls]);

    const sidebarChannels: ChannelPollCount[] = useMemo(() => summary.channels
        .map(c => ({ id: c.channel_id, name: channelName(c.channel_id), count: c.count, open: c.open }))
        .sort((a, b) => b.count - a.count || (a.name || '').localeCompare(b.name || '')), [summary, channelName]);

    // Filters the server may not support yet are applied client-side too
    const visiblePolls = useMemo(() => polls.filter(p => {
        if (channelFilter && p.channel_id !== channelFilter) return false;
        if (status === 'active' && !p.active) return false;
        if (status === 'closed' && p.active) return false;
        if (debouncedQuery && !p.title.toLowerCase().includes(debouncedQuery.toLowerCase())) return false;
        return true;
    }), [polls, channelFilter, status, debouncedQuery]);

    const channelSummary = channelFilter ? summary.channels.find(c => c.channel_id === channelFilter) : null;
    const scopeTotal = channelFilter ? (channelSummary?.count ?? 0) : summary.total;
    const scopeOpen = channelFilter ? (channelSummary?.open ?? 0) : summary.active;
    const listTotal = total ?? visiblePolls.length;
    const hasMore = total !== null && polls.length < total;

    /* ------------------------------------------------------------ actions */

    const handleStatusChange = async (pollId: string, active: boolean) => {
        const cooldownEnd = cooldownPolls.get(pollId);
        if (cooldownEnd && Date.now() < cooldownEnd) return;
        if (permissionError?.pollId === pollId) setPermissionError(null);

        try {
            const res = await apiFetch(`/api/user/polls/${pollId}/status`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ active }),
            });

            if (res.ok) {
                const updated = await res.json();
                toast.success(active ? 'Poll reopened' : 'Poll closed');
                setPolls(prev => prev.map(p => p.message_id === pollId
                    ? { ...p, active, ends_at: 'ends_at' in updated ? updated.ends_at : p.ends_at }
                    : p));
                setServerSummary(prev => prev ? {
                    ...prev,
                    active: prev.active + (active ? 1 : -1),
                    closed: prev.closed + (active ? -1 : 1),
                } : prev);
                setCooldownPolls(prev => {
                    const next = new Map(prev);
                    next.delete(pollId);
                    return next;
                });
            } else if (res.status === 410) {
                toast.error('The poll message was deleted in Discord');
                setPolls(prev => prev.map(p => p.message_id === pollId ? { ...p, discord_deleted: true, active: false } : p));
            } else if (res.status === 403) {
                const errorData = await res.json();
                if (errorData.permission_error) {
                    const poll = polls.find(p => p.message_id === pollId);
                    setPermissionError({
                        pollId,
                        pollTitle: poll?.title || 'Unknown poll',
                        channelId: errorData.channel_id || poll?.channel_id || '',
                        missingPermissions: errorData.missing_permissions || ['View Channel', 'Send Messages', 'Attach Files'],
                        timestamp: Date.now(),
                    });
                    setCooldownPolls(prev => new Map(prev).set(pollId, Date.now() + COOLDOWN_DURATION));
                } else {
                    toast.error(errorData.error || "Couldn't update the poll");
                }
            } else {
                const errorData = await res.json().catch(() => ({}));
                toast.error(errorData.error || "Couldn't update the poll");
            }
        } catch (err) {
            toast.error("Couldn't update the poll");
            console.error('Error updating poll status:', err);
        }
    };

    const handleDeletePoll = async (pollId: string) => {
        try {
            const res = await apiFetch(`/api/user/polls/${pollId}`, { method: 'DELETE' });
            if (res.ok) {
                toast.success('Poll deleted');
                const removed = polls.find(p => p.message_id === pollId);
                setPolls(prev => prev.filter(p => p.message_id !== pollId));
                setTotal(t => (t === null ? t : Math.max(0, t - 1)));
                if (removed) {
                    setServerSummary(prev => prev ? {
                        total: prev.total - 1,
                        active: prev.active - (removed.active ? 1 : 0),
                        closed: prev.closed - (removed.active ? 0 : 1),
                        channels: prev.channels
                            .map(c => c.channel_id === removed.channel_id ? { ...c, count: c.count - 1, open: c.open - (removed.active ? 1 : 0) } : c)
                            .filter(c => c.count > 0),
                    } : prev);
                }
            } else {
                toast.error("Couldn't delete the poll");
            }
        } catch (err) {
            toast.error("Couldn't delete the poll");
            console.error('Error deleting poll:', err);
        }
    };

    const handleSaveSettings = async (pollId: string, newSettings: PollSettings): Promise<boolean> => {
        setPermissionError(null);
        try {
            const res = await apiFetch(`/api/user/polls/${pollId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ settings: newSettings }),
            });

            if (res.ok) {
                const updatedPoll = await res.json();
                toast.success('Poll settings saved');
                setPolls(prev => prev.map(p => p.message_id === pollId
                    ? {
                        ...p,
                        settings: updatedPoll.settings,
                        vote_counts: updatedPoll.vote_counts ?? p.vote_counts,
                        total_votes: updatedPoll.total_votes ?? p.total_votes,
                        unique_voters: updatedPoll.unique_voters ?? p.unique_voters,
                    }
                    : p));
                return true;
            } else if (res.status === 403) {
                const errorData = await res.json();
                if (errorData.permission_error) {
                    const poll = polls.find(p => p.message_id === pollId);
                    setPermissionError({
                        pollId,
                        pollTitle: poll?.title || 'Unknown poll',
                        channelId: errorData.channel_id || poll?.channel_id || '',
                        missingPermissions: errorData.missing_permissions || ['View Channel', 'Send Messages', 'Attach Files'],
                        timestamp: Date.now(),
                    });
                    toast.error('PollBot is missing Discord channel permissions');
                } else {
                    toast.error(errorData.error || "Couldn't save the poll settings");
                }
                return false;
            } else {
                const errorData = await res.json().catch(() => ({}));
                toast.error(errorData.error || "Couldn't save the poll settings");
                return false;
            }
        } catch (err) {
            toast.error("Couldn't save the poll settings");
            console.error('Error saving poll settings:', err);
            return false;
        }
    };

    const toggleExpanded = (id: string) => setExpanded(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });

    const clearChannel = () => {
        const next = new URLSearchParams(searchParams);
        next.delete('channel');
        setSearchParams(next);
    };

    /* ------------------------------------------------------------- render */

    const sidebar = (
        <GuildSidebar
            guildId={guildId}
            name={guild?.name}
            iconUrl={guild ? guild.icon_url : undefined}
            memberCount={guild?.member_count}
            totalPolls={serverSummary?.total ?? (hasData ? summary.total : null)}
            channels={sidebarChannels}
            activeChannel={channelFilter}
            section="polls"
        />
    );

    if (fatalError) {
        return (
            <AppShell sidebar={sidebar} mobileTitle="Polls">
                <PageHeader title="Polls" />
                <Panel>
                    <EmptyBlock
                        title="This server can't be opened"
                        action={<button type="button" className="btn btn-outline" onClick={() => navigate('/dashboard')}>Back to servers</button>}
                    >
                        {fatalError}
                    </EmptyBlock>
                </Panel>
            </AppShell>
        );
    }

    const currentChannelName = channelFilter ? channelName(channelFilter) : null;
    const title = channelFilter ? (
        <span className="inline-flex items-center gap-1.5"><Hash className="w-6 h-6 text-faint" aria-hidden="true" />{currentChannelName || 'unknown-channel'}</span>
    ) : 'Polls';

    const subtitle = loading && !hasData
        ? 'Loading polls…'
        : channelFilter
            ? <>{plural(scopeTotal, 'poll')} in this channel · {fmtCount(scopeOpen)} open · <button type="button" className="text-brand-text hover:underline" onClick={clearChannel}>Show all channels</button></>
            : <>{guild?.name ?? 'This server'} · {plural(scopeTotal, 'poll')} · {fmtCount(scopeOpen)} open</>;

    return (
        <AppShell sidebar={sidebar} mobileTitle={guild?.name || 'Polls'}>
            <PageHeader
                title={title}
                subtitle={subtitle}
                actions={
                    <>
                        <Freshness updatedAt={updatedAt} onRefresh={() => void fetchPolls('refresh')} title="Refresh polls" />
                        {guild && (
                            <button type="button" className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
                                <Plus className="w-4 h-4" />
                                Create poll
                            </button>
                        )}
                    </>
                }
            />

            <PermissionErrorBanner
                error={permissionError}
                onDismiss={() => setPermissionError(null)}
                onRetry={permissionError ? () => {
                    const poll = polls.find(p => p.message_id === permissionError.pollId);
                    if (poll) void handleStatusChange(permissionError.pollId, !poll.active);
                } : undefined}
            />

            {/* Toolbar: status filter carries the counts */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div className="segmented" role="group" aria-label="Filter by status">
                    {([
                        ['all', 'All', scopeTotal],
                        ['active', 'Open', scopeOpen],
                        ['closed', 'Closed', scopeTotal - scopeOpen],
                    ] as const).map(([key, label, n]) => (
                        <button key={key} type="button" aria-pressed={status === key} onClick={() => setStatus(key)}>
                            {label}
                            <span className="num text-faint">{hasData ? fmtCount(n) : DASH}</span>
                        </button>
                    ))}
                </div>
                <div className="flex items-center gap-3 w-full sm:w-auto">
                    <span className="text-xs text-faint num hidden sm:inline">
                        {hasData ? `${fmtCount(Math.min(visiblePolls.length, listTotal))} of ${fmtCount(listTotal)}` : ''}
                    </span>
                    <SearchField value={query} onChange={setQuery} placeholder="Search polls" className="w-full sm:w-64" />
                </div>
            </div>

            <Panel>
                {listError ? (
                    <InlineError message={listError} onRetry={() => void fetchPolls('reset')} />
                ) : loading && !hasData ? (
                    <ul aria-hidden="true">
                        {[0, 1, 2, 3, 4, 5].map(i => (
                            <li key={i} className={`h-[68px] px-5 flex items-center gap-4 ${i ? 'border-t border-rule' : ''}`}>
                                <div className="flex-1">
                                    <div className="skeleton h-4 w-72 max-w-full" />
                                    <div className="skeleton h-3 w-44 mt-2" />
                                </div>
                                <div className="skeleton h-5 w-16 rounded-full" />
                            </li>
                        ))}
                    </ul>
                ) : visiblePolls.length === 0 ? (
                    summary.total === 0 && !debouncedQuery && status === 'all' && !channelFilter ? (
                        <EmptyBlock
                            title="No polls in this server yet"
                            action={<button type="button" className="btn btn-primary" onClick={() => setShowCreateModal(true)}><Plus className="w-4 h-4" />Create the first poll</button>}
                        >
                            Create one here, or run /poll in any channel PollBot can post in.
                        </EmptyBlock>
                    ) : (
                        <EmptyBlock
                            title={debouncedQuery ? `No polls match “${debouncedQuery}”` : status === 'active' ? 'No open polls here' : status === 'closed' ? 'No closed polls here' : 'No polls here'}
                            action={(debouncedQuery || status !== 'all') ? (
                                <button type="button" className="btn btn-outline btn-sm" onClick={() => { setQuery(''); setStatus('all'); }}>
                                    Clear filters
                                </button>
                            ) : undefined}
                        />
                    )
                ) : (
                    <ul>
                        {visiblePolls.map((poll, i) => (
                            <PollRow
                                key={poll.message_id}
                                first={i === 0}
                                poll={poll}
                                channelName={channelName(poll.channel_id)}
                                showChannel={!channelFilter}
                                roleById={roleById}
                                expanded={expanded.has(poll.message_id)}
                                onToggle={() => toggleExpanded(poll.message_id)}
                                onStatusChange={handleStatusChange}
                                onDeletePoll={handleDeletePoll}
                                onEditPoll={setEditingPoll}
                                onDuplicatePoll={p => { setDuplicateSource(p); setShowCreateModal(true); }}
                                cooldownEndTime={cooldownPolls.get(poll.message_id)}
                            />
                        ))}
                    </ul>
                )}
                {hasMore && !listError && (
                    <div className="border-t border-rule px-5 py-3 flex items-center justify-between">
                        <span className="text-xs text-faint num">Showing {fmtCount(polls.length)} of {fmtCount(total)}</span>
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => void fetchPolls('more')} disabled={loadingMore}>
                            {loadingMore && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                            Load {Math.min(PAGE_SIZE, (total ?? 0) - polls.length)} more
                        </button>
                    </div>
                )}
            </Panel>

            {/* Create (also handles duplicate prefill) */}
            {guild && (
                <CreatePollModal
                    isOpen={showCreateModal}
                    onClose={() => { setShowCreateModal(false); setDuplicateSource(null); }}
                    guildId={guildId}
                    guildName={guild.name}
                    onPollCreated={(poll) => {
                        setPolls(prev => [poll, ...prev]);
                        setTotal(t => (t === null ? t : t + 1));
                        setServerSummary(prev => prev ? {
                            total: prev.total + 1,
                            active: prev.active + (poll.active ? 1 : 0),
                            closed: prev.closed + (poll.active ? 0 : 1),
                            channels: prev.channels.some(c => c.channel_id === poll.channel_id)
                                ? prev.channels.map(c => c.channel_id === poll.channel_id ? { ...c, count: c.count + 1, open: c.open + (poll.active ? 1 : 0) } : c)
                                : [...prev.channels, { channel_id: poll.channel_id, count: 1, open: poll.active ? 1 : 0 }],
                        } : prev);
                    }}
                    initialValues={duplicateSource ? {
                        title: duplicateSource.title,
                        description: duplicateSource.description,
                        options: duplicateSource.options,
                        settings: {
                            public: duplicateSource.settings?.public !== false,
                            allow_thread: duplicateSource.settings?.allow_thread ?? false,
                            allow_close: duplicateSource.settings?.allow_close !== false,
                            allow_exports: duplicateSource.settings?.allow_exports !== false,
                            max_votes: duplicateSource.settings?.max_votes ?? 1,
                            min_votes: duplicateSource.settings?.min_votes ?? 1,
                            allowed_roles: duplicateSource.settings?.allowed_roles ?? [],
                            vote_weights: duplicateSource.settings?.vote_weights ?? {},
                        },
                    } : undefined}
                />
            )}

            {editingPoll && (
                <EditPollModal
                    key={editingPoll.message_id}
                    isOpen={!!editingPoll}
                    onClose={() => setEditingPoll(null)}
                    poll={editingPoll}
                    roles={roles.map(r => ({ ...r, managed: !!r.managed }))}
                    onSave={handleSaveSettings}
                />
            )}
        </AppShell>
    );
};

/* ==========================================================================
   One poll: a 68px summary row that opens to its results, settings and
   actions.
   ========================================================================== */

const PollRow: React.FC<{
    poll: Poll;
    first: boolean;
    channelName: string | null;
    showChannel: boolean;
    roleById: Map<string, Role>;
    expanded: boolean;
    onToggle: () => void;
    onStatusChange: (pollId: string, active: boolean) => Promise<void>;
    onDeletePoll: (pollId: string) => Promise<void>;
    onEditPoll: (poll: Poll) => void;
    onDuplicatePoll: (poll: Poll) => void;
    cooldownEndTime?: number;
}> = ({ poll, first, channelName, showChannel, roleById, expanded, onToggle, onStatusChange, onDeletePoll, onEditPoll, onDuplicatePoll, cooldownEndTime }) => {
    const [isUpdating, setIsUpdating] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    const [rawCooldownRemaining, setCooldownRemaining] = useState(0);
    const cooldownRemaining = cooldownEndTime ? rawCooldownRemaining : 0;

    const [showPremiumModal, setShowPremiumModal] = useState(false);
    const [showVoterModal, setShowVoterModal] = useState(false);
    const [showExportModal, setShowExportModal] = useState(false);
    const [premiumStatus, setPremiumStatus] = useState<PremiumStatus | null>(null);
    const [checkingPremium, setCheckingPremium] = useState(false);

    useEffect(() => {
        if (!cooldownEndTime) return;
        const update = () => setCooldownRemaining(Math.max(0, Math.ceil((cooldownEndTime - Date.now()) / 1000)));
        const initial = setTimeout(update, 0);
        const interval = setInterval(update, 1000);
        return () => { clearTimeout(initial); clearInterval(interval); };
    }, [cooldownEndTime]);

    const settings = poll.settings || {};
    const countsKnown = !poll.counts_error && poll.total_votes !== null && poll.total_votes !== undefined;
    const totalVotes = countsKnown ? (poll.total_votes as number) : 0;
    const voteCounts = poll.vote_counts || {};
    const maxCount = Math.max(0, ...poll.options.map((_, i) => voteCounts[i] || 0));
    const weighted = !!(settings.vote_weights && Object.keys(settings.vote_weights).length > 0);
    const voters = poll.unique_voters;
    const discordUrl = `https://discord.com/channels/${poll.guild_id}/${poll.channel_id}/${poll.message_id}`;

    const roleLabel = (id: string) => {
        const r = roleById.get(id);
        return {
            name: r?.name ?? settings.role_metadata?.[id]?.name ?? 'Unknown role',
            color: r?.color ?? settings.role_metadata?.[id]?.color ?? 0,
        };
    };

    const checkPremium = async (): Promise<boolean> => {
        try {
            const res = await fetch('/api/user/premium/status', { credentials: 'include' });
            if (res.ok) {
                const data: PremiumStatus = await res.json();
                setPremiumStatus(data);
                return data.isPremium;
            }
        } catch (err) {
            console.error('Failed to check premium status:', err);
        }
        return false;
    };

    const refreshPremium = async (): Promise<boolean> => {
        try {
            const res = await apiFetch('/api/user/premium/refresh', { method: 'POST' });
            if (res.ok) {
                const data: PremiumStatus = await res.json();
                setPremiumStatus(data);
                return data.isPremium;
            }
        } catch (err) {
            console.error('Failed to refresh premium status:', err);
        }
        return false;
    };

    const handleViewVoters = async () => {
        setCheckingPremium(true);
        try {
            if (await checkPremium()) setShowVoterModal(true);
            else setShowPremiumModal(true);
        } finally {
            setCheckingPremium(false);
        }
    };

    const fetchVoters = async (optionIndex: number): Promise<VoterResponse> => {
        const res = await fetch(`/api/user/polls/${poll.message_id}/voters?option=${optionIndex}`, { credentials: 'include' });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.message || err.error || "Couldn't load voters");
        }
        return res.json();
    };

    const fetchExport = async (): Promise<ExportResponse> => {
        const res = await fetch(`/api/user/polls/${poll.message_id}/export`, { credentials: 'include' });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.message || err.error || "Couldn't export the poll");
        }
        return res.json();
    };

    const handleStatusToggle = async () => {
        setIsUpdating(true);
        try {
            await onStatusChange(poll.message_id, !poll.active);
        } finally {
            setIsUpdating(false);
        }
    };

    const confirmDelete = async () => {
        setIsDeleting(true);
        try {
            await onDeletePoll(poll.message_id);
        } finally {
            setIsDeleting(false);
            setConfirmingDelete(false);
        }
    };

    const voteSummary = countsKnown
        ? (weighted && voters != null && voters !== totalVotes
            ? `${plural(totalVotes, 'vote')} from ${plural(voters, 'voter')}`
            : plural(totalVotes, 'vote'))
        : null;

    const panelId = `poll-${poll.message_id}`;

    return (
        <li className={first ? '' : 'border-t border-rule'}>
            <ConfirmDialog
                open={confirmingDelete}
                title="Delete this poll?"
                message={`“${poll.title}” and all of its votes will be removed from PollBot. This can't be undone.`}
                confirmLabel="Delete poll"
                danger
                busy={isDeleting}
                onConfirm={confirmDelete}
                onCancel={() => setConfirmingDelete(false)}
            />

            {/* Summary row */}
            <button
                type="button"
                onClick={onToggle}
                aria-expanded={expanded}
                aria-controls={panelId}
                className="row-interactive w-full min-h-[68px] px-5 py-3 flex items-center gap-4 text-left"
            >
                <div className="flex-1 min-w-0">
                    <div className="text-[15px] leading-5 font-medium text-ink line-clamp-2 sm:line-clamp-1 break-words">{poll.title}</div>
                    <div className="mt-1 text-xs text-faint flex flex-wrap items-center gap-x-1.5 num">
                        {showChannel && (
                            <span className="inline-flex items-center gap-0.5 text-muted"><Hash className="w-3 h-3 text-cyan" aria-hidden="true" />{channelName || 'unknown-channel'}</span>
                        )}
                        {showChannel && <span aria-hidden="true">·</span>}
                        <span title={fmtDateTime(poll.created_at)}>Created {fmtRelative(poll.created_at)}</span>
                        <span aria-hidden="true">·</span>
                        <span>{voteSummary ?? <Dash title="Votes couldn't be counted right now" />}</span>
                        {weighted && <><span aria-hidden="true">·</span><span className="text-brand-text">Weighted</span></>}
                    </div>
                </div>
                <PollStatusChip active={poll.active} deleted={!!poll.discord_deleted} endsAt={poll.ends_at} />
                <ChevronDown className={`w-4 h-4 text-faint shrink-0 transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>

            {/* Detail */}
            {expanded && (
                <div id={panelId} className="px-5 pb-5 pt-1 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px] gap-5">
                    {/* Results */}
                    <div className="min-w-0">
                        {poll.description && (
                            <p className="text-sm text-muted mb-4 whitespace-pre-line">{poll.description}</p>
                        )}
                        <ol className="flex flex-col gap-3" aria-label="Results">
                            {poll.options.map((option, index) => {
                                const votes = voteCounts[index] || 0;
                                const leader = countsKnown && votes > 0 && votes === maxCount;
                                const width = countsKnown && maxCount > 0 ? (votes / maxCount) * 100 : 0;
                                return (
                                    <li key={index}>
                                        <div className="flex items-baseline justify-between gap-4 text-sm">
                                            <span className={`truncate ${leader ? 'text-ink font-medium' : 'text-muted'}`}>{option}</span>
                                            <span className="num shrink-0 text-ink">
                                                {countsKnown ? fmtCount(votes) : DASH}
                                                <span className="text-faint ml-2 inline-block w-12 text-right">{countsKnown ? fmtPct(votes, totalVotes) : ''}</span>
                                            </span>
                                        </div>
                                        <div className="mt-1.5 h-2 rounded-full bg-[#22252e] overflow-hidden" aria-hidden="true">
                                            {width > 0 && <div className={`h-full rounded-full ${leader ? 'bg-brand' : 'bg-[#4b5494]'}`} style={{ width: `${width}%` }} />}
                                        </div>
                                    </li>
                                );
                            })}
                        </ol>
                        {countsKnown && (
                            <p className="mt-4 text-xs text-faint num">
                                {weighted ? 'Weighted totals' : 'Totals'} · {plural(totalVotes, 'vote')}
                                {voters != null && <> · {plural(voters, 'voter')}</>}
                                {(settings.max_votes ?? 1) > 1 && <> · voters could pick up to {settings.max_votes}</>}
                            </p>
                        )}
                    </div>

                    {/* Settings */}
                    <dl className="rounded-lg bg-[#23262f] border border-[#343846] px-4 py-3 text-sm self-start">
                        <SettingRow label="Results" value={settings.public !== false ? 'Shown live' : 'Hidden until closed'} />
                        <SettingRow
                            label="Choices"
                            value={(settings.min_votes ?? 1) === (settings.max_votes ?? 1)
                                ? `Pick ${settings.max_votes ?? 1}`
                                : `Pick ${settings.min_votes ?? 1}–${settings.max_votes ?? 1}`}
                        />
                        <SettingRow
                            label="Who can vote"
                            value={settings.allowed_roles && settings.allowed_roles.length > 0 ? (
                                <span className="flex flex-wrap justify-end gap-1">
                                    {settings.allowed_roles.map(id => <RoleChip key={id} {...roleLabel(id)} />)}
                                </span>
                            ) : 'Everyone'}
                        />
                        {weighted && (
                            <SettingRow
                                label="Vote weights"
                                value={(
                                    <span className="flex flex-wrap justify-end gap-1">
                                        {Object.entries(settings.vote_weights || {}).map(([id, w]) => <RoleChip key={id} {...roleLabel(id)} suffix={`×${w}`} />)}
                                    </span>
                                )}
                            />
                        )}
                        <SettingRow label="Exports" value={settings.allow_exports !== false ? 'Allowed' : 'Off'} />
                        <SettingRow label="Thread" value={settings.allow_thread ? 'Created' : 'None'} />
                        {poll.ends_at && poll.active && <SettingRow label="Closes" value={fmtDateTime(poll.ends_at)} />}
                    </dl>

                    {/* Actions */}
                    <div className="lg:col-span-2 flex flex-wrap items-center gap-2 pt-1">
                        {poll.discord_deleted ? (
                            <>
                                <p className="text-sm text-faint mr-auto">The Discord message for this poll was deleted, so it can't be closed or edited.</p>
                                <button type="button" className="btn btn-danger" onClick={() => setConfirmingDelete(true)} disabled={isDeleting}>
                                    <Trash2 className="w-4 h-4" />
                                    Delete from PollBot
                                </button>
                            </>
                        ) : (
                            <>
                                <button
                                    type="button"
                                    className="btn btn-outline"
                                    onClick={handleStatusToggle}
                                    disabled={isUpdating || cooldownRemaining > 0}
                                    title={cooldownRemaining > 0 ? 'Fix the channel permissions, then try again' : undefined}
                                >
                                    {isUpdating ? <Loader2 className="w-4 h-4 animate-spin" /> : poll.active ? <Lock className="w-4 h-4" /> : <LockOpen className="w-4 h-4" />}
                                    {poll.active ? 'Close poll' : 'Reopen poll'}
                                    {cooldownRemaining > 0 && <span className="num text-faint">{cooldownRemaining}s</span>}
                                </button>
                                <button type="button" className="btn btn-tonal" onClick={() => onEditPoll(poll)}>
                                    <Settings2 className="w-4 h-4" />
                                    Edit settings
                                </button>
                                <button type="button" className="btn btn-ghost" onClick={handleViewVoters} disabled={checkingPremium}>
                                    {checkingPremium ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
                                    Voters
                                </button>
                                <button type="button" className="btn btn-ghost" onClick={() => setShowExportModal(true)}>
                                    <FileSpreadsheet className="w-4 h-4" />
                                    Export
                                </button>
                            </>
                        )}
                        <button type="button" className="btn btn-ghost" onClick={() => onDuplicatePoll(poll)}>
                            <CopyPlus className="w-4 h-4" />
                            Duplicate
                        </button>
                        {!poll.discord_deleted && (
                            <a className="btn btn-ghost ml-auto" href={discordUrl} target="_blank" rel="noopener noreferrer">
                                Open in Discord
                                <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                        )}
                    </div>
                </div>
            )}

            <PremiumGateModal
                isOpen={showPremiumModal}
                onClose={() => setShowPremiumModal(false)}
                voteUrl={premiumStatus?.voteUrl || 'https://top.gg/bot/911731627498041374/vote'}
                onRefresh={async () => {
                    const isPremium = await refreshPremium();
                    if (isPremium) {
                        setShowPremiumModal(false);
                        setShowVoterModal(true);
                    }
                    return isPremium;
                }}
            />
            <VoterViewModal
                isOpen={showVoterModal}
                onClose={() => setShowVoterModal(false)}
                pollId={poll.message_id}
                pollTitle={poll.title}
                options={poll.options}
                fetchVoters={fetchVoters}
            />
            <ExportModal
                isOpen={showExportModal}
                onClose={() => setShowExportModal(false)}
                pollTitle={poll.title}
                fetchExport={fetchExport}
            />
        </li>
    );
};

const SettingRow: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
    <div className="flex items-start justify-between gap-3 py-1.5">
        <dt className="text-faint shrink-0">{label}</dt>
        <dd className="text-ink text-right min-w-0">{value}</dd>
    </div>
);

/** Discord-style role chip: the role's colour as a dot. */
const RoleChip: React.FC<{ name: string; color: number; suffix?: string }> = ({ name, color, suffix }) => (
    <span className="chip bg-[#323643] text-ink">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: roleHex(color) }} aria-hidden="true" />
        {name}
        {suffix && <span className="text-faint num">{suffix}</span>}
    </span>
);
