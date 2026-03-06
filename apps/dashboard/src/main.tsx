import { Component, StrictMode } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center p-8" style={{ backgroundColor: '#0d1117' }}>
          <div className="max-w-lg w-full bg-gray-900 border border-red-800/50 rounded-xl p-6">
            <h2 className="text-red-400 font-bold text-lg mb-2">Dashboard Error</h2>
            <p className="text-gray-400 text-sm mb-4">
              The dashboard encountered an unexpected error. Reload the page to recover.
            </p>
            <pre className="text-xs text-gray-600 bg-gray-800 rounded p-3 overflow-auto max-h-40 font-mono">
              {this.state.error.message}
            </pre>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 px-4 py-2 text-sm font-medium bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg transition-colors"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
