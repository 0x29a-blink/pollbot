import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, AlertCircle } from 'lucide-react';

function getOAuthErrorMessage(error: string): string {
    switch (error) {
        case 'oauth_denied':
            return 'You denied access to your Discord account.';
        case 'invalid_state':
            return 'Security check failed. Please try again.';
        case 'no_code':
            return 'No authorization code received.';
        case 'token_exchange_failed':
            return 'Failed to complete authentication with Discord.';
        case 'user_fetch_failed':
            return 'Failed to retrieve your Discord profile.';
        default:
            return 'An unexpected error occurred.';
    }
}

export const AuthCallback: React.FC = () => {
    const [searchParams] = useSearchParams();
    const oauthError = useMemo(() => {
        const err = searchParams.get('error');
        return err ? getOAuthErrorMessage(err) : null;
    }, [searchParams]);

    const [verifyState, setVerifyState] = useState<'processing' | 'success' | 'error'>('processing');
    const [verifyError, setVerifyError] = useState('');
    const navigate = useNavigate();

    useEffect(() => {
        if (oauthError) {
            return;
        }

        let redirectTimer: ReturnType<typeof setTimeout> | null = null;
        let cancelled = false;

        // With httpOnly cookies, we don't get a session token in URL
        // The cookie is already set by the backend, just verify the session works
        const verifySession = async () => {
            try {
                const res = await fetch('/api/auth/me', {
                    credentials: 'include', // Send cookies
                });

                if (cancelled) return;

                if (res.ok) {
                    setVerifyState('success');
                    // Redirect to dashboard after a brief delay
                    redirectTimer = setTimeout(() => {
                        navigate('/dashboard', { replace: true });
                    }, 1500);
                } else {
                    setVerifyState('error');
                    setVerifyError('Session verification failed. Please try again.');
                }
            } catch {
                if (!cancelled) {
                    setVerifyState('error');
                    setVerifyError('Network error. Please try again.');
                }
            }
        };

        void verifySession();
        return () => {
            cancelled = true;
            if (redirectTimer) clearTimeout(redirectTimer);
        };
    }, [oauthError, navigate]);

    const status = oauthError ? 'error' : verifyState;
    const errorMessage = oauthError || verifyError;

    return (
        <div className="min-h-screen bg-ground flex items-center justify-center px-4 py-12">
            <main className="w-full max-w-[380px] panel px-6 sm:px-8 py-8" aria-live="polite">
                {status === 'processing' && (
                    <div role="status">
                        <div className="w-6 h-6 border-2 border-brand border-t-transparent rounded-full animate-spin" aria-hidden="true" />
                        <h1 className="font-[family-name:var(--font-display)] text-xl leading-7 font-semibold text-ink mt-5">Signing you in…</h1>
                        <p className="text-sm text-muted mt-1">Checking your Discord session.</p>
                    </div>
                )}

                {status === 'success' && (
                    <div>
                        <CheckCircle2 className="w-6 h-6 text-positive" aria-hidden="true" />
                        <h1 className="font-[family-name:var(--font-display)] text-xl leading-7 font-semibold text-ink mt-5">Signed in</h1>
                        <p className="text-sm text-muted mt-1">Taking you to your dashboard…</p>
                    </div>
                )}

                {status === 'error' && (
                    <div role="alert">
                        <AlertCircle className="w-6 h-6 text-negative" aria-hidden="true" />
                        <h1 className="font-[family-name:var(--font-display)] text-xl leading-7 font-semibold text-ink mt-5">Couldn&apos;t sign you in</h1>
                        <p className="text-sm text-muted mt-1">{errorMessage}</p>
                        <button
                            type="button"
                            onClick={() => navigate('/login')}
                            className="btn btn-primary mt-6"
                        >
                            Try again
                        </button>
                    </div>
                )}
            </main>
        </div>
    );
};
