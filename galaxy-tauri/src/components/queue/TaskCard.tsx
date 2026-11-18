import React, { useState } from 'react';
import { clsx } from 'clsx';
import { motion } from 'motion/react';
import {
  Video,
  Music,
  Image as ImageIcon,
  CheckCircle2,
  AlertTriangle,
  X,
  Copy,
  Check,
  RotateCcw,
  Cpu,
  StopCircle,
  ArrowUp,
  FolderOpen,
  ChevronDown,
  FileAudio,
  Captions,
  Loader2,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useConverterStore } from '../../store/useConverterStore';
import { useI18n } from '../../i18n/useI18n';
import { BdiText } from '../common/BdiText';
import { Badge } from '../common/Badge';
import { WaveformVisualizer } from '../common/WaveformVisualizer';
import { STUDIO_SPRINGS } from '../../constants/motion';
import {
  SUPPORTED_AUDIO_FORMATS,
  SUPPORTED_IMAGE_FORMATS,
  SUPPORTED_VIDEO_FORMATS,
} from '../../constants/app';
import { MediaKind } from '../../types';
import { parseAppError } from '../../utils/errorParser';

interface TaskCardProps {
  id: string;
}

const AVAILABLE_FORMATS: Record<MediaKind, readonly string[]> = {
  video: SUPPORTED_VIDEO_FORMATS,
  audio: SUPPORTED_AUDIO_FORMATS,
  image: SUPPORTED_IMAGE_FORMATS,
};

export const TaskCard: React.FC<TaskCardProps> = ({ id }) => {
  const { t, language } = useI18n();
  const task = useConverterStore((state) => state.tasksById[id]);
  const removeTask = useConverterStore((state) => state.removeTask);
  const retryTask = useConverterStore((state) => state.retryTask);
  const setTaskStatus = useConverterStore((state) => state.setTaskStatus);
  const moveTaskToTop = useConverterStore((state) => state.moveTaskToTop);
  const overrideTaskFormat = useConverterStore((state) => state.overrideTaskFormat);
  const queueActions = useConverterStore((state) => state.queueActions);
  const selectedTaskIds = useConverterStore((state) => state.selectedTaskIds);
  const toggleTaskSelection = useConverterStore((state) => state.toggleTaskSelection);
  const addToast = useConverterStore((state) => state.addToast);

  const isSelected = task ? selectedTaskIds.includes(task.id) : false;
  const [showError, setShowError] = useState(false);
  const [copied, setCopied] = useState(false);
  const [extractingAudio, setExtractingAudio] = useState(false);
  const [extractingSubtitle, setExtractingSubtitle] = useState(false);

  if (!task) return null;

  const formatFileSize = (bytes: number) => {
    if (bytes <= 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  const formatDuration = (secs: number) => {
    if (isNaN(secs) || secs < 0) return '00:00';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (h > 0) {
      return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleOpenOutput = async () => {
    if (!task.outputPath) return;
    try {
      await invoke('open_output_folder', { path: task.outputPath });
    } catch (e) {
      addToast({
        type: 'error',
        title: t.actions.openFolder,
        message: parseAppError(e, language),
      });
    }
  };

  const handleRevealSource = async () => {
    if (!task.filePath) return;
    try {
      await invoke('open_output_folder', { path: task.filePath });
    } catch (e) {
      addToast({
        type: 'error',
        title: t.actions.revealInExplorer,
        message: parseAppError(e, language),
      });
    }
  };

  const handleCopyLog = async () => {
    if (!task.errorLog) return;
    try {
      await navigator.clipboard.writeText(task.errorLog);
      setCopied(true);
      addToast({ type: 'success', message: t.toasts.copySuccess });
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      addToast({
        type: 'error',
        message: parseAppError(err, language),
      });
    }
  };

  const handleCancelSingle = async () => {
    try {
      await invoke('cancel_job', { jobId: task.id });
    } catch (e) {
      console.error(e);
    }
    setTaskStatus(task.id, 'cancelled');
  };

  const handleRetrySingle = (forceCpu = false) => {
    retryTask(task.id, forceCpu);
    if (useConverterStore.getState().isProcessing) {
      queueActions?.dispatch?.();
    } else {
      queueActions?.startQueue();
    }
  };

  const handleExtractAudio = async () => {
    if (extractingAudio) return;
    setExtractingAudio(true);
    try {
      const outDir = useConverterStore.getState().outputDir || '';
      const outPath = await invoke<string>('extract_audio_stream', {
        inputPath: task.filePath,
        outputDir: outDir,
      });
      const fileName = outPath.split(/[\\/]/).pop() || outPath;
      addToast({
        type: 'success',
        title: t.streamExtraction.audioExtracted,
        message: fileName,
      });
    } catch (err) {
      const parsed = parseAppError(err, language);
      const message = parsed.includes('does not contain an audio stream')
        ? t.streamExtraction.noAudioStream
        : parsed;
      addToast({
        type: 'error',
        title: t.streamExtraction.extractAudio,
        message,
      });
    } finally {
      setExtractingAudio(false);
    }
  };

  const handleExtractSubtitle = async () => {
    if (extractingSubtitle) return;
    setExtractingSubtitle(true);
    try {
      const outDir = useConverterStore.getState().outputDir || '';
      const outPath = await invoke<string>('extract_subtitle_stream', {
        inputPath: task.filePath,
        outputDir: outDir,
      });
      const fileName = outPath.split(/[\\/]/).pop() || outPath;
      addToast({
        type: 'success',
        title: t.streamExtraction.subtitleExtracted,
        message: fileName,
      });
    } catch (err) {
      const parsed = parseAppError(err, language);
      let message = parsed;
      if (parsed.includes('does not contain any subtitle stream')) {
        message = t.streamExtraction.noSubtitleStream;
      } else if (parsed.includes('Bitmap subtitle stream')) {
        message = t.streamExtraction.bitmapSubtitleUnsupported;
      }
      addToast({
        type: 'error',
        title: t.streamExtraction.extractSubtitle,
        message,
      });
    } finally {
      setExtractingSubtitle(false);
    }
  };

  const renderIcon = () => {
    switch (task.mediaKind) {
      case 'video':
        return <Video className="w-4 h-4 text-sky-600 dark:text-sky-400" />;
      case 'audio':
        return <Music className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />;
      case 'image':
        return <ImageIcon className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />;
    }
  };

  const speedBadgeVariant = task.speed >= 2.5 ? 'success' : task.speed >= 1.0 ? 'primary' : 'warning';

  const savingsRatio =
    task.outputSize && task.fileSize > 0
      ? Math.round((1 - task.outputSize / task.fileSize) * 100)
      : null;

  const normalizedTargetFormat =
    task.mediaKind === 'image' && task.targetFormat.toLowerCase() === 'jpg'
      ? 'jpeg'
      : task.targetFormat.toLowerCase();

  return (
    <motion.div
      layout
      transition={STUDIO_SPRINGS.cardEntry}
      className={clsx(
        'relative rounded-xl border p-3.5 transition-all select-none',
        'bg-[var(--surface-card)] hover:bg-[var(--surface-card-hover)]',
        task.status === 'failed'
          ? 'border-s-4 border-rose-500 border-t-[var(--border-subtle)] border-e-[var(--border-subtle)] border-b-[var(--border-subtle)]'
          : task.status === 'cancelled'
          ? 'border-s-4 border-amber-500 border-t-[var(--border-subtle)] border-e-[var(--border-subtle)] border-b-[var(--border-subtle)]'
          : 'border-[var(--border-subtle)]'
      )}
      style={{
        boxShadow: 'var(--inner-glow), var(--card-shadow)',
      }}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        {/* Left: Checkbox, Icon & Title */}
        <div className="flex items-center gap-2.5 min-w-0">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => toggleTaskSelection(task.id)}
            aria-label={task.fileName}
            className="w-4 h-4 rounded accent-sky-500 cursor-pointer shrink-0"
          />
          <div className="w-9 h-9 rounded-lg bg-[var(--surface-input)] border border-[var(--surface-input-border)] flex items-center justify-center shrink-0">
            {renderIcon()}
          </div>
          <div className="min-w-0 flex-1">
            <h4
              className="text-xs font-semibold text-[var(--text-primary)] truncate max-w-[180px] sm:max-w-xs md:max-w-sm lg:max-w-md xl:max-w-lg"
              title={task.fileName}
            >
              <BdiText>{task.fileName}</BdiText>
            </h4>
            <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-[var(--text-muted)] mt-0.5">
              {task.outputSize !== undefined && task.outputSize > 0 ? (
                <BdiText dir="ltr" className="inline-flex items-center gap-1 font-mono">
                  <span>{formatFileSize(task.fileSize)}</span>
                  <span>→</span>
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                    {formatFileSize(task.outputSize)}
                  </span>
                </BdiText>
              ) : (
                <BdiText dir="ltr" mono>
                  {formatFileSize(task.fileSize)}
                </BdiText>
              )}

              {task.durationSec > 0 && (
                <>
                  <span>•</span>
                  <BdiText dir="ltr" mono>
                    {formatDuration(task.durationSec)}
                  </BdiText>
                </>
              )}

              {task.width && task.height && (
                <>
                  <span>•</span>
                  <BdiText dir="ltr" mono>
                    {task.width}x{task.height}
                  </BdiText>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right: Status & Actions */}
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
          {task.fallbackUsed && (
            <span title={t.queue.fallbackUsedTooltip}>
              <Badge variant="warning" className="text-[10px] py-0 px-1.5">
                {t.queue.fallbackUsedBadge}
              </Badge>
            </span>
          )}

          {task.status === 'queued' && (
            <div className="flex items-center gap-1.5">
              <Badge variant="neutral">{t.queue.queued}</Badge>
              <button
                type="button"
                onClick={() => moveTaskToTop(task.id)}
                className="p-1 text-[var(--text-muted)] hover:text-sky-600 dark:hover:text-sky-400 hover:bg-sky-500/10 rounded transition-colors focus-studio"
                title={t.actions.bumpToTop}
                aria-label={t.actions.bumpToTop}
              >
                <ArrowUp className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {task.status === 'processing' && (
            <div className="flex items-center gap-1.5">
              {task.mediaKind === 'audio' && (
                <WaveformVisualizer active progress={task.progress} bars={8} />
              )}
              {task.speed > 0 && (
                <Badge variant={speedBadgeVariant} className="tabular-nums">
                  <BdiText dir="ltr" mono>
                    {task.speed.toFixed(1)}x
                  </BdiText>
                </Badge>
              )}
              {task.fps > 0 && (
                <Badge variant="neutral" className="tabular-nums">
                  <BdiText dir="ltr" mono>
                    {Math.round(task.fps)} fps
                  </BdiText>
                </Badge>
              )}
              <button
                type="button"
                onClick={handleCancelSingle}
                className="p-1 text-[var(--text-muted)] hover:text-rose-600 dark:hover:text-rose-400 rounded transition-colors focus-studio"
                title={t.actions.cancelTask}
                aria-label={t.actions.cancelTask}
              >
                <StopCircle className="w-4 h-4" />
              </button>
            </div>
          )}

          {task.status === 'completed' && (
            <div className="flex items-center gap-1.5">
              {savingsRatio !== null && (
                <Badge
                  variant={savingsRatio >= 0 ? 'success' : 'warning'}
                  className="tabular-nums font-semibold gap-1"
                >
                  <BdiText dir="ltr">
                    {savingsRatio >= 0 ? `-${savingsRatio}%` : `+${Math.abs(savingsRatio)}%`}
                  </BdiText>
                  <span>{savingsRatio >= 0 ? t.queue.savedRatio : t.queue.largerRatio}</span>
                </Badge>
              )}
              <button
                type="button"
                onClick={handleOpenOutput}
                title={t.actions.openFolder}
                aria-label={t.actions.openFolder}
                className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 hover:underline font-medium px-2 py-0.5 rounded-md hover:bg-emerald-500/10 transition-colors focus-studio"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>{t.actions.openFolder}</span>
              </button>
            </div>
          )}

          {task.status === 'cancelled' && (
            <div className="flex items-center gap-1.5">
              <Badge variant="warning">{t.queue.cancelled}</Badge>
              <button
                type="button"
                onClick={() => handleRetrySingle(false)}
                className="p-1 text-sky-600 dark:text-sky-400 hover:bg-sky-500/10 rounded transition-colors focus-studio"
                title={t.actions.retry}
                aria-label={t.actions.retry}
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {task.status === 'failed' && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setShowError(!showError)}
                className="flex items-center gap-1 text-xs text-rose-600 dark:text-rose-400 font-medium px-1.5 py-0.5 rounded hover:bg-rose-500/10 transition-colors focus-studio"
                title={t.queue.errorDetails}
                aria-label={t.queue.errorDetails}
                aria-expanded={showError}
              >
                <AlertTriangle className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={() => handleRetrySingle(false)}
                className="p-1 text-sky-600 dark:text-sky-400 hover:bg-sky-500/10 rounded transition-colors focus-studio"
                title={t.actions.retry}
                aria-label={t.actions.retry}
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>

              {task.mediaKind === 'video' && (
                <button
                  type="button"
                  onClick={() => handleRetrySingle(true)}
                  className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400 font-medium px-1.5 py-0.5 rounded hover:bg-amber-500/10 transition-colors focus-studio"
                  title={t.actions.retryCpu}
                  aria-label={t.actions.retryCpu}
                >
                  <Cpu className="w-3.5 h-3.5" />
                  <span>CPU</span>
                </button>
              )}
            </div>
          )}

          {/* Video Stream Extraction Actions (Extract Audio & Extract Subtitles) */}
          {task.mediaKind === 'video' && task.status !== 'processing' && (
            <>
              <button
                type="button"
                onClick={handleExtractAudio}
                disabled={extractingAudio}
                title={t.streamExtraction.extractAudioTitle}
                aria-label={t.streamExtraction.extractAudio}
                className="p-1 text-[var(--text-muted)] hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-500/10 rounded transition-colors focus-studio disabled:opacity-50"
              >
                {extractingAudio ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <FileAudio className="w-3.5 h-3.5" />
                )}
              </button>
              <button
                type="button"
                onClick={handleExtractSubtitle}
                disabled={extractingSubtitle}
                title={t.streamExtraction.extractSubtitleTitle}
                aria-label={t.streamExtraction.extractSubtitle}
                className="p-1 text-[var(--text-muted)] hover:text-amber-600 dark:hover:text-amber-400 hover:bg-amber-500/10 rounded transition-colors focus-studio disabled:opacity-50"
              >
                {extractingSubtitle ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-600 dark:text-amber-400" />
                ) : (
                  <Captions className="w-3.5 h-3.5" />
                )}
              </button>
            </>
          )}

          {/* Reveal Source Button */}
          <button
            type="button"
            onClick={handleRevealSource}
            className="p-1 text-[var(--text-muted)] hover:text-sky-600 dark:hover:text-sky-400 hover:bg-[var(--surface-input)] rounded transition-colors focus-studio"
            title={t.actions.revealInExplorer}
            aria-label={t.actions.revealInExplorer}
          >
            <FolderOpen className="w-3.5 h-3.5" />
          </button>

          {task.status !== 'processing' && (
            <button
              type="button"
              onClick={() => removeTask(task.id)}
              title={t.queue.removeTaskTooltip}
              aria-label={t.queue.removeTaskTooltip}
              className="p-1 text-[var(--text-muted)] hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-500/10 rounded transition-colors focus-studio"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Progress Bar & In-place Format Selector */}
      <div className="space-y-1 mt-2">
        <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)] font-mono tabular-nums">
          <div className="flex items-center gap-1.5">
            <span>{t.queue.convertTo}</span>
            {task.status === 'queued' ? (
              <div className="relative inline-flex items-center">
                <select
                  value={normalizedTargetFormat}
                  onChange={(e) => overrideTaskFormat(task.id, e.target.value)}
                  aria-label={t.queue.changeFormat}
                  className="bg-[var(--surface-input)] border border-[var(--surface-input-border)] rounded px-1.5 py-0.5 text-xs font-semibold uppercase text-sky-600 dark:text-sky-400 cursor-pointer hover:border-sky-500/50 appearance-none pe-4 focus:outline-none focus:ring-1 focus:ring-sky-500"
                  title={t.queue.changeFormat}
                >
                  {AVAILABLE_FORMATS[task.mediaKind].map((fmt) => (
                    <option key={fmt} value={fmt}>
                      {fmt.toUpperCase()}
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-3 h-3 text-[var(--text-muted)] absolute end-1 pointer-events-none" />
              </div>
            ) : (
              <span className="font-semibold text-[var(--text-primary)] uppercase">
                {normalizedTargetFormat}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {task.status === 'processing' && task.etaSeconds > 0 && (
              <span>
                {t.queue.eta}: <BdiText dir="ltr">{formatDuration(task.etaSeconds)}</BdiText>
              </span>
            )}
            <BdiText dir="ltr" className="font-bold text-[var(--text-primary)]">
              {task.progress.toFixed(0)}%
            </BdiText>
          </div>
        </div>

        <div className="h-1.5 w-full bg-slate-200 dark:bg-slate-800/80 rounded-full overflow-hidden relative">
          <motion.div
            className={clsx(
              'h-full rounded-full transition-all duration-150',
              task.status === 'completed'
                ? 'bg-emerald-500'
                : task.status === 'failed'
                ? 'bg-rose-500'
                : task.status === 'cancelled'
                ? 'bg-amber-500'
                : 'bg-gradient-to-r from-sky-500 to-indigo-500'
            )}
            style={{ width: `${task.progress}%` }}
          />
        </div>
      </div>

      {/* Error Accordion */}
      {showError && task.errorLog && (
        <div className="mt-3 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-700 dark:text-rose-300 space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-semibold">{t.queue.errorDetails}:</span>
            <button
              type="button"
              onClick={handleCopyLog}
              aria-label={t.actions.copyLog}
              className="flex items-center gap-1 text-[11px] text-rose-600 dark:text-rose-400 hover:underline focus-studio rounded px-1"
            >
              {copied ? (
                <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
              <span>{copied ? t.actions.copied : t.actions.copyLog}</span>
            </button>
          </div>
          <pre
            dir="ltr"
            className="text-[10px] font-mono whitespace-pre-wrap max-h-24 overflow-y-auto text-[var(--text-primary)] bg-[var(--surface-input)] border border-[var(--surface-input-border)] p-2 rounded"
          >
            {task.errorLog}
          </pre>
        </div>
      )}
    </motion.div>
  );
};
