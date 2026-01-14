import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldAlert, X, ExternalLink, CheckCircle2, Clock } from 'lucide-react';
import type { PermissionError } from '../types';

interface PermissionErrorBannerProps {
    error: PermissionError | null;
    onDismiss: () => void;
    onRetry?: () => void;
}

const RETRY_COOLDOWN = 30; // 30 seconds cooldown

/**
 * A banner that displays when the bot is missing permissions
 * to interact with a poll in Discord.
 * 
 * Shows which permissions are missing and provides guidance
 * on how to fix them.
 */
export const PermissionErrorBanner: React.FC<PermissionErrorBannerProps> = ({
    error,
    onDismiss,
    onRetry,
}) => {
    const [cooldownRemaining, setCooldownRemaining] = useState(RETRY_COOLDOWN);

    // Reset cooldown when error changes (new error shown)
    useEffect(() => {
        if (error) {
            setCooldownRemaining(RETRY_COOLDOWN);
        }
    }, [error?.pollId, error?.timestamp]);

    // Countdown timer
    useEffect(() => {
        if (!error || cooldownRemaining <= 0) return;

        const timer = setInterval(() => {
            setCooldownRemaining(prev => Math.max(0, prev - 1));
        }, 1000);

        return () => clearInterval(timer);
    }, [error, cooldownRemaining]);

    if (!error) return null;

    const getPermissionIcon = (perm: string) => {
        switch (perm) {
            case 'View Channel':
                return '👁️';
            case 'Send Messages':
                return '💬';
            case 'Attach Files':
                return '📎';
            case 'Embed Links':
                return '🔗';
            default:
                return '⚙️';
        }
    };

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0, y: -20, height: 0 }}
                animate={{ opacity: 1, y: 0, height: 'auto' }}
                exit={{ opacity: 0, y: -20, height: 0 }}
                className="mb-6"
            >
                <div className="relative overflow-hidden rounded-xl border border-amber-500/30 bg-gradient-to-r from-amber-950/50 via-amber-900/30 to-amber-950/50">
                    {/* Animated background pattern */}
                    <div className="absolute inset-0 opacity-10">
                        <div 
                            className="absolute inset-0"
                            style={{
                                backgroundImage: `repeating-linear-gradient(
                                    -45deg,
                                    transparent,
                                    transparent 10px,
                                    rgba(251, 191, 36, 0.1) 10px,
                                    rgba(251, 191, 36, 0.1) 20px
                                )`,
                            }}
                        />
                    </div>

                    <div className="relative p-5">
                        <div className="flex items-start gap-4">
                            {/* Icon */}
                            <div className="shrink-0 w-12 h-12 rounded-xl bg-amber-500/20 flex items-center justify-center">
                                <ShieldAlert className="w-6 h-6 text-amber-400" />
                            </div>

                            {/* Content */}
                            <div className="flex-1 min-w-0">
                                <div className="flex items-start justify-between gap-4">
                                    <div>
                                        <h3 className="text-lg font-bold text-amber-300 mb-1">
                                            Bot Missing Permissions
                                        </h3>
                                        <p className="text-sm text-amber-200/70 mb-3">
                                            Unable to update <span className="font-semibold text-white">"{error.pollTitle}"</span> because
                                            the bot doesn't have the required permissions in that channel.
                                        </p>
                                    </div>

                                    {/* Dismiss button */}
                                    <button
                                        onClick={onDismiss}
                                        className="shrink-0 p-1.5 rounded-lg text-amber-400/60 hover:text-amber-300 hover:bg-amber-500/10 transition-colors"
                                    >
                                        <X className="w-5 h-5" />
                                    </button>
                                </div>

                                {/* Missing permissions list */}
                                <div className="mb-4">
                                    <div className="text-xs font-semibold text-amber-400/80 uppercase tracking-wider mb-2">
                                        Required Permissions
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {error.missingPermissions.map((perm) => (
                                            <span
                                                key={perm}
                                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/30 text-amber-200 text-sm font-medium"
                                            >
                                                <span>{getPermissionIcon(perm)}</span>
                                                {perm}
                                            </span>
                                        ))}
                                    </div>
                                </div>

                                {/* How to fix */}
                                <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-700/50">
                                    <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                                        How to Fix
                                    </div>
                                    <ol className="text-sm text-slate-300 space-y-2">
                                        <li className="flex items-start gap-2">
                                            <span className="shrink-0 w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-400 text-xs font-bold flex items-center justify-center mt-0.5">1</span>
                                            <span>Open your Discord server and go to <span className="text-white font-medium">Server Settings → Roles</span></span>
                                        </li>
                                        <li className="flex items-start gap-2">
                                            <span className="shrink-0 w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-400 text-xs font-bold flex items-center justify-center mt-0.5">2</span>
                                            <span>Find the <span className="text-white font-medium">Poll Bot</span> role (or the bot's integration role)</span>
                                        </li>
                                        <li className="flex items-start gap-2">
                                            <span className="shrink-0 w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-400 text-xs font-bold flex items-center justify-center mt-0.5">3</span>
                                            <span>Ensure it has the permissions listed above, either globally or for the specific channel where this poll was created</span>
                                        </li>
                                    </ol>

                                    {/* Quick tip */}
                                    <div className="mt-3 pt-3 border-t border-slate-700/50 flex items-start gap-2">
                                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                                        <p className="text-xs text-slate-400">
                                            <span className="text-emerald-400 font-medium">Quick tip:</span> Check the channel's permission overwrites—
                                            sometimes the bot role is explicitly denied access there even if it has server-wide permissions.
                                        </p>
                                    </div>
                                </div>

                                {/* Actions */}
                                <div className="mt-4 flex items-center gap-3">
                                    {onRetry && (
                                        <button
                                            onClick={() => {
                                                if (cooldownRemaining <= 0) {
                                                    setCooldownRemaining(RETRY_COOLDOWN);
                                                    onRetry();
                                                }
                                            }}
                                            disabled={cooldownRemaining > 0}
                                            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors border flex items-center gap-2 ${
                                                cooldownRemaining > 0
                                                    ? 'bg-slate-700/50 text-slate-400 border-slate-600 cursor-not-allowed'
                                                    : 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border-amber-500/30'
                                            }`}
                                        >
                                            {cooldownRemaining > 0 ? (
                                                <>
                                                    <Clock className="w-3.5 h-3.5" />
                                                    Try Again ({cooldownRemaining}s)
                                                </>
                                            ) : (
                                                'Try Again'
                                            )}
                                        </button>
                                    )}
                                    <a
                                        href="https://support.discord.com/hc/en-us/articles/206029707-Setting-Up-Permissions-FAQ"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-800 text-slate-300 text-sm font-medium hover:bg-slate-700 transition-colors border border-slate-700"
                                    >
                                        <ExternalLink className="w-3.5 h-3.5" />
                                        Discord Permissions Help
                                    </a>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </motion.div>
        </AnimatePresence>
    );
};
