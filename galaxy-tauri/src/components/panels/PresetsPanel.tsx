import React, { useEffect, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { clsx } from 'clsx';
import {
  Bookmark,
  Plus,
  Download,
  Upload,
  Trash2,
  Check,
  Zap,
  Sparkles,
  Pencil,
  AlertTriangle,
} from 'lucide-react';
import { GlassCard } from '../common/GlassCard';
import { ConfirmDialog } from '../common/ModalDialog';
import { Badge } from '../common/Badge';
import { useConverterStore } from '../../store/useConverterStore';
import { useI18n } from '../../i18n/useI18n';
import { VIDEO_PRESETS } from '../../constants/presets';
import { CustomPreset, MediaKind } from '../../types';
import { parseAppError } from '../../utils/errorParser';

export const PresetsPanel: React.FC = () => {
  const { t, language } = useI18n();
  const videoSettings = useConverterStore((state) => state.videoSettings);
  const audioSettings = useConverterStore((state) => state.audioSettings);
  const imageSettings = useConverterStore((state) => state.imageSettings);
  const setVideoSettings = useConverterStore((state) => state.setVideoSettings);
  const setAudioSettings = useConverterStore((state) => state.setAudioSettings);
  const setImageSettings = useConverterStore((state) => state.setImageSettings);
  const addToast = useConverterStore((state) => state.addToast);

  const [customPresets, setCustomPresets] = useState<CustomPreset[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [presetName, setPresetName] = useState('');
  const [presetDesc, setPresetDesc] = useState('');
  const [presetKind, setPresetKind] = useState<MediaKind>('video');
  const [nameTouched, setNameTouched] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const loadCustomPresets = useCallback(async () => {
    try {
      const list = await invoke<CustomPreset[]>('get_custom_presets');
      setCustomPresets(list);
    } catch (e) {
      addToast({ type: 'error', message: parseAppError(e, language) });
    }
  }, [addToast, language]);

  useEffect(() => {
    let active = true;
    invoke<CustomPreset[]>('get_custom_presets')
      .then((list) => {
        if (active) setCustomPresets(list);
      })
      .catch((e: unknown) => {
        if (active) addToast({ type: 'error', message: parseAppError(e, language) });
      });
    return () => {
      active = false;
    };
  }, [addToast, language]);

  const resetForm = () => {
    setShowForm(false);
    setEditingPresetId(null);
    setPresetName('');
    setPresetDesc('');
    setPresetKind('video');
    setNameTouched(false);
  };

  const handleOpenCreateForm = () => {
    if (showForm && editingPresetId === null) {
      resetForm();
      return;
    }
    setEditingPresetId(null);
    setPresetName('');
    setPresetDesc('');
    setPresetKind('video');
    setNameTouched(false);
    setShowForm(true);
  };

  const handleStartEdit = (preset: CustomPreset) => {
    setEditingPresetId(preset.id);
    setPresetName(preset.name);
    setPresetDesc(preset.description || '');
    setPresetKind(preset.kind);
    setNameTouched(false);
    setShowForm(true);
  };

  const handleSavePreset = async () => {
    setNameTouched(true);
    const trimmedName = presetName.trim();
    if (!trimmedName || isSaving) return;

    const existing = editingPresetId
      ? customPresets.find((p) => p.id === editingPresetId)
      : undefined;

    const preset: CustomPreset = {
      id: editingPresetId ?? `custom_${Date.now()}`,
      name: trimmedName,
      description: presetDesc.trim(),
      kind: presetKind,
      video_settings:
        presetKind === 'video'
          ? existing?.kind === 'video' && existing.video_settings
            ? existing.video_settings
            : { ...videoSettings }
          : undefined,
      audio_settings:
        presetKind === 'audio'
          ? existing?.kind === 'audio' && existing.audio_settings
            ? existing.audio_settings
            : { ...audioSettings }
          : undefined,
      image_settings:
        presetKind === 'image'
          ? existing?.kind === 'image' && existing.image_settings
            ? existing.image_settings
            : { ...imageSettings }
          : undefined,
      created_at: existing?.created_at ?? Date.now(),
    };

    setIsSaving(true);
    try {
      await invoke('save_custom_preset', { preset });
      const wasEditing = Boolean(editingPresetId);
      resetForm();
      await loadCustomPresets();
      addToast({
        type: 'success',
        message: wasEditing ? t.presets.updatedSuccess : t.presets.savedSuccess,
      });
    } catch (e) {
      addToast({ type: 'error', message: parseAppError(e, language) });
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTargetId || isDeleting) return;
    setIsDeleting(true);
    try {
      await invoke('delete_custom_preset', { id: deleteTargetId });
      if (editingPresetId === deleteTargetId) {
        resetForm();
      }
      setDeleteTargetId(null);
      await loadCustomPresets();
      addToast({ type: 'success', message: t.presets.deletedSuccess });
    } catch (e) {
      addToast({ type: 'error', message: parseAppError(e, language) });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleApplyCustomPreset = (preset: CustomPreset) => {
    if (preset.video_settings) {
      setVideoSettings(preset.video_settings);
    }
    if (preset.audio_settings) {
      setAudioSettings(preset.audio_settings);
    }
    if (preset.image_settings) {
      setImageSettings(preset.image_settings);
    }
    addToast({ type: 'success', message: t.presets.appliedSuccess });
  };

  const handleExport = async () => {
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const target = await save({
        filters: [{ name: 'JSON Presets', extensions: ['json'] }],
        defaultPath: 'galaxy_custom_presets.json',
      });
      if (target) {
        await invoke('export_presets', { targetPath: target });
        addToast({ type: 'success', message: t.presets.exportedSuccess });
      }
    } catch (e) {
      addToast({ type: 'error', message: parseAppError(e, language) });
    }
  };

  const handleImport = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        filters: [{ name: 'JSON Presets', extensions: ['json'] }],
        multiple: false,
      });
      if (selected && typeof selected === 'string') {
        const imported = await invoke<CustomPreset[]>('import_presets', { sourcePath: selected });
        setCustomPresets(imported);
        addToast({ type: 'success', message: t.presets.importedSuccess });
      }
    } catch (e) {
      addToast({ type: 'error', message: parseAppError(e, language) });
    }
  };

  const kindLabel = (kind: MediaKind): string => {
    switch (kind) {
      case 'audio':
        return t.presets.audioKind;
      case 'image':
        return t.presets.imageKind;
      default:
        return t.presets.videoKind;
    }
  };

  const isNameEmpty = !presetName.trim();

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <Bookmark className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
          <h3 className="font-bold text-sm text-[var(--text-primary)]">{t.presets.title}</h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExport}
            title={t.presets.exportPresets}
            aria-label={t.presets.exportPresets}
            className="p-1.5 rounded-lg border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-sky-600 dark:hover:text-sky-400 hover:bg-[var(--surface-input-hover)] transition-all focus-studio"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleImport}
            title={t.presets.importPresets}
            aria-label={t.presets.importPresets}
            className="p-1.5 rounded-lg border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-sky-600 dark:hover:text-sky-400 hover:bg-[var(--surface-input-hover)] transition-all focus-studio"
          >
            <Upload className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleOpenCreateForm}
            title={t.presets.saveCurrent}
            aria-label={t.presets.saveCurrent}
            className="p-1.5 rounded-lg border border-indigo-500/30 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/10 transition-all flex items-center gap-1 text-xs focus-studio"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Create / Edit Preset Form */}
      {showForm && (
        <GlassCard className="p-3 space-y-2.5 border-indigo-500/30 bg-indigo-500/5">
          <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 block">
            {editingPresetId ? t.presets.editFormTitle : t.presets.formTitle}
          </span>

          {/* Kind Selector */}
          <div className="space-y-1">
            <span className="text-[10px] font-semibold text-[var(--text-muted)] block">
              {t.presets.kindLabel}
            </span>
            <div className="grid grid-cols-3 gap-1.5 bg-[var(--surface-input)] p-1 rounded-xl border border-[var(--surface-input-border)]">
              {(['video', 'audio', 'image'] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => setPresetKind(kind)}
                  className={clsx(
                    'py-1 text-center rounded-lg text-[11px] font-medium transition-all focus-studio',
                    presetKind === kind
                      ? 'bg-indigo-600 text-white font-bold shadow'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  )}
                >
                  {kindLabel(kind)}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <input
              type="text"
              placeholder={t.presets.namePlaceholder}
              value={presetName}
              onChange={(e) => {
                setPresetName(e.target.value);
                if (!nameTouched) setNameTouched(true);
              }}
              onBlur={() => setNameTouched(true)}
              className={clsx(
                'w-full text-xs p-2 rounded-xl bg-[var(--surface-input)] border text-[var(--text-primary)] focus-studio',
                nameTouched && isNameEmpty
                  ? 'border-rose-500/60'
                  : 'border-[var(--surface-input-border)]'
              )}
            />
            {nameTouched && isNameEmpty && (
              <p className="text-[10px] text-rose-600 dark:text-rose-400 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3 shrink-0" />
                <span>{t.presets.nameRequired}</span>
              </p>
            )}
          </div>

          <input
            type="text"
            placeholder={t.presets.descPlaceholder}
            value={presetDesc}
            onChange={(e) => setPresetDesc(e.target.value)}
            className="w-full text-xs p-2 rounded-xl bg-[var(--surface-input)] border border-[var(--surface-input-border)] text-[var(--text-primary)] focus-studio"
          />

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={resetForm}
              className="px-2.5 py-1 rounded-lg text-xs text-[var(--text-muted)] hover:bg-[var(--surface-input)] focus-studio"
            >
              {t.actions.cancel}
            </button>
            <button
              type="button"
              disabled={isNameEmpty || isSaving}
              onClick={handleSavePreset}
              className="px-3 py-1 rounded-lg text-xs font-semibold bg-indigo-600 text-white shadow hover:bg-indigo-500 disabled:opacity-45 disabled:cursor-not-allowed focus-studio"
            >
              {editingPresetId ? t.presets.updatePreset : t.presets.savePreset}
            </button>
          </div>
        </GlassCard>
      )}

      {/* Custom Presets List */}
      <div className="space-y-2">
        <label className="text-xs font-semibold text-[var(--text-secondary)] px-1 flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" />
          <span>{t.presets.customSection}</span>
        </label>
        {customPresets.length === 0 ? (
          <div className="p-4 rounded-xl border border-dashed border-[var(--border-subtle)] text-center text-xs text-[var(--text-muted)]">
            {t.presets.emptyCustom}
          </div>
        ) : (
          <div className="space-y-1.5">
            {customPresets.map((cp) => (
              <div
                key={cp.id}
                className="flex items-center justify-between p-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] hover:bg-[var(--surface-card-hover)] transition-all"
              >
                <div
                  className="min-w-0 flex-1 cursor-pointer"
                  onClick={() => handleApplyCustomPreset(cp)}
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="font-semibold text-xs text-[var(--text-primary)] truncate">
                      {cp.name}
                    </span>
                    <Badge variant="neutral" className="text-[9px] px-1.5 py-0 shrink-0">
                      {kindLabel(cp.kind)}
                    </Badge>
                  </div>
                  {cp.description && (
                    <div className="text-[10px] text-[var(--text-muted)] truncate">
                      {cp.description}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0 ms-2">
                  <button
                    type="button"
                    onClick={() => handleApplyCustomPreset(cp)}
                    className="px-2 py-1 rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400 hover:bg-sky-500/20 text-[10px] font-semibold border border-sky-500/20 focus-studio"
                  >
                    {t.presets.apply}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleStartEdit(cp)}
                    title={t.presets.editPreset}
                    aria-label={t.presets.editPreset}
                    className="p-1 rounded-lg text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/10 focus-studio"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTargetId(cp.id)}
                    title={t.actions.delete}
                    aria-label={t.actions.delete}
                    className="p-1 rounded-lg text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 focus-studio"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Built-in Presets */}
      <div className="space-y-2 pt-2 border-t border-[var(--border-subtle)]">
        <label className="text-xs font-semibold text-[var(--text-secondary)] px-1 flex items-center gap-1.5">
          <Zap className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
          <span>{t.presets.builtinSection}</span>
        </label>
        <div className="space-y-1.5">
          {VIDEO_PRESETS.map((p) => {
            const isSelected = (videoSettings.ui_preset_id || videoSettings.video_preset) === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setVideoSettings({
                    ui_preset_id: p.id,
                    encoder_speed_preset: p.encoder_speed_preset || p.preset,
                    video_preset: p.id,
                    crf: p.crf,
                    scale: p.scale || 'original',
                    fps: p.fps || 0,
                    copy_streams: !!p.copyStreams,
                  });
                  addToast({ type: 'success', message: t.presets.appliedSuccess });
                }}
                className={clsx(
                  'w-full text-start p-2.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between text-xs focus-studio',
                  isSelected
                    ? 'border-sky-500/50 bg-sky-500/15 shadow-sm'
                    : 'border-[var(--border-subtle)] bg-[var(--surface-card)] hover:bg-[var(--surface-card-hover)]'
                )}
              >
                <div className="min-w-0 flex-1 pe-2">
                  <div className="font-bold text-[11px] text-[var(--text-primary)]">
                    {language === 'fa' ? p.nameFa : p.nameEn}
                  </div>
                  <div className="text-[10px] text-[var(--text-muted)] line-clamp-1">
                    {language === 'fa' ? p.descFa : p.descEn}
                  </div>
                </div>
                {isSelected && (
                  <Check className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={deleteTargetId !== null}
        title={t.presets.deleteTitle}
        message={t.presets.deleteConfirm}
        confirmLabel={t.actions.delete}
        cancelLabel={t.actions.cancel}
        variant="danger"
        isLoading={isDeleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTargetId(null)}
      />
    </div>
  );
};
