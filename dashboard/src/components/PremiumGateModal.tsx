import React, { useState } from 'react';
import { ExternalLink, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { Modal } from './ui/Modal';

const DEFAULT_FORGE_VOTE_URL = 'https://discordforge.org/bot/911731627498041374#vote';

interface PremiumGateModalProps {
    isOpen: boolean;
    onClose: () => void;
    voteUrl: string;
    secondaryVoteUrl?: string;
    onRefresh: () => Promise<boolean>; // Returns true if now premium
    /** Name of the gated feature (defaults preserve the original voter-breakdown copy). */
    featureName?: string;
}

export const PremiumGateModal: React.FC<PremiumGateModalProps> = ({
    isOpen,
    onClose,
    voteUrl,
    secondaryVoteUrl = DEFAULT_FORGE_VOTE_URL,
    onRefresh,
    featureName = 'Voter Breakdown',
}) => {
    const [checking, setChecking] = useState(false);
    const [checkResult, setCheckResult] = useState<'success' | 'failed' | null>(null);

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

    return (
        <Modal
            open={isOpen}
            onClose={onClose}
            title="Unlock with a vote"
            width="max-w-md"
            footer={
                <>
                    <button type="button" onClick={handleIVoted} disabled={checking} className="btn btn-ghost mr-auto">
                        {checking ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                                Checking…
                            </>
                        ) : (
                            'I\u2019ve voted \u2014 check again'
                        )}
                    </button>
                    {secondaryVoteUrl && (
                        <a href={secondaryVoteUrl} target="_blank" rel="noopener noreferrer" className="btn btn-outline">
                            DiscordForge (+12h)
                            <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                        </a>
                    )}
                    <a href={voteUrl} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
                        Vote on top.gg
                        <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                    </a>
                </>
            }
        >
            <p className="text-sm text-muted">
                <span className="text-ink font-medium">{featureName}</span> is a premium feature. Vote for Simple Poll Bot on top.gg
                to unlock it for <span className="text-ink">12 hours</span>.
            </p>
            <p className="mt-2.5 text-sm text-muted">
                Want extra time? Vote on DiscordForge too — voting on both lists <span className="text-ink">stacks your time</span> (+12 hours per vote).
            </p>

            <div aria-live="polite">
                {checkResult === 'success' && (
                    <p className="mt-4 flex items-center gap-2 text-sm text-ink">
                        <CheckCircle2 className="w-4 h-4 text-positive shrink-0" aria-hidden="true" />
                        Premium unlocked. Opening it now…
                    </p>
                )}
                {checkResult === 'failed' && (
                    <p className="mt-4 flex items-center gap-2 text-sm text-ink">
                        <AlertCircle className="w-4 h-4 text-negative shrink-0" aria-hidden="true" />
                        Vote not detected yet. Webhooks can take up to a minute; try again shortly.
                    </p>
                )}
            </div>
        </Modal>
    );
};
