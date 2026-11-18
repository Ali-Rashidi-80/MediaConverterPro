import { test, expect, Page } from '@playwright/test';

async function installTauriMock(page: Page) {
  await page.addInitScript(() => {
    const callbacks = new Map<number, (data: unknown) => void>();
    const pendingJobs = new Map<
      string,
      { reject: (reason?: unknown) => void; resolve: (value: string) => void }
    >();

    let settings = {
      language: 'fa',
      theme: 'dark',
      output_dir: 'D:/Converted',
      parallel_mode: 'smart',
      max_parallel_jobs: 0,
      accel_mode: 'auto',
      nvenc_preset: 'p4',
      is_pro_mode: false,
      sound_notifications: true,
      sleep_prevention: true,
      font_scale: 'medium',
    };

    let customPresets: Array<{
      id: string;
      name: string;
      description: string;
      kind: 'video' | 'audio' | 'image';
      video_settings?: Record<string, unknown>;
      audio_settings?: Record<string, unknown>;
      image_settings?: Record<string, unknown>;
      created_at: number;
    }> = [];

    let historyEntries = [
      {
        id: 'hist_1',
        input_path: 'D:/Samples/intro.mp4',
        output_path: 'D:/Converted/intro.mkv',
        filename: 'intro.mkv',
        source_size_bytes: 20_000_000,
        output_size_bytes: 8_000_000,
        duration_secs: 45,
        format: 'mkv',
        speed: 3.2,
        timestamp: 1700000100,
        status: 'completed',
      },
      {
        id: 'hist_2',
        input_path: 'D:/Samples/corrupt.avi',
        output_path: 'D:/Converted/corrupt.mp4',
        filename: 'corrupt.mp4',
        source_size_bytes: 5_000_000,
        output_size_bytes: 0,
        duration_secs: 12,
        format: 'mp4',
        speed: 0,
        timestamp: 1700000200,
        status: 'failed',
      },
    ];

    (window as unknown as { isTauri?: boolean }).isTauri = true;

    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: (_event: string, id: number) => {
        callbacks.delete(id);
      },
    };

    window.__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: 'main' },
        currentWebview: { windowLabel: 'main', label: 'main' },
      },
      transformCallback: (cb: (data: unknown) => void, once = false) => {
        const id = Math.floor(Math.random() * 1_000_000_000);
        callbacks.set(id, (data) => {
          if (once) callbacks.delete(id);
          cb(data);
        });
        return id;
      },
      unregisterCallback: (id: number) => {
        callbacks.delete(id);
      },
      runCallback: (id: number, data: unknown) => {
        callbacks.get(id)?.(data);
      },
      callbacks,
      convertFileSrc: (filePath: string) => filePath,
      invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
        switch (cmd) {
          case 'plugin:event|listen':
            return args.handler ?? 1;
          case 'plugin:event|unlisten':
            return null;
          case 'plugin:window|set_progress_bar':
            return null;
          case 'probe_hardware':
            return {
              gpus: [{ index: 0, name: 'NVIDIA GeForce RTX 4070', vendor: 'nvidia' }],
              cpu_count: 8,
              recommended_backend: 'nvidia',
              max_concurrent_gpu_slots: 2,
              ffmpeg_version: 'ffmpeg version 7.1',
              available_encoders: ['libx264', 'h264_nvenc', 'hevc_nvenc', 'libsvtav1'],
              available_hwaccels: ['cuda'],
              available_filters: ['loudnorm', 'subtitles', 'scale'],
              ffmpeg_available: true,
              ffmpeg_path: 'D:/ffmpeg/ffmpeg.exe',
            };
          case 'load_settings':
            return { ...settings };
          case 'save_settings': {
            const next = args.settings as typeof settings | undefined;
            if (next) settings = { ...next };
            return null;
          }
          case 'check_disk_space':
            return {
              total_bytes: 500_000_000_000,
              available_bytes: 250_000_000_000,
              is_low: false,
            };
          case 'plugin:dialog|open': {
            const opts = args.options as { directory?: boolean } | undefined;
            if (opts?.directory) return 'D:/OutSplit';
            return ['D:/Samples/movie.mp4', 'D:/Samples/clip.mkv'];
          }
          case 'probe_media_file': {
            const p = String(args.path || '');
            const name = p.split('/').pop() || 'sample.mp4';
            return {
              path: p,
              filename: name,
              kind: 'video',
              duration_secs: 60,
              size_bytes: 12_000_000,
              width: 1920,
              height: 1080,
              video_codec: 'h264',
              audio_codec: 'aac',
            };
          }
          case 'set_sleep_prevention':
            return null;
          case 'start_video_conversion': {
            const jobId = String(args.jobId || '');
            return await new Promise<string>((resolve, reject) => {
              pendingJobs.set(jobId, { resolve, reject });
            });
          }
          case 'cancel_job': {
            const jobId = String(args.jobId || '');
            const pending = pendingJobs.get(jobId);
            if (pending) {
              pendingJobs.delete(jobId);
              pending.reject({ kind: 'JobCancelled' });
            }
            return true;
          }
          case 'cancel_all_jobs': {
            for (const [id, pending] of pendingJobs.entries()) {
              pendingJobs.delete(id);
              pending.reject({ kind: 'JobCancelled' });
            }
            return null;
          }
          case 'get_custom_presets':
            return [...customPresets];
          case 'save_custom_preset': {
            const preset = args.preset as (typeof customPresets)[number];
            const idx = customPresets.findIndex((p) => p.id === preset.id);
            if (idx >= 0) customPresets[idx] = preset;
            else customPresets.push(preset);
            return null;
          }
          case 'delete_custom_preset': {
            const id = String(args.id || '');
            customPresets = customPresets.filter((p) => p.id !== id);
            return null;
          }
          case 'get_conversion_history':
            return [...historyEntries];
          case 'get_history_summary': {
            const completed = historyEntries.filter((e) => e.status === 'completed');
            const totalSrc = completed.reduce((acc, e) => acc + e.source_size_bytes, 0);
            const totalOut = completed.reduce((acc, e) => acc + e.output_size_bytes, 0);
            return {
              total_files: completed.length,
              total_source_bytes: totalSrc,
              total_output_bytes: totalOut,
              total_saved_bytes: totalSrc - totalOut,
              saved_percentage: totalSrc > 0 ? ((totalSrc - totalOut) / totalSrc) * 100 : 0,
              avg_speed: completed.length > 0 ? 3.2 : 0,
            };
          }
          case 'delete_history_entry': {
            const id = String(args.id || '');
            historyEntries = historyEntries.filter((e) => e.id !== id);
            return true;
          }
          case 'clear_conversion_history':
            historyEntries = [];
            return null;
          default:
            return null;
        }
      },
    };
  });
}

test.describe('Galaxy Media Pro E2E workflows', () => {
  test('theme, RTL/LTR language, queue sync, BatchBar, single cancel, Presets CRUD, History, and Modal Escape', async ({
    page,
  }) => {
    const pageErrors: Error[] = [];
    page.on('pageerror', (err) => pageErrors.push(err));

    await installTauriMock(page);
    await page.goto('/');

    // 1. Default boot: Persian RTL + Dark Mode
    await expect(page.locator('html')).toHaveAttribute('lang', 'fa');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

    // Toggle Theme: Dark -> Light
    await page.getByRole('button', { name: 'تغییر تم تیره / روشن' }).click();
    await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
    const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(lightBg).not.toBe(darkBg);

    // Switch Language: Persian RTL -> English LTR
    await page.getByRole('button', { name: 'تغییر زبان (Ctrl+L)' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');

    // 2. Add two video files -> VideoPanel Step 2 sync -> BatchBar -> Single Cancel
    await page.getByRole('button', { name: 'Add Files', exact: true }).click();
    await expect(page.getByText('movie.mp4')).toBeVisible();
    await expect(page.getByText('clip.mkv')).toBeVisible();

    // Change global video format to MKV -> both queued tasks sync
    await page.getByRole('button', { name: 'mkv', exact: true }).click();
    await expect(page.locator('select[aria-label="Change Format"]').first()).toHaveValue('mkv');

    // Select all tasks via Select All -> BatchBar opens -> batch change format to WEBM
    await page.getByRole('button', { name: /Select all visible tasks/i }).click();
    await expect(page.getByText('items selected')).toBeVisible();
    await page.getByLabel('Batch Format').selectOption('webm');
    await expect(page.locator('select[aria-label="Change Format"]').first()).toHaveValue('webm');

    // Clear selection & Start Queue -> cancel single active job -> asserts Cancelled badge, never Failed button
    await page.getByRole('button', { name: 'Clear Selection', exact: true }).click();
    await page.getByRole('button', { name: 'Start Queue', exact: true }).click();
    await page.getByRole('button', { name: 'Cancel File', exact: true }).first().click();

    await expect(page.getByText('Cancelled', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'View Encoder Error Details' })).toHaveCount(0);

    // Stop remaining active job cleanly so queue settles
    const stopBtn = page.getByRole('button', { name: 'Stop Queue', exact: true });
    if (await stopBtn.isVisible()) {
      await stopBtn.click();
    }

    // 3. Presets CRUD
    await page.getByRole('button', { name: 'Custom Presets', exact: true }).click();
    await page.getByRole('button', { name: 'Save Current Settings', exact: true }).click();
    await page.getByPlaceholder('Preset Name...').fill('E2E Studio WEBM');
    await page.getByRole('button', { name: 'Save Preset', exact: true }).click();
    await expect(page.getByText('E2E Studio WEBM')).toBeVisible();

    await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
    await page.getByPlaceholder('Preset Name...').fill('E2E Studio WEBM Edited');
    await page.getByRole('button', { name: 'Update Preset', exact: true }).click();
    await expect(page.getByText('E2E Studio WEBM Edited')).toBeVisible();

    await page.getByRole('button', { name: 'Delete', exact: true }).first().click();
    await page.locator('dialog[open]').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByText('E2E Studio WEBM Edited')).toHaveCount(0);

    // 4. History filter & delete
    await page.getByRole('button', { name: 'History & Analytics', exact: true }).click();
    await expect(page.getByText('intro.mkv')).toBeVisible();
    await expect(page.getByText('corrupt.mp4')).toBeVisible();

    await page.getByRole('button', { name: 'Failed', exact: true }).click();
    await expect(page.getByText('intro.mkv')).toHaveCount(0);
    await expect(page.getByText('corrupt.mp4')).toBeVisible();

    await page.getByRole('button', { name: 'All', exact: true }).click();
    await page.getByRole('button', { name: 'Delete History Entry', exact: true }).first().click();
    await page.locator('dialog[open]').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByText('corrupt.mp4')).toHaveCount(0);

    // 5. Open native <dialog> modal and close with Escape
    await page.getByRole('button', { name: 'Social Story Splitter & Carousel Cutter', exact: true }).click();
    const openDialog = page.locator('dialog[open]');
    await expect(openDialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('dialog[open]')).toHaveCount(0);

    expect(pageErrors).toEqual([]);
  });
});
