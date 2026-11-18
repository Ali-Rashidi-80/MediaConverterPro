import React, { useState } from 'react';
import { clsx } from 'clsx';
import { Image as ImageIcon, Sliders, Link2, Unlink } from 'lucide-react';
import { useConverterStore } from '../../store/useConverterStore';
import { useI18n } from '../../i18n/useI18n';
import { SUPPORTED_IMAGE_FORMATS } from '../../constants/app';
import { GlassCard } from '../common/GlassCard';
import { BdiText } from '../common/BdiText';

export const ImagePanel: React.FC = () => {
  const { t } = useI18n();
  const imageSettings = useConverterStore((state) => state.imageSettings);
  const setImageSettings = useConverterStore((state) => state.setImageSettings);
  const [isRatioLocked, setIsRatioLocked] = useState(true);

  const parseDimension = (valStr: string): number | undefined => {
    const trimmed = valStr.trim();
    if (!trimmed) return undefined;
    const parsed = parseInt(trimmed, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
    return parsed;
  };

  const handleWidthChange = (valStr: string) => {
    const w = parseDimension(valStr);
    if (isRatioLocked) {
      // Clear height so backend preserves each source image's original aspect ratio automatically
      setImageSettings({ resize_width: w, resize_height: undefined });
    } else {
      setImageSettings({ resize_width: w });
    }
  };

  const handleHeightChange = (valStr: string) => {
    const h = parseDimension(valStr);
    if (isRatioLocked) {
      // Clear width so backend preserves each source image's original aspect ratio automatically
      setImageSettings({ resize_height: h, resize_width: undefined });
    } else {
      setImageSettings({ resize_height: h });
    }
  };

  const handleToggleLock = () => {
    const nextLocked = !isRatioLocked;
    setIsRatioLocked(nextLocked);
    if (nextLocked && imageSettings.resize_width && imageSettings.resize_height) {
      setImageSettings({ resize_height: undefined });
    }
  };

  const supportsQuality = ['webp', 'avif', 'jpeg', 'jpg'].includes(
    imageSettings.format.toLowerCase()
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2 px-1">
        <ImageIcon className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
        <h3 className="font-bold text-sm text-[var(--text-primary)]">{t.image.title}</h3>
      </div>

      <GlassCard className="p-4 space-y-4">
        {/* Format Selector */}
        <div>
          <label className="text-xs font-semibold text-[var(--text-secondary)] mb-2 block">
            {t.image.targetFormat}
          </label>
          <div className="grid grid-cols-4 gap-1.5 bg-[var(--surface-input)] p-1 rounded-xl border border-[var(--surface-input-border)]">
            {SUPPORTED_IMAGE_FORMATS.map((fmt) => (
              <button
                key={fmt}
                type="button"
                onClick={() => setImageSettings({ format: fmt })}
                className={clsx(
                  'py-1.5 text-center rounded-lg text-xs font-mono font-medium uppercase transition-all focus-studio',
                  imageSettings.format === fmt
                    ? 'bg-indigo-600 text-white font-bold shadow'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-input-hover)]'
                )}
              >
                {fmt}
              </button>
            ))}
          </div>
        </div>

        {/* Quality Slider (for webp, avif, jpeg) */}
        {supportsQuality ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-[var(--text-secondary)]">{t.image.quality}</span>
              <BdiText dir="ltr" mono className="font-bold text-indigo-600 dark:text-indigo-400">
                {imageSettings.quality}%
              </BdiText>
            </div>
            <input
              type="range"
              min="10"
              max="100"
              step="1"
              value={imageSettings.quality}
              onChange={(e) => setImageSettings({ quality: parseInt(e.target.value, 10) })}
              className="w-full accent-indigo-600 dark:accent-indigo-500 cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-[var(--text-muted)]">
              <span>{t.image.qualityLow}</span>
              <span>{t.image.qualityWeb}</span>
              <span>{t.image.qualityHigh}</span>
            </div>
          </div>
        ) : (
          <div className="p-2.5 rounded-xl bg-[var(--surface-input)] border border-[var(--surface-input-border)] text-[11px] text-[var(--text-muted)]">
            {t.image.qualityUnsupportedNote}
          </div>
        )}

        {/* Resize Inputs with Single-Axis Aspect Preservation */}
        <div className="space-y-2 pt-2 border-t border-[var(--border-subtle)]">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-[var(--text-secondary)] flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
              <span>{t.image.resize}</span>
            </label>
            <button
              type="button"
              onClick={handleToggleLock}
              title={isRatioLocked ? t.image.aspectLockTooltip : t.image.aspectUnlockTooltip}
              className={clsx(
                'px-2 py-0.5 rounded-md text-[10px] flex items-center gap-1 border transition-colors focus-studio',
                isRatioLocked
                  ? 'bg-indigo-500/15 border-indigo-500/30 text-indigo-600 dark:text-indigo-400 font-medium'
                  : 'bg-[var(--surface-input)] border-[var(--border-subtle)] text-[var(--text-muted)]'
              )}
            >
              {isRatioLocked ? (
                <Link2 className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
              ) : (
                <Unlink className="w-3 h-3" />
              )}
              <span>{isRatioLocked ? t.image.aspectLocked : t.image.aspectUnlocked}</span>
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs font-mono">
            <div>
              <span className="text-[10px] text-[var(--text-muted)] block mb-1">{t.image.width}</span>
              <input
                type="number"
                dir="ltr"
                min={1}
                max={16384}
                placeholder={t.image.autoPlaceholder}
                value={imageSettings.resize_width || ''}
                onChange={(e) => handleWidthChange(e.target.value)}
                className="w-full p-2 rounded-xl bg-[var(--surface-input)] border border-[var(--surface-input-border)] text-[var(--text-primary)] focus-studio"
              />
            </div>
            <div>
              <span className="text-[10px] text-[var(--text-muted)] block mb-1">{t.image.height}</span>
              <input
                type="number"
                dir="ltr"
                min={1}
                max={16384}
                placeholder={t.image.autoPlaceholder}
                value={imageSettings.resize_height || ''}
                onChange={(e) => handleHeightChange(e.target.value)}
                className="w-full p-2 rounded-xl bg-[var(--surface-input)] border border-[var(--surface-input-border)] text-[var(--text-primary)] focus-studio"
              />
            </div>
          </div>
          {isRatioLocked && (
            <p className="text-[10px] text-[var(--text-muted)] leading-relaxed">
              {t.image.aspectLockHint}
            </p>
          )}
        </div>

        {/* Rotation & Transforms */}
        <div className="space-y-2 pt-2 border-t border-[var(--border-subtle)]">
          <label className="text-xs font-semibold text-[var(--text-secondary)] block">
            {t.image.rotate}
          </label>
          <div className="grid grid-cols-4 gap-1.5">
            {[
              { val: undefined, label: t.image.rotateNone, isLtr: false },
              { val: 90, label: '90° ↷', isLtr: true },
              { val: 180, label: '180° ↻', isLtr: true },
              { val: 270, label: '270° ↶', isLtr: true },
            ].map((item) => (
              <button
                key={String(item.val)}
                type="button"
                onClick={() => setImageSettings({ rotate: item.val })}
                className={clsx(
                  'py-1.5 text-center rounded-xl text-xs font-medium border transition-all focus-studio',
                  imageSettings.rotate === item.val
                    ? 'border-indigo-500/50 bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 font-bold'
                    : 'border-[var(--border-subtle)] bg-[var(--surface-input)] text-[var(--text-secondary)] hover:bg-[var(--surface-input-hover)]'
                )}
              >
                {item.isLtr ? <BdiText dir="ltr">{item.label}</BdiText> : item.label}
              </button>
            ))}
          </div>
        </div>

        {/* Flips & Grayscale */}
        <div className="space-y-2 pt-2 border-t border-[var(--border-subtle)]">
          <div className="grid grid-cols-3 gap-2">
            <label className="flex items-center gap-2 p-2 rounded-lg bg-[var(--surface-input)] border border-[var(--surface-input-border)] text-xs text-[var(--text-primary)] cursor-pointer">
              <input
                type="checkbox"
                checked={imageSettings.flip_h}
                onChange={(e) => setImageSettings({ flip_h: e.target.checked })}
                className="rounded accent-indigo-600 dark:accent-indigo-500"
              />
              <span className="truncate">{t.image.flipH}</span>
            </label>

            <label className="flex items-center gap-2 p-2 rounded-lg bg-[var(--surface-input)] border border-[var(--surface-input-border)] text-xs text-[var(--text-primary)] cursor-pointer">
              <input
                type="checkbox"
                checked={imageSettings.flip_v}
                onChange={(e) => setImageSettings({ flip_v: e.target.checked })}
                className="rounded accent-indigo-600 dark:accent-indigo-500"
              />
              <span className="truncate">{t.image.flipV}</span>
            </label>

            <label className="flex items-center gap-2 p-2 rounded-lg bg-[var(--surface-input)] border border-[var(--surface-input-border)] text-xs text-[var(--text-primary)] cursor-pointer">
              <input
                type="checkbox"
                checked={imageSettings.grayscale}
                onChange={(e) => setImageSettings({ grayscale: e.target.checked })}
                className="rounded accent-indigo-600 dark:accent-indigo-500"
              />
              <span className="truncate">{t.image.grayscale}</span>
            </label>
          </div>
        </div>

        {/* Strip Metadata */}
        <label className="flex items-center gap-2 pt-2 border-t border-[var(--border-subtle)] text-xs text-[var(--text-secondary)] cursor-pointer">
          <input
            type="checkbox"
            checked={imageSettings.strip_metadata}
            onChange={(e) => setImageSettings({ strip_metadata: e.target.checked })}
            className="rounded accent-indigo-600 dark:accent-indigo-500"
          />
          <span>{t.image.stripMeta}</span>
        </label>
      </GlassCard>
    </div>
  );
};
