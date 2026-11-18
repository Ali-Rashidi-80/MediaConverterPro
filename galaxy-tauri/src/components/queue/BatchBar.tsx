import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Layers, Trash2, X } from 'lucide-react';
import { useConverterStore } from '../../store/useConverterStore';
import { useI18n } from '../../i18n/useI18n';
import { BdiText } from '../common/BdiText';
import {
  SUPPORTED_AUDIO_FORMATS,
  SUPPORTED_IMAGE_FORMATS,
  SUPPORTED_VIDEO_FORMATS,
} from '../../constants/app';
import { TaskItem } from '../../types';

export const BatchBar: React.FC = () => {
  const { t } = useI18n();
  const selectedTaskIds = useConverterStore((state) => state.selectedTaskIds);
  const tasksById = useConverterStore((state) => state.tasksById);
  const clearTaskSelection = useConverterStore((state) => state.clearTaskSelection);
  const batchSetFormat = useConverterStore((state) => state.batchSetFormat);
  const batchDeleteSelected = useConverterStore((state) => state.batchDeleteSelected);

  const { hasVideo, hasAudio, hasImage, hasProcessing, hasEditableSelected } = useMemo(() => {
    const selectedTasks = selectedTaskIds
      .map((id) => tasksById[id])
      .filter((task): task is TaskItem => Boolean(task));

    return {
      hasVideo: selectedTasks.some((task) => task.mediaKind === 'video'),
      hasAudio: selectedTasks.some((task) => task.mediaKind === 'audio'),
      hasImage: selectedTasks.some((task) => task.mediaKind === 'image'),
      hasProcessing: selectedTasks.some((task) => task.status === 'processing'),
      hasEditableSelected: selectedTasks.some(
        (task) =>
          task.status === 'queued' || task.status === 'failed' || task.status === 'cancelled'
      ),
    };
  }, [selectedTaskIds, tasksById]);

  const hasAnyFormatGroup = hasVideo || hasAudio || hasImage;

  return (
    <AnimatePresence>
      {selectedTaskIds.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          className="absolute bottom-4 inset-x-4 z-30 flex items-center justify-between gap-2 p-3 rounded-2xl bg-[var(--surface-mica)]/95 backdrop-blur-xl border border-sky-500/35 shadow-2xl text-xs"
        >
          {/* Selection Count */}
          <div className="flex items-center gap-2 font-semibold text-[var(--text-primary)]">
            <Layers className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" />
            <span className="flex items-center gap-1">
              <BdiText dir="ltr" mono>
                {selectedTaskIds.length}
              </BdiText>
              <span>{t.batch.selected}</span>
            </span>
          </div>

          {/* Batch Operations */}
          <div className="flex items-center gap-2">
            {/* Compatible Format Dropdown */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-[var(--text-muted)] hidden sm:inline">
                {t.batch.batchFormat}:
              </span>
              <select
                value=""
                disabled={!hasEditableSelected || !hasAnyFormatGroup}
                aria-label={t.batch.batchFormat}
                onChange={(e) => {
                  if (e.target.value) {
                    batchSetFormat(e.target.value);
                  }
                }}
                className="py-1 px-2 rounded-xl bg-[var(--surface-input)] border border-[var(--surface-input-border)] text-[var(--text-primary)] font-mono text-xs focus-studio disabled:opacity-45 disabled:cursor-not-allowed"
              >
                <option value="" disabled>
                  {t.batch.chooseFormat}
                </option>
                {hasVideo && (
                  <optgroup label={t.batch.videoFormats}>
                    {SUPPORTED_VIDEO_FORMATS.map((fmt) => (
                      <option
                        key={`video-${fmt}`}
                        value={fmt}
                        className="bg-[var(--surface-card)] text-[var(--text-primary)] uppercase"
                      >
                        {fmt.toUpperCase()}
                      </option>
                    ))}
                  </optgroup>
                )}
                {hasAudio && (
                  <optgroup label={t.batch.audioFormats}>
                    {SUPPORTED_AUDIO_FORMATS.map((fmt) => (
                      <option
                        key={`audio-${fmt}`}
                        value={fmt}
                        className="bg-[var(--surface-card)] text-[var(--text-primary)] uppercase"
                      >
                        {fmt.toUpperCase()}
                      </option>
                    ))}
                  </optgroup>
                )}
                {hasImage && (
                  <optgroup label={t.batch.imageFormats}>
                    {SUPPORTED_IMAGE_FORMATS.map((fmt) => (
                      <option
                        key={`image-${fmt}`}
                        value={fmt}
                        className="bg-[var(--surface-card)] text-[var(--text-primary)] uppercase"
                      >
                        {fmt.toUpperCase()}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>

            {/* Batch Delete (disabled while any selected task is processing) */}
            <button
              type="button"
              onClick={batchDeleteSelected}
              disabled={hasProcessing}
              title={hasProcessing ? t.batch.cannotDeleteProcessing : t.batch.batchDelete}
              aria-label={hasProcessing ? t.batch.cannotDeleteProcessing : t.batch.batchDelete}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 border border-rose-500/30 font-medium transition-all focus-studio disabled:opacity-45 disabled:cursor-not-allowed"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{t.batch.batchDelete}</span>
            </button>

            {/* Clear Selection */}
            <button
              type="button"
              onClick={clearTaskSelection}
              title={t.batch.clearSelection}
              aria-label={t.batch.clearSelection}
              className="p-1.5 rounded-xl text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-input)] transition-all focus-studio"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
