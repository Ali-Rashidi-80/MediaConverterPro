import React, { useEffect, useId, useRef } from 'react';
import { clsx } from 'clsx';
import { AlertTriangle, HelpCircle, X } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';

export interface ModalDialogProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  maxWidthClass?: string;
  closeOnBackdrop?: boolean;
  footer?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

/**
 * Accessible native `<dialog>` wrapper using top-layer `.showModal()` / `.close()`.
 */
export const ModalDialog: React.FC<ModalDialogProps> = ({
  open,
  onClose,
  title,
  subtitle,
  icon,
  maxWidthClass = 'max-w-lg',
  closeOnBackdrop = true,
  footer,
  className,
  children,
}) => {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else if (dialog.open) {
      dialog.close();
    }

    return () => {
      if (dialog.open) {
        dialog.close();
      }
    };
  }, [open]);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (closeOnBackdrop && e.target === dialogRef.current) {
      onClose();
    }
  };

  const handleCancel = (e: React.SyntheticEvent<HTMLDialogElement>) => {
    e.preventDefault();
    onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClick={handleBackdropClick}
      onCancel={handleCancel}
      className={clsx(
        'w-[calc(100vw-2rem)] rounded-2xl p-0 bg-transparent shadow-2xl',
        maxWidthClass
      )}
    >
      {open && (
        <div
          className={clsx(
            'w-full max-h-[85vh] flex flex-col rounded-2xl border overflow-hidden',
            'bg-white text-slate-900 border-slate-200/90',
            'dark:bg-slate-900 dark:text-slate-100 dark:border-slate-700/80',
            className
          )}
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-200/80 dark:border-slate-800 shrink-0">
            <div className="flex items-start gap-2.5 min-w-0">
              {icon && <div className="shrink-0 mt-0.5">{icon}</div>}
              <div className="min-w-0">
                <h3
                  id={titleId}
                  className="font-bold text-sm text-slate-900 dark:text-slate-100 leading-snug"
                >
                  {title}
                </h3>
                {subtitle && (
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed">
                    {subtitle}
                  </p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={t.actions.close}
              title={t.actions.close}
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800 transition-colors focus-studio shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-5 py-4 scrollbar-thin">
            {children}
          </div>

          {/* Optional Footer */}
          {footer && (
            <div className="px-5 py-3.5 border-t border-slate-200/80 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/50 shrink-0">
              {footer}
            </div>
          )}
        </div>
      )}
    </dialog>
  );
};

export interface ConfirmDialogProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title?: React.ReactNode;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'primary';
  isLoading?: boolean;
}

/**
 * Studio confirmation dialog built atop `ModalDialog` replacing native `window.confirm()`.
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  onConfirm,
  onCancel,
  title,
  message,
  confirmLabel,
  cancelLabel,
  variant = 'danger',
  isLoading = false,
}) => {
  const { t } = useI18n();

  const iconByVariant = {
    danger: (
      <div className="w-8 h-8 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-600 dark:text-rose-400">
        <AlertTriangle className="w-4 h-4" />
      </div>
    ),
    warning: (
      <div className="w-8 h-8 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-600 dark:text-amber-400">
        <AlertTriangle className="w-4 h-4" />
      </div>
    ),
    primary: (
      <div className="w-8 h-8 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-600 dark:text-sky-400">
        <HelpCircle className="w-4 h-4" />
      </div>
    ),
  };

  const confirmBtnClass = {
    danger: 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/20',
    warning: 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-amber-500/20',
    primary: 'bg-sky-600 hover:bg-sky-500 text-white shadow-sky-600/20',
  };

  return (
    <ModalDialog
      open={open}
      onClose={onCancel}
      title={title ?? t.confirm.defaultTitle}
      icon={iconByVariant[variant]}
      maxWidthClass="max-w-md"
      closeOnBackdrop={!isLoading}
      footer={
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={isLoading}
            onClick={onCancel}
            className="px-4 py-2 rounded-xl text-xs font-medium border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus-studio disabled:opacity-50"
          >
            {cancelLabel ?? t.confirm.cancel}
          </button>
          <button
            type="button"
            disabled={isLoading}
            onClick={onConfirm}
            className={clsx(
              'px-4 py-2 rounded-xl text-xs font-bold shadow-md transition-all focus-studio disabled:opacity-50',
              confirmBtnClass[variant]
            )}
          >
            {confirmLabel ?? t.confirm.confirm}
          </button>
        </div>
      }
    >
      <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">{message}</p>
    </ModalDialog>
  );
};
