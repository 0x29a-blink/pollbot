import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ExternalLink } from 'lucide-react';
import { apiFetch } from '../utils/api';
import { Avatar, GuildIcon, PollStatusChip, ShareBar } from './ui/primitives';
import { shortId } from './admin/adminFormat';
import { fmtCount, fmtDateTime, fmtPct, fmtRelative } from '../lib/format';
import type { Poll } from '../types';

interface PollSupporters {
    total_voters: number;
    premium_now: number;
    supporters: number;
    supporters_30d: number;
    topgg: number;
    discordforge: number;
    top_supporters: {
        user_id: string;
        username: string | null;
        avatar_url: string | null;
        botlist_votes: number;
        sources: string[];
        last_botlist_vote_at: string;
    }[];
}

interface PollCardProps {
    poll: Poll;
    votes?: Record<number, number>;
    /** Shown when the list spans servers (the global polls view). */
    guild?: { name: string; icon_url: string | null; id: string };
    /** Admin-only: show the bot-list supporter breakdown on expand. */
    showSupporterCard?: boolean;
}

const SOURCE_LABELS: Record<string, string> = { topgg: 'Top.gg', discordforge: 'DiscordForge' };
/** Rules between the four supporter figures: 2x2 on phones, one row from sm up. */
const SUPPORTER_CELL = ['', 'border-l', 'border-t sm:border-t-0 sm:border-l', 'border-l border-t sm:border-t-0'];

/** Resolve a role ID to its display name via role_metadata, falling back to the ID. */
const roleName = (poll: Poll) => (id: string) => poll.settings?.role_metadata?.[id]?.name ?? id;

/**
 * One poll in an admin list: a row that expands to the results, the poll's
 * settings and (on the global view) how its voters relate to the bot lists.
 */
export const PollCard: React.FC<PollCardProps> = ({ poll, votes = {}, guild, showSupporterCard = false }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [supporters, setSupporters] = useState<PollSupporters | null>(null);
    const [supportersFailed, setSupportersFailed] = useState(false);
    const [supportersTry, setSupportersTry] = useState(0);
    const options = Array.isArray(poll.options) ? poll.options : [];
    const totalVotes = Object.values(votes).reduce((sum, count) => sum + (Number(count) || 0), 0);
    const maxVotes = Math.max(0, ...options.map((_, i) => Number(votes[i]) || 0));
    const deleted = !!poll.discord_deleted;
    const messageUrl = `https://discord.com/channels/${poll.guild_id}/${poll.channel_id}/${poll.message_id}`;
    const weights = poll.settings?.vote_weights ? Object.entries(poll.settings.vote_weights) : [];

    // Lazy-load the supporter breakdown the first time the card is expanded.
    useEffect(() => {
        if (!showSupporterCard || !isExpanded || supporters || supportersFailed) return;
        let cancelled = false;
        (async () => {
            try {
                const res = await apiFetch(`/api/admin/polls/${poll.message_id}/supporters`);
                if (cancelled) return;
                if (!res.ok) { setSupportersFailed(true); return; }
                setSupporters(await res.json());
            } catch {
                if (!cancelled) setSupportersFailed(true);
            }
        })();
        return () => { cancelled = true; };
    }, [showSupporterCard, isExpanded, supporters, supportersFailed, poll.message_id, supportersTry]);

    const panelId = `poll-${poll.message_id}-details`;

    return (
        <article className="panel overflow-hidden">
            {/* Summary row: the whole row toggles; the title button carries focus/ARIA */}
            <div className="flex items-center gap-3 px-4 sm:px-5 py-3 min-h-[64px] row-interactive" onClick={() => setIsExpanded(v => !v)}>
                <button
                    type="button"
                    onClick={e => { e.stopPropagation(); setIsExpanded(v => !v); }}
                    aria-expanded={isExpanded}
                    aria-controls={panelId}
                    className="flex-1 min-w-0 text-left flex items-center gap-3 rounded"
                >
                    <ChevronDown className={`w-4 h-4 text-faint shrink-0 transition-transform duration-150 ${isExpanded ? 'rotate-180' : ''}`} aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-semibold text-ink truncate">{poll.title}</h3>
                        <div className="flex items-center gap-1.5 text-[13px] text-faint min-w-0 mt-1 sm:mt-0.5">
                            {/* Phone: the status mark moves into this line */}
                            <span className="sm:hidden shrink-0"><PollStatusChip active={poll.active} deleted={deleted} /></span>
                            <span className="whitespace-nowrap shrink-0" title={fmtDateTime(poll.created_at)}>{fmtRelative(poll.created_at)}</span>
                            <span aria-hidden="true" className="hidden sm:inline">·</span>
                            <span className="whitespace-nowrap hidden sm:inline">by <span className="font-mono text-xs">{shortId(poll.creator_id)}</span></span>
                            {poll.ends_at && poll.active && !deleted && (
                                <>
                                    <span aria-hidden="true" className="hidden lg:inline">·</span>
                                    <span className="whitespace-nowrap hidden lg:inline">closes {fmtDateTime(poll.ends_at)}</span>
                                </>
                            )}
                            {guild && <span className="md:hidden truncate min-w-0">· {guild.name}</span>}
                        </div>
                    </div>
                </button>
                {guild && (
                    <Link
                        to={`/server/${guild.id}`}
                        onClick={e => e.stopPropagation()}
                        className="hidden md:flex items-center gap-2 w-44 min-w-0 shrink-0 text-[13px] text-muted hover:text-ink"
                        title={`Open ${guild.name}`}
                    >
                        <GuildIcon name={guild.name} iconUrl={guild.icon_url} size={20} radius="6px" />
                        <span className="truncate">{guild.name}</span>
                    </Link>
                )}
                {/* Fixed slot so the column edges line up down the list */}
                <span className="hidden sm:flex w-[136px] shrink-0 justify-start">
                    <PollStatusChip active={poll.active} deleted={deleted} />
                </span>
                <div className="w-12 sm:w-16 text-right shrink-0">
                    <div className="num text-sm text-ink">{fmtCount(totalVotes)}</div>
                    <div className="text-xs text-faint">{totalVotes === 1 ? 'vote' : 'votes'}</div>
                </div>
            </div>

            {isExpanded && (
                <div id={panelId} className="border-t border-rule">
                    <div className="grid grid-cols-1 md:grid-cols-5">
                        {/* Results, then the way back to the message */}
                        <section className="px-4 sm:px-5 py-4 min-w-0 md:col-span-3 flex flex-col" aria-label="Results">
                            {poll.description && <p className="text-sm text-muted mb-3 whitespace-pre-line">{poll.description}</p>}
                            <h4 className="text-[13px] text-faint mb-1">Results</h4>
                            <ul>
                                {options.map((opt: string | { text?: string; label?: string }, i: number) => {
                                    const count = Number(votes[i]) || 0;
                                    const label = typeof opt === 'string' ? opt : (opt.text || opt.label || `Option ${i + 1}`);
                                    return (
                                        <li key={i} className="py-1.5">
                                            <div className="flex items-baseline gap-2 text-sm mb-1">
                                                <span className="text-ink truncate flex-1">{label}</span>
                                                <span className="num text-ink">{fmtCount(count)}</span>
                                                <span className="num text-xs text-faint w-12 text-right">{fmtPct(count, totalVotes)}</span>
                                            </div>
                                            <ShareBar value={count} max={maxVotes} tone={count === maxVotes && count > 0 ? 'data' : 'muted'} />
                                        </li>
                                    );
                                })}
                            </ul>
                            <div className="mt-auto pt-3">
                                {deleted ? (
                                    <span className="text-[13px] text-faint">The Discord message was deleted, so there is nothing to open.</span>
                                ) : (
                                    <a href={messageUrl} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm">
                                        <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" /> Open in Discord
                                    </a>
                                )}
                            </div>
                        </section>

                        {/* Settings: compact label-over-value grid (the status mark is in the row above) */}
                        <section className="px-4 sm:px-5 py-4 md:col-span-2 md:border-l border-t md:border-t-0 border-rule min-w-0" aria-label="Details">
                            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                                <Detail label="Created">{fmtDateTime(poll.created_at)}</Detail>
                                {poll.ends_at
                                    ? <Detail label={poll.active ? 'Closes' : 'Was set to close'}>{fmtDateTime(poll.ends_at)}</Detail>
                                    : <Detail label="Closes">Manually</Detail>}
                                <Detail label="Creator"><span className="font-mono text-[13px]">{poll.creator_id}</span></Detail>
                                {/* public/allow_close/allow_exports default to true when absent */}
                                <Detail label="Live results">{poll.settings?.public !== false ? 'Visible' : 'Hidden until close'}</Detail>
                                <Detail label="Choices per voter">{`${poll.settings?.min_votes ?? 1}–${poll.settings?.max_votes ?? 1}`}</Detail>
                                <Detail label="Thread">{poll.settings?.allow_thread ? 'Yes' : 'No'}</Detail>
                                <Detail label="Close button">{poll.settings?.allow_close !== false ? 'Yes' : 'No'}</Detail>
                                <Detail label="Exports">{poll.settings?.allow_exports !== false ? 'Allowed' : 'Off'}</Detail>
                                <Detail label="Who can vote" wide>{poll.settings?.allowed_roles?.length ? poll.settings.allowed_roles.map(roleName(poll)).join(', ') : 'Everyone'}</Detail>
                                {weights.length > 0 && (
                                    <Detail label="Vote weights" wide>
                                        <span className="flex flex-wrap gap-1.5">
                                            {weights.map(([role, weight]) => <span key={role} className="chip">{roleName(poll)(role)} ×{weight}</span>)}
                                        </span>
                                    </Detail>
                                )}
                            </dl>
                        </section>
                    </div>

                    {/* Bot-list supporters among this poll's voters (global view) */}
                    {showSupporterCard && (
                        <section className="px-4 sm:px-5 py-4 border-t border-rule" aria-label="Bot-list supporters">
                            <h4 className="text-[13px] text-faint mb-2">Bot-list supporters among voters</h4>
                            {supportersFailed ? (
                                <div className="flex items-center gap-3 text-sm text-muted">
                                    <span>Couldn't load supporter data.</span>
                                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setSupportersFailed(false); setSupportersTry(n => n + 1); }}>Retry</button>
                                </div>
                            ) : !supporters ? (
                                <div className="skeleton h-[68px] w-full" />
                            ) : (
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-4">
                                    <div>
                                        <div className="grid grid-cols-2 sm:grid-cols-4 border border-rule rounded-lg">
                                            {[
                                                ['Voters', supporters.total_voters],
                                                ['Premium now', supporters.premium_now],
                                                ['Top.gg', supporters.topgg],
                                                ['DiscordForge', supporters.discordforge],
                                            ].map(([label, value], i) => (
                                                <div key={String(label)} className={`px-3 py-2 min-w-0 border-rule ${SUPPORTER_CELL[i]}`}>
                                                    <div className="text-xs text-faint truncate">{label}</div>
                                                    <div className="num text-lg font-semibold text-ink">{fmtCount(value)}</div>
                                                </div>
                                            ))}
                                        </div>
                                        <p className="text-xs text-faint mt-2">
                                            {supporters.total_voters > 0
                                                ? `${fmtPct(supporters.supporters, supporters.total_voters)} of this poll's voters have voted for PollBot on a bot list (${fmtCount(supporters.supporters_30d)} in the last 30 days).`
                                                : 'No votes on this poll yet.'}
                                        </p>
                                    </div>
                                    <div className="min-w-0">
                                        {supporters.top_supporters.length === 0 ? (
                                            <p className="text-sm text-faint">None of this poll's voters have voted on a bot list.</p>
                                        ) : (
                                            <ul>
                                                {supporters.top_supporters.slice(0, 3).map(s => (
                                                    <li key={s.user_id} className="h-9 flex items-center gap-2.5 min-w-0">
                                                        <Avatar name={s.username || '?'} url={s.avatar_url} size={22} id={s.user_id} />
                                                        <span className="text-sm text-ink truncate flex-1">{s.username || 'Unknown user'}</span>
                                                        <span className="text-xs text-faint shrink-0">{s.sources.map(x => SOURCE_LABELS[x] ?? x).join(' · ')}</span>
                                                        <span className="num text-sm text-ink w-10 text-right shrink-0">{fmtCount(s.botlist_votes)}</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </div>
                                </div>
                            )}
                        </section>
                    )}
                </div>
            )}
        </article>
    );
};

const Detail: React.FC<{ label: string; wide?: boolean; children: React.ReactNode }> = ({ label, wide = false, children }) => (
    <div className={`min-w-0 ${wide ? 'col-span-2' : ''}`}>
        <dt className="text-xs text-faint">{label}</dt>
        <dd className="text-ink mt-0.5 break-words">{children}</dd>
    </div>
);
