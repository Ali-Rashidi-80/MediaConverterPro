import React, { useEffect } from 'react';
import { MotionConfig } from 'motion/react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { StudioLayout } from './components/layout/StudioLayout';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { ToastContainer } from './components/common/ToastContainer';
import { useConverterStore } from './store/useConverterStore';
import { TRANSLATIONS } from './i18n/translations';
import { AppSettings, HardwareProfile, TaskProgressUpdate } from './types';

type GpuFallbackPayload = string | { job_id?: string };

export const App: React.FC = () => {
  const updateBatchProgress = useConverterStore((state) => state.updateBatchProgress);
  const markTaskFallback = useConverterStore((state) => state.markTaskFallback);
  const setHardwareProfile = useConverterStore((state) => state.setHardwareProfile);
  const initializeSettingsBatch = useConverterStore((state) => state.initializeSettingsBatch);

  useEffect(() => {
    let cancelled = false;

    // 1. Listen for throttled batch progress events from Rust
    const unlistenProgressPromise = listen<TaskProgressUpdate[]>(
      'tasks_batch_progress',
      (event) => {
        if (!cancelled && Array.isArray(event.payload)) {
          updateBatchProgress(event.payload);
        }
      }
    );

    // 2. Listen for GPU -> CPU Circuit Breaker fallback notifications
    const unlistenFallbackPromise = listen<GpuFallbackPayload>(
      'job_gpu_fallback',
      (event) => {
        if (cancelled) return;
        const jobId =
          typeof event.payload === 'string'
            ? event.payload
            : event.payload?.job_id;
        if (!jobId) return;

        markTaskFallback(jobId);
        const { language, tasksById, addToast } = useConverterStore.getState();
        const t = TRANSLATIONS[language];
        const taskName = tasksById[jobId]?.fileName;
        addToast({
          type: 'warning',
          title: t.toasts.gpuFallbackNotice,
          message: taskName ?? jobId,
        });
      }
    );

    // 3. Initial warm probe of hardware and settings
    (async () => {
      try {
        const hw = await invoke<HardwareProfile>('probe_hardware', {
          forceRefresh: false,
        });
        if (!cancelled) {
          setHardwareProfile(hw);
        }
      } catch (e) {
        console.error('Initial hardware probe error:', e);
      }

      try {
        const settings = await invoke<AppSettings>('load_settings');
        if (!cancelled) {
          initializeSettingsBatch(settings);
        }
      } catch (e) {
        console.error('Initial settings load error:', e);
      }
    })();

    return () => {
      cancelled = true;
      unlistenProgressPromise
        .then((unlisten) => unlisten())
        .catch(() => {});
      unlistenFallbackPromise
        .then((unlisten) => unlisten())
        .catch(() => {});
    };
  }, [updateBatchProgress, markTaskFallback, setHardwareProfile, initializeSettingsBatch]);

  return (
    <MotionConfig reducedMotion="user">
      <ErrorBoundary>
        <StudioLayout />
        <ToastContainer />
      </ErrorBoundary>
    </MotionConfig>
  );
};

export default App;
