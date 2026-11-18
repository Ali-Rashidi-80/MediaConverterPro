import React from 'react';
import { clsx } from 'clsx';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'primary' | 'success' | 'warning' | 'danger' | 'neutral';
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'neutral',
  className,
}) => {
  const variantStyles = {
    primary: 'bg-sky-500/15 text-sky-600 dark:text-sky-300 border-sky-500/30',
    success: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/30',
    warning: 'bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/30',
    danger: 'bg-rose-500/15 text-rose-600 dark:text-rose-300 border-rose-500/30',
    neutral: 'bg-slate-500/15 text-slate-600 dark:text-slate-300 border-slate-500/30',
  };

  return (
    <span
      className={clsx(
        'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border font-mono tracking-tight',
        variantStyles[variant],
        className
      )}
    >
      {children}
    </span>
  );
};

