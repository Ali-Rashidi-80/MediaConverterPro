import React from 'react';
import { clsx } from 'clsx';

interface BdiTextProps extends React.HTMLAttributes<HTMLElement> {
  children: React.ReactNode;
  mono?: boolean;
  dir?: 'ltr' | 'rtl' | 'auto';
}

export const BdiText: React.FC<BdiTextProps> = ({
  children,
  mono = false,
  dir = 'auto',
  className,
  ...props
}) => {
  return (
    <bdi
      dir={dir}
      className={clsx(
        'inline-block unicode-isolate',
        mono && 'font-mono tabular-nums tracking-tight',
        className
      )}
      {...props}
    >
      {children}
    </bdi>
  );
};

