import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
    errorInfo: ErrorInfo | null;
}

/**
 * Error Boundary component to catch JavaScript errors in child components
 * and display a fallback UI instead of crashing the entire application.
 */
export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = {
            hasError: false,
            error: null,
            errorInfo: null,
        };
    }

    static getDerivedStateFromError(error: Error): Partial<State> {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        // Log the error to console (in production, you might send this to an error tracking service)
        console.error('ErrorBoundary caught an error:', error, errorInfo);
        this.setState({ errorInfo });
    }

    handleRefresh = () => {
        window.location.reload();
    };

    handleGoHome = () => {
        window.location.href = '/';
    };

    render() {
        if (this.state.hasError) {
            // Custom fallback provided
            if (this.props.fallback) {
                return this.props.fallback;
            }

            // Default error UI
            return (
                <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4">
                    <div className="glass-panel p-8 max-w-lg w-full text-center">
                        <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-6">
                            <AlertTriangle className="w-8 h-8 text-red-400" />
                        </div>

                        <h1 className="text-2xl font-bold text-white mb-2">
                            Something went wrong
                        </h1>
                        <p className="text-slate-400 mb-6">
                            An unexpected error occurred. Please try refreshing the page.
                        </p>

                        {/* Error details (collapsible in production) */}
                        {import.meta.env.DEV && this.state.error && (
                            <details className="mb-6 text-left bg-slate-800/50 rounded-lg p-4 border border-slate-700">
                                <summary className="text-sm text-slate-400 cursor-pointer hover:text-slate-300">
                                    Error Details
                                </summary>
                                <pre className="mt-2 text-xs text-red-400 overflow-x-auto whitespace-pre-wrap">
                                    {this.state.error.message}
                                    {'\n\n'}
                                    {this.state.error.stack}
                                </pre>
                            </details>
                        )}

                        <div className="flex items-center justify-center gap-3">
                            <button
                                onClick={this.handleGoHome}
                                className="flex items-center gap-2 px-4 py-2 text-slate-400 hover:text-white transition-colors"
                            >
                                <Home className="w-4 h-4" />
                                Go Home
                            </button>
                            <button
                                onClick={this.handleRefresh}
                                className="flex items-center gap-2 px-5 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-500 transition-colors"
                            >
                                <RefreshCw className="w-4 h-4" />
                                Refresh Page
                            </button>
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
