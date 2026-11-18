import { describe, it, expect, beforeEach, vi } from 'bun:test';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ImagePanel } from '../components/panels/ImagePanel';
import { PresetsPanel } from '../components/panels/PresetsPanel';
import { HistoryPanel } from '../components/panels/HistoryPanel';
import { ModalDialog } from '../components/common/ModalDialog';
import {
  useConverterStore,
  DEFAULT_VIDEO_SETTINGS,
  DEFAULT_AUDIO_SETTINGS,
  DEFAULT_IMAGE_SETTINGS,
} from '../store/useConverterStore';
import { CustomPreset, HistoryEntry, HistorySummary } from '../types';
import { mockInvoke } from './setup';

describe('Panels & ModalDialog integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConverterStore.setState({
      language: 'en',
      theme: 'dark',
      taskIds: [],
      tasksById: {},
      selectedTaskIds: [],
      outputDir: 'D:/Out',
      videoSettings: { ...DEFAULT_VIDEO_SETTINGS },
      audioSettings: { ...DEFAULT_AUDIO_SETTINGS },
      imageSettings: { ...DEFAULT_IMAGE_SETTINGS },
      toasts: [],
    });
  });

  it('ImagePanel preserves single-axis aspect lock when locked and preserves dual axes when unlocked', () => {
    render(<ImagePanel />);

    const [widthInput, heightInput] = screen.getAllByRole('spinbutton');
    fireEvent.change(heightInput, { target: { value: '720' } });
    expect(useConverterStore.getState().imageSettings.resize_height).toBe(720);

    fireEvent.change(widthInput, { target: { value: '960' } });
    expect(useConverterStore.getState().imageSettings.resize_width).toBe(960);
    expect(useConverterStore.getState().imageSettings.resize_height).toBeUndefined();

    // Unlock aspect ratio
    const lockBtn = screen.getByRole('button', { name: /Locked/i });
    fireEvent.click(lockBtn);
    fireEvent.change(heightInput, { target: { value: '540' } });
    expect(useConverterStore.getState().imageSettings.resize_width).toBe(960);
    expect(useConverterStore.getState().imageSettings.resize_height).toBe(540);
  });

  it('PresetsPanel saves and applies an image preset via IPC', async () => {
    const savedPresets: CustomPreset[] = [];
    mockInvoke.mockImplementation(async (cmd: unknown, args?: unknown) => {
      if (cmd === 'get_custom_presets') return savedPresets;
      if (cmd === 'save_custom_preset') {
        const p = (args as { preset: CustomPreset }).preset;
        savedPresets.push(p);
        return undefined;
      }
      return undefined;
    });

    useConverterStore.getState().setImageSettings({ format: 'avif', quality: 62 });
    render(<PresetsPanel />);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('get_custom_presets');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save Current Settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Image' }));
    fireEvent.change(screen.getByPlaceholderText('Preset Name...'), {
      target: { value: 'Web AVIF 62' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Preset' }));

    await waitFor(() => {
      expect(screen.getByText('Web AVIF 62')).toBeInTheDocument();
    });

    useConverterStore.getState().setImageSettings({ format: 'png', quality: 95 });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(useConverterStore.getState().imageSettings.format).toBe('avif');
    expect(useConverterStore.getState().imageSettings.quality).toBe(62);
  });

  it('HistoryPanel filters by status and search and deletes an entry', async () => {
    let entries: HistoryEntry[] = [
      {
        id: 'h_1',
        input_path: 'D:/in/clip1.mp4',
        output_path: 'D:/out/clip1.mkv',
        filename: 'clip1.mkv',
        source_size_bytes: 1000,
        output_size_bytes: 500,
        duration_secs: 10,
        format: 'mkv',
        speed: 2.0,
        timestamp: 100,
        status: 'completed',
      },
      {
        id: 'h_2',
        input_path: 'D:/in/broken.avi',
        output_path: 'D:/out/broken.mp4',
        filename: 'broken.mp4',
        source_size_bytes: 2000,
        output_size_bytes: 0,
        duration_secs: 5,
        format: 'mp4',
        speed: 0,
        timestamp: 200,
        status: 'failed',
      },
    ];
    const summary: HistorySummary = {
      total_files: 2,
      total_source_bytes: 3000,
      total_output_bytes: 500,
      total_saved_bytes: 2500,
      saved_percentage: 83.3,
      avg_speed: 2.0,
    };

    mockInvoke.mockImplementation(async (cmd: unknown, args?: unknown) => {
      if (cmd === 'get_conversion_history') return entries;
      if (cmd === 'get_history_summary') return summary;
      if (cmd === 'delete_history_entry') {
        const id = (args as { id: string }).id;
        entries = entries.filter((e) => e.id !== id);
        return true;
      }
      return undefined;
    });

    render(<HistoryPanel />);

    await waitFor(() => {
      expect(screen.getByText('clip1.mkv')).toBeInTheDocument();
      expect(screen.getByText('broken.mp4')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Failed' }));
    expect(screen.queryByText('clip1.mkv')).not.toBeInTheDocument();
    expect(screen.getByText('broken.mp4')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    fireEvent.change(screen.getByPlaceholderText('Search completed files & formats...'), {
      target: { value: 'clip1' },
    });
    expect(screen.getByText('clip1.mkv')).toBeInTheDocument();
    expect(screen.queryByText('broken.mp4')).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete History Entry' })[0]);
    const deleteButtons = screen.getAllByRole('button', { name: 'Delete' });
    fireEvent.click(deleteButtons[deleteButtons.length - 1]);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('delete_history_entry', { id: 'h_1' });
      expect(screen.queryByText('clip1.mkv')).not.toBeInTheDocument();
    });
  });

  it('ModalDialog renders content and invokes onClose when closed', () => {
    const onClose = vi.fn();
    render(
      <ModalDialog open={true} onClose={onClose} title="Test Modal" subtitle="Sub info">
        <div>Modal Body Content</div>
      </ModalDialog>
    );

    expect(screen.getByText('Test Modal')).toBeInTheDocument();
    expect(screen.getByText('Modal Body Content')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
