import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Crown, ExternalLink, Loader2, CheckCircle, XCircle } from 'lucide-react';

interface PremiumGateModalProps {
    isOpen: boolean;
    onClose: () => void;
    voteUrl: string;
    onRefresh: () => Promise<boolean>; // Returns true if now premium
}

export const PremiumGateModal: React.FC<PremiumGateModalProps> = ({
    isOpen,
    onClose,
    voteUrl,
    onRefresh,
}) => {
    const [checking, setChecking] = useState(false);
    const [checkResult, setCheckResult] = useState<'success' | 'failed' | null>(null);

    const handleVoteClick = () => {
        window.open(voteUrl, '_blank', 'noopener,noreferrer');
    };

    const handleIVoted = async () => {
        setChecking(true);
        setCheckResult(null);
        try {
            const isPremium = await onRefresh();
            if (isPremium) {
                setCheckResult('success');
                // Auto-close after showing success
                setTimeout(() => {
                    onClose();
                }, 1500);
            } else {
                setCheckResult('failed');
            }
        } catch {
            setCheckResult('failed');
        } finally {
            setChecking(false);
        }
    };

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
                    className="glass-panel w-full max-w-md overflow-hidden"
                    onClick={(e: React.MouseEvent) => e.stopPropagation()}
                >
                    {/* Header */}
                    <div className="flex items-center justify-between p-5 border-b border-slate-700">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
                                <Crown className="w-5 h-5 text-white" />
                            </div>
                            <div>
                                <h2 className="text-lg font-bold text-white">Premium Feature</h2>
                                <p className="text-xs text-slate-400">Unlock with top.gg vote</p>
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-2 text-slate-400 hover:text-white transition-colors rounded-lg hover:bg-slate-800"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Content */}
                    <div className="p-6">
                        <div className="text-center mb-6">
                            <p className="text-slate-300 mb-2">
                                <strong className="text-white">Voter Breakdown</strong> is a premium feature.
                            </p>
                            <p className="text-sm text-slate-400">
                                Vote for Pollbot on top.gg to unlock this feature for <span className="text-amber-400 font-medium">12 hours</span>!
                            </p>
                        </div>

                        {/* Status Message */}
                        <AnimatePresence mode="wait">
                            {checkResult === 'success' && (
                                <motion.div
                                    initial={{ opacity: 0, y: -10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -10 }}
                                    className="mb-4 p-3 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center gap-2"
                                >
                                    <CheckCircle className="w-5 h-5 text-emerald-400" />
                                    <span className="text-sm text-emerald-400">Premium unlocked! Refreshing...</span>
                                </motion.div>
                            )}
                            {checkResult === 'failed' && (
                                <motion.div
                                    initial={{ opacity: 0, y: -10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -10 }}
                                    className="mb-4 p-3 rounded-lg bg-red-500/20 border border-red-500/30 flex items-center gap-2"
                                >
                                    <XCircle className="w-5 h-5 text-red-400" />
                                    <span className="text-sm text-red-400">Vote not detected yet. Try again in a moment.</span>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* Buttons */}
                        <div className="space-y-3">
                            <button
                                onClick={handleVoteClick}
                                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-amber-500 to-orange-600 text-white rounded-lg font-bold hover:from-amber-400 hover:to-orange-500 transition-all shadow-lg shadow-amber-500/25"
                            >
                                <ExternalLink className="w-4 h-4" />
                                Vote on top.gg
                            </button>

                            <button
                                onClick={handleIVoted}
                                disabled={checking}
                                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-slate-700 text-white rounded-lg font-medium hover:bg-slate-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {checking ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Checking...
                                    </>
                                ) : (
                                    <>
                                        <CheckCircle className="w-4 h-4" />
                                        I've Voted
                                    </>
                                )}
                            </button>

                            <button
                                onClick={onClose}
                                className="w-full px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors"
                            >
                                Maybe Later
                            </button>
                        </div>
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
};
