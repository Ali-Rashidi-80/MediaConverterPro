"""Video/audio conversion worker thread."""
import logging
import os
import re
import subprocess
import threading
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait

from PySide6.QtCore import QThread, Signal

from galaxy.core.exceptions import FFmpegNotFoundError, OutputDirError
from galaxy.core.utils import ensure_writable_dir, get_startupinfo, resolve_output_path
from galaxy.services.ffmpeg import FFmpegEngine, find_ffmpeg_path
from galaxy.services.ffmpeg_pipeline import PipelineTier, build_video_command, pick_pipeline_tier, tier_label
from galaxy.services.hw_probe import AccelBackend, get_system_profile
from galaxy.services.job_scheduler import GlobalGpuSemaphore, JobDescriptor, JobKind, compute_slots, per_job_cpu_threads
from galaxy.workers.task_queue import ConversionTaskQueue
from galaxy.workers.worker_i18n import WorkerI18n

_output_locks: dict[str, threading.Lock] = {}
_output_locks_guard = threading.Lock()


def _output_lock(path: str) -> threading.Lock:
    with _output_locks_guard:
        if path not in _output_locks:
            _output_locks[path] = threading.Lock()
        return _output_locks[path]


class MediaWorker(QThread):
    progress_signal = Signal(int)
    log_signal = Signal(str)
    file_status_signal = Signal(str, str)
    file_started_signal = Signal(str)
    pipeline_signal = Signal(str)
    batch_progress_signal = Signal(int, int)
    finished_all = Signal()

    def __init__(self, queue: ConversionTaskQueue, output_dir, settings, mode='video', app_settings=None):
        super().__init__()
        self.queue = queue
        self.output_dir = output_dir
        self.app_settings = app_settings or {}
        self.settings = dict(self.app_settings)
        self.settings.update(settings)
        self.mode = mode
        self.is_running = True
        self._active_processes: list[subprocess.Popen] = []
        self._proc_lock = threading.Lock()
        self._executor = None
        self._progress_lock = threading.Lock()
        self._tier_lock = threading.Lock()
        self._i18n = WorkerI18n(self.app_settings.get('language', 'fa'))
        self._batch_tier_key = ""

    def append_tasks(self, paths: list[str]) -> list[str]:
        return self.queue.append(paths)

    def _encoder_label(self, profile, settings) -> str:
        if self.mode != 'video':
            return "CPU"
        tier, backend = pick_pipeline_tier(settings, profile)
        if tier not in (PipelineTier.TIER1, PipelineTier.TIER2):
            return self._i18n.t('pipeline.cpu').replace('🖥 ', '').replace('🖥', '').strip()
        preset = settings.get('nvenc_preset') or 'p4'
        if backend == AccelBackend.NVIDIA:
            return f"NVENC {preset}"
        if backend == AccelBackend.AMD:
            return "AMF"
        if backend == AccelBackend.INTEL:
            return "QSV"
        return "GPU"

    def get_ffmpeg_path(self):
        ffmpeg_path = find_ffmpeg_path()
        if ffmpeg_path:
            return ffmpeg_path
        raise FFmpegNotFoundError("FFmpeg not found")

    def get_duration(self, ffmpeg_path, file_path):
        probe = FFmpegEngine.run_probe(ffmpeg_path, file_path)
        return FFmpegEngine.get_duration(probe)

    def _extract_ffmpeg_error(self, stderr_output):
        if not stderr_output or not stderr_output.strip():
            return self._i18n.t('err.ffmpeg_empty')
        for line in reversed(stderr_output.strip().splitlines()):
            text = line.strip()
            if not text or 'time=' in text or text.startswith('frame='):
                continue
            lower = text.lower()
            if any(k in lower for k in ('error', 'invalid', 'failed', 'unable', 'not found', 'does not contain', 'no such file', 'concurrent')):
                return text[:200]
        for line in reversed(stderr_output.strip().splitlines()):
            text = line.strip()
            if text and 'time=' not in text and not text.startswith('frame='):
                return text[:200]
        return self._i18n.t('err.ffmpeg_incomplete')

    def _resolve_output_path(self, file_path, name, target_fmt):
        save_path = resolve_output_path(self.output_dir, file_path, name, target_fmt)
        collision = '_converted.' in os.path.basename(save_path)
        return save_path, collision

    def _build_command(self, ffmpeg_cmd, file_path, save_path, profile, force_cpu=False, settings=None):
        s = settings if settings is not None else self.settings
        target_fmt = s.get('format', 'mp3').lower()
        if self.mode == 'audio':
            cmd = [ffmpeg_cmd, '-hide_banner', '-loglevel', 'info', '-y']
            FFmpegEngine.append_input_options(cmd, s)
            cmd.extend(['-i', file_path])
            FFmpegEngine.append_audio_options(cmd, s, target_fmt)
            cmd.append(save_path)
            return cmd, PipelineTier.CPU, None
        cmd, tier, backend = build_video_command(
            ffmpeg_cmd, file_path, save_path, s, profile, force_cpu=force_cpu
        )
        return cmd, tier, backend

    def _register_process(self, proc):
        with self._proc_lock:
            self._active_processes.append(proc)

    def _unregister_process(self, proc):
        with self._proc_lock:
            if proc in self._active_processes:
                self._active_processes.remove(proc)

    def _emit_batch_progress(self):
        done = self.queue.completed
        total = max(1, self.queue.total)
        pct = int((done / total) * 100)
        self.progress_signal.emit(min(99, pct))
        self.batch_progress_signal.emit(done, total)

    def _finish_file(self, path: str, ok: bool, msg: str, *, rename_collision: bool = False) -> None:
        if msg == "stopped" and self.queue.is_stopped():
            self.queue.mark_complete()
            self._emit_batch_progress()
            self.file_status_signal.emit(path, "cancelled")
            return
        if rename_collision:
            self.log_signal.emit(self._i18n.t('status.rename_collision'))
        self.queue.mark_complete()
        self._emit_batch_progress()
        if ok:
            self.file_status_signal.emit(path, "success")
            self.log_signal.emit(self._i18n.t('status.file_ok', name=msg))
        else:
            self.file_status_signal.emit(path, "fail")
            self.log_signal.emit(self._i18n.t('status.file_fail', name=os.path.basename(path), err=msg))

    def _emit_pipeline_key(self, tier, backend) -> str | None:
        if self.mode != "video" or not tier:
            return None
        with self._tier_lock:
            if self._batch_tier_key:
                return None
            if tier == PipelineTier.CPU or not backend:
                key = "cpu"
            else:
                key = tier_label(tier, backend)
            self._batch_tier_key = key
            return key

    def _run_ffmpeg(self, cmd, duration_sec, file_index, total_files, progress_base=0, progress_span=100, *, emit_progress=True):
        proc = subprocess.Popen(
            cmd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE, text=True, encoding='utf-8', errors='replace',
            startupinfo=get_startupinfo()
        )
        self._register_process(proc)
        stderr_output = []
        last_progress = progress_base
        returncode = None

        try:
            while True:
                returncode = proc.poll()
                if returncode is not None:
                    break
                if not self.is_running:
                    self._terminate_process(proc)
                    returncode = proc.poll()
                    break
                try:
                    line = proc.stderr.readline()
                    if line:
                        stderr_output.append(line)
                        if 'time=' in line and duration_sec > 0 and total_files > 0:
                            match = re.search(r"time=(\d{1,3}):(\d{2}):(\d{2})", line)
                            if match:
                                th, tm, ts = map(int, match.groups())
                                cur_sec = th * 3600 + tm * 60 + ts
                                frac = min(cur_sec / duration_sec, 1.0)
                                prog = progress_base + int(frac * progress_span * 0.99)
                                if emit_progress and prog > last_progress:
                                    last_progress = prog
                                    self.progress_signal.emit(min(99, prog))
                except OSError:
                    pass
            try:
                remaining = proc.stderr.read()
                if remaining:
                    stderr_output.append(remaining)
            except OSError:
                pass
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._terminate_process(proc)
        finally:
            self._unregister_process(proc)

        return returncode, ''.join(stderr_output)

    def _convert_one(self, ffmpeg_cmd, profile, file_path, file_index, total_files, slots, emit_progress=True):
        if not self.is_running:
            return file_path, False, "stopped", None, False

        if not os.path.isfile(file_path) or not os.access(file_path, os.R_OK):
            return file_path, False, "unreadable", None, False

        fname = os.path.basename(file_path)
        name, _ = os.path.splitext(fname)
        target_fmt = self.settings.get('format', 'mp3').lower()
        save_path, rename_collision = self._resolve_output_path(file_path, name, target_fmt)
        lock = _output_lock(save_path)
        duration_sec = self.get_duration(ffmpeg_cmd, file_path)

        tier, _ = pick_pipeline_tier(self.settings, profile)
        uses_gpu = self.mode == 'video' and tier in (PipelineTier.TIER1, PipelineTier.TIER2)
        gpu_acquired = False
        pipeline_key = None

        job_settings = dict(self.settings)
        job_settings['cpu_threads'] = per_job_cpu_threads(self.app_settings, slots, profile)
        cpu_retried = False

        try:
            if uses_gpu:
                if not GlobalGpuSemaphore.acquire(timeout=300):
                    uses_gpu = False
                    self.log_signal.emit(self._i18n.t('status.gpu_queue_timeout'))
                else:
                    gpu_acquired = True

            with lock:
                cmd, tier, backend = self._build_command(
                    ffmpeg_cmd, file_path, save_path, profile,
                    force_cpu=not uses_gpu, settings=job_settings,
                )
                pipeline_key = self._emit_pipeline_key(tier, backend)
                logging.info(
                    "Pipeline tier=%s backend=%s file=%s",
                    tier.value if tier else "?",
                    backend.value if backend else "cpu",
                    fname,
                )

                span = max(1, 100 // total_files)
                base = int((file_index / total_files) * 100)
                returncode, stderr_output = self._run_ffmpeg(
                    cmd, duration_sec, file_index, total_files, base, span, emit_progress=emit_progress,
                )

                if returncode == 0 and os.path.exists(save_path) and os.path.getsize(save_path) > 0:
                    return file_path, True, os.path.basename(save_path), pipeline_key, rename_collision

                if uses_gpu and not cpu_retried:
                    cpu_retried = True
                    if gpu_acquired:
                        GlobalGpuSemaphore.release()
                        gpu_acquired = False
                    uses_gpu = False
                    self.log_signal.emit(self._i18n.t('status.gpu_fallback'))
                    logging.warning("GPU fallback CPU: %s — %s", fname, stderr_output[:120])
                    cmd, tier, backend = self._build_command(
                        ffmpeg_cmd, file_path, save_path, profile,
                        force_cpu=True, settings=job_settings,
                    )
                    cpu_key = self._emit_pipeline_key(tier, backend)
                    if cpu_key:
                        pipeline_key = cpu_key
                    returncode, stderr_output = self._run_ffmpeg(
                        cmd, duration_sec, file_index, total_files, base, span, emit_progress=emit_progress,
                    )
                    if returncode == 0 and os.path.exists(save_path) and os.path.getsize(save_path) > 0:
                        return file_path, True, os.path.basename(save_path), pipeline_key, rename_collision

                err = self._extract_ffmpeg_error(stderr_output)
                return file_path, False, err[:120], pipeline_key, rename_collision
        except Exception as exc:
            return file_path, False, str(exc)[:80], pipeline_key, rename_collision
        finally:
            if gpu_acquired:
                GlobalGpuSemaphore.release()

    def run(self):
        if self.queue.total == 0:
            self.finished_all.emit()
            return

        self._batch_tier_key = ""

        try:
            ffmpeg_cmd = self.get_ffmpeg_path()
        except FFmpegNotFoundError:
            self.log_signal.emit(self._i18n.t('status.ffmpeg_missing'))
            self.finished_all.emit()
            return

        try:
            ensure_writable_dir(self.output_dir)
        except OutputDirError as e:
            self.log_signal.emit(self._i18n.t(e.code, path=e.path))
            self.finished_all.emit()
            return
        except OSError as e:
            self.log_signal.emit(self._i18n.t('status.output_err', err=str(e)))
            self.finished_all.emit()
            return

        try:
            profile = get_system_profile()
        except Exception:
            profile = None

        kind = JobKind.VIDEO if self.mode == 'video' else JobKind.AUDIO
        job = JobDescriptor(kind=kind, file_count=max(1, self.queue.total), settings=self.settings, profile=profile)
        slots = compute_slots(self.app_settings, job)
        self.batch_progress_signal.emit(0, max(1, self.queue.total))

        if slots <= 1:
            while self.is_running and not self.queue.is_stopped():
                file_path = self.queue.take_next()
                if file_path is None:
                    break
                self.file_started_signal.emit(file_path)
                idx = self.queue.completed
                path, ok, msg, pipeline_key, rename_collision = self._convert_one(
                    ffmpeg_cmd, profile, file_path, idx, max(1, self.queue.total), 1, emit_progress=True,
                )
                if pipeline_key:
                    self.pipeline_signal.emit(pipeline_key)
                self._finish_file(path, ok, msg, rename_collision=rename_collision)
        else:
            self.log_signal.emit(self._i18n.t('status.parallel', n=slots))
            pool = ThreadPoolExecutor(max_workers=slots)
            self._executor = pool
            active_futures: dict = {}
            try:
                while self.is_running and not self.queue.is_stopped():
                    while len(active_futures) < slots:
                        file_path = self.queue.take_next()
                        if file_path is None:
                            break
                        self.file_started_signal.emit(file_path)
                        idx = self.queue.completed + len(active_futures)
                        fut = pool.submit(
                            self._convert_one,
                            ffmpeg_cmd, profile, file_path, idx, max(1, self.queue.total), slots, False,
                        )
                        active_futures[fut] = file_path

                    if not active_futures:
                        if self.queue.pending_count() == 0:
                            break
                        self.msleep(50)
                        continue

                    done, _ = wait(active_futures.keys(), return_when=FIRST_COMPLETED, timeout=0.3)
                    for fut in done:
                        fp = active_futures.pop(fut)
                        try:
                            path, ok, msg, pipeline_key, rename_collision = fut.result()
                        except Exception as exc:
                            if self.queue.is_stopped():
                                path, ok, msg, pipeline_key, rename_collision = fp, False, "stopped", None, False
                            else:
                                path, ok, msg, pipeline_key, rename_collision = fp, False, str(exc)[:80], None, False
                        if pipeline_key:
                            self.pipeline_signal.emit(pipeline_key)
                        self._finish_file(path, ok, msg, rename_collision=rename_collision)
            finally:
                self._executor = None
                pool.shutdown(wait=False, cancel_futures=True)

        self.progress_signal.emit(100)
        self.batch_progress_signal.emit(self.queue.completed, max(1, self.queue.total))
        self.finished_all.emit()

    def _terminate_process(self, proc=None):
        targets = [proc] if proc else []
        if not targets:
            with self._proc_lock:
                targets = list(self._active_processes)
        for p in targets:
            if not p:
                continue
            try:
                p.terminate()
                p.wait(timeout=3)
            except subprocess.TimeoutExpired:
                try:
                    p.kill()
                    p.wait(timeout=1)
                except Exception:
                    pass
            except Exception:
                pass

    def stop(self):
        self.is_running = False
        self.queue.request_stop()
        self._terminate_process()
        if self._executor:
            try:
                self._executor.shutdown(wait=False, cancel_futures=True)
            except Exception:
                pass
