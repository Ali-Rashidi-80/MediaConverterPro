import React, { useMemo } from 'react';
import { clsx } from 'clsx';
import {
  Video,
  Zap,
  Sliders,
  Check,
  AlertTriangle,
  RefreshCw,
  Shield,
  Sparkles,
  Scissors,
  Gauge,
  Lock,
  Type,
  FileText,
} from 'lucide-react';
import { useConverterStore } from '../../store/useConverterStore';
import { useI18n } from '../../i18n/useI18n';
import { VIDEO_PRESETS } from '../../constants/presets';
import {
  SUPPORTED_VIDEO_FORMATS,
  SUPPORTED_VIDEO_CODECS,
  ACCELERATION_MODES,
  RESOLUTION_PRESETS,
  FRAMERATE_PRESETS,
  NVENC_PRESETS,
  CROP_PRESETS,
  SPEED_PRESETS,
  PRORES_PROFILES,
} from '../../constants/app';
import { parseAppError } from '../../utils/errorParser';
import { GlassCard } from '../common/GlassCard';
import { BdiText } from '../common/BdiText';

interface ParsedTimecode {
  valid: boolean;
  secs: number | null;
}

const MAX_TIMECODE_SECS = 86400 * 30;

function parseTimecodeInput(raw?: string): ParsedTimecode {
  if (!raw || !raw.trim()) {
    return { valid: true, secs: null };
  }

  const trimmed = raw.trim();
  const parts = trimmed.split(':');

  if (parts.length === 1) {
    if (!/^\d+(?:\.\d+)?$/.test(trimmed)) {
      return { valid: false, secs: null };
    }
    const secs = Number(trimmed);
    if (!Number.isFinite(secs) || secs < 0 || secs > MAX_TIMECODE_SECS) {
      return { valid: false, secs: null };
    }
    return { valid: true, secs };
  }

  if (parts.length === 2) {
    const [mStr, sStr] = parts.map((p) => p.trim());
    if (!/^\d+$/.test(mStr) || !/^\d+(?:\.\d+)?$/.test(sStr)) {
      return { valid: false, secs: null };
    }
    const m = Number(mStr);
    const s = Number(sStr);
    if (!Number.isFinite(m) || !Number.isFinite(s) || s >= 60) {
      return { valid: false, secs: null };
    }
    const total = m * 60 + s;
    if (!Number.isFinite(total) || total > MAX_TIMECODE_SECS) {
      return { valid: false, secs: null };
    }
    return { valid: true, secs: total };
  }

  if (parts.length === 3) {
    const [hStr, mStr, sStr] = parts.map((p) => p.trim());
    if (!/^\d+$/.test(hStr) || !/^\d+$/.test(mStr) || !/^\d+(?:\.\d+)?$/.test(sStr)) {
      return { valid: false, secs: null };
    }
    const h = Number(hStr);
    const m = Number(mStr);
    const s = Number(sStr);
    if (!Number.isFinite(h) || !Number.isFinite(m) || !Number.isFinite(s) || m >= 60 || s >= 60) {
      return { valid: false, secs: null };
    }
    const total = h * 3600 + m * 60 + s;
    if (!Number.isFinite(total) || total > MAX_TIMECODE_SECS) {
      return { valid: false, secs: null };
    }
    return { valid: true, secs: total };
  }

  return { valid: false, secs: null };
}

function isBitrateValid(raw?: string): boolean {
  const trimmed = raw?.trim() ?? '';
  if (!trimmed || trimmed.toLowerCase() === 'auto') return true;
  const match = /^(\d{1,9})([kKmM])?$/.exec(trimmed);
  if (!match) return false;
  return Number(match[1]) > 0;
}

export const VideoPanel: React.FC = () => {
  const { t, language } = useI18n();
  const videoSettings = useConverterStore((state) => state.videoSettings);
  const setVideoSettings = useConverterStore((state) => state.setVideoSettings);
  const isProMode = useConverterStore((state) => state.isProMode);
  const hardwareProfile = useConverterStore((state) => state.hardwareProfile);
  const addToast = useConverterStore((state) => state.addToast);

  const isCodecDisabled = (codec: string, format: string): boolean => {
    if (format === 'webm') {
      return codec !== 'AV1' && codec !== 'VP9';
    }
    if (format === 'mov') {
      return codec === 'AV1' || codec === 'VP9';
    }
    if (format === 'avi') {
      return codec !== 'H.264';
    }
    if (format === 'gif') {
      return true;
    }
    if (format === 'mp4') {
      return codec === 'ProRes 422';
    }
    return false;
  };

  const handleSelectFormat = (fmt: string) => {
    let nextCodec = videoSettings.codec;
    if (isCodecDisabled(nextCodec, fmt)) {
      if (fmt === 'webm') nextCodec = 'AV1';
      else nextCodec = 'H.264';
    }
    setVideoSettings({
      format: fmt,
      codec: nextCodec,
      prores_profile:
        fmt === 'mov' && nextCodec === 'ProRes 422'
          ? videoSettings.prores_profile || 'standard'
          : undefined,
    });
  };

  const handleSelectCodec = (codec: string) => {
    setVideoSettings({
      codec,
      prores_profile:
        videoSettings.format === 'mov' && codec === 'ProRes 422'
          ? videoSettings.prores_profile || 'standard'
          : undefined,
    });
  };

  const handlePickSubtitle = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        filters: [{ name: 'Subtitle Files', extensions: ['srt', 'vtt', 'ass'] }],
        multiple: false,
      });
      if (selected && typeof selected === 'string') {
        setVideoSettings({ subtitle_path: selected });
      }
    } catch (e) {
      addToast({ type: 'error', message: parseAppError(e, language) });
    }
  };

  const handleSelectPreset = (presetId: string) => {
    const p = VIDEO_PRESETS.find((item) => item.id === presetId);
    if (!p) return;

    setVideoSettings({
      ui_preset_id: p.id,
      encoder_speed_preset: p.encoder_speed_preset || p.preset,
      video_preset: p.id,
      crf: p.crf,
      scale: p.scale || 'original',
      fps: p.fps || 0,
      copy_streams: !!p.copyStreams,
    });
  };

  const handleResetColorEq = () => {
    setVideoSettings({
      brightness: 0,
      contrast: 1,
      saturation: 1,
      gamma: 1,
    });
  };

  const isAccelModeAvailable = useMemo(() => {
    const encoders = hardwareProfile?.available_encoders ?? [];
    return (modeId: string): boolean => {
      if (modeId === 'auto' || modeId === 'cpu') return true;
      if (!hardwareProfile) return false;
      if (modeId === 'nvidia') return encoders.some((enc) => enc.includes('_nvenc'));
      if (modeId === 'amd') return encoders.some((enc) => enc.includes('_amf'));
      if (modeId === 'intel') return encoders.some((enc) => enc.includes('_qsv'));
      return true;
    };
  }, [hardwareProfile]);

  const isCodecIncompatible = useMemo(() => {
    if (
      videoSettings.format === 'webm' &&
      (videoSettings.codec === 'H.264' || videoSettings.codec === 'ProRes 422')
    ) {
      return t.video.incompatibleWebm;
    }
    if (videoSettings.format !== 'mov' && videoSettings.codec === 'ProRes 422') {
      return t.video.incompatibleProres;
    }
    return null;
  }, [videoSettings.format, videoSettings.codec, t.video.incompatibleWebm, t.video.incompatibleProres]);

  const hasCpuFilters = useMemo(() => {
    const crop = videoSettings.crop?.trim().toLowerCase();
    const hasCrop = Boolean(crop && crop !== 'none' && crop !== 'original');
    const scale = videoSettings.scale?.trim().toLowerCase();
    const hasScale = Boolean(scale && scale !== 'original');
    const hasColorEq =
      (videoSettings.brightness ?? 0) !== 0 ||
      Math.abs((videoSettings.contrast ?? 1) - 1) > 1e-4 ||
      Math.abs((videoSettings.saturation ?? 1) - 1) > 1e-4 ||
      Math.abs((videoSettings.gamma ?? 1) - 1) > 1e-4;
    const hasFps = (videoSettings.fps ?? 0) > 0;
    const hasSub = Boolean(videoSettings.subtitle_path?.trim());
    const hasRotate = Boolean(videoSettings.rotate && videoSettings.rotate.trim() !== '');
    const hasSpeed = Math.abs((videoSettings.speed ?? 1) - 1) >= 0.01;

    return (
      hasCrop ||
      hasScale ||
      hasColorEq ||
      Boolean(videoSettings.hdr_to_sdr) ||
      hasFps ||
      hasSub ||
      videoSettings.grayscale ||
      videoSettings.denoise ||
      videoSettings.sharpen ||
      hasRotate ||
      hasSpeed
    );
  }, [videoSettings]);

  const pipelineBadge = useMemo(() => {
    if (videoSettings.copy_streams) {
      return {
        text: t.video.pipelineBadgeRemux,
        color:
          'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
      };
    }

    const isPureCpu =
      videoSettings.format === 'gif' ||
      videoSettings.codec === 'ProRes 422' ||
      videoSettings.accel_mode === 'cpu' ||
      (videoSettings.accel_mode === 'auto' && hardwareProfile?.recommended_backend === 'cpu');

    if (isPureCpu) {
      return {
        text: t.video.pipelineBadgeCpu,
        color: 'bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30',
      };
    }

    if (hasCpuFilters) {
      return {
        text: t.video.pipelineBadgeTier2,
        color: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30',
      };
    }

    const activeBackend =
      videoSettings.accel_mode === 'auto'
        ? hardwareProfile?.recommended_backend
        : videoSettings.accel_mode;
    const backendTag =
      activeBackend && activeBackend !== 'cpu' ? ` · ${activeBackend.toUpperCase()}` : '';

    return {
      text: `${t.video.pipelineBadgeGpu}${backendTag}`,
      color: 'bg-sky-500/15 text-sky-700 dark:text-sky-400 border-sky-500/30',
    };
  }, [
    videoSettings.copy_streams,
    videoSettings.format,
    videoSettings.codec,
    videoSettings.accel_mode,
    hardwareProfile?.recommended_backend,
    hasCpuFilters,
    t,
  ]);

  const parsedStart = parseTimecodeInput(videoSettings.trim_start);
  const parsedEnd = parseTimecodeInput(videoSettings.trim_end);
  const hasTrimSyntaxError = !parsedStart.valid || !parsedEnd.valid;
  const hasTrimOrderError =
    parsedStart.valid &&
    parsedEnd.valid &&
    parsedStart.secs !== null &&
    parsedEnd.secs !== null &&
    parsedStart.secs >= parsedEnd.secs;

  const hasInvalidBitrate = !isBitrateValid(videoSettings.bitrate);

  return (
    <div className="space-y-4">
      {/* Header with Pipeline Badge */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2">
          <Video className="w-4 h-4 text-sky-600 dark:text-sky-400" />
          <h3 className="font-bold text-sm text-[var(--text-primary)]">{t.video.title}</h3>
        </div>
        <div
          className={clsx(
            'px-2.5 py-0.5 rounded-full text-[10px] font-semibold border flex items-center gap-1 max-w-full',
            pipelineBadge.color
          )}
        >
          <Zap className="w-3 h-3 shrink-0" />
          <span className="truncate">{pipelineBadge.text}</span>
        </div>
      </div>

      {/* Quick Presets */}
      <div className="space-y-2">
        <label className="text-xs font-semibold text-[var(--text-secondary)] px-1 block">
          {t.video.presets}
        </label>
        <div className="grid grid-cols-2 gap-2">
          {VIDEO_PRESETS.map((preset) => {
            const isSelected = (videoSettings.ui_preset_id || videoSettings.video_preset) === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => handleSelectPreset(preset.id)}
                className={clsx(
                  'text-start p-2.5 rounded-xl border transition-all text-xs focus-studio',
                  isSelected
                    ? 'border-sky-500/50 bg-sky-500/15 text-[var(--text-primary)] font-semibold shadow-sm'
                    : 'border-[var(--border-subtle)] bg-[var(--surface-card)] text-[var(--text-secondary)] hover:bg-[var(--surface-card-hover)]'
                )}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-[11px] truncate">
                    {language === 'fa' ? preset.nameFa : preset.nameEn}
                  </span>
                  {isSelected && (
                    <Check className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 shrink-0" />
                  )}
                </div>
                <p className="text-[10px] text-[var(--text-muted)] line-clamp-2">
                  {language === 'fa' ? preset.descFa : preset.descEn}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Basic Settings */}
      <GlassCard className="p-4 space-y-4">
        {/* Format & Codec */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-[var(--text-secondary)] mb-1.5 block">
              {t.video.targetFormat}
            </label>
            <div className="flex bg-[var(--surface-input)] p-1 rounded-xl border border-[var(--surface-input-border)]">
              {SUPPORTED_VIDEO_FORMATS.map((fmt) => (
                <button
                  key={fmt}
                  type="button"
                  onClick={() => handleSelectFormat(fmt)}
                  className={clsx(
                    'flex-1 py-1 text-center rounded-lg text-xs font-mono font-medium uppercase transition-all focus-studio',
                    videoSettings.format === fmt
                      ? 'bg-sky-600 dark:bg-sky-500 text-white font-bold shadow'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-input-hover)]'
                  )}
                >
                  {fmt}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-[var(--text-secondary)] mb-1.5 block">
              {t.video.codec}
            </label>
            <div className="flex bg-[var(--surface-input)] p-1 rounded-xl border border-[var(--surface-input-border)]">
              {SUPPORTED_VIDEO_CODECS.map((codec) => {
                const disabled = isCodecDisabled(codec, videoSettings.format);
                return (
                  <button
                    key={codec}
                    type="button"
                    disabled={disabled}
                    onClick={() => !disabled && handleSelectCodec(codec)}
                    title={disabled ? t.video.incompatibleCodec : codec}
                    className={clsx(
                      'flex-1 py-1 text-center rounded-lg text-xs font-mono font-medium transition-all flex items-center justify-center gap-0.5 focus-studio',
                      disabled
                        ? 'opacity-40 cursor-not-allowed pointer-events-none'
                        : videoSettings.codec === codec
                        ? 'bg-indigo-600 text-white font-bold shadow'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-input-hover)]'
                    )}
                  >
                    {disabled && <Lock className="w-2.5 h-2.5 shrink-0" />}
                    <span>{codec}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Compatibility Warning */}
        {isCodecIncompatible && (
          <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 text-xs flex items-center gap-2 font-medium">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{isCodecIncompatible}</span>
          </div>
        )}

        {/* Apple ProRes Profile (when MOV + ProRes 422 is selected) */}
        {videoSettings.format === 'mov' && videoSettings.codec === 'ProRes 422' && (
          <div className="space-y-1.5 p-2.5 rounded-xl bg-sky-500/5 border border-sky-500/15">
            <label className="text-xs font-semibold text-sky-600 dark:text-sky-400 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              <span>{t.video.prores}</span>
            </label>
            <select
              value={videoSettings.prores_profile || 'standard'}
              onChange={(e) => setVideoSettings({ prores_profile: e.target.value, codec: 'ProRes 422' })}
              className="w-full text-xs p-2 rounded-xl bg-[var(--surface-input)] border border-[var(--surface-input-border)] text-[var(--text-primary)] focus-studio"
            >
              {PRORES_PROFILES.map((prof) => (
                <option
                  key={prof.id}
                  value={prof.id}
                  className="bg-[var(--surface-card)] text-[var(--text-primary)]"
                >
                  {language === 'fa' ? prof.labelFa : prof.labelEn}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Copy Streams (Remux) Toggle */}
        <label className="flex items-center justify-between p-2.5 rounded-xl bg-[var(--surface-input)] border border-[var(--surface-input-border)] cursor-pointer text-xs transition-colors hover:bg-[var(--surface-input-hover)]">
          <div className="space-y-0.5 pe-2">
            <span className="font-semibold text-[var(--text-primary)] block">
              {t.video.copyStreams}
            </span>
            <span className="text-[10px] text-[var(--text-muted)] block">
              {t.video.copyStreamsDesc}
            </span>
          </div>
          <input
            type="checkbox"
            checked={videoSettings.copy_streams}
            onChange={(e) => setVideoSettings({ copy_streams: e.target.checked })}
            className="w-4 h-4 rounded accent-sky-600 dark:accent-sky-500 cursor-pointer shrink-0"
          />
        </label>

        {/* Quality / CRF Slider */}
        {!videoSettings.copy_streams && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-[var(--text-secondary)]">{t.video.crfLabel}</span>
              <BdiText dir="ltr" mono className="font-bold text-sky-600 dark:text-sky-400">
                CRF: {videoSettings.crf ?? 23}
              </BdiText>
            </div>
            <input
              type="range"
              min="14"
              max="35"
              step="1"
              value={videoSettings.crf ?? 23}
              onChange={(e) => setVideoSettings({ crf: parseInt(e.target.value, 10) })}
              className="w-full accent-sky-600 dark:accent-sky-500 cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-[var(--text-muted)]">
              <span>{t.video.qualityHigh}</span>
              <span>{t.video.qualityBalanced}</span>
              <span>{t.video.qualityLow}</span>
            </div>
          </div>
        )}

        {/* Acceleration Backend */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-[var(--text-secondary)] flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" />
            <span>{t.video.accelBackend}</span>
          </label>
          <select
            value={videoSettings.accel_mode}
            onChange={(e) => setVideoSettings({ accel_mode: e.target.value })}
            className="w-full text-xs p-2 rounded-xl bg-[var(--surface-input)] border border-[var(--surface-input-border)] text-[var(--text-primary)] focus-studio"
          >
            {ACCELERATION_MODES.map((mode) => {
              const available = isAccelModeAvailable(mode.id);
              const label =
                t.accelModes[mode.labelKey as keyof typeof t.accelModes] || mode.id;
              return (
                <option
                  key={mode.id}
                  value={mode.id}
                  disabled={!available}
                  className="bg-[var(--surface-card)] text-[var(--text-primary)]"
                >
                  {label}
                </option>
              );
            })}
          </select>
        </div>
      </GlassCard>

      {/* Pro Controls */}
      {isProMode && (
        <GlassCard className="p-4 space-y-4 border-indigo-500/20">
          <div className="flex items-center justify-between text-indigo-600 dark:text-indigo-400 font-bold text-xs">
            <div className="flex items-center gap-2">
              <Sliders className="w-3.5 h-3.5" />
              <span>{t.video.customSettings}</span>
            </div>
          </div>

          {/* Optional Target Bitrate */}
          {!videoSettings.copy_streams && (
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-[var(--text-secondary)] block">
                {t.video.bitrate}
              </label>
              <input
                type="text"
                dir="ltr"
                placeholder={t.video.bitratePlaceholder}
                value={videoSettings.bitrate || ''}
                onChange={(e) => setVideoSettings({ bitrate: e.target.value })}
                className={clsx(
                  'w-full p-2 rounded-xl bg-[var(--surface-input)] border text-[var(--text-primary)] font-mono text-xs focus-studio',
                  hasInvalidBitrate
                    ? 'border-rose-500/60'
                    : 'border-[var(--surface-input-border)]'
                )}
              />
              {hasInvalidBitrate && (
                <p className="text-[10px] text-rose-600 dark:text-rose-400 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3 shrink-0" />
                  <span>{t.errors.validation}</span>
                </p>
              )}
            </div>
          )}

          {/* 4-Way Color EQ */}
          <div className="space-y-3 p-3 rounded-xl bg-[var(--surface-input)]/50 border border-[var(--surface-input-border)]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                <span>{t.video.colorEq}</span>
              </span>
              <button
                type="button"
                onClick={handleResetColorEq}
                className="text-[10px] text-sky-600 dark:text-sky-400 hover:text-sky-700 dark:hover:text-sky-300 flex items-center gap-1 transition-colors px-1.5 py-0.5 rounded border border-sky-500/25 focus-studio"
              >
                <RefreshCw className="w-2.5 h-2.5" />
                <span>{t.video.resetEq}</span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-[11px]">
              {/* Brightness */}
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] text-[var(--text-muted)]">
                  <span>{t.video.brightness}</span>
                  <BdiText dir="ltr" mono className="text-sky-600 dark:text-sky-400">
                    {(videoSettings.brightness ?? 0).toFixed(2)}
                  </BdiText>
                </div>
                <input
                  type="range"
                  min="-1.0"
                  max="1.0"
                  step="0.05"
                  value={videoSettings.brightness ?? 0}
                  onChange={(e) => setVideoSettings({ brightness: parseFloat(e.target.value) })}
                  className="w-full accent-sky-600 dark:accent-sky-500 cursor-pointer h-1.5"
                />
              </div>

              {/* Contrast */}
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] text-[var(--text-muted)]">
                  <span>{t.video.contrast}</span>
                  <BdiText dir="ltr" mono className="text-sky-600 dark:text-sky-400">
                    {(videoSettings.contrast ?? 1).toFixed(2)}
                  </BdiText>
                </div>
                <input
                  type="range"
                  min="0.0"
                  max="3.0"
                  step="0.05"
                  value={videoSettings.contrast ?? 1}
                  onChange={(e) => setVideoSettings({ contrast: parseFloat(e.target.value) })}
                  className="w-full accent-sky-600 dark:accent-sky-500 cursor-pointer h-1.5"
                />
              </div>

              {/* Saturation */}
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] text-[var(--text-muted)]">
                  <span>{t.video.saturation}</span>
                  <BdiText dir="ltr" mono className="text-sky-600 dark:text-sky-400">
                    {(videoSettings.saturation ?? 1).toFixed(2)}
                  </BdiText>
                </div>
                <input
                  type="range"
                  min="0.0"
                  max="2.0"
                  step="0.05"
                  value={videoSettings.saturation ?? 1}
                  onChange={(e) => setVideoSettings({ saturation: parseFloat(e.target.value) })}
                  className="w-full accent-sky-600 dark:accent-sky-500 cursor-pointer h-1.5"
                />
              </div>

              {/* Gamma */}
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] text-[var(--text-muted)]">
                  <span>{t.video.gamma}</span>
                  <BdiText dir="ltr" mono className="text-sky-600 dark:text-sky-400">
                    {(videoSettings.gamma ?? 1).toFixed(2)}
                  </BdiText>
                </div>
                <input
                  type="range"
                  min="0.4"
                  max="2.0"
                  step="0.05"
                  value={videoSettings.gamma ?? 1}
                  onChange={(e) => setVideoSettings({ gamma: parseFloat(e.target.value) })}
                  className="w-full accent-sky-600 dark:accent-sky-500 cursor-pointer h-1.5"
                />
              </div>
            </div>
          </div>

          {/* Framing / Crop Presets */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[var(--text-secondary)] flex items-center gap-1.5">
              <Scissors className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
              <span>{t.video.cropFraming}</span>
            </label>
            <select
              value={videoSettings.crop || 'none'}
              onChange={(e) => setVideoSettings({ crop: e.target.value })}
              className="w-full text-xs p-2 rounded-xl bg-[var(--surface-input)] border border-[var(--surface-input-border)] text-[var(--text-primary)] focus-studio"
            >
              {CROP_PRESETS.map((cr) => (
                <option
                  key={cr.id}
                  value={cr.id}
                  className="bg-[var(--surface-card)] text-[var(--text-primary)]"
                >
                  {language === 'fa' ? cr.labelFa : cr.labelEn}
                </option>
              ))}
            </select>
          </div>

          {/* Speed Selector */}
          <div className="space-y-2 p-3 rounded-xl bg-[var(--surface-input)]/50 border border-[var(--surface-input-border)]">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-[var(--text-secondary)] flex items-center gap-1.5">
                <Gauge className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" />
                <span>{t.video.speed}</span>
              </span>
              <BdiText dir="ltr" mono className="font-bold text-amber-700 dark:text-amber-400">
                {(videoSettings.speed ?? 1).toFixed(2)}x
              </BdiText>
            </div>
            <div className="flex gap-1">
              {SPEED_PRESETS.map((sp) => (
                <button
                  key={sp}
                  type="button"
                  onClick={() => setVideoSettings({ speed: sp })}
                  className={clsx(
                    'flex-1 py-1 text-center rounded-lg text-[10px] font-mono transition-all focus-studio',
                    (videoSettings.speed ?? 1) === sp
                      ? 'bg-amber-500 text-slate-950 font-bold shadow'
                      : 'bg-[var(--surface-card)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  )}
                >
                  <BdiText dir="ltr" mono>
                    {sp}x
                  </BdiText>
                </button>
              ))}
            </div>
            <input
              type="range"
              min="0.25"
              max="4.0"
              step="0.05"
              value={videoSettings.speed ?? 1}
              onChange={(e) => setVideoSettings({ speed: parseFloat(e.target.value) })}
              className="w-full accent-amber-600 dark:accent-amber-500 cursor-pointer h-1.5 mt-1"
            />
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            {/* Scale */}
            <div>
              <label className="text-[11px] text-[var(--text-muted)] mb-1 block">{t.video.scale}</label>
              <select
                value={videoSettings.scale}
                onChange={(e) => setVideoSettings({ scale: e.target.value })}
                className="w-full p-2 rounded-xl bg-[var(--surface-input)] border border-[var(--surface-input-border)] text-[var(--text-primary)] focus-studio"
              >
                {RESOLUTION_PRESETS.map((res) => (
                  <option
                    key={res.id}
                    value={res.id}
                    className="bg-[var(--surface-card)] text-[var(--text-primary)]"
                  >
                    {'labelKey' in res
                      ? t.video[res.labelKey as keyof typeof t.video]
                      : language === 'fa'
                      ? res.labelFa
                      : res.labelEn}
                  </option>
                ))}
              </select>
            </div>

            {/* FPS */}
            <div>
              <label className="text-[11px] text-[var(--text-muted)] mb-1 block">{t.video.fps}</label>
              <select
                value={videoSettings.fps || 0}
                onChange={(e) => setVideoSettings({ fps: parseInt(e.target.value, 10) })}
                className="w-full p-2 rounded-xl bg-[var(--surface-input)] border border-[var(--surface-input-border)] text-[var(--text-primary)] focus-studio"
              >
                {FRAMERATE_PRESETS.map((fpsItem) => (
                  <option
                    key={fpsItem.value}
                    value={fpsItem.value}
                    className="bg-[var(--surface-card)] text-[var(--text-primary)]"
                  >
                    {'labelKey' in fpsItem
                      ? t.video[fpsItem.labelKey as keyof typeof t.video]
                      : language === 'fa'
                      ? fpsItem.labelFa
                      : fpsItem.labelEn}
                  </option>
                ))}
              </select>
            </div>

            {/* Rotation */}
            <div>
              <label className="text-[11px] text-[var(--text-muted)] mb-1 block">{t.video.rotate}</label>
              <select
                value={videoSettings.rotate || ''}
                onChange={(e) => setVideoSettings({ rotate: e.target.value })}
                className="w-full p-2 rounded-xl bg-[var(--surface-input)] border border-[var(--surface-input-border)] text-[var(--text-primary)] focus-studio"
              >
                <option value="" className="bg-[var(--surface-card)] text-[var(--text-primary)]">
                  {t.video.rotateNone}
                </option>
                <option value="90" className="bg-[var(--surface-card)] text-[var(--text-primary)]">
                  {t.video.rotate90}
                </option>
                <option value="180" className="bg-[var(--surface-card)] text-[var(--text-primary)]">
                  {t.video.rotate180}
                </option>
                <option value="270" className="bg-[var(--surface-card)] text-[var(--text-primary)]">
                  {t.video.rotate270}
                </option>
              </select>
            </div>

            {/* NVENC Preset */}
            {videoSettings.accel_mode === 'nvidia' && (
              <div>
                <label className="text-[11px] text-[var(--text-muted)] mb-1 block">
                  {t.video.nvencPreset}
                </label>
                <select
                  value={videoSettings.nvenc_preset || 'p4'}
                  onChange={(e) => setVideoSettings({ nvenc_preset: e.target.value })}
                  className="w-full p-2 rounded-xl bg-[var(--surface-input)] border border-[var(--surface-input-border)] text-[var(--text-primary)] focus-studio"
                >
                  {NVENC_PRESETS.map((p) => (
                    <option
                      key={p.id}
                      value={p.id}
                      className="bg-[var(--surface-card)] text-[var(--text-primary)]"
                    >
                      {language === 'fa' ? p.labelFa : p.labelEn}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Trimming Inputs */}
            <div>
              <label className="text-[11px] text-[var(--text-muted)] mb-1 block">
                {t.video.trimStart}
              </label>
              <input
                type="text"
                dir="ltr"
                placeholder={t.video.trimPlaceholder}
                value={videoSettings.trim_start || ''}
                onChange={(e) => setVideoSettings({ trim_start: e.target.value })}
                className={clsx(
                  'w-full p-2 rounded-xl bg-[var(--surface-input)] border text-[var(--text-primary)] font-mono text-xs focus-studio',
                  !parsedStart.valid
                    ? 'border-rose-500/60'
                    : 'border-[var(--surface-input-border)]'
                )}
              />
            </div>

            <div>
              <label className="text-[11px] text-[var(--text-muted)] mb-1 block">{t.video.trimEnd}</label>
              <input
                type="text"
                dir="ltr"
                placeholder={t.video.trimPlaceholder}
                value={videoSettings.trim_end || ''}
                onChange={(e) => setVideoSettings({ trim_end: e.target.value })}
                className={clsx(
                  'w-full p-2 rounded-xl bg-[var(--surface-input)] border text-[var(--text-primary)] font-mono text-xs focus-studio',
                  !parsedEnd.valid
                    ? 'border-rose-500/60'
                    : 'border-[var(--surface-input-border)]'
                )}
              />
            </div>

            {(hasTrimSyntaxError || hasTrimOrderError) && (
              <div className="col-span-2 p-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-[11px] flex items-center gap-1.5 font-medium">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {hasTrimSyntaxError ? t.validation.trimSyntaxError : t.validation.trimOrderError}
                </span>
              </div>
            )}
          </div>

          {/* HDR to SDR Tonemapping & Privacy */}
          <div className="space-y-2 pt-2 border-t border-[var(--border-subtle)]">
            <label className="flex items-center gap-2 p-2.5 rounded-lg bg-[var(--surface-input)] border border-[var(--surface-input-border)] text-xs text-[var(--text-primary)] cursor-pointer">
              <input
                type="checkbox"
                checked={videoSettings.hdr_to_sdr ?? false}
                onChange={(e) => setVideoSettings({ hdr_to_sdr: e.target.checked })}
                className="rounded accent-sky-600 dark:accent-sky-500"
              />
              <span className="font-medium">{t.video.hdrToSdr}</span>
            </label>

            <label className="flex items-center gap-2 p-2.5 rounded-lg bg-emerald-500/5 border border-emerald-500/20 text-xs text-emerald-600 dark:text-emerald-400 cursor-pointer">
              <input
                type="checkbox"
                checked={videoSettings.privacy_wipe ?? false}
                onChange={(e) => setVideoSettings({ privacy_wipe: e.target.checked })}
                className="rounded accent-emerald-600 dark:accent-emerald-500"
              />
              <Shield className="w-3.5 h-3.5 shrink-0" />
              <span className="font-medium">{t.video.privacyWipe}</span>
            </label>
          </div>

          {/* Filters */}
          <div className="space-y-2 pt-2 border-t border-[var(--border-subtle)]">
            <span className="text-[11px] font-semibold text-[var(--text-muted)] block">
              {t.video.filters}
            </span>
            <div className="grid grid-cols-3 gap-2">
              <label className="flex items-center gap-2 p-2 rounded-lg bg-[var(--surface-input)] border border-[var(--surface-input-border)] text-xs text-[var(--text-primary)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={videoSettings.denoise}
                  onChange={(e) => setVideoSettings({ denoise: e.target.checked })}
                  className="rounded accent-sky-600 dark:accent-sky-500"
                />
                <span>{t.video.denoise}</span>
              </label>

              <label className="flex items-center gap-2 p-2 rounded-lg bg-[var(--surface-input)] border border-[var(--surface-input-border)] text-xs text-[var(--text-primary)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={videoSettings.sharpen}
                  onChange={(e) => setVideoSettings({ sharpen: e.target.checked })}
                  className="rounded accent-sky-600 dark:accent-sky-500"
                />
                <span>{t.video.sharpen}</span>
              </label>

              <label className="flex items-center gap-2 p-2 rounded-lg bg-[var(--surface-input)] border border-[var(--surface-input-border)] text-xs text-[var(--text-primary)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={videoSettings.grayscale}
                  onChange={(e) => setVideoSettings({ grayscale: e.target.checked })}
                  className="rounded accent-sky-600 dark:accent-sky-500"
                />
                <span>{t.video.grayscale}</span>
              </label>
            </div>
          </div>

          {/* Subtitle Burn-In (Hardsub) */}
          <div className="space-y-1.5 pt-2 border-t border-[var(--border-subtle)]">
            <label className="text-xs font-semibold text-[var(--text-secondary)] flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Type className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                <span>{t.video.subtitleBurnIn}</span>
              </span>
              {videoSettings.subtitle_path && (
                <button
                  type="button"
                  onClick={() => setVideoSettings({ subtitle_path: undefined })}
                  className="text-[10px] text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 focus-studio"
                >
                  {t.video.clearSubtitle}
                </button>
              )}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                dir="ltr"
                readOnly
                placeholder={t.video.subtitlePlaceholder}
                value={videoSettings.subtitle_path || ''}
                className="flex-1 text-xs p-2 rounded-xl bg-[var(--surface-input)] border border-[var(--surface-input-border)] text-[var(--text-primary)] font-mono truncate focus-studio"
              />
              <button
                type="button"
                onClick={handlePickSubtitle}
                className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400 hover:bg-sky-500/20 border border-sky-500/30 shrink-0 focus-studio"
              >
                {t.actions.browse}
              </button>
            </div>
          </div>

          {/* Metadata Studio */}
          <div className="space-y-2 pt-2 border-t border-[var(--border-subtle)]">
            <span className="text-[11px] font-semibold text-[var(--text-muted)] flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
              <span>{t.video.metadataTagsTitle}</span>
            </span>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <label className="text-[10px] text-[var(--text-muted)] block mb-0.5">
                  {t.video.metadataTitle}
                </label>
                <input
                  type="text"
                  value={videoSettings.metadata_title || ''}
                  onChange={(e) => setVideoSettings({ metadata_title: e.target.value })}
                  placeholder={t.video.metadataTitlePlaceholder}
                  className="w-full p-1.5 rounded-lg bg-[var(--surface-input)] border border-[var(--surface-input-border)] text-[var(--text-primary)] text-xs focus-studio"
                />
              </div>
              <div>
                <label className="text-[10px] text-[var(--text-muted)] block mb-0.5">
                  {t.video.metadataArtist}
                </label>
                <input
                  type="text"
                  value={videoSettings.metadata_artist || ''}
                  onChange={(e) => setVideoSettings({ metadata_artist: e.target.value })}
                  placeholder={t.video.metadataArtistPlaceholder}
                  className="w-full p-1.5 rounded-lg bg-[var(--surface-input)] border border-[var(--surface-input-border)] text-[var(--text-primary)] text-xs focus-studio"
                />
              </div>
              <div>
                <label className="text-[10px] text-[var(--text-muted)] block mb-0.5">
                  {t.video.metadataAlbum}
                </label>
                <input
                  type="text"
                  value={videoSettings.metadata_album || ''}
                  onChange={(e) => setVideoSettings({ metadata_album: e.target.value })}
                  placeholder={t.video.metadataAlbumPlaceholder}
                  className="w-full p-1.5 rounded-lg bg-[var(--surface-input)] border border-[var(--surface-input-border)] text-[var(--text-primary)] text-xs focus-studio"
                />
              </div>
              <div>
                <label className="text-[10px] text-[var(--text-muted)] block mb-0.5">
                  {t.video.metadataYear}
                </label>
                <input
                  type="text"
                  dir="ltr"
                  value={videoSettings.metadata_year || ''}
                  onChange={(e) => setVideoSettings({ metadata_year: e.target.value })}
                  placeholder={t.video.metadataYearPlaceholder}
                  className="w-full p-1.5 rounded-lg bg-[var(--surface-input)] border border-[var(--surface-input-border)] text-[var(--text-primary)] text-xs font-mono focus-studio"
                />
              </div>
              <div className="col-span-2">
                <label className="text-[10px] text-[var(--text-muted)] block mb-0.5">
                  {t.video.metadataCopyright}
                </label>
                <input
                  type="text"
                  value={videoSettings.metadata_copyright || ''}
                  onChange={(e) => setVideoSettings({ metadata_copyright: e.target.value })}
                  placeholder={t.video.metadataCopyrightPlaceholder}
                  className="w-full p-1.5 rounded-lg bg-[var(--surface-input)] border border-[var(--surface-input-border)] text-[var(--text-primary)] text-xs focus-studio"
                />
              </div>
            </div>
          </div>

          {/* Stream Stripping Options */}
          <div className="space-y-2 pt-2 border-t border-[var(--border-subtle)]">
            <div className="grid grid-cols-2 gap-2">
              <label className="flex items-center gap-2 p-2 rounded-lg bg-[var(--surface-input)] border border-[var(--surface-input-border)] text-xs text-[var(--text-primary)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={videoSettings.strip_audio}
                  onChange={(e) => setVideoSettings({ strip_audio: e.target.checked })}
                  className="rounded accent-sky-600 dark:accent-sky-500"
                />
                <div className="truncate">
                  <span className="block font-medium truncate">{t.video.stripAudio}</span>
                </div>
              </label>

              <label className="flex items-center gap-2 p-2 rounded-lg bg-[var(--surface-input)] border border-[var(--surface-input-border)] text-xs text-[var(--text-primary)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={videoSettings.strip_subs}
                  onChange={(e) => setVideoSettings({ strip_subs: e.target.checked })}
                  className="rounded accent-sky-600 dark:accent-sky-500"
                />
                <div className="truncate">
                  <span className="block font-medium truncate">{t.video.stripSubs}</span>
                </div>
              </label>
            </div>
          </div>
        </GlassCard>
      )}
    </div>
  );
};
