import React, { useState, useEffect } from 'react';
import { AlertTriangle, X, ExternalLink } from 'lucide-react';
import type { PermissionError } from '../types';

interface PermissionErrorBannerProps {
    error: PermissionError | null;
    onDismiss: () => void;
    onRetry?: () => void;
}

const RETRY_COOLDOWN = 30; // 30 seconds cooldown

/**
 * Inline warning InfoBar shown when the bot is missing permissions to
 * interact with a poll in Discord: what failed, the missing permissions as
 * chips, how to fix it, and Retry / Dismiss.
 */
export const PermissionErrorBanner: React.FC<PermissionErrorBannerProps> = ({
    error,
    onDismiss,
    onRetry,
}) => {
    const [nowMs, setNowMs] = useState(() => Date.now());
    const [manualRetryAt, setManualRetryAt] = useState(0);

    // Tick current time while a permission error banner is visible
    useEffect(() => {
        if (!error) return;

        const initialTick = setTimeout(() => setNowMs(Date.now()), 0);
        const timer = setInterval(() => {
            setNowMs(Date.now());
        }, 1000);

        return () => {
            clearTimeout(initialTick);
            clearInterval(timer);
        };
    }, [error]);

    if (!error) return null;

    const cooldownStart = Math.max(error.timestamp, manualRetryAt);
    const cooldownEnd = cooldownStart + RETRY_COOLDOWN * 1000;
    const cooldownRemaining = Math.max(0, Math.ceil((cooldownEnd - nowMs) / 1000));

    return (
        <div role="alert" className="mb-6 rounded-card border border-[#5a4a2a] bg-warning-soft">
            <div className="flex items-start gap-3 pl-4 pr-2 py-3">
                <AlertTriangle className="w-4 h-4 mt-0.5 text-warning shrink-0" aria-hidden="true" />

                <div className="flex-1 min-w-0">
                    <p className="text-sm text-ink">
                        <span className="font-semibold">PollBot is missing permissions.</span>{' '}
                        <span className="text-muted">
                            It couldn&apos;t update &ldquo;{error.pollTitle}&rdquo; because it lacks these permissions in that channel:
                        </span>
                    </p>

                    <ul className="flex flex-wrap gap-1.5 mt-2" aria-label="Missing permissions">
                        {error.missingPermissions.map((perm) => (
                            <li key={perm} className="chip bg-black/30 text-ink">{perm}</li>
                        ))}
                    </ul>

                    <details className="mt-2 group">
                        <summary className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
                            <span className="underline underline-offset-2 decoration-[#6a6a6a]">How to fix it</span>
                        </summary>
                        <ol className="mt-2 ml-4 list-decimal space-y-1 text-[13px] text-muted marker:text-faint">
                            <li>In Discord, open <span className="text-ink">Server Settings → Roles</span>.</li>
                            <li>Find the <span className="text-ink">Poll Bot</span> role (or the bot&apos;s integration role).</li>
                            <li>Give it the permissions above, server-wide or on the channel this poll is in.</li>
                            <li className="text-faint">Also check the channel&apos;s permission overwrites: the bot role may be denied there even with server-wide permissions.</li>
                        </ol>
                    </details>

                    <div className="flex flex-wrap items-center gap-2 mt-3">
                        {onRetry && (
                            <button
                                type="button"
                                onClick={() => {
                                    if (cooldownRemaining <= 0) {
                                        const now = Date.now();
                                        setNowMs(now);
                                        setManualRetryAt(now);
                                        onRetry();
                                    }
                                }}
                                disabled={cooldownRemaining > 0}
                                className="btn btn-outline btn-sm"
                            >
                                {cooldownRemaining > 0 ? <span className="num">Retry in {cooldownRemaining}s</span> : 'Retry'}
                            </button>
                        )}
                        <a
                            href="https://support.discord.com/hc/en-us/articles/206029707-Setting-Up-Permissions-FAQ"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-ghost btn-sm"
                        >
                            Discord permissions help
                            <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                        </a>
                    </div>
                </div>

                <button type="button" onClick={onDismiss} aria-label="Dismiss" className="btn btn-ghost btn-sm btn-icon shrink-0">
                    <X className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
};
