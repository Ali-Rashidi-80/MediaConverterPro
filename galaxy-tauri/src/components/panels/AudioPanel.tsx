import React from 'react';
import { clsx } from 'clsx';
import {
  Music,
  Radio,
  Volume2,
  Sliders,
  AlertTriangle,
  RefreshCw,
  Sparkles,
  Shield,
  Gauge,
  FileText,
} from 'lucide-react';
import { useConverterStore } from '../../store/useConverterStore';
import { useI18n } from '../../i18n/useI18n';
import { AudioConversionSettings } from '../../types';
import {
  SUPPORTED_AUDIO_FORMATS,
  SUPPORTED_AUDIO_BITRATES,
  AUDIO_SAMPLE_RATES,
  LOUDNORM_PRESETS,
  SPEED_PRESETS,
} from '../../constants/app';
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

export const AudioPanel: React.FC = () => {
  const { t, language } = useI18n();
  const audioSettings = useConverterStore((state) => state.audioSettings);
  const setAudioSettings = useConverterStore((state) => state.setAudioSettings);
  const isProMode = useConverterStore((state) => state.isProMode);

  const isLossless = ['flac', 'wav', 'alac'].includes(audioSettings.format.toLowerCase());
  const activeChannel = audioSettings.channels || 'original';

  const handleSelectFormat = (fmt: string) => {
    const updates: Partial<AudioConversionSettings> = { format: fmt };
    if (fmt.toLowerCase() === 'mp3' && audioSettings.sample_rate > 48000) {
      updates.sample_rate = 48000;
    }
    setAudioSettings(updates);
  };

  const handleResetAudio = () => {
    setAudioSettings({
      volume: 100,
      bass_boost: 0,
      treble_boost: 0,
      compressor: false,
      reverb: false,
      downmix: false,
      loudnorm_preset: 'none',
      normalize: false,
    });
  };

  const parsedStart = parseTimecodeInput(audioSettings.trim_start);
  const parsedEnd = parseTimecodeInput(audioSettings.trim_end);
  const hasTrimSyntaxError = !parsedStart.valid || !parsedEnd.valid;
  const hasTrimOrderError =
    parsedStart.valid &&
    parsedEnd.valid &&
    parsedStart.secs !== null &&
    parsedEnd.secs !== null &&
    parsedStart.secs >= parsedEnd.secs;

  const bassVal = audioSettings.bass_boost ?? 0;
  const trebleVal = audioSettings.treble_boost ?? 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <Music className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <h3 className="font-bold text-sm text-[var(--text-primary)]">{t.audio.title}</h3>
        </div>
        <button
          type="button"
          onClick={handleResetAudio}
          className="text-[11px] text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 flex items-center gap-1 transition-colors px-2 py-0.5 rounded-lg border border-emerald-500/25 focus-studio"
        >
          <RefreshCw className="w-3 h-3" />
          <span>{t.audio.resetAudio}</span>
        </button>
      </div>

      <GlassCard className="p-4 space-y-4">
        {/* Format Selector */}
        <div>
          <label className="text-xs font-semibold text-[var(--text-secondary)] mb-2 block">
            {t.audio.targetFormat}
          </label>
          <div className="grid grid-cols-5 gap-1.5 bg-[var(--surface-input)] p-1 rounded-xl border border-[var(--surface-input-border)]">
            {SUPPORTED_AUDIO_FORMATS.map((fmt) => (
              <button
                key={fmt}
                type="button"
                onClick={() => handleSelectFormat(fmt)}
                className={clsx(
                  'py-1.5 text-center rounded-lg text-xs font-mono font-medium uppercase transition-all focus-studio',
                  audioSettings.format === fmt
                    ? 'bg-emerald-600 dark:bg-emerald-500 text-white font-bold shadow'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-input-hover)]'
                )}
              >
                {fmt}
              </button>
            ))}
          </div>
        </div>

        {/* Bitrate Selector or Lossless Notice */}
        {!isLossless ? (
          <div>
            <label className="text-xs font-semibold text-[var(--text-secondary)] mb-2 block">
              {t.audio.bitrate}
            </label>
            <div className="grid grid-cols-5 gap-1.5">
              {SUPPORTED_AUDIO_BITRATES.map((br) => (
                <button
                  key={br}
                  type="button"
                  onClick={() => setAudioSettings({ bitrate: br })}
                  className={clsx(
                    'py-2 text-center rounded-xl text-xs font-mono border transition-all focus-studio',
                    audioSettings.bitrate === br
                      ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-bold'
                      : 'border-[var(--border-subtle)] bg-[var(--surface-input)] text-[var(--text-secondary)] hover:bg-[var(--surface-input-hover)]'
                  )}
                >
                  <BdiText dir="ltr" mono>
                    {br}
                  </BdiText>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-[11px] text-emerald-700 dark:text-emerald-300">
            {t.audio.losslessNotice}
          </div>
        )}

        {/* Sample Rate */}
        <div>
          <label className="text-xs font-semibold text-[var(--text-secondary)] mb-1.5 block">
            {t.audio.sampleRate}
          </label>
          <select
            value={audioSettings.sample_rate}
            onChange={(e) => setAudioSettings({ sample_rate: parseInt(e.target.value, 10) })}
            className="w-full text-xs p-2 rounded-xl bg-[var(--surface-input)] border border-[var(--surface-input-border)] text-[var(--text-primary)] focus-studio"
          >
            {AUDIO_SAMPLE_RATES.map((sr) => {
              const isClamped = audioSettings.format === 'mp3' && sr.value > 48000;
              const label =
                'labelKey' in sr
                  ? t.audio[sr.labelKey as keyof typeof t.audio]
                  : language === 'fa'
                  ? sr.labelFa
                  : sr.labelEn;
              return (
                <option
                  key={sr.value}
                  value={sr.value}
                  disabled={isClamped}
                  className="bg-[var(--surface-card)] text-[var(--text-primary)]"
                >
                  {label} {isClamped ? `(${t.validation.mp3SampleRateClamped})` : ''}
                </option>
              );
            })}
          </select>
        </div>

        {/* Channels (Original / Stereo / Mono) */}
        <div>
          <label className="text-xs font-semibold text-[var(--text-secondary)] mb-1.5 flex items-center gap-1">
            <Radio className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>{t.audio.channels}</span>
          </label>
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: 'original', label: t.audio.channelsOriginal },
              { id: 'stereo', label: t.audio.stereo },
              { id: 'mono', label: t.audio.mono },
            ].map((ch) => (
              <button
                key={ch.id}
                type="button"
                onClick={() => setAudioSettings({ channels: ch.id })}
                className={clsx(
                  'py-2 px-1.5 text-center rounded-xl text-[11px] font-medium border transition-all focus-studio truncate',
                  activeChannel === ch.id
                    ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-semibold'
                    : 'border-[var(--border-subtle)] bg-[var(--surface-input)] text-[var(--text-secondary)] hover:bg-[var(--surface-input-hover)]'
                )}
              >
                {ch.label}
              </button>
            ))}
          </div>
        </div>
      </GlassCard>

      {/* Advanced / Pro Audio Mastering Controls */}
      {isProMode && (
        <GlassCard className="p-4 space-y-4 border-emerald-500/20">
          <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-bold text-xs">
            <Sliders className="w-3.5 h-3.5" />
            <span>{t.audio.mastering}</span>
          </div>

          {/* Volume Slider */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-[var(--text-secondary)] flex items-center gap-1.5">
                <Volume2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>{t.audio.volume}</span>
              </span>
              <BdiText dir="ltr" mono className="font-bold text-emerald-600 dark:text-emerald-400">
                {audioSettings.volume ?? 100}%
              </BdiText>
            </div>
            <input
              type="range"
              min="50"
              max="200"
              step="5"
              value={audioSettings.volume ?? 100}
              onChange={(e) => setAudioSettings({ volume: parseInt(e.target.value, 10) })}
              className="w-full accent-emerald-600 dark:accent-emerald-500 cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-[var(--text-muted)]">
              <BdiText dir="ltr">50%</BdiText>
              <span>{t.audio.volumeNormal}</span>
              <BdiText dir="ltr">200%</BdiText>
            </div>
          </div>

          {/* EBU R128 Loudness Normalization Presets */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[var(--text-secondary)] flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>{t.audio.loudnormPreset}</span>
            </label>
            <select
              value={audioSettings.loudnorm_preset || 'none'}
              onChange={(e) =>
                setAudioSettings({
                  loudnorm_preset: e.target.value,
                  normalize: e.target.value !== 'none',
                })
              }
              className="w-full text-xs p-2 rounded-xl bg-[var(--surface-input)] border border-[var(--surface-input-border)] text-[var(--text-primary)] focus-studio"
            >
              {LOUDNORM_PRESETS.map((lp) => (
                <option
                  key={lp.id}
                  value={lp.id}
                  className="bg-[var(--surface-card)] text-[var(--text-primary)]"
                >
                  {language === 'fa' ? lp.labelFa : lp.labelEn}
                </option>
              ))}
            </select>
          </div>

          {/* Equalization: Bass & Treble */}
          <div className="grid grid-cols-2 gap-3 text-xs p-3 rounded-xl bg-[var(--surface-input)]/50 border border-[var(--surface-input-border)]">
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] text-[var(--text-muted)]">
                <span>{t.audio.bassBoost}</span>
                <BdiText dir="ltr" mono className="text-emerald-600 dark:text-emerald-400">
                  {bassVal > 0 ? `+${bassVal}` : bassVal} dB
                </BdiText>
              </div>
              <input
                type="range"
                min="-10.0"
                max="15.0"
                step="0.5"
                value={bassVal}
                onChange={(e) => setAudioSettings({ bass_boost: parseFloat(e.target.value) })}
                className="w-full accent-emerald-600 dark:accent-emerald-500 cursor-pointer h-1.5"
              />
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-[10px] text-[var(--text-muted)]">
                <span>{t.audio.trebleBoost}</span>
                <BdiText dir="ltr" mono className="text-emerald-600 dark:text-emerald-400">
                  {trebleVal > 0 ? `+${trebleVal}` : trebleVal} dB
                </BdiText>
              </div>
              <input
                type="range"
                min="-10.0"
                max="15.0"
                step="0.5"
                value={trebleVal}
                onChange={(e) => setAudioSettings({ treble_boost: parseFloat(e.target.value) })}
                className="w-full accent-emerald-600 dark:accent-emerald-500 cursor-pointer h-1.5"
              />
            </div>
          </div>

          {/* Mastering Switches: Compressor, Reverb, Downmix */}
          <div className="space-y-2 pt-2 border-t border-[var(--border-subtle)] text-xs">
            <label className="flex items-center gap-2 p-2 rounded-lg bg-[var(--surface-input)] border border-[var(--surface-input-border)] cursor-pointer">
              <input
                type="checkbox"
                checked={audioSettings.compressor ?? false}
                onChange={(e) => setAudioSettings({ compressor: e.target.checked })}
                className="rounded accent-emerald-600 dark:accent-emerald-500"
              />
              <span className="font-medium text-[var(--text-primary)]">{t.audio.compressor}</span>
            </label>

            <label className="flex items-center gap-2 p-2 rounded-lg bg-[var(--surface-input)] border border-[var(--surface-input-border)] cursor-pointer">
              <input
                type="checkbox"
                checked={audioSettings.reverb ?? false}
                onChange={(e) => setAudioSettings({ reverb: e.target.checked })}
                className="rounded accent-emerald-600 dark:accent-emerald-500"
              />
              <span className="font-medium text-[var(--text-primary)]">{t.audio.reverb}</span>
            </label>

            <label className="flex items-center gap-2 p-2 rounded-lg bg-[var(--surface-input)] border border-[var(--surface-input-border)] cursor-pointer">
              <input
                type="checkbox"
                checked={audioSettings.downmix ?? false}
                onChange={(e) => setAudioSettings({ downmix: e.target.checked })}
                className="rounded accent-emerald-600 dark:accent-emerald-500"
              />
              <span className="font-medium text-[var(--text-primary)]">{t.audio.downmix}</span>
            </label>

            <label className="flex items-center gap-2 p-2 rounded-lg bg-emerald-500/5 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 cursor-pointer">
              <input
                type="checkbox"
                checked={audioSettings.privacy_wipe ?? false}
                onChange={(e) => setAudioSettings({ privacy_wipe: e.target.checked })}
                className="rounded accent-emerald-600 dark:accent-emerald-500"
              />
              <Shield className="w-3.5 h-3.5 shrink-0" />
              <span className="font-medium">{t.video.privacyWipe}</span>
            </label>
          </div>

          {/* Audio Speed */}
          <div className="space-y-2 p-3 rounded-xl bg-[var(--surface-input)]/50 border border-[var(--surface-input-border)]">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-[var(--text-secondary)] flex items-center gap-1.5">
                <Gauge className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" />
                <span>{t.audio.speed}</span>
              </span>
              <BdiText dir="ltr" mono className="font-bold text-amber-700 dark:text-amber-400">
                {(audioSettings.speed ?? 1).toFixed(2)}x
              </BdiText>
            </div>
            <div className="flex gap-1">
              {SPEED_PRESETS.map((sp) => (
                <button
                  key={sp}
                  type="button"
                  onClick={() => setAudioSettings({ speed: sp })}
                  className={clsx(
                    'flex-1 py-1 text-center rounded-lg text-[10px] font-mono transition-all focus-studio',
                    (audioSettings.speed ?? 1) === sp
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
              value={audioSettings.speed ?? 1}
              onChange={(e) => setAudioSettings({ speed: parseFloat(e.target.value) })}
              className="w-full accent-amber-600 dark:accent-amber-500 cursor-pointer h-1.5 mt-1"
            />
          </div>

          {/* ID3 Metadata Studio */}
          <div className="space-y-2 pt-2 border-t border-[var(--border-subtle)]">
            <span className="text-[11px] font-semibold text-[var(--text-muted)] flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>{t.audio.metadataTagsTitle}</span>
            </span>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <label className="text-[10px] text-[var(--text-muted)] block mb-0.5">
                  {t.video.metadataTitle}
                </label>
                <input
                  type="text"
                  value={audioSettings.metadata_title || ''}
                  onChange={(e) => setAudioSettings({ metadata_title: e.target.value })}
                  placeholder={t.audio.metadataTitlePlaceholder}
                  className="w-full p-1.5 rounded-lg bg-[var(--surface-input)] border border-[var(--surface-input-border)] text-[var(--text-primary)] text-xs focus-studio"
                />
              </div>
              <div>
                <label className="text-[10px] text-[var(--text-muted)] block mb-0.5">
                  {t.video.metadataArtist}
                </label>
                <input
                  type="text"
                  value={audioSettings.metadata_artist || ''}
                  onChange={(e) => setAudioSettings({ metadata_artist: e.target.value })}
                  placeholder={t.audio.metadataArtistPlaceholder}
                  className="w-full p-1.5 rounded-lg bg-[var(--surface-input)] border border-[var(--surface-input-border)] text-[var(--text-primary)] text-xs focus-studio"
                />
              </div>
              <div>
                <label className="text-[10px] text-[var(--text-muted)] block mb-0.5">
                  {t.audio.metadataAlbum}
                </label>
                <input
                  type="text"
                  value={audioSettings.metadata_album || ''}
                  onChange={(e) => setAudioSettings({ metadata_album: e.target.value })}
                  placeholder={t.audio.metadataAlbumPlaceholder}
                  className="w-full p-1.5 rounded-lg bg-[var(--surface-input)] border border-[var(--surface-input-border)] text-[var(--text-primary)] text-xs focus-studio"
                />
              </div>
              <div>
                <label className="text-[10px] text-[var(--text-muted)] block mb-0.5">
                  {t.audio.metadataYear}
                </label>
                <input
                  type="text"
                  dir="ltr"
                  value={audioSettings.metadata_year || ''}
                  onChange={(e) => setAudioSettings({ metadata_year: e.target.value })}
                  placeholder={t.audio.metadataYearPlaceholder}
                  className="w-full p-1.5 rounded-lg bg-[var(--surface-input)] border border-[var(--surface-input-border)] text-[var(--text-primary)] text-xs font-mono focus-studio"
                />
              </div>
              <div className="col-span-2">
                <label className="text-[10px] text-[var(--text-muted)] block mb-0.5">
                  {t.audio.metadataCopyright}
                </label>
                <input
                  type="text"
                  value={audioSettings.metadata_copyright || ''}
                  onChange={(e) => setAudioSettings({ metadata_copyright: e.target.value })}
                  placeholder={t.audio.metadataCopyrightPlaceholder}
                  className="w-full p-1.5 rounded-lg bg-[var(--surface-input)] border border-[var(--surface-input-border)] text-[var(--text-primary)] text-xs focus-studio"
                />
              </div>
            </div>
          </div>

          {/* Audio Trimming */}
          <div className="grid grid-cols-2 gap-3 text-xs pt-2 border-t border-[var(--border-subtle)]">
            <div>
              <label className="text-[11px] text-[var(--text-muted)] mb-1 block">
                {t.audio.trimStart}
              </label>
              <input
                type="text"
                dir="ltr"
                placeholder={t.audio.trimPlaceholder}
                value={audioSettings.trim_start || ''}
                onChange={(e) => setAudioSettings({ trim_start: e.target.value })}
                className={clsx(
                  'w-full p-2 rounded-xl bg-[var(--surface-input)] border text-[var(--text-primary)] font-mono text-xs focus-studio',
                  !parsedStart.valid
                    ? 'border-rose-500/60'
                    : 'border-[var(--surface-input-border)]'
                )}
              />
            </div>

            <div>
              <label className="text-[11px] text-[var(--text-muted)] mb-1 block">
                {t.audio.trimEnd}
              </label>
              <input
                type="text"
                dir="ltr"
                placeholder={t.audio.trimPlaceholder}
                value={audioSettings.trim_end || ''}
                onChange={(e) => setAudioSettings({ trim_end: e.target.value })}
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
        </GlassCard>
      )}
    </div>
  );
};
