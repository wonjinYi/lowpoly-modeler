import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  public state: ErrorBoundaryState = { error: null };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('Editor runtime error', error, errorInfo);
  }

  public render(): ReactNode {
    if (this.state.error) {
      return (
        <main className="error-boundary" role="alert">
          <p className="eyebrow">EDITOR RECOVERY</p>
          <h1>Something interrupted the editor.</h1>
          <p>The local document was not sent anywhere. Reload the app to start a clean session.</p>
          <button onClick={() => window.location.reload()} type="button">
            Reload editor
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}
