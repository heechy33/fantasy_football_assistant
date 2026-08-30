import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Root-level crash guard. Before this existed, any uncaught error inside the route tree (e.g. the
 * 2026-08-29 `bridgeBaselineRef` temporal-dead-zone ReferenceError in DraftSessionProvider)
 * unmounted the whole app and left only the near-black `body` background — a silent black page
 * with zero diagnostics. This renders the error and stack on-screen instead, so a root crash is a
 * 5-second diagnosis. Deliberately minimal: it must never itself be able to throw (no context, no
 * hooks, no external styling dependencies beyond inline styles).
 */
export class RootErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the stack in the console too — the on-screen rendering is for humans who don't have
    // devtools open; the console copy keeps sourcemapped frames for the actual fix.
    console.error('Root error boundary caught:', error, info.componentStack);
  }

  render() {
    if (this.state.error == null) return this.props.children;
    return (
      <div style={{ minHeight: '100vh', padding: '2rem', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
        <h1>Something went wrong</h1>
        <p>The app crashed while rendering. The error below is what the browser reported:</p>
        <pre style={{ color: '#ff8a8a' }}>{this.state.error.message}</pre>
        <pre>{this.state.error.stack ?? '(no stack available)'}</pre>
        <button type="button" onClick={() => { this.setState({ error: null }); window.location.assign('/'); }}>
          Reload
        </button>
      </div>
    );
  }
}
