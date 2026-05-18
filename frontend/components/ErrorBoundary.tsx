'use client';

import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props {
    children: ReactNode;
    fallback?: (error: Error, reset: () => void) => ReactNode;
    label?: string;
}

interface State {
    error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
    state: State = { error: null };

    static getDerivedStateFromError(error: Error): State {
        return { error };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error(`[ErrorBoundary${this.props.label ? ` (${this.props.label})` : ''}]`, error, info.componentStack);
    }

    reset = () => this.setState({ error: null });

    render() {
        const { error } = this.state;
        if (!error) return this.props.children;

        if (this.props.fallback) return this.props.fallback(error, this.reset);

        return (
            <div className="flex flex-col items-center justify-center p-8 gap-3 text-center rounded-lg border border-destructive/40 bg-destructive/5">
                <p className="font-semibold text-destructive">
                    {this.props.label ? `${this.props.label}: ` : ''}Noget gik galt
                </p>
                <p className="text-sm text-muted-foreground">{error.message}</p>
                <button
                    onClick={this.reset}
                    className="mt-1 px-4 py-1.5 text-sm rounded bg-primary text-primary-foreground hover:opacity-90"
                >
                    Prøv igen
                </button>
            </div>
        );
    }
}
