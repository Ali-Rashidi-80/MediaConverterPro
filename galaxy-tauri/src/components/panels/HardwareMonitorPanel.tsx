import React, { useEffect, useState, useCallback } from 'react';
import { Cpu, HardDrive, RefreshCw, ShieldCheck, Zap } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useConverterStore } from '../../store/useConverterStore';
import { useI18n } from '../../i18n/useI18n';
import { HardwareProfile } from '../../types';
import { GlassCard } from '../common/GlassCard';
import { Badge } from '../common/Badge';
import { BdiText } from '../common/BdiText';
import { parseAppError } from '../../utils/errorParser';

export const HardwareMonitorPanel: React.FC = () => {
  const { t, language } = useI18n();
  const hardwareProfile = useConverterStore((state) => state.hardwareProfile);
  const setHardwareProfile = useConverterStore((state) => state.setHardwareProfile);
  const addToast = useConverterStore((state) => state.addToast);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadHardware = useCallback(
    async (forceRefresh: boolean) => {
      setIsRefreshing(true);
      try {
        const hw: HardwareProfile = await invoke('probe_hardware', { forceRefresh });
        setHardwareProfile(hw);
        if (forceRefresh) {
          addToast({
            type: 'success',
            title: t.hardware.refresh,
            message: `${hw.recommended_backend.toUpperCase()} · ${hw.cpu_count} ${t.hardware.threadsUnit}`,
          });
        }
      } catch (e) {
        addToast({
          type: 'error',
          title: t.toasts.probeError,
          message: parseAppError(e, language),
        });
      } finally {
        setIsRefreshing(false);
      }
    },
    [addToast, language, setHardwareProfile, t.hardware.refresh, t.hardware.threadsUnit, t.toasts.probeError]
  );

  useEffect(() => {
    if (hardwareProfile) return;
    let active = true;
    invoke<HardwareProfile>('probe_hardware', { forceRefresh: false })
      .then((hw) => {
        if (active) setHardwareProfile(hw);
      })
      .catch((e: unknown) => {
        if (active) {
          addToast({
            type: 'error',
            title: t.toasts.probeError,
            message: parseAppError(e, language),
          });
        }
      });
    return () => {
      active = false;
    };
  }, [hardwareProfile, setHardwareProfile, addToast, t.toasts.probeError, language]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <Cpu className="w-4 h-4 text-sky-600 dark:text-sky-400" />
          <h3 className="font-bold text-sm text-[var(--text-primary)]">{t.hardware.title}</h3>
        </div>
        <button
          type="button"
          onClick={() => void loadHardware(true)}
          disabled={isRefreshing}
          className="p-1.5 rounded-lg border border-[var(--border-subtle)] hover:bg-[var(--surface-card-hover)] text-[var(--text-muted)] hover:text-sky-600 dark:hover:text-sky-400 transition-colors disabled:opacity-50 focus-studio"
          title={t.hardware.refresh}
          aria-label={t.hardware.refresh}
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-sky-600 dark:text-sky-400' : ''}`}
          />
        </button>
      </div>

      {hardwareProfile ? (
        <div className="space-y-3">
          {/* Main Specs Card */}
          <GlassCard className="p-4 space-y-3">
            {/* GPU Device */}
            <div>
              <span className="text-[11px] font-semibold text-[var(--text-muted)] block mb-1">
                {t.hardware.detectedGpus}
              </span>
              {hardwareProfile.gpus.length > 0 ? (
                <div className="space-y-1.5">
                  {hardwareProfile.gpus.map((gpu) => (
                    <div
                      key={gpu.index}
                      className="flex items-center justify-between p-2 rounded-xl bg-[var(--surface-input)] border border-[var(--surface-input-border)] text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <HardDrive className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                        <span className="font-medium text-[var(--text-primary)] truncate">
                          <BdiText dir="ltr">{gpu.name}</BdiText>
                        </span>
                      </div>
                      <Badge variant="primary" className="uppercase text-[10px] shrink-0">
                        {gpu.vendor}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <span className="text-xs text-[var(--text-muted)]">{t.hardware.noGpu}</span>
              )}
            </div>

            {/* CPU & Parallel Slots */}
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[var(--border-subtle)] text-xs">
              <div className="p-2 rounded-xl bg-[var(--surface-input)] border border-[var(--surface-input-border)]">
                <span className="text-[10px] text-[var(--text-muted)] block mb-0.5">
                  {t.hardware.cpuCores}
                </span>
                <span className="font-bold text-sky-600 dark:text-sky-400 flex items-center gap-1">
                  <BdiText dir="ltr" mono>
                    {hardwareProfile.cpu_count}
                  </BdiText>
                  <span className="text-[11px]">{t.hardware.threadsUnit}</span>
                </span>
              </div>

              <div className="p-2 rounded-xl bg-[var(--surface-input)] border border-[var(--surface-input-border)]">
                <span className="text-[10px] text-[var(--text-muted)] block mb-0.5">
                  {t.hardware.parallelSlots}
                </span>
                <span className="font-bold text-emerald-600 dark:text-emerald-400 text-[11px] flex flex-wrap items-center gap-1">
                  <BdiText dir="ltr" mono>
                    {hardwareProfile.recommended_gpu_slots}
                  </BdiText>
                  <span>{t.hardware.gpuSlotsLabel}</span>
                  <span>+</span>
                  <BdiText dir="ltr" mono>
                    {Math.max(1, hardwareProfile.cpu_count - 1)}
                  </BdiText>
                  <span>{t.hardware.threadsUnit}</span>
                </span>
              </div>
            </div>

            {/* Active Engine */}
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-gradient-to-r from-sky-500/10 to-indigo-500/10 border border-sky-500/20 text-xs">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                <span className="font-medium text-[var(--text-primary)]">
                  {t.hardware.activeBackend}:
                </span>
              </div>
              <Badge variant="primary" className="uppercase font-bold">
                {hardwareProfile.recommended_backend}
              </Badge>
            </div>
          </GlassCard>

          {/* Encoders List */}
          <GlassCard className="p-4 space-y-2">
            <span className="text-[11px] font-semibold text-[var(--text-muted)] block">
              {t.hardware.encodersTitle}
            </span>
            <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto p-1 scrollbar-thin">
              {hardwareProfile.available_encoders.map((enc) => (
                <Badge
                  key={enc}
                  variant={
                    enc.includes('nvenc') || enc.includes('amf') || enc.includes('qsv')
                      ? 'success'
                      : 'neutral'
                  }
                  className="text-[10px]"
                >
                  <BdiText dir="ltr" mono>
                    {enc}
                  </BdiText>
                </Badge>
              ))}
            </div>
          </GlassCard>

          {/* Decode Accelerators List */}
          {hardwareProfile.available_hwaccels && hardwareProfile.available_hwaccels.length > 0 && (
            <GlassCard className="p-4 space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--text-muted)]">
                <Zap className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" />
                <span>{t.hardware.hwaccelsTitle}</span>
              </div>
              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto p-1 scrollbar-thin">
                {hardwareProfile.available_hwaccels.map((hw) => (
                  <Badge key={hw} variant="primary" className="text-[10px] uppercase">
                    <BdiText dir="ltr" mono>
                      {hw}
                    </BdiText>
                  </Badge>
                ))}
              </div>
            </GlassCard>
          )}

          {/* Version & FFmpeg Status Card */}
          <div className="p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] text-[11px] text-[var(--text-muted)] space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-[var(--text-secondary)]">
                {t.hardware.ffmpegVersion}:
              </span>
              <Badge
                variant={hardwareProfile.ffmpeg_available ? 'success' : 'danger'}
                className="text-[10px]"
              >
                {hardwareProfile.ffmpeg_available ? t.hardware.ffmpegReady : t.hardware.ffmpegMissing}
              </Badge>
            </div>
            <p
              className="font-mono text-[10px] text-[var(--text-muted)] truncate max-w-full"
              title={hardwareProfile.ffmpeg_version}
            >
              <BdiText dir="ltr" mono>
                {hardwareProfile.ffmpeg_version}
              </BdiText>
            </p>
            {hardwareProfile.ffmpeg_path && (
              <div className="pt-1 border-t border-[var(--border-subtle)]/60">
                <span className="text-[10px] font-semibold block text-[var(--text-secondary)] mb-0.5">
                  {t.hardware.ffmpegPathLabel}:
                </span>
                <p
                  className="font-mono text-[10px] text-[var(--text-muted)] truncate"
                  title={hardwareProfile.ffmpeg_path}
                >
                  <BdiText dir="ltr" mono>
                    {hardwareProfile.ffmpeg_path}
                  </BdiText>
                </p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3" aria-busy="true">
          <div className="px-1 text-xs text-[var(--text-muted)]">{t.hardware.probing}</div>
          <GlassCard className="p-4 space-y-3 animate-pulse">
            <div className="h-4 w-32 rounded bg-[var(--surface-input)]" />
            <div className="h-10 w-full rounded-xl bg-[var(--surface-input)]" />
            <div className="grid grid-cols-2 gap-2">
              <div className="h-14 rounded-xl bg-[var(--surface-input)]" />
              <div className="h-14 rounded-xl bg-[var(--surface-input)]" />
            </div>
            <div className="h-10 w-full rounded-xl bg-[var(--surface-input)]" />
          </GlassCard>
          <GlassCard className="p-4 space-y-2 animate-pulse">
            <div className="h-3 w-28 rounded bg-[var(--surface-input)]" />
            <div className="flex gap-1.5">
              <div className="h-5 w-16 rounded-full bg-[var(--surface-input)]" />
              <div className="h-5 w-20 rounded-full bg-[var(--surface-input)]" />
              <div className="h-5 w-14 rounded-full bg-[var(--surface-input)]" />
            </div>
          </GlassCard>
        </div>
      )}
    </div>
  );
};
