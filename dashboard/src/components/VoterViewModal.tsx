import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2, Users, Copy, Check, ChevronLeft, ChevronRight, User } from 'lucide-react';

import type { VoterInfo, VoteUpdate } from '../types';

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
    lastVoteUpdate?: VoteUpdate | null;
}

export const VoterViewModal: React.FC<VoterViewModalProps> = ({
    isOpen,
    onClose,
    pollId,
    pollTitle,
    options,
    fetchVoters,
    lastVoteUpdate,
}) => {
    const [selectedOption, setSelectedOption] = useState(0);
    const [loading, setLoading] = useState(false);
    const [voters, setVoters] = useState<VoterInfo[]>([]);
    const [totalVoters, setTotalVoters] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [copiedMention, setCopiedMention] = useState<string | null>(null);
    const [copiedList, setCopiedList] = useState(false);
    const [expandedUser, setExpandedUser] = useState<string | null>(null);

    // Pagination
    const [currentPage, setCurrentPage] = useState(0);
    const pageSize = 15;
    const totalPages = Math.ceil(voters.length / pageSize);

    // Initial load and option change
    useEffect(() => {
        if (isOpen) {
            loadVoters(selectedOption);
        }
    }, [isOpen, selectedOption]);

    // Handle realtime updates
    useEffect(() => {
        if (isOpen && lastVoteUpdate) {
            // Optimistic update if valid vote, matches current poll AND current option
            if (lastVoteUpdate.poll_id === pollId && lastVoteUpdate.option_index === selectedOption && lastVoteUpdate.user_id) {
                // Check if already in list
                const exists = voters.some(v => v.user_id === lastVoteUpdate.user_id);
                if (!exists) {
                    // Add temporary voter
                    const tempVoter: VoterInfo = {
                        user_id: lastVoteUpdate.user_id,
                        username: 'New Voter...',
                        display_name: 'Loading...',
                        nickname: null,
                        avatar_url: null
                    };
                    setVoters(prev => [tempVoter, ...prev]);
                    setTotalVoters(prev => prev + 1);
                }
            }

            // Only refresh if the update is for this poll
            if (lastVoteUpdate.poll_id === pollId) {
                // Debounce the full refresh
                const timer = setTimeout(() => {
                    loadVoters(selectedOption);
                }, 2000);
                return () => clearTimeout(timer);
            }
        }
    }, [lastVoteUpdate, pollId]);

    const loadVoters = async (optionIndex: number) => {
        setLoading(true);
        setError(null);
        setCurrentPage(0);
        try {
            const data = await fetchVoters(optionIndex);
            setVoters(data.voters);
            setTotalVoters(data.total_voters);
        } catch (err: any) {
            setError(err.message || 'Failed to load voters');
            setVoters([]);
            setTotalVoters(0);
        } finally {
            setLoading(false);
        }
    };

    const copyMention = async (userId: string) => {
        const mention = `<@${userId}>`;
        await navigator.clipboard.writeText(mention);
        setCopiedMention(userId);
        setTimeout(() => setCopiedMention(null), 2000);
    };

    const copyMentionList = async () => {
        const optionName = options[selectedOption];
        const mentions = voters.map(v => `<@${v.user_id}>`).join('\n');
        const text = `---\n${optionName} Voters\n${mentions}\n---`;
        await navigator.clipboard.writeText(text);
        setCopiedList(true);
        setTimeout(() => setCopiedList(false), 2000);
    };

    const paginatedVoters = voters.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

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
                    className="glass-panel w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col"
                    onClick={(e: React.MouseEvent) => e.stopPropagation()}
                >
                    {/* Header */}
                    <div className="flex items-center justify-between p-5 border-b border-slate-700">
                        <div>
                            <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                <Users className="w-5 h-5 text-violet-400" />
                                Voter Breakdown
                            </h2>
                            <p className="text-sm text-slate-400 mt-1 truncate max-w-md">{pollTitle}</p>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-2 text-slate-400 hover:text-white transition-colors rounded-lg hover:bg-slate-800"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Option Tabs */}
                    <div className="flex flex-wrap gap-2 p-4 border-b border-slate-700/50 bg-slate-900/30">
                        {options.map((option, index) => (
                            <button
                                key={index}
                                onClick={() => setSelectedOption(index)}
                                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${selectedOption === index
                                    ? 'bg-violet-600 text-white shadow-lg shadow-violet-500/25'
                                    : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white'
                                    }`}
                            >
                                {option.length > 25 ? option.substring(0, 25) + '...' : option}
                            </button>
                        ))}
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-y-auto p-4">
                        {loading ? (
                            <div className="flex items-center justify-center py-12">
                                <Loader2 className="w-8 h-8 text-violet-400 animate-spin" />
                            </div>
                        ) : error ? (
                            <div className="text-center py-12">
                                <p className="text-red-400">{error}</p>
                            </div>
                        ) : voters.length === 0 ? (
                            <div className="text-center py-12">
                                <Users className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                                <p className="text-slate-400">No votes for this option yet</p>
                            </div>
                        ) : (
                            <>
                                {/* Stats bar */}
                                <div className="flex items-center justify-between mb-4">
                                    <span className="text-sm text-slate-400">
                                        <span className="text-white font-bold">{totalVoters}</span> voter{totalVoters !== 1 ? 's' : ''}
                                    </span>
                                    <button
                                        onClick={copyMentionList}
                                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${copiedList
                                            ? 'bg-emerald-500/20 text-emerald-400'
                                            : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                                            }`}
                                    >
                                        {copiedList ? (
                                            <>
                                                <Check className="w-3.5 h-3.5" />
                                                Copied!
                                            </>
                                        ) : (
                                            <>
                                                <Copy className="w-3.5 h-3.5" />
                                                Copy All Mentions
                                            </>
                                        )}
                                    </button>
                                </div>

                                {/* Voter list */}
                                <div className="space-y-1">
                                    {paginatedVoters.map((voter) => (
                                        <div
                                            key={voter.user_id}
                                            className="group"
                                        >
                                            <div
                                                onClick={() => setExpandedUser(expandedUser === voter.user_id ? null : voter.user_id)}
                                                className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-800/50 cursor-pointer transition-colors"
                                            >
                                                {/* Avatar */}
                                                {voter.avatar_url ? (
                                                    <img
                                                        src={voter.avatar_url}
                                                        alt=""
                                                        className="w-8 h-8 rounded-full"
                                                    />
                                                ) : (
                                                    <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center">
                                                        <User className="w-4 h-4 text-slate-400" />
                                                    </div>
                                                )}

                                                {/* Name */}
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-sm font-medium text-white truncate">
                                                        {voter.nickname || voter.display_name}
                                                    </p>
                                                </div>

                                                {/* Quick copy */}
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        copyMention(voter.user_id);
                                                    }}
                                                    className={`p-1.5 rounded-md transition-all ${copiedMention === voter.user_id
                                                        ? 'bg-emerald-500/20 text-emerald-400'
                                                        : 'opacity-0 group-hover:opacity-100 bg-slate-700 text-slate-400 hover:text-white'
                                                        }`}
                                                    title="Copy mention"
                                                >
                                                    {copiedMention === voter.user_id ? (
                                                        <Check className="w-3.5 h-3.5" />
                                                    ) : (
                                                        <Copy className="w-3.5 h-3.5" />
                                                    )}
                                                </button>
                                            </div>

                                            {/* Expanded details */}
                                            <AnimatePresence>
                                                {expandedUser === voter.user_id && (
                                                    <motion.div
                                                        initial={{ height: 0, opacity: 0 }}
                                                        animate={{ height: 'auto', opacity: 1 }}
                                                        exit={{ height: 0, opacity: 0 }}
                                                        className="overflow-hidden"
                                                    >
                                                        <div className="ml-11 mb-2 p-3 rounded-lg bg-slate-800/50 border border-slate-700/50 text-xs space-y-1.5">
                                                            <div className="flex justify-between">
                                                                <span className="text-slate-500">Username</span>
                                                                <span className="text-slate-300 font-mono">{voter.username}</span>
                                                            </div>
                                                            <div className="flex justify-between">
                                                                <span className="text-slate-500">Display Name</span>
                                                                <span className="text-slate-300">{voter.display_name}</span>
                                                            </div>
                                                            {voter.nickname && (
                                                                <div className="flex justify-between">
                                                                    <span className="text-slate-500">Server Nickname</span>
                                                                    <span className="text-slate-300">{voter.nickname}</span>
                                                                </div>
                                                            )}
                                                            <div className="flex justify-between items-center pt-1 border-t border-slate-700/50">
                                                                <span className="text-slate-500">Mention</span>
                                                                <code className="text-violet-400 bg-violet-500/10 px-2 py-0.5 rounded">
                                                                    {'<@' + voter.user_id + '>'}
                                                                </code>
                                                            </div>
                                                        </div>
                                                    </motion.div>
                                                )}
                                            </AnimatePresence>
                                        </div>
                                    ))}
                                </div>

                                {/* Pagination */}
                                {totalPages > 1 && (
                                    <div className="flex items-center justify-center gap-2 mt-4 pt-4 border-t border-slate-700/50">
                                        <button
                                            onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
                                            disabled={currentPage === 0}
                                            className="p-2 rounded-lg bg-slate-800 text-slate-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                        >
                                            <ChevronLeft className="w-4 h-4" />
                                        </button>
                                        <span className="text-sm text-slate-400">
                                            Page <span className="text-white font-medium">{currentPage + 1}</span> of {totalPages}
                                        </span>
                                        <button
                                            onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
                                            disabled={currentPage >= totalPages - 1}
                                            className="p-2 rounded-lg bg-slate-800 text-slate-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                        >
                                            <ChevronRight className="w-4 h-4" />
                                        </button>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
};
