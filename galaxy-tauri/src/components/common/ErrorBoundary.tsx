import React from 'react';
import { AlertTriangle, RotateCcw, RefreshCw } from 'lucide-react';
import { useConverterStore } from '../../store/useConverterStore';
import { TRANSLATIONS } from '../../i18n/translations';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Top-level React error boundary preventing white-screen crashes with bilingual recovery UI.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('Studio UI ErrorBoundary caught an error:', error, errorInfo);
  }

  private handleReset = (): void => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  private handleReload = (): void => {
    window.location.reload();
  };

  render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const lang = useConverterStore.getState().language;
    const t = TRANSLATIONS[lang];

    return (
      <div
        dir={lang === 'fa' ? 'rtl' : 'ltr'}
        className="h-screen w-screen flex items-center justify-center p-6 bg-[var(--canvas-bg)] text-[var(--text-primary)]"
      >
        <div className="w-full max-w-md rounded-2xl border border-rose-500/30 bg-white dark:bg-slate-900 p-6 shadow-2xl space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-600 dark:text-rose-400 shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div className="space-y-1 min-w-0">
              <h2 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                {t.errorBoundary.title}
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                {t.errorBoundary.subtitle}
              </p>
            </div>
          </div>

          {this.state.error?.message && (
            <div className="space-y-1">
              <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 block">
                {t.errorBoundary.technicalDetails}
              </span>
              <pre className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-[11px] font-mono text-rose-700 dark:text-rose-300 max-h-28 overflow-y-auto whitespace-pre-wrap break-words">
                {this.state.error.message}
              </pre>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200/80 dark:border-slate-800">
            <button
              type="button"
              onClick={this.handleReset}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus-studio"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>{t.errorBoundary.tryAgain}</span>
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-sky-600 hover:bg-sky-500 text-white shadow-md shadow-sky-600/20 transition-all focus-studio"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>{t.errorBoundary.reloadApp}</span>
            </button>
          </div>
        </div>
      </div>
    );
  }
}
