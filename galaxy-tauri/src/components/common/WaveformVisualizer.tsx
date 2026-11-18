import React from 'react';
import { clsx } from 'clsx';

interface WaveformVisualizerProps {
  active?: boolean;
  progress?: number;
  bars?: number;
  className?: string;
}

/**
 * Deterministic equalizer bar indicator modulated by encoding progress.
 */
export const WaveformVisualizer: React.FC<WaveformVisualizerProps> = ({
  active = false,
  progress,
  bars = 16,
  className,
}) => {
  const safeBars = Math.max(1, bars);
  const hasProgress = typeof progress === 'number' && Number.isFinite(progress);
  const clampedProgress = hasProgress ? Math.min(100, Math.max(0, progress)) : 0;
  const activeBarLimit = hasProgress ? (clampedProgress / 100) * safeBars : safeBars;

  return (
    <div
      aria-hidden="true"
      className={clsx('flex items-center gap-[3px] h-6 px-1.5', className)}
    >
      {Array.from({ length: safeBars }).map((_, idx) => {
        const position = safeBars > 1 ? idx / (safeBars - 1) : 0.5;
        // Smooth symmetric harmonic envelope deterministic for each bar index
        const baseEnvelope =
          0.42 + 0.34 * Math.sin(position * Math.PI) + 0.16 * Math.cos((idx + 1) * 1.45);
        const phaseShift = active
          ? 0.14 * Math.sin(idx * 1.15 + clampedProgress * 0.22)
          : 0;
        const rawPct = Math.round(Math.min(98, Math.max(22, (baseEnvelope + phaseShift) * 100)));
        const heightPct = active ? rawPct : Math.max(20, Math.round(rawPct * 0.55));
        const isFilled = hasProgress ? idx < activeBarLimit : active;

        return (
          <span
            key={idx}
            className={clsx(
              'w-[3px] rounded-full transition-all duration-200',
              active && isFilled
                ? 'bg-sky-600 dark:bg-sky-400'
                : active && !isFilled
                ? 'bg-slate-300 dark:bg-slate-700'
                : isFilled
                ? 'bg-emerald-600 dark:bg-emerald-400'
                : 'bg-slate-300 dark:bg-slate-600'
            )}
            style={{ height: `${heightPct}%` }}
          />
        );
      })}
    </div>
  );
};
