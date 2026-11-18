import React, { useState, useEffect, useCallback, useRef } from 'react';
import { clsx } from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import {
  UploadCloud,
  Plus,
  FolderPlus,
  Play,
  Trash2,
  StopCircle,
  CheckCheck,
  Sparkles,
  X,
  Loader2,
} from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow, ProgressBarStatus } from '@tauri-apps/api/window';
import { useConverterStore } from '../../store/useConverterStore';
import { useI18n } from '../../i18n/useI18n';
import { TRANSLATIONS } from '../../i18n/translations';
import { ALL_MEDIA_EXTENSIONS } from '../../constants/app';
import { DiskSpaceInfo, MediaFileInfo, MediaKind, TaskItem } from '../../types';
import { playCompletionChime } from '../../utils/audioChime';
import { isJobCancelledError, parseAppError } from '../../utils/errorParser';
import { ConfirmDialog } from '../common/ModalDialog';

interface DropZoneProps {
  isDragOver?: boolean;
  onDragOverChange?: (dragOver: boolean) => void;
}

const createJobId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `job_${crypto.randomUUID()}`;
  }
  return `job_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
};

const parseTimecode = (raw?: string): { valid: boolean; seconds: number | null } => {
  if (!raw || !raw.trim()) {
    return { valid: true, seconds: null };
  }
  const trimmed = raw.trim();
  const parts = trimmed.split(':');
  const maxSecs = 86400 * 7;

  if (parts.length === 1) {
    if (!/^\d+(\.\d+)?$/.test(parts[0])) return { valid: false, seconds: null };
    const secs = Number(parts[0]);
    if (!Number.isFinite(secs) || secs > maxSecs) return { valid: false, seconds: null };
    return { valid: true, seconds: secs };
  }
  if (parts.length === 2) {
    if (!/^\d+$/.test(parts[0]) || !/^\d+(\.\d+)?$/.test(parts[1])) {
      return { valid: false, seconds: null };
    }
    const mins = Number(parts[0]);
    const secs = Number(parts[1]);
    if (!Number.isFinite(mins) || !Number.isFinite(secs) || secs >= 60) {
      return { valid: false, seconds: null };
    }
    const total = mins * 60 + secs;
    if (!Number.isFinite(total) || total > maxSecs) return { valid: false, seconds: null };
    return { valid: true, seconds: total };
  }
  if (parts.length === 3) {
    if (!/^\d+$/.test(parts[0]) || !/^\d+$/.test(parts[1]) || !/^\d+(\.\d+)?$/.test(parts[2])) {
      return { valid: false, seconds: null };
    }
    const hrs = Number(parts[0]);
    const mins = Number(parts[1]);
    const secs = Number(parts[2]);
    if (
      !Number.isFinite(hrs) ||
      !Number.isFinite(mins) ||
      !Number.isFinite(secs) ||
      mins >= 60 ||
      secs >= 60
    ) {
      return { valid: false, seconds: null };
    }
    const total = hrs * 3600 + mins * 60 + secs;
    if (!Number.isFinite(total) || total > maxSecs) return { valid: false, seconds: null };
    return { valid: true, seconds: total };
  }
  return { valid: false, seconds: null };
};

const notifyHistoryUpdated = () => {
  useConverterStore.getState().bumpHistoryVersion();
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel('galaxy_events');
      channel.postMessage('history_updated');
      channel.close();
    }
  } catch {
    // BroadcastChannel unavailable in restricted environments
  }
};

export const DropZone: React.FC<DropZoneProps> = ({ isDragOver = false, onDragOverChange }) => {
  const { t } = useI18n();
  const [showCelebration, setShowCelebration] = useState(false);
  const [isProbing, setIsProbing] = useState(false);
  const [requeueConfirmOpen, setRequeueConfirmOpen] = useState(false);
  const [lowDiskConfirmOpen, setLowDiskConfirmOpen] = useState(false);

  const isCancelledRef = useRef(false);
  const activeWorkersRef = useRef(0);
  const queueRunIdRef = useRef(0);
  const probingCountRef = useRef(0);
  const dispatchRef = useRef<() => void>(() => {});

  const addTasks = useConverterStore((state) => state.addTasks);
  const addToast = useConverterStore((state) => state.addToast);
  const taskIds = useConverterStore((state) => state.taskIds);
  const tasksById = useConverterStore((state) => state.tasksById);
  const isProcessing = useConverterStore((state) => state.isProcessing);
  const setIsProcessing = useConverterStore((state) => state.setIsProcessing);
  const clearQueue = useConverterStore((state) => state.clearQueue);
  const clearFinishedTasks = useConverterStore((state) => state.clearFinishedTasks);
  const setTaskStatus = useConverterStore((state) => state.setTaskStatus);
  const retryTask = useConverterStore((state) => state.retryTask);
  const setQueueActions = useConverterStore((state) => state.setQueueActions);

  const hasCompleted = useConverterStore((state) =>
    state.taskIds.some((id) => state.tasksById[id]?.status === 'completed')
  );

  // Update Taskbar progress whenever tasks change
  useEffect(() => {
    if (!isProcessing || taskIds.length === 0) {
      try {
        void getCurrentWindow().setProgressBar({ status: ProgressBarStatus.None }).catch(() => {});
      } catch {
        // Non-Tauri environment
      }
      return;
    }

    const total = taskIds.length;
    let totalProgress = 0;
    for (const id of taskIds) {
      const task = tasksById[id];
      if (!task) continue;
      if (task.status === 'completed') {
        totalProgress += 100;
      } else if (task.status === 'processing') {
        totalProgress += task.progress;
      }
    }

    const overall = Math.min(100, Math.max(0, Math.round(totalProgress / total)));
    try {
      void getCurrentWindow()
        .setProgressBar({ status: ProgressBarStatus.Normal, progress: overall })
        .catch(() => {});
    } catch {
      // Non-Tauri environment
    }
  }, [isProcessing, taskIds, tasksById]);

  const processFilePaths = useCallback(
    async (rawPaths: string[], skipDirScan = false) => {
      if (rawPaths.length === 0) return;

      probingCountRef.current += 1;
      setIsProbing(true);

      try {
        const state = useConverterStore.getState();
        const {
          activeTab: currentActiveTab,
          videoSettings,
          audioSettings,
          imageSettings,
          outputDir: currentOutputDir,
          language,
        } = state;
        const localized = TRANSLATIONS[language];

        const expandedPaths: string[] = [];
        if (skipDirScan) {
          expandedPaths.push(...rawPaths);
        } else {
          for (const p of rawPaths) {
            try {
              const scanned: string[] = await invoke('scan_directory', { dirPath: p });
              if (Array.isArray(scanned)) {
                expandedPaths.push(...scanned);
                continue;
              }
            } catch {
              // Path is a file or inaccessible directory; attempt direct file probe
            }
            expandedPaths.push(p);
          }
        }

        const uniquePaths = Array.from(new Set(expandedPaths));
        if (uniquePaths.length === 0) return;

        const newTasks: TaskItem[] = [];
        let failedCount = 0;

        // Probe in bounded chunks to keep UI responsive on large folder drops
        const CHUNK_SIZE = 16;
        for (let i = 0; i < uniquePaths.length; i += CHUNK_SIZE) {
          const chunk = uniquePaths.slice(i, i + CHUNK_SIZE);
          const probed = await Promise.all(
            chunk.map(async (p): Promise<TaskItem | null> => {
              try {
                const info: MediaFileInfo = await invoke('probe_media_file', { path: p });
                const id = createJobId();

                // If user is on the Audio panel and drops video or audio, treat as audio extraction/conversion
                const mediaKind: MediaKind =
                  currentActiveTab === 'audio' && (info.kind === 'video' || info.kind === 'audio')
                    ? 'audio'
                    : currentActiveTab === 'image' && info.kind === 'image'
                    ? 'image'
                    : info.kind;

                const rawTargetFormat =
                  mediaKind === 'video'
                    ? videoSettings.format
                    : mediaKind === 'audio'
                    ? audioSettings.format
                    : imageSettings.format;

                const targetFormat =
                  mediaKind === 'image' && rawTargetFormat.toLowerCase() === 'jpg'
                    ? 'jpeg'
                    : rawTargetFormat;

                const item: TaskItem = {
                  id,
                  filePath: info.path,
                  fileName: info.filename,
                  fileSize: info.size_bytes,
                  durationSec: info.duration_secs,
                  mediaKind,
                  targetFormat,
                  progress: 0,
                  fps: 0,
                  speed: 0,
                  etaSeconds: 0,
                  status: 'queued',
                  width: info.width,
                  height: info.height,
                  videoCodec: info.video_codec,
                  audioCodec: info.audio_codec,
                  videoSettings:
                    mediaKind === 'video'
                      ? {
                          ...videoSettings,
                          output_dir: currentOutputDir,
                          source_audio_codec: info.audio_codec,
                        }
                      : undefined,
                  audioSettings:
                    mediaKind === 'audio'
                      ? { ...audioSettings, output_dir: currentOutputDir }
                      : undefined,
                  imageSettings:
                    mediaKind === 'image'
                      ? { ...imageSettings, format: targetFormat, output_dir: currentOutputDir }
                      : undefined,
                };
                return item;
              } catch (err) {
                console.error('Failed to probe file:', p, err);
                failedCount += 1;
                return null;
              }
            })
          );

          for (const task of probed) {
            if (task) newTasks.push(task);
          }
        }

        if (newTasks.length > 0) {
          addTasks(newTasks);
          if (useConverterStore.getState().isProcessing) {
            setTimeout(() => {
              dispatchRef.current();
            }, 0);
          }
        }

        if (failedCount > 0) {
          addToast({
            type: 'warning',
            title: localized.toasts.probeError,
            message: `${failedCount} ${localized.queue.probeFailedCount}`,
          });
        }
      } finally {
        probingCountRef.current = Math.max(0, probingCountRef.current - 1);
        setIsProbing(probingCountRef.current > 0);
      }
    },
    [addTasks, addToast]
  );

  useEffect(() => {
    let cancelled = false;
    let unlistenPromise: Promise<() => void> | null = null;

    try {
      unlistenPromise = getCurrentWindow().onDragDropEvent(async (event) => {
        if (cancelled) return;
        if (event.payload.type === 'enter' || event.payload.type === 'over') {
          onDragOverChange?.(true);
        } else if (event.payload.type === 'drop') {
          onDragOverChange?.(false);
          const paths = event.payload.paths;
          if (paths && paths.length > 0) {
            await processFilePaths(paths, false);
          }
        } else {
          onDragOverChange?.(false);
        }
      });
    } catch (e) {
      console.warn('Native drag-drop listener could not be registered:', e);
    }

    return () => {
      cancelled = true;
      onDragOverChange?.(false);
      if (unlistenPromise) {
        unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
      }
    };
  }, [processFilePaths, onDragOverChange]);

  const handleSelectFiles = useCallback(async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [
          {
            name: 'Media Files',
            extensions: [...ALL_MEDIA_EXTENSIONS],
          },
        ],
      });

      if (selected && Array.isArray(selected) && selected.length > 0) {
        await processFilePaths(selected, true);
      } else if (selected && typeof selected === 'string') {
        await processFilePaths([selected], true);
      }
    } catch (e) {
      const lang = useConverterStore.getState().language;
      addToast({
        type: 'error',
        title: TRANSLATIONS[lang].toasts.probeError,
        message: parseAppError(e, lang),
      });
    }
  }, [processFilePaths, addToast]);

  const handleSelectFolder = useCallback(async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
      });

      if (selected && typeof selected === 'string') {
        probingCountRef.current += 1;
        setIsProbing(true);
        try {
          const filePaths: string[] = await invoke('scan_directory', { dirPath: selected });
          if (filePaths.length > 0) {
            await processFilePaths(filePaths, true);
          }
        } finally {
          probingCountRef.current = Math.max(0, probingCountRef.current - 1);
          setIsProbing(probingCountRef.current > 0);
        }
      }
    } catch (e) {
      const lang = useConverterStore.getState().language;
      addToast({
        type: 'error',
        title: TRANSLATIONS[lang].toasts.probeError,
        message: parseAppError(e, lang),
      });
    }
  }, [processFilePaths, addToast]);

  const dispatchWorkers = useCallback(() => {
    if (isCancelledRef.current) return;

    const currentRunId = queueRunIdRef.current;
    const {
      maxParallelJobs,
      parallelMode,
      hardwareProfile: currentHw,
    } = useConverterStore.getState();

    const maxConcurrency =
      parallelMode === 'sequential'
        ? 1
        : maxParallelJobs > 0
        ? maxParallelJobs
        : Math.max(4, currentHw?.cpu_count || 4);

    const availableSlots = maxConcurrency - activeWorkersRef.current;
    if (availableSlots <= 0) return;

    for (let i = 0; i < availableSlots; i++) {
      const { taskIds: currentIds, tasksById: currentMap } = useConverterStore.getState();
      const nextId = currentIds.find((id) => currentMap[id]?.status === 'queued');
      if (!nextId) break;

      activeWorkersRef.current++;
      setTaskStatus(nextId, 'processing');

      (async (jobId: string, runId: number) => {
        try {
          const state = useConverterStore.getState();
          const currentTask = state.tasksById[jobId];
          if (!currentTask || isCancelledRef.current || queueRunIdRef.current !== runId) {
            return;
          }

          let outputPath = '';
          const currentOutputDir = state.outputDir;

          if (currentTask.mediaKind === 'video') {
            const s = {
              ...(currentTask.videoSettings || state.videoSettings),
              output_dir: currentOutputDir,
            };
            outputPath = await invoke('start_video_conversion', {
              inputPath: currentTask.filePath,
              settings: s,
              jobId: currentTask.id,
            });
          } else if (currentTask.mediaKind === 'audio') {
            const s = {
              ...(currentTask.audioSettings || state.audioSettings),
              output_dir: currentOutputDir,
            };
            outputPath = await invoke('start_audio_conversion', {
              inputPath: currentTask.filePath,
              settings: s,
              jobId: currentTask.id,
            });
          } else {
            const s = {
              ...(currentTask.imageSettings || state.imageSettings),
              output_dir: currentOutputDir,
            };
            outputPath = await invoke('start_image_conversion', {
              inputPath: currentTask.filePath,
              settings: s,
              jobId: currentTask.id,
            });
          }

          const latestStatus = useConverterStore.getState().tasksById[jobId]?.status;
          if (
            isCancelledRef.current ||
            queueRunIdRef.current !== runId ||
            latestStatus === 'cancelled'
          ) {
            setTaskStatus(jobId, 'cancelled');
          } else {
            let outputSize: number | undefined;
            try {
              const outProbe: MediaFileInfo = await invoke('probe_media_file', {
                path: outputPath,
              });
              outputSize = outProbe.size_bytes;
            } catch (probeErr) {
              console.warn('Completed output metadata check failed:', outputPath, probeErr);
            }
            setTaskStatus(jobId, 'completed', outputPath, undefined, outputSize);
            notifyHistoryUpdated();
          }
        } catch (err: unknown) {
          if (
            isJobCancelledError(err) ||
            isCancelledRef.current ||
            queueRunIdRef.current !== runId
          ) {
            setTaskStatus(jobId, 'cancelled');
          } else {
            const lang = useConverterStore.getState().language;
            const parsedMessage = parseAppError(err, lang);
            const failedTask = useConverterStore.getState().tasksById[jobId];
            setTaskStatus(jobId, 'failed', undefined, parsedMessage);
            notifyHistoryUpdated();
            addToast({
              type: 'error',
              title: TRANSLATIONS[lang].toasts.conversionFailed,
              message: failedTask ? `${failedTask.fileName}: ${parsedMessage}` : parsedMessage,
            });
          }
        } finally {
          activeWorkersRef.current = Math.max(0, activeWorkersRef.current - 1);
          if (queueRunIdRef.current === runId) {
            if (isCancelledRef.current) {
              if (activeWorkersRef.current === 0) {
                setIsProcessing(false);
                invoke('set_sleep_prevention', { enable: false }).catch(() => {});
              }
            } else {
              const latestState = useConverterStore.getState();
              const hasQueued = latestState.taskIds.some(
                (id) => latestState.tasksById[id]?.status === 'queued'
              );
              if (hasQueued) {
                dispatchRef.current();
              } else if (activeWorkersRef.current === 0) {
                setIsProcessing(false);
                invoke('set_sleep_prevention', { enable: false }).catch(() => {});
                if (latestState.soundNotifications) {
                  playCompletionChime();
                }
                setShowCelebration(true);
              }
            }
          }
        }
      })(nextId, currentRunId);
    }
  }, [setIsProcessing, setTaskStatus, addToast]);

  useEffect(() => {
    dispatchRef.current = dispatchWorkers;
  }, [dispatchWorkers]);

  const validateQueuedTrims = useCallback((): boolean => {
    const state = useConverterStore.getState();
    const localized = TRANSLATIONS[state.language];

    for (const id of state.taskIds) {
      const task = state.tasksById[id];
      if (!task || task.status !== 'queued') continue;

      if (task.mediaKind === 'video' || task.mediaKind === 'audio') {
        const trimStart =
          task.mediaKind === 'video'
            ? (task.videoSettings ?? state.videoSettings).trim_start
            : (task.audioSettings ?? state.audioSettings).trim_start;
        const trimEnd =
          task.mediaKind === 'video'
            ? (task.videoSettings ?? state.videoSettings).trim_end
            : (task.audioSettings ?? state.audioSettings).trim_end;

        const parsedStart = parseTimecode(trimStart);
        const parsedEnd = parseTimecode(trimEnd);

        if (!parsedStart.valid || !parsedEnd.valid) {
          addToast({
            type: 'error',
            title: localized.errors.validation,
            message: `${task.fileName}: ${localized.validation.trimSyntaxError}`,
          });
          return false;
        }

        if (
          parsedStart.seconds !== null &&
          parsedEnd.seconds !== null &&
          parsedStart.seconds >= parsedEnd.seconds
        ) {
          addToast({
            type: 'error',
            title: localized.errors.validation,
            message: `${task.fileName}: ${localized.validation.trimOrderError}`,
          });
          return false;
        }
      }
    }

    return true;
  }, [addToast]);

  const actuallyStartProcessing = useCallback(async () => {
    isCancelledRef.current = false;
    queueRunIdRef.current += 1;

    if (useConverterStore.getState().sleepPrevention) {
      try {
        await invoke('set_sleep_prevention', { enable: true });
      } catch {
        // Sleep prevention unavailable
      }
    }

    setShowCelebration(false);
    setIsProcessing(true);
    dispatchWorkers();
  }, [setIsProcessing, dispatchWorkers]);

  const checkDiskAndStart = useCallback(async () => {
    const state = useConverterStore.getState();
    const queuedTasks = state.taskIds
      .map((id) => state.tasksById[id])
      .filter((task): task is TaskItem => Boolean(task) && task.status === 'queued');

    if (queuedTasks.length === 0) return;

    if (!validateQueuedTrims()) {
      return;
    }

    const estimatedBytes = queuedTasks.reduce((sum, task) => sum + (task.fileSize || 0), 0);

    try {
      const outDir = state.outputDir || '';
      const space = await invoke<DiskSpaceInfo>('check_disk_space', {
        targetPath: outDir,
        estimatedBytes,
      });
      if (space && space.is_low) {
        setLowDiskConfirmOpen(true);
        return;
      }
    } catch (e) {
      console.warn('Pre-render disk space check error:', e);
    }

    await actuallyStartProcessing();
  }, [validateQueuedTrims, actuallyStartProcessing]);

  const handleStartQueue = useCallback(async () => {
    if (isProcessing) {
      isCancelledRef.current = true;
      queueRunIdRef.current += 1;
      try {
        await invoke('cancel_all_jobs');
        await invoke('set_sleep_prevention', { enable: false });
      } catch (e) {
        console.error(e);
      }

      const currentState = useConverterStore.getState();
      for (const id of currentState.taskIds) {
        if (currentState.tasksById[id]?.status === 'processing') {
          setTaskStatus(id, 'cancelled');
        }
      }
      setIsProcessing(false);
      return;
    }

    const { taskIds: currentTaskIds, tasksById: currentTasks } = useConverterStore.getState();
    if (currentTaskIds.length === 0) return;

    let hasQueued = false;
    let hasFailedOrCancelled = false;
    let hasCompleted = false;

    for (const id of currentTaskIds) {
      const status = currentTasks[id]?.status;
      if (status === 'queued') hasQueued = true;
      else if (status === 'failed' || status === 'cancelled') hasFailedOrCancelled = true;
      else if (status === 'completed') hasCompleted = true;
    }

    // If ALL tasks are already completed, ask before re-running to avoid duplicating outputs
    if (!hasQueued && !hasFailedOrCancelled && hasCompleted) {
      setRequeueConfirmOpen(true);
      return;
    }

    // Re-queue only failed/cancelled tasks (preserve completed outputs)
    if (hasFailedOrCancelled) {
      for (const id of currentTaskIds) {
        const status = currentTasks[id]?.status;
        if (status === 'failed' || status === 'cancelled') {
          retryTask(id, false);
        }
      }
    }

    await checkDiskAndStart();
  }, [isProcessing, setIsProcessing, setTaskStatus, retryTask, checkDiskAndStart]);

  const handleConfirmRequeueCompleted = useCallback(async () => {
    setRequeueConfirmOpen(false);
    const { taskIds: currentTaskIds } = useConverterStore.getState();
    for (const id of currentTaskIds) {
      retryTask(id, false);
    }
    await checkDiskAndStart();
  }, [retryTask, checkDiskAndStart]);

  const handleConfirmLowDisk = useCallback(async () => {
    setLowDiskConfirmOpen(false);
    await actuallyStartProcessing();
  }, [actuallyStartProcessing]);

  // Wire keyboard shortcuts
  useEffect(() => {
    setQueueActions({
      addFiles: handleSelectFiles,
      addFolder: handleSelectFolder,
      startQueue: handleStartQueue,
      dispatch: () => dispatchRef.current(),
    });
    return () => {
      setQueueActions(null);
    };
  }, [setQueueActions, handleSelectFiles, handleSelectFolder, handleStartQueue]);

  return (
    <div className="space-y-3 relative">
      {/* Probing Files Loading Banner */}
      <AnimatePresence>
        {isProbing && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            role="status"
            aria-live="polite"
            className="px-3.5 py-2 rounded-xl bg-sky-500/12 border border-sky-500/30 text-sky-700 dark:text-sky-300 flex items-center gap-2.5 text-xs font-medium"
          >
            <Loader2 className="w-4 h-4 text-sky-600 dark:text-sky-400 animate-spin shrink-0" />
            <span>{t.queue.probingFiles}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Celebration Notification Banner */}
      <AnimatePresence>
        {showCelebration && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            role="status"
            className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 flex items-center justify-between text-xs font-medium"
          >
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>{t.queue.completedCelebration}</span>
            </div>
            <button
              type="button"
              onClick={() => setShowCelebration(false)}
              aria-label={t.actions.close}
              title={t.actions.close}
              className="p-1 hover:bg-emerald-500/20 rounded transition-colors text-emerald-600 dark:text-emerald-400 focus-studio"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Action Bar */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSelectFiles}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium border border-[var(--border-subtle)] bg-[var(--surface-card)] hover:bg-[var(--surface-card-hover)] text-[var(--text-primary)] transition-all shadow-sm focus-studio"
          >
            <Plus className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
            <span>{t.actions.addFiles}</span>
          </button>

          <button
            type="button"
            onClick={handleSelectFolder}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium border border-[var(--border-subtle)] bg-[var(--surface-card)] hover:bg-[var(--surface-card-hover)] text-[var(--text-primary)] transition-all shadow-sm focus-studio"
          >
            <FolderPlus className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
            <span>{t.actions.addFolder}</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          {hasCompleted && (
            <button
              type="button"
              onClick={clearFinishedTasks}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] hover:bg-emerald-500/10 text-[var(--text-muted)] hover:text-emerald-600 dark:hover:text-emerald-400 transition-all text-xs focus-studio"
              title={t.actions.clearCompleted}
              aria-label={t.actions.clearCompleted}
            >
              <CheckCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span className="hidden sm:inline text-[11px] font-medium">
                {t.actions.clearCompleted}
              </span>
            </button>
          )}

          {taskIds.length > 0 && (
            <button
              type="button"
              onClick={clearQueue}
              disabled={isProcessing}
              className="p-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] hover:bg-rose-500/10 text-[var(--text-muted)] hover:text-rose-600 dark:hover:text-rose-400 transition-all disabled:opacity-50 focus-studio"
              title={t.actions.clearQueue}
              aria-label={t.actions.clearQueue}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}

          <button
            type="button"
            onClick={handleStartQueue}
            disabled={taskIds.length === 0}
            className={clsx(
              'flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-semibold text-white shadow-lg transition-all focus-studio disabled:opacity-40 disabled:cursor-not-allowed',
              isProcessing
                ? 'bg-rose-600 hover:bg-rose-500 shadow-rose-600/20'
                : 'bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 shadow-sky-500/20'
            )}
          >
            {isProcessing ? (
              <>
                <StopCircle className="w-4 h-4" />
                <span>{t.actions.stopQueue}</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-current" />
                <span>{t.actions.startQueue}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Empty Queue Drop Callout (click to pick files; native Tauri onDragDropEvent handles drops) */}
      {taskIds.length === 0 && (
        <button
          type="button"
          onClick={handleSelectFiles}
          className={clsx(
            'w-full border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-300 focus-studio',
            isDragOver
              ? 'border-sky-500 dark:border-sky-400 bg-sky-500/10 scale-[0.99]'
              : 'border-[var(--border-subtle)] bg-[var(--surface-card)]/60 hover:bg-[var(--surface-card)] hover:border-slate-400/50 dark:hover:border-slate-500/40'
          )}
        >
          <div className="w-12 h-12 rounded-2xl bg-sky-500/10 text-sky-600 dark:text-sky-400 flex items-center justify-center mb-3">
            <UploadCloud className="w-6 h-6" />
          </div>
          <h3 className="font-semibold text-sm text-[var(--text-primary)] mb-1">
            {t.dropzone.title}
          </h3>
          <p className="text-xs text-[var(--text-muted)] max-w-sm mb-3">{t.dropzone.subtitle}</p>
          <span className="text-[11px] font-mono text-[var(--text-muted)]">
            {t.dropzone.shortcutHint}
          </span>
        </button>
      )}

      {/* Re-queue Completed Queue Confirmation */}
      <ConfirmDialog
        open={requeueConfirmOpen}
        variant="primary"
        title={t.queue.requeueCompletedTitle}
        message={t.queue.requeueCompletedMessage}
        confirmLabel={t.confirm.proceed}
        cancelLabel={t.confirm.cancel}
        onConfirm={handleConfirmRequeueCompleted}
        onCancel={() => setRequeueConfirmOpen(false)}
      />

      {/* Low Disk Space Warning Confirmation */}
      <ConfirmDialog
        open={lowDiskConfirmOpen}
        variant="warning"
        title={t.queue.lowDiskConfirmTitle}
        message={t.queue.lowDiskConfirmMessage}
        confirmLabel={t.confirm.proceed}
        cancelLabel={t.confirm.cancel}
        onConfirm={handleConfirmLowDisk}
        onCancel={() => setLowDiskConfirmOpen(false)}
      />
    </div>
  );
};
