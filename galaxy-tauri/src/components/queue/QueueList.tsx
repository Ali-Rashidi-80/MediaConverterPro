import React, { useRef, useMemo, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Layers, Search, X, RotateCcw, Filter, CheckSquare, Square } from 'lucide-react';
import { useConverterStore } from '../../store/useConverterStore';
import { TaskCard } from './TaskCard';
import { BatchBar } from './BatchBar';
import { useI18n } from '../../i18n/useI18n';
import { QueueFilter } from '../../types';
import { clsx } from 'clsx';

export const QueueList: React.FC = () => {
  const { t } = useI18n();
  const taskIds = useConverterStore((state) => state.taskIds);
  const tasksById = useConverterStore((state) => state.tasksById);
  const queueFilter = useConverterStore((state) => state.queueFilter);
  const setQueueFilter = useConverterStore((state) => state.setQueueFilter);
  const searchQuery = useConverterStore((state) => state.searchQuery);
  const setSearchQuery = useConverterStore((state) => state.setSearchQuery);
  const retryAllFailed = useConverterStore((state) => state.retryAllFailed);
  const selectedTaskIds = useConverterStore((state) => state.selectedTaskIds);
  const selectAllTasks = useConverterStore((state) => state.selectAllTasks);
  const clearTaskSelection = useConverterStore((state) => state.clearTaskSelection);

  const parentRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Compute status counts
  const counts = useMemo(() => {
    let queued = 0;
    let processing = 0;
    let completed = 0;
    let failed = 0;

    for (const id of taskIds) {
      const task = tasksById[id];
      if (!task) continue;
      if (task.status === 'queued') queued++;
      else if (task.status === 'processing') processing++;
      else if (task.status === 'completed') completed++;
      else if (task.status === 'failed') failed++;
    }

    return {
      all: taskIds.length,
      queued,
      processing,
      completed,
      failed,
    };
  }, [taskIds, tasksById]);

  // Filter tasks based on status and search query
  const filteredTaskIds = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return taskIds.filter((id) => {
      const task = tasksById[id];
      if (!task) return false;

      if (queueFilter !== 'all') {
        if (queueFilter === 'processing' && task.status !== 'processing') return false;
        if (queueFilter === 'queued' && task.status !== 'queued') return false;
        if (queueFilter === 'completed' && task.status !== 'completed') return false;
        if (queueFilter === 'failed' && task.status !== 'failed') return false;
      }

      if (q) {
        const matchesName = task.fileName.toLowerCase().includes(q);
        const matchesFmt = task.targetFormat.toLowerCase().includes(q);
        return matchesName || matchesFmt;
      }

      return true;
    });
  }, [taskIds, tasksById, queueFilter, searchQuery]);

  const allFilteredSelected = useMemo(() => {
    if (filteredTaskIds.length === 0) return false;
    const selectedSet = new Set(selectedTaskIds);
    return filteredTaskIds.every((id) => selectedSet.has(id));
  }, [filteredTaskIds, selectedTaskIds]);

  // Ctrl+A shortcut for Select All in Queue (supports English & Persian layouts)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey &&
        !e.altKey &&
        (e.code === 'KeyA' || e.key.toLowerCase() === 'a' || e.key === 'ش')
      ) {
        const activeModal = useConverterStore.getState().activeModal;
        if (activeModal !== 'none' || document.querySelector('dialog[open]')) {
          return;
        }
        const activeEl = document.activeElement as HTMLElement | null;
        const activeTag = activeEl?.tagName.toLowerCase();
        if (
          activeTag === 'input' ||
          activeTag === 'textarea' ||
          activeTag === 'select' ||
          activeEl?.isContentEditable
        ) {
          return;
        }
        e.preventDefault();
        if (filteredTaskIds.length === 0) return;
        if (allFilteredSelected) {
          clearTaskSelection();
        } else {
          selectAllTasks(filteredTaskIds);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [allFilteredSelected, filteredTaskIds, selectAllTasks, clearTaskSelection]);

  const rowVirtualizer = useVirtualizer({
    count: filteredTaskIds.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 104,
    overscan: 4,
  });

  if (taskIds.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-center text-xs select-none space-y-2.5">
        <div className="w-11 h-11 rounded-2xl bg-[var(--surface-input)] border border-[var(--surface-input-border)] flex items-center justify-center text-[var(--text-muted)] shadow-inner">
          <Layers className="w-5 h-5 opacity-70" />
        </div>
        <span className="font-semibold text-xs text-[var(--text-secondary)]">{t.queue.empty}</span>
        <span className="text-[11px] text-[var(--text-muted)] max-w-xs">{t.dropzone.subtitle}</span>
      </div>
    );
  }

  const filterTabs: { key: QueueFilter; label: string; count: number; color?: string }[] = [
    { key: 'all', label: t.queue.filterAll, count: counts.all },
    {
      key: 'processing',
      label: t.queue.filterProcessing,
      count: counts.processing,
      color: 'text-sky-600 dark:text-sky-400',
    },
    { key: 'queued', label: t.queue.filterQueued, count: counts.queued },
    {
      key: 'completed',
      label: t.queue.filterCompleted,
      count: counts.completed,
      color: 'text-emerald-600 dark:text-emerald-400',
    },
    {
      key: 'failed',
      label: t.queue.filterFailed,
      count: counts.failed,
      color: 'text-rose-600 dark:text-rose-400',
    },
  ];

  const handleToggleSelectAll = () => {
    if (filteredTaskIds.length === 0) return;
    if (allFilteredSelected) {
      clearTaskSelection();
    } else {
      selectAllTasks(filteredTaskIds);
    }
  };

  return (
    <div className="h-full w-full flex flex-col overflow-hidden">
      {/* Queue Filter & Search Toolbar */}
      <div className="p-3 border-b border-[var(--border-subtle)] bg-[var(--surface-card)] space-y-2 shrink-0">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          {/* Filter Pills */}
          <div className="flex items-center gap-1 overflow-x-auto py-0.5 scrollbar-none">
            {/* Select All Toggle Button */}
            <button
              type="button"
              onClick={handleToggleSelectAll}
              disabled={filteredTaskIds.length === 0}
              title={allFilteredSelected ? t.actions.deselectAll : t.queue.selectAllTooltip}
              aria-label={allFilteredSelected ? t.actions.deselectAll : t.queue.selectAllTooltip}
              aria-pressed={allFilteredSelected}
              className="p-1.5 rounded-lg border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-sky-600 dark:hover:text-sky-400 hover:bg-[var(--surface-input)] transition-all flex items-center gap-1 text-xs me-1 focus-studio disabled:opacity-40"
            >
              {allFilteredSelected ? (
                <CheckSquare className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
              ) : (
                <Square className="w-3.5 h-3.5" />
              )}
            </button>

            {filterTabs.map((tab) => {
              const isSelected = queueFilter === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setQueueFilter(tab.key)}
                  aria-pressed={isSelected}
                  aria-label={`${tab.label} (${tab.count})`}
                  className={clsx(
                    'px-2.5 py-1 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 whitespace-nowrap focus-studio',
                    isSelected
                      ? 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border border-sky-500/30 font-semibold'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-input)]'
                  )}
                >
                  <span>{tab.label}</span>
                  <span
                    className={clsx(
                      'text-[10px] px-1.5 py-0.5 rounded-full font-mono tabular-nums',
                      isSelected
                        ? 'bg-sky-500/20 text-sky-600 dark:text-sky-400'
                        : 'bg-[var(--surface-input)] text-[var(--text-muted)]',
                      !isSelected && tab.color
                    )}
                  >
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Retry All Failed Button */}
          {counts.failed > 0 && (
            <button
              type="button"
              onClick={retryAllFailed}
              title={t.actions.retryAllFailed}
              aria-label={t.actions.retryAllFailed}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-rose-500/15 text-rose-600 dark:text-rose-400 hover:bg-rose-500/25 border border-rose-500/30 transition-all shrink-0 focus-studio"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>{t.actions.retryAllFailed}</span>
            </button>
          )}
        </div>

        {/* Live Search Input */}
        <div className="relative flex items-center">
          <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute start-2.5 pointer-events-none" />
          <input
            ref={searchInputRef}
            data-search-input="true"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t.queue.searchPlaceholder}
            aria-label={t.queue.searchPlaceholder}
            className="w-full bg-[var(--surface-input)] border border-[var(--surface-input-border)] text-[var(--text-primary)] text-xs rounded-lg ps-8 pe-8 py-1.5 placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-sky-500 transition-all"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              title={t.history.clearSearch}
              aria-label={t.history.clearSearch}
              className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] absolute end-2 rounded focus-studio"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Task List or Filtered Empty State */}
      {filteredTaskIds.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-xs select-none space-y-2 text-[var(--text-muted)]">
          <Filter className="w-8 h-8 opacity-40 mb-1" />
          <span className="font-semibold text-xs text-[var(--text-secondary)]">
            {searchQuery ? t.queue.noMatches : t.queue.emptyFilter}
          </span>
        </div>
      ) : (
        <div
          ref={parentRef}
          className="flex-1 w-full overflow-y-auto p-3 space-y-2 scrollbar-thin"
        >
          <div
            className="w-full relative"
            style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const taskId = filteredTaskIds[virtualRow.index];
              return (
                <div
                  key={taskId}
                  ref={rowVirtualizer.measureElement}
                  data-index={virtualRow.index}
                  className="absolute top-0 inset-x-0 w-full pb-2"
                  style={{
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <TaskCard id={taskId} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Floating Batch Operations Bar */}
      <BatchBar />
    </div>
  );
};
