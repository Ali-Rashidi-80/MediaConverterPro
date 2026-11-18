import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import {
  AppSettings,
  AudioConversionSettings,
  HardwareProfile,
  ImageConversionSettings,
  MediaKind,
  QueueActions,
  QueueFilter,
  TaskItem,
  TaskProgressUpdate,
  VideoConversionSettings,
} from '../types';
import {
  SUPPORTED_AUDIO_FORMATS,
  SUPPORTED_IMAGE_FORMATS,
  SUPPORTED_VIDEO_FORMATS,
} from '../constants/app';
import { TRANSLATIONS } from '../i18n/translations';
import { parseAppError } from '../utils/errorParser';

export type ParallelMode = 'smart' | 'parallel' | 'sequential';
export type AccelMode = 'auto' | 'nvidia' | 'amd' | 'intel' | 'cpu';
export type FontScale = 'small' | 'medium' | 'large';
export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastMessage {
  id: string;
  type: ToastType;
  message: string;
  title?: string;
  durationMs?: number;
}

interface ConverterState {
  taskIds: string[];
  tasksById: Record<string, TaskItem>;
  isProcessing: boolean;
  activeTab: 'video' | 'audio' | 'image' | 'history' | 'presets' | 'hardware' | 'settings' | 'about';
  language: 'fa' | 'en';
  theme: 'dark' | 'light';
  isProMode: boolean;
  parallelMode: ParallelMode;
  maxParallelJobs: number;
  accelMode: AccelMode;
  nvencPreset: string;
  sleepPrevention: boolean;
  fontScale: FontScale;
  hardwareProfile: HardwareProfile | null;
  outputDir: string;
  queueActions: QueueActions | null;
  queueFilter: QueueFilter;
  searchQuery: string;
  soundNotifications: boolean;
  toasts: ToastMessage[];
  historyVersion: number;

  // Phase 9: Multi-Selection & Modals
  selectedTaskIds: string[];
  activeModal: 'none' | 'social_splitter' | 'duplicate_scanner' | 'custom_presets' | 'subtitle_fixer';

  // Settings
  videoSettings: VideoConversionSettings;
  audioSettings: AudioConversionSettings;
  imageSettings: ImageConversionSettings;

  // Actions
  addTask: (task: TaskItem) => void;
  addTasks: (tasks: TaskItem[]) => void;
  removeTask: (id: string) => void;
  clearQueue: () => void;
  clearFinishedTasks: () => void;
  updateBatchProgress: (updates: TaskProgressUpdate[]) => void;
  setTaskStatus: (
    id: string,
    status: TaskItem['status'],
    outputPath?: string,
    errorLog?: string,
    outputSize?: number
  ) => void;
  markTaskFallback: (id: string) => void;
  retryTask: (id: string, forceCpu?: boolean) => void;
  retryAllFailed: () => void;
  moveTaskToTop: (id: string) => void;
  overrideTaskFormat: (id: string, format: string) => void;
  setQueueFilter: (filter: QueueFilter) => void;
  setSearchQuery: (query: string) => void;
  setSoundNotifications: (enabled: boolean) => void;
  toggleSoundNotifications: () => void;
  setActiveTab: (tab: ConverterState['activeTab']) => void;
  setLanguage: (lang: 'fa' | 'en') => void;
  toggleLanguage: () => void;
  setTheme: (theme: 'dark' | 'light') => void;
  toggleTheme: () => void;
  setProMode: (isProMode: boolean) => void;
  toggleProMode: () => void;
  setParallelMode: (mode: ParallelMode) => void;
  setMaxParallelJobs: (jobs: number) => void;
  setAccelMode: (mode: AccelMode) => void;
  setNvencPreset: (preset: string) => void;
  setSleepPrevention: (enabled: boolean) => void;
  setFontScale: (scale: FontScale) => void;
  setHardwareProfile: (profile: HardwareProfile) => void;
  setOutputDir: (dir: string) => void;
  setVideoSettings: (settings: Partial<VideoConversionSettings>) => void;
  setAudioSettings: (settings: Partial<AudioConversionSettings>) => void;
  setImageSettings: (settings: Partial<ImageConversionSettings>) => void;
  setIsProcessing: (processing: boolean) => void;
  setQueueActions: (actions: QueueActions | null) => void;
  initializeSettingsBatch: (settings: Partial<AppSettings>) => void;
  saveSettingsToDisk: () => Promise<void>;
  resetSettingsToDefault: () => void;

  // Toasts & Telemetry
  addToast: (toast: Omit<ToastMessage, 'id'>) => string;
  removeToast: (id: string) => void;
  bumpHistoryVersion: () => void;

  // Batch actions
  toggleTaskSelection: (id: string) => void;
  selectAllTasks: (ids?: string[]) => void;
  clearTaskSelection: () => void;
  batchSetFormat: (format: string) => void;
  batchDeleteSelected: () => void;
  setActiveModal: (modal: ConverterState['activeModal']) => void;
}

export const DEFAULT_VIDEO_SETTINGS: VideoConversionSettings = {
  format: 'mp4',
  codec: 'H.264',
  ui_preset_id: 'original',
  encoder_speed_preset: 'medium',
  video_preset: 'original',
  crf: 23,
  bitrate: '',
  scale: 'original',
  fps: 0,
  rotate: '',
  denoise: false,
  sharpen: false,
  grayscale: false,
  strip_audio: false,
  strip_subs: false,
  trim_start: '',
  trim_end: '',
  accel_mode: 'auto',
  nvenc_preset: 'p4',
  copy_streams: false,
  output_dir: '',
  brightness: 0,
  contrast: 1,
  saturation: 1,
  gamma: 1,
  crop: 'none',
  speed: 1,
  prores_profile: undefined,
  hdr_to_sdr: false,
  subtitle_path: undefined,
  privacy_wipe: false,
};

export const DEFAULT_AUDIO_SETTINGS: AudioConversionSettings = {
  format: 'mp3',
  bitrate: '192k',
  sample_rate: 0,
  channels: 'original',
  volume: 100,
  normalize: false,
  trim_start: '',
  trim_end: '',
  output_dir: '',
  loudnorm_preset: 'none',
  bass_boost: 0,
  treble_boost: 0,
  compressor: false,
  reverb: false,
  downmix: false,
  speed: 1,
  privacy_wipe: false,
};

export const DEFAULT_IMAGE_SETTINGS: ImageConversionSettings = {
  format: 'webp',
  quality: 85,
  resize_width: undefined,
  resize_height: undefined,
  strip_metadata: true,
  flip_h: false,
  flip_v: false,
  grayscale: false,
  rotate: undefined,
  output_dir: '',
};

const VALID_PARALLEL_MODES: readonly ParallelMode[] = ['smart', 'parallel', 'sequential'];
const VALID_ACCEL_MODES: readonly AccelMode[] = ['auto', 'nvidia', 'amd', 'intel', 'cpu'];
const VALID_FONT_SCALES: readonly FontScale[] = ['small', 'medium', 'large'];

const VIDEO_FORMAT_SET = new Set<string>(SUPPORTED_VIDEO_FORMATS);
const AUDIO_FORMAT_SET = new Set<string>(SUPPORTED_AUDIO_FORMATS);
const IMAGE_FORMAT_SET = new Set<string>([...SUPPORTED_IMAGE_FORMATS, 'jpg']);

const toastTimers = new Map<string, ReturnType<typeof setTimeout>>();

export const isFormatSupportedForKind = (kind: MediaKind, format: string): boolean => {
  const fmt = format.toLowerCase();
  switch (kind) {
    case 'video':
      return VIDEO_FORMAT_SET.has(fmt);
    case 'audio':
      return AUDIO_FORMAT_SET.has(fmt);
    case 'image':
      return IMAGE_FORMAT_SET.has(fmt);
  }
};

export const resolveCompatibleVideoCodec = (format: string, currentCodec: string): string => {
  const fmt = format.toLowerCase();
  if (fmt === 'webm') {
    return currentCodec === 'AV1' || currentCodec === 'VP9' ? currentCodec : 'AV1';
  }
  if (fmt === 'mov') {
    return currentCodec === 'H.264' || currentCodec === 'H.265' || currentCodec === 'ProRes 422'
      ? currentCodec
      : 'H.264';
  }
  if (fmt === 'avi') {
    return 'H.264';
  }
  if (fmt !== 'mov' && currentCodec === 'ProRes 422') {
    return 'H.264';
  }
  return currentCodec;
};

const syncDocumentAttributes = (
  lang: 'fa' | 'en',
  theme: 'dark' | 'light',
  fontScale: FontScale
): void => {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dir = lang === 'fa' ? 'rtl' : 'ltr';
  root.lang = lang;
  if (theme === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
  root.setAttribute('data-font-scale', fontScale);
};

interface PersistedSlice {
  language: 'fa' | 'en';
  theme: 'dark' | 'light';
  outputDir: string;
  parallelMode: ParallelMode;
  maxParallelJobs: number;
  accelMode: AccelMode;
  nvencPreset: string;
  isProMode: boolean;
  soundNotifications: boolean;
  sleepPrevention: boolean;
  fontScale: FontScale;
}

const persistSettings = async (state: PersistedSlice): Promise<void> => {
  try {
    const payload: AppSettings = {
      language: state.language,
      theme: state.theme,
      output_dir: state.outputDir,
      parallel_mode: state.parallelMode,
      max_parallel_jobs: state.maxParallelJobs,
      accel_mode: state.accelMode,
      nvenc_preset: state.nvencPreset,
      is_pro_mode: state.isProMode,
      sound_notifications: state.soundNotifications,
      sleep_prevention: state.sleepPrevention,
      font_scale: state.fontScale,
    };
    await invoke('save_settings', { settings: payload });
  } catch (err) {
    console.error('Failed to auto-persist settings:', err);
    const { language, addToast } = useConverterStore.getState();
    const t = TRANSLATIONS[language];
    addToast({
      type: 'error',
      title: t.toasts.settingsSaveFailed,
      message: parseAppError(err, language),
    });
  }
};

export const useConverterStore = create<ConverterState>((set, get) => ({
  taskIds: [],
  tasksById: {},
  isProcessing: false,
  activeTab: 'video',
  language: 'fa',
  theme: 'dark',
  isProMode: false,
  parallelMode: 'smart',
  maxParallelJobs: 0,
  accelMode: 'auto',
  nvencPreset: 'p4',
  sleepPrevention: true,
  fontScale: 'medium',
  hardwareProfile: null,
  outputDir: '',
  queueActions: null,
  queueFilter: 'all',
  searchQuery: '',
  soundNotifications: true,
  toasts: [],
  historyVersion: 0,

  selectedTaskIds: [],
  activeModal: 'none',

  videoSettings: DEFAULT_VIDEO_SETTINGS,
  audioSettings: DEFAULT_AUDIO_SETTINGS,
  imageSettings: DEFAULT_IMAGE_SETTINGS,

  addTask: (task) =>
    set((state) => {
      if (state.tasksById[task.id]) return state;
      return {
        taskIds: [...state.taskIds, task.id],
        tasksById: { ...state.tasksById, [task.id]: task },
      };
    }),

  addTasks: (tasks) =>
    set((state) => {
      const newTasksById = { ...state.tasksById };
      const newTaskIds = [...state.taskIds];

      const activePaths = new Set(
        state.taskIds
          .filter(
            (id) =>
              state.tasksById[id]?.status === 'queued' ||
              state.tasksById[id]?.status === 'processing'
          )
          .map((id) => state.tasksById[id]?.filePath)
      );

      for (const t of tasks) {
        if (!newTasksById[t.id] && !activePaths.has(t.filePath)) {
          newTaskIds.push(t.id);
          newTasksById[t.id] = t;
          activePaths.add(t.filePath);
        }
      }

      return {
        taskIds: newTaskIds,
        tasksById: newTasksById,
      };
    }),

  removeTask: (id) =>
    set((state) => {
      const { [id]: _, ...rest } = state.tasksById;
      return {
        taskIds: state.taskIds.filter((taskId) => taskId !== id),
        tasksById: rest,
        selectedTaskIds: state.selectedTaskIds.filter((tId) => tId !== id),
      };
    }),

  clearQueue: () =>
    set({
      taskIds: [],
      tasksById: {},
      selectedTaskIds: [],
    }),

  clearFinishedTasks: () =>
    set((state) => {
      const remainingIds = state.taskIds.filter((id) => {
        const s = state.tasksById[id]?.status;
        return s !== 'completed';
      });
      const remainingById: Record<string, TaskItem> = {};
      for (const id of remainingIds) {
        if (state.tasksById[id]) {
          remainingById[id] = state.tasksById[id];
        }
      }
      return {
        taskIds: remainingIds,
        tasksById: remainingById,
        selectedTaskIds: state.selectedTaskIds.filter((id) => Boolean(remainingById[id])),
      };
    }),

  updateBatchProgress: (updates) =>
    set((state) => {
      let changed = false;
      const nextById = { ...state.tasksById };

      for (const up of updates) {
        const item = nextById[up.job_id];
        if (item && item.status === 'processing') {
          nextById[up.job_id] = {
            ...item,
            progress: up.percentage,
            fps: up.fps,
            speed: up.speed,
            etaSeconds: up.eta_seconds,
          };
          changed = true;
        }
      }

      return changed ? { tasksById: nextById } : state;
    }),

  setTaskStatus: (id, status, outputPath, errorLog, outputSize) =>
    set((state) => {
      const item = state.tasksById[id];
      if (!item) return state;
      const isFinished = status === 'completed' || status === 'failed' || status === 'cancelled';
      const shouldBumpHistory =
        (status === 'completed' || status === 'failed') && item.status !== status;

      return {
        tasksById: {
          ...state.tasksById,
          [id]: {
            ...item,
            status,
            outputPath: outputPath ?? item.outputPath,
            errorLog: errorLog ?? item.errorLog,
            outputSize: outputSize ?? item.outputSize,
            progress: status === 'completed' ? 100 : item.progress,
            speed: isFinished ? 0 : item.speed,
            fps: isFinished ? 0 : item.fps,
            etaSeconds: isFinished ? 0 : item.etaSeconds,
          },
        },
        historyVersion: shouldBumpHistory ? state.historyVersion + 1 : state.historyVersion,
      };
    }),

  markTaskFallback: (id) =>
    set((state) => {
      const item = state.tasksById[id];
      if (!item || item.fallbackUsed) return state;
      return {
        tasksById: {
          ...state.tasksById,
          [id]: {
            ...item,
            fallbackUsed: true,
          },
        },
      };
    }),

  retryTask: (id, forceCpu = false) =>
    set((state) => {
      const item = state.tasksById[id];
      if (!item) return state;

      const updated: TaskItem = {
        ...item,
        status: 'queued',
        progress: 0,
        fps: 0,
        speed: 0,
        etaSeconds: 0,
        errorLog: undefined,
        fallbackUsed: false,
      };

      if (forceCpu && updated.videoSettings) {
        updated.videoSettings = {
          ...updated.videoSettings,
          accel_mode: 'cpu',
        };
      }

      return {
        tasksById: {
          ...state.tasksById,
          [id]: updated,
        },
      };
    }),

  retryAllFailed: () =>
    set((state) => {
      const nextById = { ...state.tasksById };
      let hasChanges = false;
      for (const id of state.taskIds) {
        const item = nextById[id];
        if (item && item.status === 'failed') {
          nextById[id] = {
            ...item,
            status: 'queued',
            progress: 0,
            fps: 0,
            speed: 0,
            etaSeconds: 0,
            errorLog: undefined,
            fallbackUsed: false,
          };
          hasChanges = true;
        }
      }
      return hasChanges ? { tasksById: nextById } : state;
    }),

  moveTaskToTop: (id) =>
    set((state) => {
      if (!state.taskIds.includes(id)) return state;
      const otherIds = state.taskIds.filter((taskId) => taskId !== id);
      return {
        taskIds: [id, ...otherIds],
      };
    }),

  overrideTaskFormat: (id, format) =>
    set((state) => {
      const item = state.tasksById[id];
      const fmt = format.toLowerCase();
      if (!item || (item.status !== 'queued' && item.status !== 'failed' && item.status !== 'cancelled')) {
        return state;
      }
      if (!isFormatSupportedForKind(item.mediaKind, fmt)) {
        return state;
      }

      const updated: TaskItem = {
        ...item,
        targetFormat: fmt,
        hasCustomFormat: true,
      };

      if (item.mediaKind === 'video') {
        const base = item.videoSettings ?? {
          ...state.videoSettings,
          source_audio_codec: item.audioCodec,
        };
        const nextCodec = resolveCompatibleVideoCodec(fmt, base.codec);
        updated.videoSettings = {
          ...base,
          format: fmt,
          codec: nextCodec,
          prores_profile:
            fmt === 'mov' && nextCodec === 'ProRes 422'
              ? (base.prores_profile ?? 'standard')
              : undefined,
        };
      } else if (item.mediaKind === 'audio') {
        const base = item.audioSettings ?? { ...state.audioSettings };
        updated.audioSettings = {
          ...base,
          format: fmt,
          sample_rate: fmt === 'mp3' && base.sample_rate > 48000 ? 48000 : base.sample_rate,
        };
      } else if (item.mediaKind === 'image') {
        const base = item.imageSettings ?? { ...state.imageSettings };
        updated.imageSettings = {
          ...base,
          format: fmt,
        };
      }

      return {
        tasksById: {
          ...state.tasksById,
          [id]: updated,
        },
      };
    }),

  setQueueFilter: (queueFilter) => set({ queueFilter }),

  setSearchQuery: (searchQuery) => set({ searchQuery }),

  setSoundNotifications: (soundNotifications) => {
    set({ soundNotifications });
    void persistSettings({ ...get(), soundNotifications });
  },

  toggleSoundNotifications: () => {
    const next = !get().soundNotifications;
    get().setSoundNotifications(next);
  },

  setActiveTab: (activeTab) => set({ activeTab }),

  setLanguage: (lang) => {
    syncDocumentAttributes(lang, get().theme, get().fontScale);
    set({ language: lang });
    void persistSettings({ ...get(), language: lang });
  },

  toggleLanguage: () => {
    const next = get().language === 'fa' ? 'en' : 'fa';
    get().setLanguage(next);
  },

  setTheme: (theme) => {
    syncDocumentAttributes(get().language, theme, get().fontScale);
    set({ theme });
    void persistSettings({ ...get(), theme });
  },

  toggleTheme: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark';
    get().setTheme(next);
  },

  setProMode: (isProMode) => {
    set({ isProMode });
    void persistSettings({ ...get(), isProMode });
  },

  toggleProMode: () => {
    const next = !get().isProMode;
    get().setProMode(next);
  },

  setParallelMode: (parallelMode) => {
    set({ parallelMode });
    void persistSettings({ ...get(), parallelMode });
  },

  setMaxParallelJobs: (maxParallelJobs) => {
    set({ maxParallelJobs });
    void persistSettings({ ...get(), maxParallelJobs });
  },

  setAccelMode: (accelMode) => {
    set({ accelMode });
    get().setVideoSettings({ accel_mode: accelMode });
    void persistSettings({ ...get(), accelMode });
  },

  setNvencPreset: (nvencPreset) => {
    set({ nvencPreset });
    get().setVideoSettings({ nvenc_preset: nvencPreset });
    void persistSettings({ ...get(), nvencPreset });
  },

  setSleepPrevention: (sleepPrevention) => {
    set({ sleepPrevention });
    void persistSettings({ ...get(), sleepPrevention });
  },

  setFontScale: (fontScale) => {
    syncDocumentAttributes(get().language, get().theme, fontScale);
    set({ fontScale });
    void persistSettings({ ...get(), fontScale });
  },

  setHardwareProfile: (hardwareProfile) => set({ hardwareProfile }),

  setOutputDir: (outputDir) => {
    set((state) => {
      const nextById = { ...state.tasksById };
      let tasksChanged = false;

      for (const id of state.taskIds) {
        const task = nextById[id];
        if (!task || task.status !== 'queued') continue;
        if (task.mediaKind === 'video' && task.videoSettings) {
          nextById[id] = {
            ...task,
            videoSettings: { ...task.videoSettings, output_dir: outputDir },
          };
          tasksChanged = true;
        } else if (task.mediaKind === 'audio' && task.audioSettings) {
          nextById[id] = {
            ...task,
            audioSettings: { ...task.audioSettings, output_dir: outputDir },
          };
          tasksChanged = true;
        } else if (task.mediaKind === 'image' && task.imageSettings) {
          nextById[id] = {
            ...task,
            imageSettings: { ...task.imageSettings, output_dir: outputDir },
          };
          tasksChanged = true;
        }
      }

      return {
        outputDir,
        videoSettings: { ...state.videoSettings, output_dir: outputDir },
        audioSettings: { ...state.audioSettings, output_dir: outputDir },
        imageSettings: { ...state.imageSettings, output_dir: outputDir },
        ...(tasksChanged ? { tasksById: nextById } : {}),
      };
    });
    void persistSettings({ ...get(), outputDir });
  },

  setVideoSettings: (settings) =>
    set((state) => {
      const merged: VideoConversionSettings = {
        ...state.videoSettings,
        ...settings,
      };

      if (settings.format !== undefined && settings.codec === undefined) {
        merged.codec = resolveCompatibleVideoCodec(merged.format, merged.codec);
      }

      if (merged.format.toLowerCase() !== 'mov' || merged.codec !== 'ProRes 422') {
        if (settings.prores_profile === undefined) {
          merged.prores_profile = undefined;
        }
      }

      const nextById = { ...state.tasksById };
      let tasksChanged = false;

      for (const id of state.taskIds) {
        const task = nextById[id];
        if (!task || task.status !== 'queued' || task.mediaKind !== 'video') continue;

        const preservedSourceAudio = task.videoSettings?.source_audio_codec;
        const preserveCustomFormat = task.hasCustomFormat === true;
        const effectiveFormat = preserveCustomFormat
          ? (task.videoSettings?.format || task.targetFormat)
          : merged.format;
        const effectiveCodec = preserveCustomFormat
          ? resolveCompatibleVideoCodec(effectiveFormat, merged.codec)
          : merged.codec;

        nextById[id] = {
          ...task,
          targetFormat: preserveCustomFormat ? task.targetFormat : merged.format,
          videoSettings: {
            ...merged,
            format: effectiveFormat,
            codec: effectiveCodec,
            prores_profile:
              effectiveFormat.toLowerCase() === 'mov' && effectiveCodec === 'ProRes 422'
                ? merged.prores_profile
                : undefined,
            source_audio_codec: preservedSourceAudio,
          },
        };
        tasksChanged = true;
      }

      return {
        videoSettings: merged,
        ...(tasksChanged ? { tasksById: nextById } : {}),
      };
    }),

  setAudioSettings: (settings) =>
    set((state) => {
      const merged: AudioConversionSettings = {
        ...state.audioSettings,
        ...settings,
      };
      if (merged.format.toLowerCase() === 'mp3' && merged.sample_rate > 48000) {
        merged.sample_rate = 48000;
      }

      const nextById = { ...state.tasksById };
      let tasksChanged = false;

      for (const id of state.taskIds) {
        const task = nextById[id];
        if (!task || task.status !== 'queued' || task.mediaKind !== 'audio') continue;

        const preserveCustomFormat = task.hasCustomFormat === true;
        const effectiveFormat = preserveCustomFormat
          ? (task.audioSettings?.format || task.targetFormat)
          : merged.format;
        const effectiveSampleRate =
          effectiveFormat.toLowerCase() === 'mp3' && merged.sample_rate > 48000
            ? 48000
            : merged.sample_rate;

        nextById[id] = {
          ...task,
          targetFormat: preserveCustomFormat ? task.targetFormat : merged.format,
          audioSettings: {
            ...merged,
            format: effectiveFormat,
            sample_rate: effectiveSampleRate,
          },
        };
        tasksChanged = true;
      }

      return {
        audioSettings: merged,
        ...(tasksChanged ? { tasksById: nextById } : {}),
      };
    }),

  setImageSettings: (settings) =>
    set((state) => {
      const merged: ImageConversionSettings = {
        ...state.imageSettings,
        ...settings,
      };

      const nextById = { ...state.tasksById };
      let tasksChanged = false;

      for (const id of state.taskIds) {
        const task = nextById[id];
        if (!task || task.status !== 'queued' || task.mediaKind !== 'image') continue;

        const preserveCustomFormat = task.hasCustomFormat === true;
        const effectiveFormat = preserveCustomFormat
          ? (task.imageSettings?.format || task.targetFormat)
          : merged.format;

        nextById[id] = {
          ...task,
          targetFormat: preserveCustomFormat ? task.targetFormat : merged.format,
          imageSettings: {
            ...merged,
            format: effectiveFormat,
          },
        };
        tasksChanged = true;
      }

      return {
        imageSettings: merged,
        ...(tasksChanged ? { tasksById: nextById } : {}),
      };
    }),

  initializeSettingsBatch: (settings) => {
    const current = get();
    const lang: 'fa' | 'en' =
      settings.language === 'en' ? 'en' : settings.language === 'fa' ? 'fa' : current.language;
    const theme: 'dark' | 'light' =
      settings.theme === 'light' ? 'light' : settings.theme === 'dark' ? 'dark' : current.theme;
    const outputDir = settings.output_dir !== undefined ? settings.output_dir : current.outputDir;
    const isProMode =
      settings.is_pro_mode !== undefined ? settings.is_pro_mode : current.isProMode;
    const parallelMode: ParallelMode = VALID_PARALLEL_MODES.includes(
      settings.parallel_mode as ParallelMode
    )
      ? (settings.parallel_mode as ParallelMode)
      : current.parallelMode;
    const maxParallelJobs =
      settings.max_parallel_jobs !== undefined ? settings.max_parallel_jobs : current.maxParallelJobs;
    const accelMode: AccelMode = VALID_ACCEL_MODES.includes(settings.accel_mode as AccelMode)
      ? (settings.accel_mode as AccelMode)
      : current.accelMode;
    const nvencPreset =
      settings.nvenc_preset && settings.nvenc_preset.trim()
        ? settings.nvenc_preset
        : current.nvencPreset;
    const soundNotifications =
      settings.sound_notifications !== undefined
        ? settings.sound_notifications
        : current.soundNotifications;
    const sleepPrevention =
      settings.sleep_prevention !== undefined ? settings.sleep_prevention : current.sleepPrevention;
    const fontScale: FontScale = VALID_FONT_SCALES.includes(settings.font_scale as FontScale)
      ? (settings.font_scale as FontScale)
      : current.fontScale;

    syncDocumentAttributes(lang, theme, fontScale);

    set((state) => ({
      language: lang,
      theme,
      outputDir,
      isProMode,
      parallelMode,
      maxParallelJobs,
      accelMode,
      nvencPreset,
      soundNotifications,
      sleepPrevention,
      fontScale,
      videoSettings: {
        ...state.videoSettings,
        output_dir: outputDir,
        accel_mode: accelMode,
        nvenc_preset: nvencPreset,
      },
      audioSettings: { ...state.audioSettings, output_dir: outputDir },
      imageSettings: { ...state.imageSettings, output_dir: outputDir },
    }));
  },

  setIsProcessing: (isProcessing) => set({ isProcessing }),

  setQueueActions: (queueActions) => set({ queueActions }),

  saveSettingsToDisk: async () => {
    await persistSettings(get());
  },

  addToast: (toast) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const duration = toast.durationMs ?? (toast.type === 'error' ? 6000 : 4000);
    const nextToast: ToastMessage = { ...toast, id };

    set((state) => {
      const existing = state.toasts;
      const trimmed = existing.length >= 5 ? existing.slice(existing.length - 4) : existing;
      if (existing.length >= 5) {
        const dropped = existing.slice(0, existing.length - 4);
        for (const d of dropped) {
          const timer = toastTimers.get(d.id);
          if (timer) {
            clearTimeout(timer);
            toastTimers.delete(d.id);
          }
        }
      }
      return { toasts: [...trimmed, nextToast] };
    });

    if (duration > 0) {
      const timer = setTimeout(() => {
        toastTimers.delete(id);
        get().removeToast(id);
      }, duration);
      toastTimers.set(id, timer);
    }

    return id;
  },

  removeToast: (id) => {
    const timer = toastTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      toastTimers.delete(id);
    }
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },

  bumpHistoryVersion: () =>
    set((state) => ({
      historyVersion: state.historyVersion + 1,
    })),

  toggleTaskSelection: (id) =>
    set((state) => {
      if (!state.tasksById[id]) return state;
      const exists = state.selectedTaskIds.includes(id);
      return {
        selectedTaskIds: exists
          ? state.selectedTaskIds.filter((tId) => tId !== id)
          : [...state.selectedTaskIds, id],
      };
    }),

  selectAllTasks: (ids) =>
    set((state) => {
      const targetIds = ids
        ? ids.filter((id) => Boolean(state.tasksById[id]))
        : [...state.taskIds];
      return {
        selectedTaskIds: targetIds,
      };
    }),

  clearTaskSelection: () => set({ selectedTaskIds: [] }),

  batchSetFormat: (format) =>
    set((state) => {
      const fmt = format.toLowerCase();
      const newTasksById = { ...state.tasksById };
      let changed = false;

      for (const id of state.selectedTaskIds) {
        const task = newTasksById[id];
        if (!task) continue;
        if (task.status !== 'queued' && task.status !== 'failed' && task.status !== 'cancelled') {
          continue;
        }
        if (!isFormatSupportedForKind(task.mediaKind, fmt)) {
          continue;
        }

        const updated: TaskItem = {
          ...task,
          targetFormat: fmt,
          hasCustomFormat: true,
        };

        if (task.mediaKind === 'video') {
          const base = task.videoSettings ?? {
            ...state.videoSettings,
            source_audio_codec: task.audioCodec,
          };
          const nextCodec = resolveCompatibleVideoCodec(fmt, base.codec);
          updated.videoSettings = {
            ...base,
            format: fmt,
            codec: nextCodec,
            prores_profile:
              fmt === 'mov' && nextCodec === 'ProRes 422'
                ? (base.prores_profile ?? 'standard')
                : undefined,
          };
        } else if (task.mediaKind === 'audio') {
          const base = task.audioSettings ?? { ...state.audioSettings };
          updated.audioSettings = {
            ...base,
            format: fmt,
            sample_rate: fmt === 'mp3' && base.sample_rate > 48000 ? 48000 : base.sample_rate,
          };
        } else if (task.mediaKind === 'image') {
          const base = task.imageSettings ?? { ...state.imageSettings };
          updated.imageSettings = {
            ...base,
            format: fmt,
          };
        }

        newTasksById[id] = updated;
        changed = true;
      }

      return changed ? { tasksById: newTasksById } : state;
    }),

  batchDeleteSelected: () =>
    set((state) => {
      const toDelete = new Set(
        state.selectedTaskIds.filter((id) => {
          const task = state.tasksById[id];
          return task && task.status !== 'processing';
        })
      );
      if (toDelete.size === 0) return state;

      const newTaskIds = state.taskIds.filter((id) => !toDelete.has(id));
      const newTasksById = { ...state.tasksById };
      for (const id of toDelete) {
        delete newTasksById[id];
      }

      return {
        taskIds: newTaskIds,
        tasksById: newTasksById,
        selectedTaskIds: state.selectedTaskIds.filter((id) => !toDelete.has(id)),
      };
    }),

  setActiveModal: (activeModal) => set({ activeModal }),

  resetSettingsToDefault: () => {
    const currentOutputDir = get().outputDir;
    syncDocumentAttributes('fa', 'dark', 'medium');

    set({
      language: 'fa',
      theme: 'dark',
      isProMode: false,
      parallelMode: 'smart',
      maxParallelJobs: 0,
      accelMode: 'auto',
      nvencPreset: 'p4',
      soundNotifications: true,
      sleepPrevention: true,
      fontScale: 'medium',
      videoSettings: { ...DEFAULT_VIDEO_SETTINGS, output_dir: currentOutputDir },
      audioSettings: { ...DEFAULT_AUDIO_SETTINGS, output_dir: currentOutputDir },
      imageSettings: { ...DEFAULT_IMAGE_SETTINGS, output_dir: currentOutputDir },
    });

    void persistSettings({
      language: 'fa',
      theme: 'dark',
      outputDir: currentOutputDir,
      parallelMode: 'smart',
      maxParallelJobs: 0,
      accelMode: 'auto',
      nvencPreset: 'p4',
      isProMode: false,
      soundNotifications: true,
      sleepPrevention: true,
      fontScale: 'medium',
    });
  },
}));
