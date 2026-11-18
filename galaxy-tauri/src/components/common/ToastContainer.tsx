import React from 'react';
import { clsx } from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { ToastType, useConverterStore } from '../../store/useConverterStore';
import { useI18n } from '../../i18n/useI18n';

const TOAST_STYLES: Record<
  ToastType,
  {
    container: string;
    icon: React.ReactNode;
    accent: string;
  }
> = {
  success: {
    container:
      'bg-white/95 dark:bg-slate-900/95 border-emerald-500/40 text-slate-900 dark:text-slate-100',
    icon: <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />,
    accent: 'border-s-4 border-s-emerald-500',
  },
  error: {
    container:
      'bg-white/95 dark:bg-slate-900/95 border-rose-500/40 text-slate-900 dark:text-slate-100',
    icon: <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />,
    accent: 'border-s-4 border-s-rose-500',
  },
  warning: {
    container:
      'bg-white/95 dark:bg-slate-900/95 border-amber-500/40 text-slate-900 dark:text-slate-100',
    icon: <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />,
    accent: 'border-s-4 border-s-amber-500',
  },
  info: {
    container:
      'bg-white/95 dark:bg-slate-900/95 border-sky-500/40 text-slate-900 dark:text-slate-100',
    icon: <Info className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" />,
    accent: 'border-s-4 border-s-sky-500',
  },
};

/**
 * Global accessible toast notification stack anchored above the bottom StatusBar.
 */
export const ToastContainer: React.FC = () => {
  const { t } = useI18n();
  const toasts = useConverterStore((state) => state.toasts);
  const removeToast = useConverterStore((state) => state.removeToast);

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="fixed bottom-12 end-4 z-[60] flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)] pointer-events-none"
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => {
          const style = TOAST_STYLES[toast.type];
          return (
            <motion.div
              key={toast.id}
              layout
              role="status"
              initial={{ opacity: 0, y: 12, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.96 }}
              transition={{ duration: 0.18 }}
              className={clsx(
                'pointer-events-auto flex items-start gap-2.5 p-3 rounded-xl border shadow-xl backdrop-blur-xl text-xs',
                style.container,
                style.accent
              )}
            >
              <div className="mt-0.5">{style.icon}</div>
              <div className="flex-1 min-w-0">
                {toast.title && (
                  <div className="font-bold text-slate-900 dark:text-slate-100 mb-0.5 leading-snug">
                    {toast.title}
                  </div>
                )}
                <div className="text-[11px] text-slate-700 dark:text-slate-300 leading-relaxed break-words whitespace-pre-line">
                  {toast.message}
                </div>
              </div>
              <button
                type="button"
                onClick={() => removeToast(toast.id)}
                aria-label={t.actions.close}
                title={t.actions.close}
                className="p-1 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-200/70 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0 focus-studio"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
};
