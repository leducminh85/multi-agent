import { Component, type ReactNode } from 'react';

/**
 * Keeps one broken component from blanking the whole app: shows what failed and lets the user recover.
 * `resetKey` (e.g. the current route) clears the error on navigation.
 */
export default class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  componentDidCatch(error: Error) {
    console.error('UI error', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card mx-auto mt-10 max-w-lg p-6 text-center">
        <div className="text-lg font-semibold text-white">Something went wrong on this screen</div>
        <p className="mt-2 text-sm text-slate-400">The rest of the office keeps running. Details: {this.state.error.message}</p>
        <div className="mt-4 flex justify-center gap-2">
          <button className="btn-primary" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
          <button className="btn-outline" onClick={() => location.reload()}>
            Reload page
          </button>
        </div>
      </div>
    );
  }
}
