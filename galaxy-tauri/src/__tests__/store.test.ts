import { describe, it, expect, beforeEach } from 'bun:test';
import {
  useConverterStore,
  DEFAULT_VIDEO_SETTINGS,
  DEFAULT_AUDIO_SETTINGS,
  DEFAULT_IMAGE_SETTINGS,
} from '../store/useConverterStore';
import { TaskItem } from '../types';

const makeTask = (overrides: Partial<TaskItem> = {}): TaskItem => ({
  id: 'task_1',
  filePath: 'D:/media/sample.mp4',
  fileName: 'sample.mp4',
  fileSize: 1024 * 1024,
  durationSec: 12,
  mediaKind: 'video',
  targetFormat: 'mp4',
  progress: 0,
  fps: 0,
  speed: 0,
  etaSeconds: 0,
  status: 'queued',
  videoSettings: { ...DEFAULT_VIDEO_SETTINGS },
  ...overrides,
});

describe('useConverterStore queue & settings synchronization', () => {
  beforeEach(() => {
    useConverterStore.setState({
      taskIds: [],
      tasksById: {},
      selectedTaskIds: [],
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
      outputDir: '',
      videoSettings: { ...DEFAULT_VIDEO_SETTINGS },
      audioSettings: { ...DEFAULT_AUDIO_SETTINGS },
      imageSettings: { ...DEFAULT_IMAGE_SETTINGS },
      toasts: [],
    });
  });

  it('syncs queued video settings & outputDir without overriding custom per-task format or finished tasks', () => {
    const tQueuedAuto = makeTask({
      id: 'v_auto',
      filePath: 'D:/media/a.mp4',
      hasCustomFormat: false,
    });
    const tQueuedCustom = makeTask({
      id: 'v_custom',
      filePath: 'D:/media/b.mp4',
      status: 'queued',
    });
    const tCompleted = makeTask({
      id: 'v_done',
      filePath: 'D:/media/c.mp4',
      status: 'completed',
      targetFormat: 'mp4',
      videoSettings: { ...DEFAULT_VIDEO_SETTINGS, format: 'mp4', crf: 23 },
    });

    const store = useConverterStore.getState();
    store.addTasks([tQueuedAuto, tQueuedCustom, tCompleted]);
    store.overrideTaskFormat('v_custom', 'webm');
    store.setVideoSettings({ format: 'mkv', crf: 19 });
    store.setOutputDir('D:/Converted');

    const { tasksById } = useConverterStore.getState();
    expect(tasksById['v_auto'].targetFormat).toBe('mkv');
    expect(tasksById['v_auto'].videoSettings?.crf).toBe(19);
    expect(tasksById['v_auto'].videoSettings?.output_dir).toBe('D:/Converted');

    // Custom format preserved, other global settings synced cleanly
    expect(tasksById['v_custom'].hasCustomFormat).toBe(true);
    expect(tasksById['v_custom'].targetFormat).toBe('webm');
    expect(tasksById['v_custom'].videoSettings?.format).toBe('webm');
    expect(tasksById['v_custom'].videoSettings?.codec).toBe('AV1');
    expect(tasksById['v_custom'].videoSettings?.crf).toBe(19);

    // Finished tasks remain immutable snapshots
    expect(tasksById['v_done'].targetFormat).toBe('mp4');
    expect(tasksById['v_done'].videoSettings?.crf).toBe(23);
  });

  it('batchSetFormat updates only compatible selected tasks of matching mediaKind', () => {
    const vTask = makeTask({ id: 'v1', filePath: 'D:/media/v1.mp4', mediaKind: 'video', targetFormat: 'mp4' });
    const aTask = makeTask({
      id: 'a1',
      filePath: 'D:/media/a1.wav',
      fileName: 'a1.wav',
      mediaKind: 'audio',
      targetFormat: 'flac',
      videoSettings: undefined,
      audioSettings: { ...DEFAULT_AUDIO_SETTINGS, format: 'flac', sample_rate: 96000 },
    });
    const imgTask = makeTask({
      id: 'i1',
      filePath: 'D:/media/i1.png',
      fileName: 'i1.png',
      mediaKind: 'image',
      targetFormat: 'webp',
      videoSettings: undefined,
      imageSettings: { ...DEFAULT_IMAGE_SETTINGS },
    });

    const store = useConverterStore.getState();
    store.addTasks([vTask, aTask, imgTask]);
    store.selectAllTasks();
    store.batchSetFormat('mp3');

    const { tasksById } = useConverterStore.getState();
    expect(tasksById['v1'].targetFormat).toBe('mp4');
    expect(tasksById['i1'].targetFormat).toBe('webp');
    expect(tasksById['a1'].targetFormat).toBe('mp3');
    expect(tasksById['a1'].audioSettings?.sample_rate).toBe(48000);
  });

  it('cleans up selectedTaskIds when tasks are removed or finished tasks cleared', () => {
    const t1 = makeTask({ id: 't1', filePath: 'D:/media/1.mp4', status: 'queued' });
    const t2 = makeTask({ id: 't2', filePath: 'D:/media/2.mp4', status: 'completed' });
    const t3 = makeTask({ id: 't3', filePath: 'D:/media/3.mp4', status: 'failed' });

    const store = useConverterStore.getState();
    store.addTasks([t1, t2, t3]);
    store.selectAllTasks();
    expect(useConverterStore.getState().selectedTaskIds).toEqual(['t1', 't2', 't3']);

    store.removeTask('t1');
    expect(useConverterStore.getState().selectedTaskIds).toEqual(['t2', 't3']);

    store.clearFinishedTasks();
    expect(useConverterStore.getState().selectedTaskIds).toEqual(['t3']);
  });

  it('resetSettingsToDefault restores defaults while preserving queue items', () => {
    const t1 = makeTask({ id: 'keep_1', filePath: 'D:/media/keep.mp4' });
    const store = useConverterStore.getState();
    store.addTasks([t1]);
    store.setLanguage('en');
    store.setTheme('light');
    store.setVideoSettings({ crf: 15, format: 'mkv' });
    store.setAudioSettings({ bitrate: '320k' });
    store.setImageSettings({ quality: 45 });
    store.setMaxParallelJobs(4);
    store.setSleepPrevention(false);
    store.setFontScale('large');

    store.resetSettingsToDefault();

    const s = useConverterStore.getState();
    expect(s.language).toBe('fa');
    expect(s.theme).toBe('dark');
    expect(s.videoSettings.crf).toBe(DEFAULT_VIDEO_SETTINGS.crf);
    expect(s.videoSettings.format).toBe('mp4');
    expect(s.audioSettings.bitrate).toBe('192k');
    expect(s.imageSettings.quality).toBe(85);
    expect(s.maxParallelJobs).toBe(0);
    expect(s.sleepPrevention).toBe(true);
    expect(s.fontScale).toBe('medium');
    expect(s.taskIds).toEqual(['keep_1']);
  });
});
