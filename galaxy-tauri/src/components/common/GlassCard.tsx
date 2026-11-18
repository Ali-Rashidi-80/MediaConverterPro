import React from 'react';
import { clsx } from 'clsx';
import { motion, HTMLMotionProps } from 'motion/react';

interface GlassCardProps extends HTMLMotionProps<'div'> {
  children: React.ReactNode;
  className?: string;
  hoverEffect?: boolean;
}

export const GlassCard: React.FC<GlassCardProps> = ({
  children,
  className,
  hoverEffect = false,
  ...props
}) => {
  return (
    <motion.div
      className={clsx(
        'relative rounded-2xl border transition-all duration-200 overflow-hidden',
        'bg-[var(--surface-card)] border-[var(--border-subtle)] shadow-[var(--card-shadow)]',
        hoverEffect && 'hover:bg-[var(--surface-card-hover)] hover:border-[var(--border-active)]',
        className
      )}
      style={{
        boxShadow: 'var(--inner-glow), var(--card-shadow)',
      }}
      {...props}
    >
      {children}
    </motion.div>
  );
};

