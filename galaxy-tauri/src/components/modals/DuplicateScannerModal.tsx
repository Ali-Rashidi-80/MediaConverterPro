import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Copy,
  FolderOpen,
  Play,
  CheckCircle2,
  HardDrive,
  RefreshCw,
  Trash2,
  AlertCircle,
} from 'lucide-react';
import { ModalDialog, ConfirmDialog } from '../common/ModalDialog';
import { BdiText } from '../common/BdiText';
import { useI18n } from '../../i18n/useI18n';
import { useConverterStore } from '../../store/useConverterStore';
import { DuplicateGroup } from '../../types';
import { parseAppError } from '../../utils/errorParser';

const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const idx = Math.min(sizes.length - 1, Math.max(0, Math.floor(Math.log(bytes) / Math.log(k))));
  return `${(bytes / Math.pow(k, idx)).toFixed(1)} ${sizes[idx]}`;
};

export const DuplicateScannerModal: React.FC = () => {
  const { t, language } = useI18n();
  const setActiveModal = useConverterStore((state) => state.setActiveModal);
  const addToast = useConverterStore((state) => state.addToast);

  const [scanDir, setScanDir] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [hasScanned, setHasScanned] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pendingDeletePath, setPendingDeletePath] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleClose = () => {
    if (isScanning || isDeleting) return;
    setActiveModal('none');
  };

  const handlePickFolder = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        directory: true,
        multiple: false,
      });
      if (selected && typeof selected === 'string') {
        setScanDir(selected);
        setGroups([]);
        setHasScanned(false);
        setErrorMsg(null);
      }
    } catch (e) {
      addToast({ type: 'error', message: parseAppError(e, language) });
    }
  };

  const handleStartScan = async () => {
    if (!scanDir || isScanning) return;
    setIsScanning(true);
    setErrorMsg(null);
    try {
      const res = await invoke<DuplicateGroup[]>('scan_duplicate_media', { dirPath: scanDir });
      setGroups(res);
      setHasScanned(true);
    } catch (e) {
      const msg = parseAppError(e, language);
      setErrorMsg(msg);
      addToast({ type: 'error', message: msg });
    } finally {
      setIsScanning(false);
    }
  };

  const handleReveal = async (path: string) => {
    try {
      await invoke('open_output_folder', { path });
    } catch (e) {
      addToast({ type: 'error', message: parseAppError(e, language) });
    }
  };

  const handleConfirmDelete = async () => {
    if (!pendingDeletePath || isDeleting) return;
    setIsDeleting(true);
    setErrorMsg(null);
    try {
      await invoke('delete_file', { filePath: pendingDeletePath });
      setGroups((prev) =>
        prev
          .map((g) => ({
            ...g,
            files: g.files.filter((f) => f.path !== pendingDeletePath),
          }))
          .filter((g) => g.files.length > 1)
      );
      setPendingDeletePath(null);
      addToast({ type: 'success', message: t.duplicates.deleted });
    } catch (e) {
      const msg = parseAppError(e, language);
      setErrorMsg(msg);
      addToast({ type: 'error', message: msg });
    } finally {
      setIsDeleting(false);
    }
  };

  const totalReclaimableBytes = groups.reduce((acc, g) => {
    return acc + g.file_size * Math.max(0, g.files.length - 1);
  }, 0);

  return (
    <>
      <ModalDialog
        open={true}
        onClose={handleClose}
        title={t.duplicates.title}
        subtitle={t.duplicates.desc}
        icon={<Copy className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />}
        maxWidthClass="max-w-xl"
        closeOnBackdrop={!isScanning && !isDeleting}
      >
        <div className="space-y-4">
          {/* Directory Picker */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[var(--text-secondary)] block">
              {t.duplicates.selectFolder}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                dir="ltr"
                readOnly
                placeholder={t.duplicates.folderPlaceholder}
                value={scanDir}
                className="flex-1 text-xs p-2 rounded-xl bg-[var(--surface-input)] border border-[var(--surface-input-border)] text-[var(--text-primary)] font-mono truncate focus-studio"
              />
              <button
                type="button"
                onClick={handlePickFolder}
                disabled={isScanning}
                className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/20 border border-indigo-500/30 shrink-0 disabled:opacity-50 focus-studio"
              >
                {t.actions.browse}
              </button>
            </div>
          </div>

          {/* Action Button & Total Reclaimable Banner */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={handleStartScan}
              disabled={!scanDir || isScanning}
              className="px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20 flex items-center gap-2 disabled:opacity-50 focus-studio"
            >
              {isScanning ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>{t.duplicates.scanning}</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>{t.duplicates.startScan}</span>
                </>
              )}
            </button>

            {hasScanned && (
              <div className="flex flex-wrap items-center gap-3 text-xs font-mono">
                {groups.length > 0 && (
                  <span className="text-[11px] text-[var(--text-secondary)]">
                    <BdiText dir="ltr" mono>
                      {groups.length}
                    </BdiText>{' '}
                    {t.duplicates.found}
                  </span>
                )}
                <div className="flex items-center gap-1.5">
                  <HardDrive className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span className="text-[var(--text-muted)]">{t.duplicates.reclaimable}</span>
                  <BdiText
                    dir="ltr"
                    mono
                    className="font-bold text-emerald-600 dark:text-emerald-400"
                  >
                    {formatBytes(totalReclaimableBytes)}
                  </BdiText>
                </div>
              </div>
            )}
          </div>

          {/* Inline Error Alert */}
          {errorMsg && (
            <div
              role="alert"
              className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs flex items-center gap-2"
            >
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span className="break-words">{errorMsg}</span>
            </div>
          )}

          {/* Scan Results */}
          <div className="max-h-[340px] overflow-y-auto space-y-2 pe-1 min-h-[140px] scrollbar-thin">
            {hasScanned && groups.length === 0 && (
              <div className="text-center py-10 text-xs text-[var(--text-muted)] flex flex-col items-center gap-2">
                <CheckCircle2 className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
                <span>{t.duplicates.noDuplicates}</span>
              </div>
            )}

            {groups.map((group, gIdx) => (
              <div
                key={`${group.hash}_${gIdx}`}
                className="p-3 rounded-xl bg-[var(--surface-input)]/50 border border-[var(--surface-input-border)] space-y-2 text-xs"
              >
                <div className="flex items-center justify-between text-[11px] font-semibold text-[var(--text-secondary)]">
                  <span>
                    <BdiText dir="ltr" mono>
                      {group.files.length}
                    </BdiText>{' '}
                    {t.duplicates.identicalCopies}
                  </span>
                  <span className="font-mono text-indigo-600 dark:text-indigo-400 flex items-center gap-1">
                    <BdiText dir="ltr" mono>
                      {formatBytes(group.file_size)}
                    </BdiText>
                    <span>/ {t.duplicates.perFile}</span>
                  </span>
                </div>
                <div className="space-y-1">
                  {group.files.map((file, fIdx) => (
                    <div
                      key={`${file.path}_${fIdx}`}
                      className="flex items-center justify-between gap-2 p-1.5 rounded-lg bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[10px]"
                    >
                      <span
                        className="truncate flex-1 font-mono text-[var(--text-primary)]"
                        title={file.path}
                      >
                        <BdiText dir="ltr" mono>
                          {file.path}
                        </BdiText>
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleReveal(file.path)}
                          title={t.actions.revealInExplorer}
                          aria-label={t.actions.revealInExplorer}
                          className="p-1 rounded text-sky-600 dark:text-sky-400 hover:bg-sky-500/10 focus-studio"
                        >
                          <FolderOpen className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingDeletePath(file.path)}
                          title={t.duplicates.deleteTooltip}
                          aria-label={t.duplicates.deleteTooltip}
                          className="p-1 rounded text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 focus-studio"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </ModalDialog>

      <ConfirmDialog
        open={pendingDeletePath !== null}
        title={t.confirm.deleteTitle}
        message={t.duplicates.deleteConfirm}
        confirmLabel={t.actions.delete}
        cancelLabel={t.actions.cancel}
        variant="danger"
        isLoading={isDeleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDeletePath(null)}
      />
    </>
  );
};
