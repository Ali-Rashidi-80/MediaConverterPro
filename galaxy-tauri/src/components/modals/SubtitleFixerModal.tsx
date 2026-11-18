import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Type,
  FolderOpen,
  CheckCircle2,
  AlertCircle,
  FileText,
  Sparkles,
} from 'lucide-react';
import { ModalDialog } from '../common/ModalDialog';
import { BdiText } from '../common/BdiText';
import { useI18n } from '../../i18n/useI18n';
import { useConverterStore } from '../../store/useConverterStore';
import { parseAppError } from '../../utils/errorParser';

export const SubtitleFixerModal: React.FC = () => {
  const { t, language } = useI18n();
  const setActiveModal = useConverterStore((state) => state.setActiveModal);
  const addToast = useConverterStore((state) => state.addToast);

  const [filePath, setFilePath] = useState('');
  const [isFixing, setIsFixing] = useState(false);
  const [outputPath, setOutputPath] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleClose = () => {
    if (isFixing) return;
    setActiveModal('none');
  };

  const handleSelectFile = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        filters: [{ name: 'Subtitle Files', extensions: ['srt', 'vtt', 'ass', 'sub'] }],
        multiple: false,
      });
      if (selected && typeof selected === 'string') {
        setFilePath(selected);
        setOutputPath(null);
        setErrorMsg(null);
      }
    } catch (e) {
      addToast({ type: 'error', message: parseAppError(e, language) });
    }
  };

  const handleFixCharset = async () => {
    if (!filePath || isFixing) return;
    setIsFixing(true);
    setErrorMsg(null);
    setOutputPath(null);

    try {
      const fixedPath = await invoke<string>('fix_subtitle_charset', { filePath });
      setOutputPath(fixedPath);
      addToast({ type: 'success', message: t.toasts.subtitleFixed });
    } catch (e) {
      const msg = parseAppError(e, language) || t.subtitleFixer.errorFallback;
      setErrorMsg(msg);
      addToast({ type: 'error', message: msg });
    } finally {
      setIsFixing(false);
    }
  };

  const handleReveal = async () => {
    if (!outputPath) return;
    try {
      await invoke('open_output_folder', { path: outputPath });
    } catch (e) {
      addToast({ type: 'error', message: parseAppError(e, language) });
    }
  };

  const footer = (
    <div className="flex justify-end gap-2">
      <button
        type="button"
        disabled={isFixing}
        onClick={handleClose}
        className="px-4 py-2 rounded-xl text-xs text-[var(--text-muted)] hover:bg-[var(--surface-input)] disabled:opacity-50 focus-studio"
      >
        {t.actions.cancel}
      </button>
      <button
        type="button"
        onClick={handleFixCharset}
        disabled={!filePath || isFixing}
        className="px-4 py-2 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-lg shadow-amber-500/20 flex items-center gap-1.5 disabled:opacity-50 focus-studio"
      >
        <FileText className="w-3.5 h-3.5" />
        <span>{isFixing ? t.subtitleFixer.fixing : t.subtitleFixer.fixButton}</span>
      </button>
    </div>
  );

  return (
    <ModalDialog
      open={true}
      onClose={handleClose}
      title={t.subtitleFixer.title}
      subtitle={t.subtitleFixer.desc}
      icon={<Type className="w-5 h-5 text-amber-700 dark:text-amber-400" />}
      maxWidthClass="max-w-md"
      closeOnBackdrop={!isFixing}
      footer={footer}
    >
      <div className="space-y-4">
        {/* File Picker */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-[var(--text-secondary)] block">
            {t.subtitleFixer.inputLabel}
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              dir="ltr"
              readOnly
              placeholder={t.subtitleFixer.inputPlaceholder}
              value={filePath}
              className="flex-1 text-xs p-2 rounded-xl bg-[var(--surface-input)] border border-[var(--surface-input-border)] text-[var(--text-primary)] font-mono truncate focus-studio"
            />
            <button
              type="button"
              onClick={handleSelectFile}
              disabled={isFixing}
              className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-amber-500/10 text-amber-700 dark:text-amber-400 hover:bg-amber-500/20 border border-amber-500/30 shrink-0 disabled:opacity-50 focus-studio"
            >
              {t.actions.browse}
            </button>
          </div>
        </div>

        {/* Explanatory note */}
        <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-800 dark:text-amber-300 leading-relaxed flex items-start gap-2">
          <Sparkles className="w-4 h-4 shrink-0 mt-0.5 text-amber-700 dark:text-amber-400" />
          <span>{t.subtitleFixer.explanation}</span>
        </div>

        {/* Error message */}
        {errorMsg && (
          <div
            role="alert"
            className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs flex items-center gap-2"
          >
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="break-words">{errorMsg}</span>
          </div>
        )}

        {/* Success Output */}
        {outputPath && (
          <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 space-y-2">
            <div className="flex items-center justify-between text-emerald-600 dark:text-emerald-400 font-bold text-xs">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{t.subtitleFixer.success}</span>
              </span>
              <button
                type="button"
                onClick={handleReveal}
                className="px-2 py-0.5 rounded text-[10px] bg-emerald-500/20 hover:bg-emerald-500/30 flex items-center gap-1 focus-studio"
              >
                <FolderOpen className="w-3 h-3" />
                <span>{t.actions.revealInExplorer}</span>
              </button>
            </div>
            <div className="font-mono text-[10px] text-[var(--text-muted)] truncate" title={outputPath}>
              <BdiText dir="ltr" mono>
                {outputPath}
              </BdiText>
            </div>
          </div>
        )}
      </div>
    </ModalDialog>
  );
};
