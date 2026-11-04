import { Component, type ErrorInfo, type ReactNode } from 'react';

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

            // Default error UI: calm, on the app ground, one way forward
            return (
                <div className="min-h-screen flex items-center justify-center bg-ground px-6 py-12">
                    <div className="w-full max-w-md" role="alert">
                        <h1 className="font-[family-name:var(--font-display)] text-xl leading-7 font-semibold text-ink">
                            Something went wrong
                        </h1>
                        <p className="text-sm text-muted mt-2">
                            This page hit an unexpected error and stopped. Reloading usually fixes it.
                        </p>

                        {/* Error details (dev builds only) */}
                        {import.meta.env.DEV && this.state.error && (
                            <details className="mt-5 rounded-card border border-line bg-surface">
                                <summary className="px-4 h-10 flex items-center text-[13px] text-muted cursor-pointer hover:text-ink">
                                    Error details
                                </summary>
                                <pre className="px-4 pb-4 text-xs font-mono text-negative overflow-x-auto whitespace-pre-wrap">
                                    {this.state.error.message}
                                    {'\n\n'}
                                    {this.state.error.stack}
                                </pre>
                            </details>
                        )}

                        <div className="flex items-center gap-2 mt-6">
                            <button type="button" onClick={this.handleRefresh} className="btn btn-primary">
                                Reload
                            </button>
                            <button type="button" onClick={this.handleGoHome} className="btn btn-ghost">
                                Go to home
                            </button>
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
