import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { clsx } from 'clsx';
import {
  History,
  TrendingDown,
  Gauge,
  HardDrive,
  FolderOpen,
  Trash2,
  Download,
  Search,
  CheckCircle2,
  XCircle,
  FileText,
  RotateCcw,
  X,
} from 'lucide-react';
import { GlassCard } from '../common/GlassCard';
import { ConfirmDialog } from '../common/ModalDialog';
import { BdiText } from '../common/BdiText';
import { useI18n } from '../../i18n/useI18n';
import { useConverterStore } from '../../store/useConverterStore';
import { HistoryEntry, HistorySummary, MediaFileInfo, TaskItem } from '../../types';
import { parseAppError } from '../../utils/errorParser';

type StatusFilter = 'all' | 'completed' | 'failed';
type ConfirmTarget =
  | { type: 'all' }
  | { type: 'single'; entry: HistoryEntry }
  | null;

const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const idx = Math.min(sizes.length - 1, Math.max(0, Math.floor(Math.log(bytes) / Math.log(k))));
  return `${(bytes / Math.pow(k, idx)).toFixed(1)} ${sizes[idx]}`;
};

export const HistoryPanel: React.FC = () => {
  const { t, language } = useI18n();
  const historyVersion = useConverterStore((state) => state.historyVersion);
  const addTasks = useConverterStore((state) => state.addTasks);
  const addToast = useConverterStore((state) => state.addToast);

  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [summary, setSummary] = useState<HistorySummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget>(null);
  const [isConfirmBusy, setIsConfirmBusy] = useState(false);
  const [requeueingId, setRequeueingId] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    try {
      const [hist, summ] = await Promise.all([
        invoke<HistoryEntry[]>('get_conversion_history'),
        invoke<HistorySummary>('get_history_summary'),
      ]);
      setEntries([...hist].reverse());
      setSummary(summ);
    } catch (e) {
      addToast({ type: 'error', message: parseAppError(e, language) });
    } finally {
      setIsLoading(false);
    }
  }, [addToast, language]);

  useEffect(() => {
    let active = true;
    Promise.all([
      invoke<HistoryEntry[]>('get_conversion_history'),
      invoke<HistorySummary>('get_history_summary'),
    ])
      .then(([hist, summ]) => {
        if (!active) return;
        setEntries([...hist].reverse());
        setSummary(summ);
      })
      .catch((e: unknown) => {
        if (active) addToast({ type: 'error', message: parseAppError(e, language) });
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [addToast, language, historyVersion]);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel('galaxy_events');
      channel.onmessage = (event) => {
        if (
          event.data === 'history_updated' ||
          (typeof event.data === 'object' && event.data?.type === 'history_updated')
        ) {
          void fetchHistory();
        }
      };
    } catch {
      // BroadcastChannel unavailable in this environment
    }
    return () => {
      try {
        channel?.close();
      } catch {
        // Ignore close errors
      }
    };
  }, [fetchHistory]);

  const handleConfirmAction = async () => {
    if (!confirmTarget || isConfirmBusy) return;
    setIsConfirmBusy(true);
    try {
      if (confirmTarget.type === 'all') {
        await invoke('clear_conversion_history');
        setConfirmTarget(null);
        await fetchHistory();
        addToast({ type: 'success', message: t.toasts.historyCleared });
      } else {
        await invoke('delete_history_entry', { id: confirmTarget.entry.id });
        setConfirmTarget(null);
        await fetchHistory();
        addToast({ type: 'success', message: t.toasts.historyEntryDeleted });
      }
    } catch (e) {
      addToast({ type: 'error', message: parseAppError(e, language) });
    } finally {
      setIsConfirmBusy(false);
    }
  };

  const handleExportCsv = async () => {
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const target = await save({
        filters: [{ name: 'CSV File', extensions: ['csv'] }],
        defaultPath: 'galaxy_conversion_history.csv',
      });
      if (target) {
        await invoke('export_history_csv', { targetPath: target });
        addToast({ type: 'success', message: t.history.csvExported });
      }
    } catch (e) {
      addToast({ type: 'error', message: parseAppError(e, language) });
    }
  };

  const handleReveal = async (path: string) => {
    if (!path || path === '[redacted]') return;
    try {
      await invoke('open_output_folder', { path });
    } catch (e) {
      addToast({ type: 'error', message: parseAppError(e, language) });
    }
  };

  const handleRequeue = async (entry: HistoryEntry) => {
    if (!entry.input_path || entry.input_path === '[redacted]') {
      addToast({ type: 'error', message: t.history.requeueFailed });
      return;
    }

    setRequeueingId(entry.id);
    try {
      const info = await invoke<MediaFileInfo>('probe_media_file', {
        path: entry.input_path,
      });
      const state = useConverterStore.getState();
      const targetFormat =
        info.kind === 'video'
          ? state.videoSettings.format
          : info.kind === 'audio'
          ? state.audioSettings.format
          : state.imageSettings.format;

      const task: TaskItem = {
        id: `job_${crypto.randomUUID()}`,
        filePath: info.path,
        fileName: info.filename,
        fileSize: info.size_bytes,
        durationSec: info.duration_secs,
        mediaKind: info.kind,
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
          info.kind === 'video'
            ? { ...state.videoSettings, source_audio_codec: info.audio_codec }
            : undefined,
        audioSettings: info.kind === 'audio' ? { ...state.audioSettings } : undefined,
        imageSettings: info.kind === 'image' ? { ...state.imageSettings } : undefined,
      };

      addTasks([task]);
      addToast({ type: 'success', message: t.history.requeueSuccess });
    } catch (e) {
      addToast({
        type: 'error',
        title: t.history.requeueFailed,
        message: parseAppError(e, language),
      });
    } finally {
      setRequeueingId(null);
    }
  };

  const filteredEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (statusFilter !== 'all' && e.status !== statusFilter) {
        return false;
      }
      if (!q) return true;
      return e.filename.toLowerCase().includes(q) || e.format.toLowerCase().includes(q);
    });
  }, [entries, search, statusFilter]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-sky-600 dark:text-sky-400" />
          <h3 className="font-bold text-sm text-[var(--text-primary)]">{t.history.title}</h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={entries.length === 0}
            title={t.history.exportCsv}
            aria-label={t.history.exportCsv}
            className="p-1.5 rounded-lg border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-input-hover)] transition-all disabled:opacity-40 focus-studio"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setConfirmTarget({ type: 'all' })}
            disabled={entries.length === 0}
            title={t.history.clearHistory}
            aria-label={t.history.clearHistory}
            className="p-1.5 rounded-lg border border-rose-500/20 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 transition-all disabled:opacity-40 focus-studio"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* KPI Metric Cards / Initial Skeleton */}
      {isLoading ? (
        <div className="grid grid-cols-2 gap-2" aria-busy="true">
          {[0, 1, 2, 3].map((idx) => (
            <GlassCard key={idx} className="p-3 space-y-2 animate-pulse">
              <div className="h-3 w-20 rounded bg-[var(--surface-input)]" />
              <div className="h-5 w-16 rounded bg-[var(--surface-input)]" />
            </GlassCard>
          ))}
        </div>
      ) : (
        summary && (
          <div className="grid grid-cols-2 gap-2">
            <GlassCard className="p-3 space-y-1">
              <span className="text-[10px] text-[var(--text-muted)] flex items-center gap-1">
                <FileText className="w-3 h-3 text-sky-600 dark:text-sky-400" />
                <span>{t.history.totalFiles}</span>
              </span>
              <div className="font-mono font-bold text-base text-[var(--text-primary)]">
                <BdiText dir="ltr" mono>
                  {summary.total_files}
                </BdiText>
              </div>
            </GlassCard>

            <GlassCard className="p-3 space-y-1">
              <span className="text-[10px] text-[var(--text-muted)] flex items-center gap-1">
                <HardDrive className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
                <span>{t.history.totalData}</span>
              </span>
              <div className="font-mono font-bold text-base text-[var(--text-primary)]">
                <BdiText dir="ltr" mono>
                  {formatBytes(summary.total_source_bytes)}
                </BdiText>
              </div>
            </GlassCard>

            <GlassCard className="p-3 space-y-1">
              <span className="text-[10px] text-[var(--text-muted)] flex items-center gap-1">
                <TrendingDown className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                <span>{t.history.spaceSaved}</span>
              </span>
              <div className="font-mono font-bold text-base text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                <BdiText dir="ltr" mono>
                  {formatBytes(Math.max(0, summary.total_saved_bytes))}
                </BdiText>
                {summary.saved_percentage > 0 && (
                  <BdiText dir="ltr" mono className="text-xs font-normal">
                    (-{summary.saved_percentage.toFixed(0)}%)
                  </BdiText>
                )}
              </div>
            </GlassCard>

            <GlassCard className="p-3 space-y-1">
              <span className="text-[10px] text-[var(--text-muted)] flex items-center gap-1">
                <Gauge className="w-3 h-3 text-amber-700 dark:text-amber-400" />
                <span>{t.history.avgSpeed}</span>
              </span>
              <div className="font-mono font-bold text-base text-amber-700 dark:text-amber-400">
                <BdiText dir="ltr" mono>
                  {summary.avg_speed > 0 ? `${summary.avg_speed.toFixed(1)}x` : '-'}
                </BdiText>
              </div>
            </GlassCard>
          </div>
        )
      )}

      {/* Search & Status Filter Pills */}
      <div className="space-y-2">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute start-3 top-2.5 pointer-events-none" />
          <input
            type="text"
            data-search-input="true"
            placeholder={t.history.searchHistory}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full ps-8 pe-8 py-1.5 text-xs rounded-xl bg-[var(--surface-input)] border border-[var(--surface-input-border)] text-[var(--text-primary)] focus-studio"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label={t.history.clearSearch}
              title={t.history.clearSearch}
              className="absolute end-2 top-1.5 p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] focus-studio"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="grid grid-cols-3 gap-1.5 bg-[var(--surface-input)] p-1 rounded-xl border border-[var(--surface-input-border)]">
          {(
            [
              { id: 'all', label: t.history.filterAll },
              { id: 'completed', label: t.history.filterCompleted },
              { id: 'failed', label: t.history.filterFailed },
            ] as const
          ).map((pill) => (
            <button
              key={pill.id}
              type="button"
              onClick={() => setStatusFilter(pill.id)}
              className={clsx(
                'py-1 rounded-lg text-[11px] font-medium transition-all focus-studio',
                statusFilter === pill.id
                  ? 'bg-sky-600 dark:bg-sky-500 text-white font-semibold shadow-xs'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              )}
            >
              {pill.label}
            </button>
          ))}
        </div>
      </div>

      {/* History Items List */}
      <GlassCard className="p-2 space-y-1.5 max-h-[380px] overflow-y-auto scrollbar-thin">
        {isLoading ? (
          <div className="space-y-1.5" aria-busy="true">
            {[0, 1, 2].map((idx) => (
              <div
                key={idx}
                className="h-12 rounded-xl bg-[var(--surface-input)]/60 animate-pulse"
              />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center py-8 text-xs text-[var(--text-muted)]">
            {t.history.noHistory}
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className="text-center py-8 space-y-2 text-xs text-[var(--text-muted)]">
            <p>{t.history.noMatches}</p>
            {(search || statusFilter !== 'all') && (
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setStatusFilter('all');
                }}
                className="px-2.5 py-1 rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400 hover:bg-sky-500/20 text-[11px] font-medium focus-studio"
              >
                {t.history.clearSearch}
              </button>
            )}
          </div>
        ) : (
          filteredEntries.map((entry) => {
            const canRequeue = Boolean(entry.input_path && entry.input_path !== '[redacted]');
            const canReveal = Boolean(entry.output_path && entry.output_path !== '[redacted]');
            const savedPct =
              entry.source_size_bytes > entry.output_size_bytes && entry.output_size_bytes > 0
                ? Math.round(
                    ((entry.source_size_bytes - entry.output_size_bytes) /
                      entry.source_size_bytes) *
                      100
                  )
                : 0;

            return (
              <div
                key={`${entry.id}_${entry.timestamp}`}
                className="flex items-center justify-between gap-2 p-2 rounded-xl bg-[var(--surface-input)]/40 hover:bg-[var(--surface-input)] border border-[var(--surface-input-border)] transition-colors text-xs"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    {entry.status === 'completed' ? (
                      <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    ) : (
                      <XCircle className="w-3 h-3 text-rose-600 dark:text-rose-400 shrink-0" />
                    )}
                    <span className="font-semibold text-[11px] truncate text-[var(--text-primary)]">
                      <BdiText dir="ltr">{entry.filename}</BdiText>
                    </span>
                    <span className="px-1 py-0.5 rounded text-[9px] uppercase font-mono bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20 shrink-0">
                      {entry.format}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5 text-[10px] text-[var(--text-muted)] font-mono">
                    <BdiText dir="ltr" mono>
                      {formatBytes(entry.source_size_bytes)} → {formatBytes(entry.output_size_bytes)}
                    </BdiText>
                    {savedPct > 0 && (
                      <BdiText
                        dir="ltr"
                        mono
                        className="text-emerald-600 dark:text-emerald-400 font-semibold"
                      >
                        -{savedPct}%
                      </BdiText>
                    )}
                    {entry.speed > 0 && (
                      <BdiText dir="ltr" mono>
                        {entry.speed.toFixed(1)}x
                      </BdiText>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    disabled={!canRequeue || requeueingId === entry.id}
                    onClick={() => handleRequeue(entry)}
                    title={t.history.requeue}
                    aria-label={t.history.requeue}
                    className="p-1.5 rounded-lg border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-emerald-600 dark:hover:text-emerald-400 hover:border-emerald-500/30 transition-all disabled:opacity-40 focus-studio"
                  >
                    <RotateCcw
                      className={clsx(
                        'w-3.5 h-3.5',
                        requeueingId === entry.id && 'animate-spin'
                      )}
                    />
                  </button>
                  <button
                    type="button"
                    disabled={!canReveal}
                    onClick={() => handleReveal(entry.output_path)}
                    title={t.actions.revealInExplorer}
                    aria-label={t.actions.revealInExplorer}
                    className="p-1.5 rounded-lg border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-sky-600 dark:hover:text-sky-400 hover:border-sky-500/30 transition-all disabled:opacity-40 focus-studio"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmTarget({ type: 'single', entry })}
                    title={t.history.deleteEntry}
                    aria-label={t.history.deleteEntry}
                    className="p-1.5 rounded-lg border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-rose-600 dark:hover:text-rose-400 hover:border-rose-500/30 transition-all focus-studio"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </GlassCard>

      {/* Confirm Clear / Delete Entry */}
      <ConfirmDialog
        open={confirmTarget !== null}
        title={
          confirmTarget?.type === 'all' ? t.history.clearHistory : t.history.deleteEntry
        }
        message={
          confirmTarget?.type === 'all'
            ? t.history.clearConfirm
            : t.history.deleteEntryConfirm
        }
        confirmLabel={t.actions.delete}
        cancelLabel={t.actions.cancel}
        variant="danger"
        isLoading={isConfirmBusy}
        onConfirm={handleConfirmAction}
        onCancel={() => setConfirmTarget(null)}
      />
    </div>
  );
};
