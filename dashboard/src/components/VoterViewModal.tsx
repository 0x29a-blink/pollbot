import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Copy, Check, ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';
import { Modal } from './ui/Modal';
import { Avatar, InlineError } from './ui/primitives';
import { fmtCount, plural } from '../lib/format';

import type { VoterInfo } from '../types';

interface VoterViewModalProps {
    isOpen: boolean;
    onClose: () => void;
    pollId: string;
    pollTitle: string;
    options: string[];
    fetchVoters: (optionIndex: number) => Promise<{
        option_index: number;
        option_name: string;
        total_voters: number;
        voters: VoterInfo[];
    }>;
}

/** Above this many options the per-tab counts fill in as tabs are opened, instead of all at once. */
const PREFETCH_COUNT_LIMIT = 12;

export const VoterViewModal: React.FC<VoterViewModalProps> = ({
    isOpen,
    onClose,
    pollId,
    pollTitle,
    options,
    fetchVoters,
}) => {
    const [selectedOption, setSelectedOption] = useState(0);
    const [loading, setLoading] = useState(false);
    const [voters, setVoters] = useState<VoterInfo[]>([]);
    const [totalVoters, setTotalVoters] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [copiedMention, setCopiedMention] = useState<string | null>(null);
    const [copiedList, setCopiedList] = useState(false);
    const [expandedUser, setExpandedUser] = useState<string | null>(null);
    /** Voter count per option index, for the tab labels. */
    const [counts, setCounts] = useState<Record<number, number>>({});
    const fetchVotersRef = useRef(fetchVoters);

    useEffect(() => {
        fetchVotersRef.current = fetchVoters;
    }, [fetchVoters]);

    const safeSelectedOption = selectedOption < options.length ? selectedOption : 0;

    // Pagination
    const [currentPage, setCurrentPage] = useState(0);
    const pageSize = 15;
    const totalPages = Math.ceil(voters.length / pageSize);

    const loadVoters = useCallback(async (optionIndex: number, resetPage: boolean = true) => {
        // Background refreshes keep the reader where they are; only an explicit
        // open/option change jumps back to the first page.
        setLoading(resetPage);
        setError(null);
        if (resetPage) setCurrentPage(0);
        try {
            const data = await fetchVotersRef.current(optionIndex);
            setVoters(data.voters);
            setTotalVoters(data.total_voters);
            setCounts(c => ({ ...c, [optionIndex]: data.total_voters }));
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Failed to load voters');
            setVoters([]);
            setTotalVoters(0);
        } finally {
            setLoading(false);
        }
    }, []);

    // Initial load and option change
    useEffect(() => {
        if (!isOpen) return;
        void (async () => {
            await loadVoters(safeSelectedOption, true);
        })();
    }, [isOpen, pollId, safeSelectedOption, loadVoters]);

    // Fill in the per-tab counts once per open (small polls only).
    const optionCount = options.length;
    useEffect(() => {
        if (!isOpen || optionCount > PREFETCH_COUNT_LIMIT) return;
        let cancelled = false;
        void Promise.allSettled(Array.from({ length: optionCount }, (_, i) => fetchVotersRef.current(i))).then(results => {
            if (cancelled) return;
            setCounts(prev => {
                const next = { ...prev };
                results.forEach((r, i) => {
                    if (r.status === 'fulfilled') next[i] = r.value.total_voters;
                });
                return next;
            });
        });
        return () => {
            cancelled = true;
        };
    }, [isOpen, pollId, optionCount]);

    // Keep the open list fresh. Previously this reacted to a realtime vote feed
    // delivered over the public anon key; voter identity is admin/owner data, so
    // it now comes only from the authenticated fetchVoters endpoint.
    useEffect(() => {
        if (!isOpen) return;

        const interval = setInterval(() => {
            if (document.visibilityState === 'visible') {
                void loadVoters(safeSelectedOption, false);
            }
        }, 15000);

        return () => clearInterval(interval);
    }, [isOpen, pollId, safeSelectedOption, loadVoters]);

    const copyMention = async (userId: string) => {
        const mention = `<@${userId}>`;
        try {
            await navigator.clipboard.writeText(mention);
            setCopiedMention(userId);
            setTimeout(() => setCopiedMention(null), 2000);
        } catch (err) {
            console.error('Clipboard copy failed:', err);
        }
    };

    const copyMentionList = async () => {
        const optionName = options[safeSelectedOption];
        const mentions = voters.map(v => `<@${v.user_id}>`).join('\n');
        const text = `---\n${optionName} Voters\n${mentions}\n---`;
        try {
            await navigator.clipboard.writeText(text);
            setCopiedList(true);
            setTimeout(() => setCopiedList(false), 2000);
        } catch (err) {
            console.error('Clipboard copy failed:', err);
        }
    };

    const paginatedVoters = voters.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
    const firstShown = currentPage * pageSize + 1;
    const lastShown = Math.min(voters.length, (currentPage + 1) * pageSize);

    return (
        <Modal
            open={isOpen}
            onClose={onClose}
            title="Voters"
            subtitle={pollTitle}
            width="max-w-2xl"
        >
            {/* Option tabs (Fluent pivot): one per option with its voter count */}
            <div className="shrink-0 px-4 border-b border-rule overflow-x-auto">
                <div role="tablist" aria-label="Poll options" className="flex gap-1 min-w-max">
                    {options.map((option, index) => {
                        const selected = safeSelectedOption === index;
                        const count = counts[index];
                        return (
                            <button
                                key={index}
                                type="button"
                                role="tab"
                                aria-selected={selected}
                                onClick={() => setSelectedOption(index)}
                                title={option}
                                className={`relative h-10 px-3 inline-flex items-center gap-2 text-sm rounded-t-control transition-colors ${selected ? 'text-ink font-medium' : 'text-muted hover:text-ink hover:bg-[var(--state-hover)]'
                                    }`}
                            >
                                <span>{option.length > 25 ? option.substring(0, 25) + '…' : option}</span>
                                {count !== undefined && (
                                    <span className={`num text-xs ${selected ? 'text-muted' : 'text-faint'}`}>{fmtCount(count)}</span>
                                )}
                                {selected && <span aria-hidden="true" className="absolute left-3 right-3 bottom-0 h-[3px] rounded-full bg-brand" />}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Toolbar */}
            {!loading && !error && voters.length > 0 && (
                <div className="shrink-0 flex items-center justify-between gap-3 px-6 h-12">
                    <span className="text-sm text-muted num">{plural(totalVoters, 'voter')}</span>
                    <button type="button" onClick={copyMentionList} className="btn btn-outline btn-sm" aria-live="polite">
                        {copiedList ? (
                            <>
                                <Check className="w-3.5 h-3.5 text-positive" aria-hidden="true" />
                                Copied
                            </>
                        ) : (
                            <>
                                <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                                Copy all mentions
                            </>
                        )}
                    </button>
                </div>
            )}

            {/* Content */}
            <div className="flex-1 min-h-[300px] overflow-y-auto px-3 pb-3" role="tabpanel" aria-label={options[safeSelectedOption]}>
                {loading ? (
                    <div role="status" aria-label="Loading voters" className="pt-3 motion-safe:animate-pulse">
                        {Array.from({ length: 6 }, (_, i) => (
                            <div key={i} className="h-11 px-3 flex items-center gap-3">
                                <div className="skeleton w-7 h-7 rounded-full" />
                                <div className="skeleton h-3.5" style={{ width: 90 + ((i * 37) % 70) }} />
                                <div className="skeleton h-3 w-16 opacity-60" />
                            </div>
                        ))}
                    </div>
                ) : error ? (
                    <div className="pt-3">
                        <InlineError message={`Couldn't load voters. ${error}`} onRetry={() => void loadVoters(safeSelectedOption, true)} className="px-3" />
                    </div>
                ) : voters.length === 0 ? (
                    <div className="mx-3 mt-3 rounded-card border border-dashed border-control px-5 py-10 text-center">
                        <p className="text-sm font-semibold text-ink">No votes for this option yet</p>
                        <p className="text-sm text-faint mt-1">People who pick it will appear here.</p>
                    </div>
                ) : (
                    <>
                        <ul>
                            {paginatedVoters.map((voter) => {
                                const name = voter.nickname || voter.display_name;
                                const expanded = expandedUser === voter.user_id;
                                return (
                                    <li key={voter.user_id} className="group">
                                        <div className="flex items-center gap-1 rounded-control hover:bg-[var(--state-hover)] transition-colors">
                                            <button
                                                type="button"
                                                onClick={() => setExpandedUser(expanded ? null : voter.user_id)}
                                                aria-expanded={expanded}
                                                className="flex-1 min-w-0 h-11 pl-3 flex items-center gap-3 text-left rounded-control"
                                            >
                                                <Avatar name={name} url={voter.avatar_url} id={voter.user_id} size={28} />
                                                <span className="min-w-0 flex items-baseline gap-2">
                                                    <span className="text-sm font-medium text-ink truncate">{name}</span>
                                                    <span className="text-[13px] text-faint truncate">@{voter.username}</span>
                                                </span>
                                                <ChevronDown className={`w-3.5 h-3.5 text-faint shrink-0 ml-auto mr-1 transition-transform ${expanded ? 'rotate-180' : 'sm:opacity-0 sm:group-hover:opacity-100'}`} aria-hidden="true" />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => copyMention(voter.user_id)}
                                                aria-label={`Copy mention for ${name}`}
                                                title="Copy mention"
                                                className={`btn btn-ghost btn-sm btn-icon mr-1.5 shrink-0 ${copiedMention === voter.user_id ? '' : 'sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100'}`}
                                            >
                                                {copiedMention === voter.user_id
                                                    ? <Check className="w-3.5 h-3.5 text-positive" />
                                                    : <Copy className="w-3.5 h-3.5" />}
                                            </button>
                                        </div>

                                        {expanded && (
                                            <dl className="ml-[52px] mr-3 mb-2 mt-0.5 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 rounded-control bg-raised px-3 py-2.5 text-xs">
                                                <dt className="text-faint">Username</dt>
                                                <dd className="text-muted text-right truncate">{voter.username}</dd>
                                                <dt className="text-faint">Display name</dt>
                                                <dd className="text-muted text-right truncate">{voter.display_name}</dd>
                                                {voter.nickname && (
                                                    <>
                                                        <dt className="text-faint">Server nickname</dt>
                                                        <dd className="text-muted text-right truncate">{voter.nickname}</dd>
                                                    </>
                                                )}
                                                <dt className="text-faint">Mention</dt>
                                                <dd className="text-right"><code className="font-mono text-muted">{'<@' + voter.user_id + '>'}</code></dd>
                                            </dl>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>

                        {/* Pagination */}
                        {totalPages > 1 && (
                            <div className="flex items-center justify-between gap-2 mt-2 pt-3 px-3 border-t border-rule">
                                <span className="text-xs text-faint num">
                                    {firstShown}–{lastShown} of {fmtCount(voters.length)}
                                </span>
                                <div className="flex items-center gap-1">
                                    <button
                                        type="button"
                                        onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
                                        disabled={currentPage === 0}
                                        aria-label="Previous page"
                                        className="btn btn-ghost btn-sm btn-icon"
                                    >
                                        <ChevronLeft className="w-4 h-4" />
                                    </button>
                                    <span className="text-xs text-muted num px-1">
                                        Page {currentPage + 1} of {totalPages}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
                                        disabled={currentPage >= totalPages - 1}
                                        aria-label="Next page"
                                        className="btn btn-ghost btn-sm btn-icon"
                                    >
                                        <ChevronRight className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </Modal>
    );
};
