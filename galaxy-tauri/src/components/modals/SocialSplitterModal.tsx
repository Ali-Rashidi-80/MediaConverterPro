import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { clsx } from 'clsx';
import {
  Scissors,
  FolderOpen,
  Play,
  CheckCircle2,
  AlertCircle,
  Layers,
  X,
} from 'lucide-react';
import { ModalDialog } from '../common/ModalDialog';
import { BdiText } from '../common/BdiText';
import { useI18n } from '../../i18n/useI18n';
import { useConverterStore } from '../../store/useConverterStore';
import { parseAppError } from '../../utils/errorParser';

export const SocialSplitterModal: React.FC = () => {
  const { t, language } = useI18n();
  const setActiveModal = useConverterStore((state) => state.setActiveModal);
  const storeOutputDir = useConverterStore((state) => state.outputDir);
  const addToast = useConverterStore((state) => state.addToast);

  const [inputPath, setInputPath] = useState('');
  const [targetOutputDir, setTargetOutputDir] = useState(storeOutputDir || '');
  const [segmentDuration, setSegmentDuration] = useState(15);
  const [overlapSec, setOverlapSec] = useState(2);
  const [blurBg, setBlurBg] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [outputParts, setOutputParts] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isOverlapInvalid = overlapSec >= segmentDuration;

  const handleClose = () => {
    if (isProcessing) return;
    setActiveModal('none');
  };

  const handleSelectFile = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        filters: [{ name: 'Video Files', extensions: ['mp4', 'mov', 'mkv', 'avi', 'webm'] }],
        multiple: false,
      });
      if (selected && typeof selected === 'string') {
        setInputPath(selected);
        setOutputParts([]);
        setErrorMsg(null);
      }
    } catch (e) {
      addToast({ type: 'error', message: parseAppError(e, language) });
    }
  };

  const handleSelectOutputDir = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        directory: true,
        multiple: false,
      });
      if (selected && typeof selected === 'string') {
        setTargetOutputDir(selected);
      }
    } catch (e) {
      addToast({ type: 'error', message: parseAppError(e, language) });
    }
  };

  const handleStartSplit = async () => {
    if (!inputPath || isProcessing) return;
    if (isOverlapInvalid) {
      setErrorMsg(t.socialSplitter.maxOverlapHint);
      return;
    }

    setIsProcessing(true);
    setErrorMsg(null);
    setOutputParts([]);

    try {
      const parts = await invoke<string[]>('split_social_video', {
        inputPath,
        segmentDuration,
        overlapSeconds: overlapSec,
        blurBackground: blurBg,
        outputDir: targetOutputDir.trim(),
      });
      setOutputParts(parts);
      addToast({ type: 'success', message: t.socialSplitter.done });
    } catch (e) {
      const msg = parseAppError(e, language) || t.socialSplitter.errorFallback;
      setErrorMsg(msg);
      addToast({ type: 'error', message: msg });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReveal = async (path: string) => {
    try {
      await invoke('open_output_folder', { path });
    } catch (e) {
      addToast({ type: 'error', message: parseAppError(e, language) });
    }
  };

  const footer = (
    <div className="flex justify-end gap-2">
      <button
        type="button"
        disabled={isProcessing}
        onClick={handleClose}
        className="px-4 py-2 rounded-xl text-xs text-[var(--text-muted)] hover:bg-[var(--surface-input)] disabled:opacity-50 focus-studio"
      >
        {t.actions.cancel}
      </button>
      <button
        type="button"
        onClick={handleStartSplit}
        disabled={!inputPath || isProcessing || isOverlapInvalid}
        className="px-4 py-2 rounded-xl text-xs font-bold bg-sky-600 hover:bg-sky-500 text-white shadow-lg shadow-sky-500/20 flex items-center gap-1.5 disabled:opacity-50 focus-studio"
      >
        <Play className="w-3.5 h-3.5 fill-current" />
        <span>{isProcessing ? t.socialSplitter.splitting : t.socialSplitter.startSplit}</span>
      </button>
    </div>
  );

  return (
    <ModalDialog
      open={true}
      onClose={handleClose}
      title={t.socialSplitter.title}
      subtitle={t.socialSplitter.desc}
      icon={<Scissors className="w-5 h-5 text-sky-600 dark:text-sky-400" />}
      maxWidthClass="max-w-lg"
      closeOnBackdrop={!isProcessing}
      footer={footer}
    >
      <div className="space-y-4">
        {/* File Picker */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-[var(--text-secondary)] block">
            {t.socialSplitter.inputLabel}
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              dir="ltr"
              readOnly
              placeholder={t.socialSplitter.inputPlaceholder}
              value={inputPath}
              className="flex-1 text-xs p-2 rounded-xl bg-[var(--surface-input)] border border-[var(--surface-input-border)] text-[var(--text-primary)] font-mono truncate focus-studio"
            />
            <button
              type="button"
              onClick={handleSelectFile}
              disabled={isProcessing}
              className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400 hover:bg-sky-500/20 border border-sky-500/30 shrink-0 disabled:opacity-50 focus-studio"
            >
              {t.actions.browse}
            </button>
          </div>
        </div>

        {/* Output Folder Picker */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-[var(--text-secondary)] block">
            {t.socialSplitter.outputDirLabel}
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1 flex items-center">
              <input
                type="text"
                dir="ltr"
                readOnly
                placeholder={t.socialSplitter.outputDirPlaceholder}
                value={targetOutputDir}
                className="w-full text-xs p-2 pe-7 rounded-xl bg-[var(--surface-input)] border border-[var(--surface-input-border)] text-[var(--text-primary)] font-mono truncate focus-studio"
              />
              {targetOutputDir && !isProcessing && (
                <button
                  type="button"
                  onClick={() => setTargetOutputDir('')}
                  title={t.actions.clear}
                  aria-label={t.actions.clear}
                  className="absolute end-1.5 p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] focus-studio"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={handleSelectOutputDir}
              disabled={isProcessing}
              className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-[var(--surface-input)] text-[var(--text-secondary)] hover:bg-[var(--surface-input-hover)] border border-[var(--surface-input-border)] shrink-0 disabled:opacity-50 focus-studio"
            >
              {t.actions.browse}
            </button>
          </div>
        </div>

        {/* Preset Duration Buttons */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-[var(--text-secondary)] block">
            {t.socialSplitter.segmentDuration}
          </label>
          <div className="grid grid-cols-3 gap-2">
            {[
              { sec: 15, label: t.socialSplitter.presetStories },
              { sec: 30, label: t.socialSplitter.presetWhatsApp },
              { sec: 60, label: t.socialSplitter.presetReels },
            ].map((item) => (
              <button
                key={item.sec}
                type="button"
                disabled={isProcessing}
                onClick={() => setSegmentDuration(item.sec)}
                className={clsx(
                  'p-2 rounded-xl border text-xs text-start transition-all focus-studio',
                  segmentDuration === item.sec
                    ? 'border-sky-500/50 bg-sky-500/15 text-sky-700 dark:text-sky-400 font-bold'
                    : 'border-[var(--border-subtle)] bg-[var(--surface-input)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* Smart Overlap Slider */}
        <div className="space-y-1 p-3 rounded-xl bg-[var(--surface-input)]/50 border border-[var(--surface-input-border)]">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-[var(--text-secondary)] flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
              <span>{t.socialSplitter.overlap}</span>
            </span>
            <BdiText dir="ltr" mono className="font-bold text-sky-600 dark:text-sky-400">
              {overlapSec}s
            </BdiText>
          </div>
          <input
            type="range"
            min="0"
            max="5"
            step="1"
            value={overlapSec}
            disabled={isProcessing}
            onChange={(e) => setOverlapSec(parseInt(e.target.value, 10))}
            className="w-full accent-sky-600 dark:accent-sky-500 cursor-pointer h-1.5"
          />
          <p className="text-[10px] text-[var(--text-muted)]">{t.socialSplitter.overlapHelp}</p>
          {isOverlapInvalid && (
            <p className="text-[10px] text-rose-600 dark:text-rose-400 font-medium">
              {t.socialSplitter.maxOverlapHint}
            </p>
          )}
        </div>

        {/* 9:16 Blurred Background Toggle */}
        <label className="flex items-center justify-between p-2.5 rounded-xl bg-[var(--surface-input)] border border-[var(--surface-input-border)] text-xs cursor-pointer">
          <span className="font-medium text-[var(--text-primary)]">{t.socialSplitter.blurBg}</span>
          <input
            type="checkbox"
            checked={blurBg}
            disabled={isProcessing}
            onChange={(e) => setBlurBg(e.target.checked)}
            className="w-4 h-4 rounded accent-sky-600 dark:accent-sky-500 cursor-pointer"
          />
        </label>

        {/* Errors & Output list */}
        {errorMsg && (
          <div
            role="alert"
            className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs flex items-center gap-2"
          >
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="break-words">{errorMsg}</span>
          </div>
        )}

        {outputParts.length > 0 && (
          <div className="space-y-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs">
            <div className="flex items-center justify-between text-emerald-600 dark:text-emerald-400 font-bold">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>
                  <BdiText dir="ltr" mono>
                    {outputParts.length}
                  </BdiText>{' '}
                  {t.socialSplitter.partsCreated}
                </span>
              </span>
              <button
                type="button"
                onClick={() => handleReveal(outputParts[0])}
                className="px-2 py-0.5 rounded text-[10px] bg-emerald-500/20 hover:bg-emerald-500/30 flex items-center gap-1 focus-studio"
              >
                <FolderOpen className="w-3 h-3" />
                <span>{t.actions.openFolder}</span>
              </button>
            </div>
            <div className="max-h-24 overflow-y-auto space-y-1 font-mono text-[10px] text-[var(--text-muted)] scrollbar-thin">
              {outputParts.map((p, idx) => (
                <div key={idx} className="truncate" title={p}>
                  <BdiText dir="ltr" mono>
                    {p}
                  </BdiText>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </ModalDialog>
  );
};
