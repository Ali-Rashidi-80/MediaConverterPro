import React, { useState } from 'react';
import {
  Info,
  CheckCircle2,
  Cpu,
  FolderOpen,
  Keyboard,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  Layers,
  Settings,
  Zap,
  Scale,
  UserCheck,
  ExternalLink,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useConverterStore } from '../../store/useConverterStore';
import { useI18n } from '../../i18n/useI18n';
import { GlassCard } from '../common/GlassCard';
import { Badge } from '../common/Badge';
import { BdiText } from '../common/BdiText';
import { APP_METADATA } from '../../constants/app';
import { parseAppError } from '../../utils/errorParser';

export const AboutPanel: React.FC = () => {
  const { t, language } = useI18n();
  const hardwareProfile = useConverterStore((state) => state.hardwareProfile);
  const outputDir = useConverterStore((state) => state.outputDir);
  const setActiveTab = useConverterStore((state) => state.setActiveTab);
  const addToast = useConverterStore((state) => state.addToast);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const handleOpenFolder = async () => {
    try {
      await invoke('open_output_folder', { path: outputDir || '' });
    } catch (e) {
      addToast({ type: 'error', message: parseAppError(e, language) });
    }
  };

  const faqs = [
    { q: t.about.faq1Q, a: t.about.faq1A },
    { q: t.about.faq2Q, a: t.about.faq2A },
    { q: t.about.faq3Q, a: t.about.faq3A },
  ];

  const shortcuts = [
    { key: 'Ctrl + O', label: t.actions.addFiles },
    { key: 'Ctrl + Shift + O', label: t.actions.addFolder },
    { key: 'Ctrl + Enter', label: t.actions.startQueue },
    { key: 'Ctrl + F', label: t.queue.searchPlaceholder.split('...')[0] },
    { key: 'Ctrl + L', label: t.settings.language },
    { key: 'Ctrl + ,', label: t.settings.title },
    { key: 'Ctrl + Shift + P', label: t.settings.proMode },
  ];

  const isFfmpegReady = Boolean(hardwareProfile?.ffmpeg_available);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2 px-1">
        <Info className="w-4 h-4 text-sky-600 dark:text-sky-400" />
        <h3 className="font-bold text-sm text-[var(--text-primary)]">{t.about.title}</h3>
      </div>

      {/* Hero Brand Card */}
      <GlassCard className="p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center text-white font-bold text-lg shadow-md shadow-sky-500/20 shrink-0">
            G
          </div>
          <div className="min-w-0">
            <h4 className="font-bold text-sm text-[var(--text-primary)]">{t.appTitle}</h4>
            <div className="flex items-center gap-2 mt-0.5">
              <BdiText dir="ltr" mono className="text-[11px] text-[var(--text-muted)]">
                v{APP_METADATA.version}
              </BdiText>
              <Badge variant="primary" className="text-[10px] py-0 px-1.5">
                <BdiText dir="ltr">{APP_METADATA.edition}</BdiText>
              </Badge>
            </div>
          </div>
        </div>

        <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{t.about.desc}</p>

        <div className="pt-2 border-t border-[var(--border-subtle)] text-[10px] text-[var(--text-muted)] font-mono">
          {t.about.techStack}
        </div>
      </GlassCard>

      {/* System Diagnostics Card */}
      <GlassCard className="p-4 space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-secondary)]">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <span>{t.about.systemReadiness}</span>
        </div>

        <div className="space-y-2 text-xs">
          {/* Real FFmpeg Status */}
          <div className="p-2 rounded-xl bg-[var(--surface-input)] border border-[var(--surface-input-border)] space-y-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" />
                <span className="text-[11px]">{t.about.ffmpegEngine}</span>
              </div>
              <Badge variant={isFfmpegReady ? 'success' : 'danger'} className="text-[10px]">
                {isFfmpegReady ? t.about.ffmpegReady : t.about.ffmpegMissing}
              </Badge>
            </div>
            {hardwareProfile?.ffmpeg_path && (
              <p
                className="text-[10px] text-[var(--text-muted)] truncate"
                title={hardwareProfile.ffmpeg_path}
              >
                <BdiText dir="ltr" mono>
                  {hardwareProfile.ffmpeg_path}
                </BdiText>
              </p>
            )}
          </div>

          {/* Hardware Acceleration Status */}
          <div className="flex items-center justify-between p-2 rounded-xl bg-[var(--surface-input)] border border-[var(--surface-input-border)]">
            <div className="flex items-center gap-2">
              <Cpu className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
              <span className="text-[11px]">{t.about.hwEngine}</span>
            </div>
            <Badge variant="primary" className="text-[10px] uppercase font-mono">
              {hardwareProfile?.recommended_backend || 'CPU'}
            </Badge>
          </div>

          {/* Output Destination Folder */}
          <div className="flex items-center justify-between gap-2 p-2 rounded-xl bg-[var(--surface-input)] border border-[var(--surface-input-border)]">
            <div className="flex items-center gap-2 min-w-0">
              <FolderOpen className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
              <span className="text-[11px] truncate max-w-[190px]">
                <BdiText dir="ltr" mono>
                  {outputDir || APP_METADATA.defaultOutputFolderName}
                </BdiText>
              </span>
            </div>
            <button
              type="button"
              onClick={handleOpenFolder}
              className="text-[10px] text-sky-600 dark:text-sky-400 hover:underline shrink-0 font-medium focus-studio"
            >
              {t.actions.openFolder}
            </button>
          </div>
        </div>
      </GlassCard>

      {/* FFmpeg GNU GPL Attribution Card */}
      <GlassCard className="p-4 space-y-2.5 border-amber-500/20">
        <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-secondary)]">
          <Scale className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0" />
          <span>{t.about.gplTitle}</span>
        </div>
        <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
          {t.about.gplNotice}
        </p>
        <p className="text-[10px] text-[var(--text-muted)] leading-relaxed">
          {t.about.gplBuildsNotice}
        </p>
        <div className="flex flex-wrap items-center gap-2 pt-1 text-[10px]">
          <a
            href="https://ffmpeg.org/legal.html"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[var(--surface-input)] border border-[var(--surface-input-border)] text-sky-600 dark:text-sky-400 hover:underline focus-studio"
          >
            <span>{t.about.gplLinkLabel}</span>
            <ExternalLink className="w-3 h-3" />
          </a>
          <Badge variant="neutral" className="text-[10px]">
            <BdiText dir="ltr" mono>
              gyan.dev
            </BdiText>
          </Badge>
          <Badge variant="neutral" className="text-[10px]">
            <BdiText dir="ltr" mono>
              BtbN
            </BdiText>
          </Badge>
        </div>
      </GlassCard>

      {/* Developer / Author Credits Card */}
      <GlassCard className="p-4 space-y-2.5 border-indigo-500/20">
        <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-secondary)]">
          <UserCheck className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
          <span>{t.about.authorTitle}</span>
        </div>
        <div className="p-2.5 rounded-xl bg-[var(--surface-input)] border border-[var(--surface-input-border)] space-y-1">
          <div className="text-xs font-bold text-[var(--text-primary)]">
            <BdiText dir="ltr">
              {APP_METADATA.authorName} · {APP_METADATA.authorBrand}
            </BdiText>
          </div>
          <div className="text-[10px] text-[var(--text-muted)]">{t.about.creditsSubtitle}</div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <a
            href={APP_METADATA.telegramChannel}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between p-2 rounded-xl bg-[var(--surface-input)] border border-[var(--surface-input-border)] hover:bg-[var(--surface-input-hover)] transition-colors focus-studio"
          >
            <span className="text-[var(--text-secondary)] truncate">{t.about.telegramChannel}</span>
            <BdiText dir="ltr" mono className="text-sky-600 dark:text-sky-400 font-semibold">
              {APP_METADATA.telegramHandle}
            </BdiText>
          </a>
          <a
            href={APP_METADATA.contactUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between p-2 rounded-xl bg-[var(--surface-input)] border border-[var(--surface-input-border)] hover:bg-[var(--surface-input-hover)] transition-colors focus-studio"
          >
            <span className="text-[var(--text-secondary)] truncate">{t.about.contactDeveloper}</span>
            <BdiText dir="ltr" mono className="text-indigo-600 dark:text-indigo-400 font-semibold">
              {APP_METADATA.contactHandle}
            </BdiText>
          </a>
        </div>
      </GlassCard>

      {/* 3-Step Workflow Guide */}
      <GlassCard className="p-4 space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-secondary)]">
          <Layers className="w-4 h-4 text-sky-600 dark:text-sky-400" />
          <span>{t.about.quickStartTitle}</span>
        </div>

        <div className="space-y-2.5 text-xs">
          <div className="flex items-start gap-2.5 p-2 rounded-xl bg-[var(--surface-input)] border border-[var(--surface-input-border)]">
            <div className="w-5 h-5 rounded-full bg-sky-500/20 text-sky-600 dark:text-sky-400 font-bold text-[11px] flex items-center justify-center shrink-0 mt-0.5">
              1
            </div>
            <div className="space-y-0.5">
              <span className="font-semibold text-[var(--text-primary)] block text-[11px]">
                {t.about.step1Title}
              </span>
              <p className="text-[10px] text-[var(--text-muted)] leading-relaxed">
                {t.about.step1Desc}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2.5 p-2 rounded-xl bg-[var(--surface-input)] border border-[var(--surface-input-border)]">
            <div className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 font-bold text-[11px] flex items-center justify-center shrink-0 mt-0.5">
              2
            </div>
            <div className="space-y-0.5">
              <span className="font-semibold text-[var(--text-primary)] block text-[11px]">
                {t.about.step2Title}
              </span>
              <p className="text-[10px] text-[var(--text-muted)] leading-relaxed">
                {t.about.step2Desc}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2.5 p-2 rounded-xl bg-[var(--surface-input)] border border-[var(--surface-input-border)]">
            <div className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-bold text-[11px] flex items-center justify-center shrink-0 mt-0.5">
              3
            </div>
            <div className="space-y-0.5">
              <span className="font-semibold text-[var(--text-primary)] block text-[11px]">
                {t.about.step3Title}
              </span>
              <p className="text-[10px] text-[var(--text-muted)] leading-relaxed">
                {t.about.step3Desc}
              </p>
            </div>
          </div>
        </div>
      </GlassCard>

      {/* Keyboard Shortcuts Reference */}
      <GlassCard className="p-4 space-y-2.5">
        <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-secondary)]">
          <Keyboard className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
          <span>{t.about.shortcuts}</span>
        </div>

        <div className="grid grid-cols-1 gap-1.5 text-xs">
          {shortcuts.map((sc) => (
            <div
              key={sc.key}
              className="flex items-center justify-between p-2 rounded-lg bg-[var(--surface-input)] border border-[var(--surface-input-border)]"
            >
              <span className="text-[11px] text-[var(--text-secondary)]">{sc.label}</span>
              <BdiText dir="ltr">
                <kbd className="px-2 py-0.5 rounded bg-[var(--surface-card)] border border-[var(--border-subtle)] font-mono text-[10px] text-sky-600 dark:text-sky-400 font-semibold shadow-xs">
                  {sc.key}
                </kbd>
              </BdiText>
            </div>
          ))}
        </div>
      </GlassCard>

      {/* FAQs Accordion */}
      <GlassCard className="p-4 space-y-2.5">
        <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-secondary)]">
          <HelpCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <span>{t.about.faqTitle}</span>
        </div>

        <div className="space-y-1.5">
          {faqs.map((faq, idx) => {
            const isOpen = openFaq === idx;
            return (
              <div
                key={idx}
                className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-input)] overflow-hidden transition-all text-xs"
              >
                <button
                  type="button"
                  onClick={() => setOpenFaq(isOpen ? null : idx)}
                  className="w-full flex items-center justify-between p-2.5 text-start font-medium text-[var(--text-primary)] hover:bg-[var(--surface-input-hover)] transition-colors focus-studio"
                >
                  <span className="text-[11px]">{faq.q}</span>
                  {isOpen ? (
                    <ChevronUp className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 shrink-0" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
                  )}
                </button>
                {isOpen && (
                  <div className="p-2.5 pt-0 text-[10px] text-[var(--text-muted)] leading-relaxed border-t border-[var(--border-subtle)]/50">
                    {faq.a}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </GlassCard>

      {/* Quick Action Footer */}
      <div className="grid grid-cols-2 gap-2 pt-1">
        <button
          type="button"
          onClick={() => setActiveTab('settings')}
          className="flex items-center justify-center gap-1.5 p-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] hover:bg-[var(--surface-card-hover)] text-xs text-[var(--text-secondary)] transition-colors focus-studio"
        >
          <Settings className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
          <span>{t.settings.title}</span>
        </button>

        <button
          type="button"
          onClick={handleOpenFolder}
          className="flex items-center justify-center gap-1.5 p-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] hover:bg-[var(--surface-card-hover)] text-xs text-[var(--text-secondary)] transition-colors focus-studio"
        >
          <FolderOpen className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" />
          <span>{t.actions.openFolder}</span>
        </button>
      </div>
    </div>
  );
};
