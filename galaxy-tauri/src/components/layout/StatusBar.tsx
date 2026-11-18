import React, { useEffect, useState } from 'react';
import { FolderOpen, Cpu, CheckCircle2, Loader2, HardDrive, Zap } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { clsx } from 'clsx';
import { useConverterStore } from '../../store/useConverterStore';
import { useI18n } from '../../i18n/useI18n';
import { BdiText } from '../common/BdiText';
import { APP_METADATA } from '../../constants/app';
import { DiskSpaceInfo } from '../../types';
import { parseAppError } from '../../utils/errorParser';

export const StatusBar: React.FC = () => {
  const { t, language } = useI18n();
  const taskIds = useConverterStore((state) => state.taskIds);
  const tasksById = useConverterStore((state) => state.tasksById);
  const isProcessing = useConverterStore((state) => state.isProcessing);
  const hardwareProfile = useConverterStore((state) => state.hardwareProfile);
  const outputDir = useConverterStore((state) => state.outputDir);
  const addToast = useConverterStore((state) => state.addToast);
  const [diskSpace, setDiskSpace] = useState<DiskSpaceInfo | null>(null);

  useEffect(() => {
    let mounted = true;
    const fetchDisk = async () => {
      try {
        const info = await invoke<DiskSpaceInfo>('check_disk_space', {
          targetPath: outputDir || '',
          estimatedBytes: 0,
        });
        if (mounted) setDiskSpace(info);
      } catch (e) {
        console.error('Disk space fetch failed:', e);
      }
    };
    fetchDisk();
    const interval = setInterval(fetchDisk, 15000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [outputDir]);

  const formatDiskBytes = (bytes: number) => {
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1) return `${gb.toFixed(0)} GB`;
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(0)} MB`;
  };

  const total = taskIds.length;
  const completed = taskIds.filter((id) => tasksById[id]?.status === 'completed').length;
  const processing = taskIds.filter((id) => tasksById[id]?.status === 'processing').length;

  const handleOpenFolder = async () => {
    try {
      await invoke('open_output_folder', { path: outputDir || '' });
    } catch (err) {
      addToast({
        type: 'error',
        title: t.statusBar.openOutputFolder,
        message: parseAppError(err, language),
      });
    }
  };

  const folderDisplayName = outputDir
    ? outputDir.split(/[\\/]/).filter(Boolean).pop() || outputDir
    : APP_METADATA.defaultOutputFolderName;

  const ffmpegReady = hardwareProfile?.ffmpeg_available ?? false;

  return (
    <footer className="h-9 border-t border-[var(--border-subtle)] bg-[var(--surface-mica)] backdrop-blur-md px-4 flex items-center justify-between text-xs text-[var(--text-muted)] select-none shrink-0 z-20 gap-3">
      {/* Left: Queue stats & Output Folder */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center gap-1.5 shrink-0">
          {isProcessing ? (
            <Loader2 className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 animate-spin" />
          ) : (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
          )}
          <span className="flex items-center gap-1">
            <BdiText dir="ltr" mono>
              {completed}/{total}
            </BdiText>
            <span>{t.statusBar.queueProgress}</span>
          </span>
          {processing > 0 && (
            <span className="text-sky-600 dark:text-sky-400 font-mono font-medium">
              (<BdiText dir="ltr">{processing}</BdiText> {t.status.active})
            </span>
          )}
        </div>

        <span className="text-[var(--border-subtle)]">|</span>

        {/* Output dir trigger */}
        <button
          type="button"
          onClick={handleOpenFolder}
          className="flex items-center gap-1.5 hover:text-[var(--text-primary)] transition-colors focus-studio rounded px-1.5 py-0.5 min-w-0"
          title={outputDir || t.statusBar.openOutputFolder}
          aria-label={t.statusBar.openOutputFolder}
        >
          <FolderOpen className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
          <span className="truncate max-w-[120px] sm:max-w-[200px]">
            <BdiText dir="ltr">{folderDisplayName}</BdiText>
          </span>
        </button>
      </div>

      {/* Right: FFmpeg Health, Hardware Telemetry & Disk Space */}
      <div className="flex items-center gap-2.5 shrink-0">
        {hardwareProfile && (
          <>
            {/* FFmpeg Binary Readiness Indicator */}
            <div
              className={clsx(
                'flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] font-medium',
                ffmpegReady
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'border-rose-500/35 bg-rose-500/15 text-rose-600 dark:text-rose-400'
              )}
              title={
                ffmpegReady
                  ? `${t.about.ffmpegEngine}: ${t.about.ffmpegReady}`
                  : t.errors.ffmpegBinaryNotFound
              }
            >
              <span
                className={clsx(
                  'w-1.5 h-1.5 rounded-full shrink-0',
                  ffmpegReady ? 'bg-emerald-500' : 'bg-rose-500 animate-pulse'
                )}
              />
              <BdiText dir="ltr" className="font-mono text-[10px]">
                FFmpeg
              </BdiText>
              <span className="hidden md:inline text-[10px]">
                {ffmpegReady ? t.about.ffmpegReady : t.about.ffmpegMissing}
              </span>
            </div>

            <span className="text-[var(--border-subtle)]">|</span>

            <div className="flex items-center gap-2 font-mono text-[11px]">
              <div className="flex items-center gap-1 text-[var(--text-secondary)]">
                <Cpu className="w-3 h-3 text-sky-600 dark:text-sky-400 shrink-0" />
                <BdiText dir="ltr">{hardwareProfile.cpu_count}</BdiText>
                <span>{t.statusBar.threadsShort}</span>
              </div>
              <span className="text-[var(--border-subtle)]">|</span>
              <div className="flex items-center gap-1 text-[var(--text-secondary)] truncate max-w-[140px] sm:max-w-[220px]">
                <Zap className="w-3 h-3 text-amber-600 dark:text-amber-400 shrink-0" />
                <BdiText dir="ltr">
                  {hardwareProfile.gpus[0]?.name
                    ? hardwareProfile.gpus[0].name.slice(0, 24)
                    : t.statusBar.cpuEngine}
                </BdiText>
              </div>
            </div>
          </>
        )}

        {diskSpace && diskSpace.total_bytes > 0 && (
          <div
            className="flex items-center gap-1 font-mono text-[11px] text-[var(--text-secondary)]"
            title={
              diskSpace.is_low
                ? `${t.statusBar.lowDiskTooltip} — ${t.statusBar.totalSpace} ${formatDiskBytes(diskSpace.total_bytes)}`
                : `${t.statusBar.totalSpace} ${formatDiskBytes(diskSpace.total_bytes)}`
            }
          >
            <span className="text-[var(--border-subtle)] me-1">|</span>
            <HardDrive
              className={clsx(
                'w-3 h-3 shrink-0',
                diskSpace.is_low
                  ? 'text-rose-600 dark:text-rose-400 animate-pulse'
                  : 'text-emerald-600 dark:text-emerald-400'
              )}
            />
            <span
              className={clsx(
                'flex items-center gap-1',
                diskSpace.is_low && 'text-rose-600 dark:text-rose-400 font-semibold'
              )}
            >
              <span>{t.statusBar.freeSpace}</span>
              <BdiText dir="ltr">{formatDiskBytes(diskSpace.available_bytes)}</BdiText>
            </span>
          </div>
        )}
      </div>
    </footer>
  );
};
