import React, { useState } from 'react';
import { clsx } from 'clsx';
import {
  Settings,
  FolderOpen,
  Moon,
  Sun,
  Languages,
  RotateCcw,
  Cpu,
  Check,
  Bell,
  Type,
  ShieldCheck,
  Gauge,
  FileText,
  Trash2,
} from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { FontScale, ParallelMode, useConverterStore } from '../../store/useConverterStore';
import { useI18n } from '../../i18n/useI18n';
import { GlassCard } from '../common/GlassCard';
import { BdiText } from '../common/BdiText';
import { ModalDialog } from '../common/ModalDialog';
import { APP_METADATA } from '../../constants/app';
import { parseAppError } from '../../utils/errorParser';

export const SettingsPanel: React.FC = () => {
  const { t, language } = useI18n();
  const outputDir = useConverterStore((state) => state.outputDir);
  const setOutputDir = useConverterStore((state) => state.setOutputDir);
  const isProcessing = useConverterStore((state) => state.isProcessing);
  const theme = useConverterStore((state) => state.theme);
  const toggleTheme = useConverterStore((state) => state.toggleTheme);
  const toggleLanguage = useConverterStore((state) => state.toggleLanguage);
  const isProMode = useConverterStore((state) => state.isProMode);
  const toggleProMode = useConverterStore((state) => state.toggleProMode);
  const soundNotifications = useConverterStore((state) => state.soundNotifications);
  const toggleSoundNotifications = useConverterStore((state) => state.toggleSoundNotifications);
  const sleepPrevention = useConverterStore((state) => state.sleepPrevention);
  const setSleepPrevention = useConverterStore((state) => state.setSleepPrevention);
  const parallelMode = useConverterStore((state) => state.parallelMode);
  const setParallelMode = useConverterStore((state) => state.setParallelMode);
  const maxParallelJobs = useConverterStore((state) => state.maxParallelJobs);
  const setMaxParallelJobs = useConverterStore((state) => state.setMaxParallelJobs);
  const fontScale = useConverterStore((state) => state.fontScale);
  const setFontScale = useConverterStore((state) => state.setFontScale);
  const resetSettingsToDefault = useConverterStore((state) => state.resetSettingsToDefault);
  const addToast = useConverterStore((state) => state.addToast);

  const [resetSuccess, setResetSuccess] = useState(false);
  const [logsModalOpen, setLogsModalOpen] = useState(false);
  const [recentLogs, setRecentLogs] = useState<string[]>([]);

  const handleSelectDir = async () => {
    if (isProcessing) return;
    try {
      const selected = await open({
        directory: true,
        multiple: false,
      });

      if (selected && typeof selected === 'string') {
        setOutputDir(selected);
        addToast({ type: 'success', message: t.toasts.settingsSaved });
      }
    } catch (e) {
      addToast({ type: 'error', message: parseAppError(e, language) });
    }
  };

  const handleResetDefaults = () => {
    resetSettingsToDefault();
    setResetSuccess(true);
    addToast({ type: 'info', message: t.toasts.settingsReset });
    setTimeout(() => {
      setResetSuccess(false);
    }, 2500);
  };

  const handleViewLogs = async () => {
    try {
      const lines = await invoke<string[]>('get_recent_logs', { maxLines: 200 });
      setRecentLogs(lines);
      setLogsModalOpen(true);
    } catch (e) {
      addToast({ type: 'error', message: parseAppError(e, language) });
    }
  };

  const handleClearLogs = async () => {
    try {
      await invoke<number>('clear_old_logs');
      addToast({ type: 'success', message: t.settings.logsCleared });
    } catch (e) {
      addToast({ type: 'error', message: parseAppError(e, language) });
    }
  };

  const parallelOptions: Array<{ id: ParallelMode; label: string; desc: string }> = [
    { id: 'smart', label: t.settings.parallelSmart, desc: t.settings.parallelSmartDesc },
    { id: 'parallel', label: t.settings.parallelParallel, desc: t.settings.parallelParallelDesc },
    {
      id: 'sequential',
      label: t.settings.parallelSequential,
      desc: t.settings.parallelSequentialDesc,
    },
  ];

  const fontScaleOptions: Array<{ id: FontScale; label: string }> = [
    { id: 'small', label: t.settings.fontSmall },
    { id: 'medium', label: t.settings.fontMedium },
    { id: 'large', label: t.settings.fontLarge },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2 px-1">
        <Settings className="w-4 h-4 text-sky-600 dark:text-sky-400" />
        <h3 className="font-bold text-sm text-[var(--text-primary)]">{t.settings.title}</h3>
      </div>

      <GlassCard className="p-4 space-y-4">
        {/* Output Directory */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-[var(--text-secondary)] block">
            {t.settings.outputDir}
          </label>
          <div className="flex items-center gap-2">
            <div className="flex-1 p-2 rounded-xl bg-[var(--surface-input)] border border-[var(--surface-input-border)] text-xs font-mono text-[var(--text-primary)] truncate">
              <BdiText dir="ltr" mono>
                {outputDir || APP_METADATA.defaultOutputFolderName}
              </BdiText>
            </div>
            <button
              type="button"
              onClick={handleSelectDir}
              disabled={isProcessing}
              className="p-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] hover:bg-[var(--surface-card-hover)] text-sky-600 dark:text-sky-400 focus-studio transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
              title={t.actions.browse}
              aria-label={t.actions.browse}
            >
              <FolderOpen className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Theme Mode */}
        <div className="space-y-1.5 pt-2 border-t border-[var(--border-subtle)]">
          <label className="text-xs font-semibold text-[var(--text-secondary)] block">
            {t.settings.theme}
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                if (theme !== 'dark') toggleTheme();
              }}
              className={clsx(
                'flex items-center justify-center gap-2 p-2.5 rounded-xl border text-xs font-medium transition-all focus-studio',
                theme === 'dark'
                  ? 'border-sky-500/50 bg-sky-500/15 text-sky-700 dark:text-sky-300 font-semibold'
                  : 'border-[var(--border-subtle)] bg-[var(--surface-input)] text-[var(--text-secondary)] hover:bg-[var(--surface-input-hover)]'
              )}
            >
              <Moon className="w-3.5 h-3.5" />
              <span>{t.settings.dark}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                if (theme !== 'light') toggleTheme();
              }}
              className={clsx(
                'flex items-center justify-center gap-2 p-2.5 rounded-xl border text-xs font-medium transition-all focus-studio',
                theme === 'light'
                  ? 'border-sky-500/50 bg-sky-500/15 text-sky-700 dark:text-sky-300 font-semibold'
                  : 'border-[var(--border-subtle)] bg-[var(--surface-input)] text-[var(--text-secondary)] hover:bg-[var(--surface-input-hover)]'
              )}
            >
              <Sun className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" />
              <span>{t.settings.light}</span>
            </button>
          </div>
        </div>

        {/* Language */}
        <div className="space-y-1.5 pt-2 border-t border-[var(--border-subtle)]">
          <label className="text-xs font-semibold text-[var(--text-secondary)] block">
            {t.settings.language}
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                if (language !== 'fa') toggleLanguage();
              }}
              className={clsx(
                'flex items-center justify-center gap-2 p-2.5 rounded-xl border text-xs font-medium transition-all focus-studio',
                language === 'fa'
                  ? 'border-sky-500/50 bg-sky-500/15 text-sky-700 dark:text-sky-300 font-semibold'
                  : 'border-[var(--border-subtle)] bg-[var(--surface-input)] text-[var(--text-secondary)] hover:bg-[var(--surface-input-hover)]'
              )}
            >
              <Languages className="w-3.5 h-3.5" />
              <span>{t.settings.languageFa}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                if (language !== 'en') toggleLanguage();
              }}
              className={clsx(
                'flex items-center justify-center gap-2 p-2.5 rounded-xl border text-xs font-medium transition-all focus-studio',
                language === 'en'
                  ? 'border-sky-500/50 bg-sky-500/15 text-sky-700 dark:text-sky-300 font-semibold'
                  : 'border-[var(--border-subtle)] bg-[var(--surface-input)] text-[var(--text-secondary)] hover:bg-[var(--surface-input-hover)]'
              )}
            >
              <Languages className="w-3.5 h-3.5" />
              <span>{t.settings.languageEn}</span>
            </button>
          </div>
        </div>

        {/* Font Scale Selector */}
        <div className="space-y-1.5 pt-2 border-t border-[var(--border-subtle)]">
          <div>
            <label className="text-xs font-semibold text-[var(--text-secondary)] flex items-center gap-1.5">
              <Type className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
              <span>{t.settings.fontScale}</span>
            </label>
            <span className="text-[10px] text-[var(--text-muted)] block">
              {t.settings.fontScaleDesc}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {fontScaleOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setFontScale(opt.id)}
                className={clsx(
                  'py-1.5 px-2 text-center rounded-xl text-[11px] font-medium border transition-all focus-studio',
                  fontScale === opt.id
                    ? 'border-indigo-500/50 bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 font-semibold'
                    : 'border-[var(--border-subtle)] bg-[var(--surface-input)] text-[var(--text-secondary)] hover:bg-[var(--surface-input-hover)]'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Parallel Execution Strategy */}
        <div className="space-y-2 pt-2 border-t border-[var(--border-subtle)]">
          <div>
            <label className="text-xs font-semibold text-[var(--text-secondary)] flex items-center gap-1.5">
              <Gauge className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
              <span>{t.settings.parallelMode}</span>
            </label>
            <span className="text-[10px] text-[var(--text-muted)] block">
              {t.settings.parallelModeDesc}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {parallelOptions.map((mode) => (
              <button
                key={mode.id}
                type="button"
                title={mode.desc}
                onClick={() => setParallelMode(mode.id)}
                className={clsx(
                  'py-1.5 px-1.5 text-center rounded-xl text-[11px] font-medium border transition-all focus-studio truncate',
                  parallelMode === mode.id
                    ? 'border-sky-500/50 bg-sky-500/15 text-sky-700 dark:text-sky-300 font-semibold'
                    : 'border-[var(--border-subtle)] bg-[var(--surface-input)] text-[var(--text-secondary)] hover:bg-[var(--surface-input-hover)]'
                )}
              >
                {mode.label}
              </button>
            ))}
          </div>
        </div>

        {/* Pro Mode Toggle */}
        <div className="pt-2 border-t border-[var(--border-subtle)]">
          <div className="flex items-center justify-between gap-2">
            <div>
              <span className="text-xs font-semibold text-[var(--text-primary)] block">
                {t.settings.proMode}
              </span>
              <span className="text-[10px] text-[var(--text-muted)] block">
                {t.settings.proModeDesc}
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={isProMode}
              aria-label={t.settings.proMode}
              onClick={toggleProMode}
              className={clsx(
                'w-10 h-6 rounded-full transition-colors relative p-1 shrink-0 focus-studio',
                isProMode ? 'bg-sky-600 dark:bg-sky-500' : 'bg-slate-300 dark:bg-slate-700'
              )}
            >
              <div
                className={clsx(
                  'w-4 h-4 rounded-full bg-white transition-transform',
                  isProMode
                    ? language === 'fa'
                      ? '-translate-x-4'
                      : 'translate-x-4'
                    : 'translate-x-0'
                )}
              />
            </button>
          </div>
        </div>

        {/* Max Parallel Jobs (Pro Mode) */}
        {isProMode && (
          <div className="space-y-1.5 pt-2 border-t border-[var(--border-subtle)]">
            <label className="text-xs font-semibold text-[var(--text-secondary)] flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
              <span>{t.settings.maxParallel}</span>
            </label>
            <div className="grid grid-cols-5 gap-1.5">
              {[
                { val: 0, label: t.settings.parallelAuto },
                { val: 1, label: '1' },
                { val: 2, label: '2' },
                { val: 4, label: '4' },
                { val: 8, label: '8' },
              ].map((item) => (
                <button
                  key={item.val}
                  type="button"
                  onClick={() => setMaxParallelJobs(item.val)}
                  className={clsx(
                    'py-1.5 text-center rounded-xl text-xs font-medium border transition-all focus-studio',
                    maxParallelJobs === item.val
                      ? 'border-sky-500/50 bg-sky-500/15 text-sky-700 dark:text-sky-300 font-bold'
                      : 'border-[var(--border-subtle)] bg-[var(--surface-input)] text-[var(--text-secondary)] hover:bg-[var(--surface-input-hover)]'
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Sleep Prevention Toggle */}
        <div className="pt-2 border-t border-[var(--border-subtle)]">
          <div className="flex items-center justify-between gap-2">
            <div>
              <span className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" />
                <span>{t.settings.sleepPrevention}</span>
              </span>
              <span className="text-[10px] text-[var(--text-muted)] block">
                {t.settings.sleepPreventionDesc}
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={sleepPrevention}
              aria-label={t.settings.sleepPrevention}
              onClick={() => setSleepPrevention(!sleepPrevention)}
              className={clsx(
                'w-10 h-6 rounded-full transition-colors relative p-1 shrink-0 focus-studio',
                sleepPrevention ? 'bg-amber-600 dark:bg-amber-500' : 'bg-slate-300 dark:bg-slate-700'
              )}
            >
              <div
                className={clsx(
                  'w-4 h-4 rounded-full bg-white transition-transform',
                  sleepPrevention
                    ? language === 'fa'
                      ? '-translate-x-4'
                      : 'translate-x-4'
                    : 'translate-x-0'
                )}
              />
            </button>
          </div>
        </div>

        {/* Sound Notifications Toggle */}
        <div className="pt-2 border-t border-[var(--border-subtle)]">
          <div className="flex items-center justify-between gap-2">
            <div>
              <span className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                <Bell className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>{t.settings.soundNotification}</span>
              </span>
              <span className="text-[10px] text-[var(--text-muted)] block">
                {t.settings.soundNotificationDesc}
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={soundNotifications}
              aria-label={t.settings.soundNotification}
              onClick={toggleSoundNotifications}
              className={clsx(
                'w-10 h-6 rounded-full transition-colors relative p-1 shrink-0 focus-studio',
                soundNotifications
                  ? 'bg-emerald-600 dark:bg-emerald-500'
                  : 'bg-slate-300 dark:bg-slate-700'
              )}
            >
              <div
                className={clsx(
                  'w-4 h-4 rounded-full bg-white transition-transform',
                  soundNotifications
                    ? language === 'fa'
                      ? '-translate-x-4'
                      : 'translate-x-4'
                    : 'translate-x-0'
                )}
              />
            </button>
          </div>
        </div>

        {/* Diagnostics & Log Maintenance */}
        <div className="space-y-2 pt-2 border-t border-[var(--border-subtle)]">
          <span className="text-xs font-semibold text-[var(--text-secondary)] block">
            {t.settings.diagnosticsTitle}
          </span>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={handleViewLogs}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border border-[var(--border-subtle)] bg-[var(--surface-input)] hover:bg-[var(--surface-input-hover)] text-[var(--text-secondary)] transition-colors focus-studio"
            >
              <FileText className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
              <span>{t.settings.viewLogs}</span>
            </button>
            <button
              type="button"
              onClick={handleClearLogs}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border border-[var(--border-subtle)] bg-[var(--surface-input)] hover:bg-[var(--surface-input-hover)] text-[var(--text-secondary)] transition-colors focus-studio"
            >
              <Trash2 className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" />
              <span>{t.settings.clearLogs}</span>
            </button>
          </div>
        </div>

        {/* Reset to Defaults Action */}
        <div className="pt-2 border-t border-[var(--border-subtle)] flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleResetDefaults}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border border-[var(--border-subtle)] bg-[var(--surface-card)] hover:bg-[var(--surface-card-hover)] text-rose-600 dark:text-rose-400 transition-colors focus-studio"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>{t.settings.resetDefaults}</span>
          </button>
          <span
            className={clsx(
              'text-[11px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-medium transition-opacity duration-200',
              resetSuccess ? 'opacity-100' : 'opacity-0 pointer-events-none'
            )}
            aria-hidden={!resetSuccess}
          >
            <Check className="w-3.5 h-3.5" />
            <span>{t.settings.resetConfirm}</span>
          </span>
        </div>
      </GlassCard>

      {/* Diagnostic Log Viewer Modal */}
      <ModalDialog
        open={logsModalOpen}
        onClose={() => setLogsModalOpen(false)}
        title={t.settings.diagnosticsTitle}
        icon={<FileText className="w-5 h-5 text-sky-600 dark:text-sky-400" />}
        maxWidthClass="max-w-2xl"
      >
        <div className="max-h-96 overflow-y-auto rounded-xl bg-slate-950 text-slate-200 p-3 font-mono text-[11px] leading-relaxed scrollbar-thin">
          {recentLogs.length === 0 ? (
            <div className="text-slate-300 text-center py-8">-</div>
          ) : (
            <BdiText dir="ltr" mono className="block whitespace-pre-wrap break-all">
              {recentLogs.join('\n')}
            </BdiText>
          )}
        </div>
      </ModalDialog>
    </div>
  );
};
