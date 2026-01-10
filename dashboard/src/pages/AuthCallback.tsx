import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, CheckCircle, XCircle } from 'lucide-react';
import { motion } from 'framer-motion';

export const AuthCallback: React.FC = () => {
    const [searchParams] = useSearchParams();
    const [status, setStatus] = useState<'processing' | 'success' | 'error'>('processing');
    const [errorMessage, setErrorMessage] = useState('');
    const navigate = useNavigate();

    useEffect(() => {
        const session = searchParams.get('session');
        const error = searchParams.get('error');

        if (error) {
            setStatus('error');
            switch (error) {
                case 'oauth_denied':
                    setErrorMessage('You denied access to your Discord account.');
                    break;
                case 'invalid_state':
                    setErrorMessage('Security check failed. Please try again.');
                    break;
                case 'no_code':
                    setErrorMessage('No authorization code received.');
                    break;
                case 'token_exchange_failed':
                    setErrorMessage('Failed to complete authentication with Discord.');
                    break;
                case 'user_fetch_failed':
                    setErrorMessage('Failed to retrieve your Discord profile.');
                    break;
                default:
                    setErrorMessage('An unexpected error occurred.');
            }
            return;
        }

        if (session) {
            // Store the session token
            localStorage.setItem('dashboard_session', session);
            setStatus('success');

            // Redirect to dashboard after a brief delay
            setTimeout(() => {
                navigate('/dashboard', { replace: true });
            }, 1500);
        } else {
            setStatus('error');
            setErrorMessage('No session token received.');
        }
    }, [searchParams, navigate]);

    return (
        <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-indigo-900/20 via-slate-900/50 to-slate-950 -z-10" />

            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5 }}
                className="glass-panel p-8 w-full max-w-md mx-4 text-center"
            >
                {status === 'processing' && (
                    <>
                        <Loader2 className="w-16 h-16 text-indigo-400 animate-spin mx-auto mb-4" />
                        <h1 className="text-2xl font-bold text-white">Signing you in...</h1>
                        <p className="text-gray-400 mt-2">Please wait while we complete authentication.</p>
                    </>
                )}

                {status === 'success' && (
                    <>
                        <CheckCircle className="w-16 h-16 text-emerald-400 mx-auto mb-4" />
                        <h1 className="text-2xl font-bold text-white">Welcome!</h1>
                        <p className="text-gray-400 mt-2">Redirecting to dashboard...</p>
                    </>
                )}

                {status === 'error' && (
                    <>
                        <XCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
                        <h1 className="text-2xl font-bold text-white">Authentication Failed</h1>
                        <p className="text-red-400 mt-2">{errorMessage}</p>
                        <button
                            onClick={() => navigate('/login')}
                            className="mt-6 btn-primary"
                        >
                            Try Again
                        </button>
                    </>
                )}
            </motion.div>
        </div>
    );
};
