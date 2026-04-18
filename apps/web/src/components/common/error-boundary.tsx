'use client';

import { Component, ReactNode } from 'react';
import { QueryClient } from '@tanstack/react-query';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onReset?: () => void;
  /** TanStack query keys to invalidate on retry */
  queryKeys?: unknown[][];
  /** QueryClient instance for invalidating queries */
  queryClient?: QueryClient;
  labels?: {
    title?: string;
    unknownError?: string;
    retry?: string;
  };
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    if (process.env.NODE_ENV === 'development') {
      console.error('Error caught by boundary:', error, errorInfo);
    }
  }

  handleReset = () => {
    // Invalidate specified queries on retry
    if (this.props.queryClient && this.props.queryKeys?.length) {
      for (const key of this.props.queryKeys) {
        this.props.queryClient.invalidateQueries({ queryKey: key });
      }
    }
    this.setState({ hasError: false, error: undefined });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex min-h-[300px] items-center justify-center p-6">
          <div className="max-w-sm w-full text-center space-y-4">
            <div className="w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
              <svg
                className="w-7 h-7 text-destructive"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"
                />
              </svg>
            </div>
            <div>
              <h3 className="text-base font-bold text-foreground">
                {this.props.labels?.title || '页面出现问题'}
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                {this.state.error?.message ||
                  this.props.labels?.unknownError ||
                  '发生了未知错误，请重试'}
              </p>
            </div>

            {process.env.NODE_ENV === 'development' && this.state.error?.stack && (
              <pre className="text-xs bg-muted p-2 rounded overflow-auto max-h-32 text-left">
                {this.state.error.stack}
              </pre>
            )}

            <button
              onClick={this.handleReset}
              className="w-full bg-primary text-primary-foreground font-bold py-3 rounded-full active:scale-[0.98] transition-all text-sm"
            >
              {this.props.labels?.retry || '重新加载'}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
