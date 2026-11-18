import React, { useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { StatusBar } from './StatusBar';
import { DropZone } from '../queue/DropZone';
import { QueueList } from '../queue/QueueList';
import { VideoPanel } from '../panels/VideoPanel';
import { AudioPanel } from '../panels/AudioPanel';
import { ImagePanel } from '../panels/ImagePanel';
import { HistoryPanel } from '../panels/HistoryPanel';
import { PresetsPanel } from '../panels/PresetsPanel';
import { HardwareMonitorPanel } from '../panels/HardwareMonitorPanel';
import { SettingsPanel } from '../panels/SettingsPanel';
import { AboutPanel } from '../panels/AboutPanel';
import { SocialSplitterModal } from '../modals/SocialSplitterModal';
import { DuplicateScannerModal } from '../modals/DuplicateScannerModal';
import { SubtitleFixerModal } from '../modals/SubtitleFixerModal';
import { useConverterStore } from '../../store/useConverterStore';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import { useI18n } from '../../i18n/useI18n';

export const StudioLayout: React.FC = () => {
  const { t } = useI18n();
  const activeTab = useConverterStore((state) => state.activeTab);
  const activeModal = useConverterStore((state) => state.activeModal);
  const [isDragOver, setIsDragOver] = useState(false);

  useKeyboardShortcuts();

  const renderActivePanel = () => {
    switch (activeTab) {
      case 'video':
        return <VideoPanel />;
      case 'audio':
        return <AudioPanel />;
      case 'image':
        return <ImagePanel />;
      case 'history':
        return <HistoryPanel />;
      case 'presets':
        return <PresetsPanel />;
      case 'hardware':
        return <HardwareMonitorPanel />;
      case 'settings':
        return <SettingsPanel />;
      case 'about':
        return <AboutPanel />;
      default:
        return <VideoPanel />;
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--canvas-bg)] text-[var(--text-primary)]">
      {/* Sidebar navigation */}
      <Sidebar />

      {/* Main Studio Viewport */}
      <div className="flex-1 flex flex-col h-full min-w-0 overflow-hidden relative">
        <main className="flex-1 flex overflow-hidden p-3 lg:p-4 gap-3 lg:gap-4">
          {/* Settings & Parameters Column */}
          <div className="w-[340px] lg:w-[380px] xl:w-[420px] shrink-0 h-full overflow-y-auto pe-1 scrollbar-thin">
            {renderActivePanel()}
          </div>

          {/* Queue & DropZone Column */}
          <div className="flex-1 flex flex-col h-full overflow-hidden gap-3 min-w-0 relative">
            {/* Full-Queue Native Drag-and-Drop Overlay */}
            {isDragOver && (
              <div
                aria-hidden="true"
                className="absolute inset-0 z-50 rounded-2xl bg-sky-500/15 dark:bg-sky-500/20 backdrop-blur-md border-2 border-dashed border-sky-600 dark:border-sky-400 flex flex-col items-center justify-center pointer-events-none transition-all shadow-xl p-6 text-center"
              >
                <div className="w-14 h-14 rounded-2xl bg-sky-500/20 border border-sky-500/30 flex items-center justify-center mb-3">
                  <UploadCloud className="w-8 h-8 text-sky-600 dark:text-sky-400 animate-bounce" />
                </div>
                <span className="font-bold text-sm text-[var(--text-primary)]">
                  {t.dropzone.dropFilesNow}
                </span>
              </div>
            )}

            <DropZone isDragOver={isDragOver} onDragOverChange={setIsDragOver} />
            <div className="flex-1 overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-card)] relative">
              <QueueList />
            </div>
          </div>
        </main>

        {/* Bottom Status Bar */}
        <StatusBar />
      </div>

      {/* Modals */}
      {activeModal === 'social_splitter' && <SocialSplitterModal />}
      {activeModal === 'duplicate_scanner' && <DuplicateScannerModal />}
      {activeModal === 'subtitle_fixer' && <SubtitleFixerModal />}
    </div>
  );
};
