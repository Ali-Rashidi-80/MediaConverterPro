"""Image conversion worker thread."""
import logging
import os
import threading
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait

from PySide6.QtCore import QThread, Signal

from galaxy.core.exceptions import OutputDirError
from galaxy.core.utils import ensure_writable_dir
from galaxy.services.hw_probe import get_system_profile
from galaxy.services.job_scheduler import JobDescriptor, JobKind, compute_slots
from galaxy.workers.image_task import convert_image_task
from galaxy.workers.task_queue import ConversionTaskQueue
from galaxy.workers.worker_i18n import WorkerI18n


class ImageWorker(QThread):
    progress_signal = Signal(int)
    log_signal = Signal(str)
    file_status_signal = Signal(str, str)
    file_started_signal = Signal(str)
    batch_progress_signal = Signal(int, int)
    finished_all = Signal()

    def __init__(self, queue: ConversionTaskQueue, output_dir, settings, app_settings=None):
        super().__init__()
        self.queue = queue
        self.output_dir = output_dir
        self.settings = settings
        self.app_settings = app_settings or {}
        self.is_running = True
        self._executor = None
        self._progress_lock = threading.Lock()
        self._i18n = WorkerI18n(self.app_settings.get('language', 'fa'))

    def append_tasks(self, paths: list[str]) -> list[str]:
        return self.queue.append(paths)

    def _emit_progress(self) -> None:
        done = self.queue.completed
        total = max(1, self.queue.total)
        pct = int((done / total) * 100)
        self.progress_signal.emit(min(99, pct))
        self.batch_progress_signal.emit(done, total)

    def _handle_result(self, file_path: str, ok: bool, msg: str) -> None:
        if msg == "stopped" and self.queue.is_stopped():
            self.queue.mark_complete()
            self._emit_progress()
            self.file_status_signal.emit(file_path, "cancelled")
            return
        self.queue.mark_complete()
        self._emit_progress()
        if ok:
            self.file_status_signal.emit(file_path, "success")
            self.log_signal.emit(self._i18n.t('status.image_ok', name=msg))
        else:
            self.file_status_signal.emit(file_path, "fail")
            self.log_signal.emit(self._i18n.t('status.image_fail', name=os.path.basename(file_path), err=msg))

    def _convert_path(self, file_path: str, settings_copy: dict) -> None:
        if not self.is_running or self.queue.is_stopped():
            self._handle_result(file_path, False, "stopped")
            return
        self.file_started_signal.emit(file_path)
        path, ok, msg = convert_image_task(file_path, self.output_dir, settings_copy)
        self._handle_result(path, ok, msg)

    def run(self):
        if self.queue.total == 0:
            self.finished_all.emit()
            return
        self.batch_progress_signal.emit(0, max(1, self.queue.total))
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

        job = JobDescriptor(kind=JobKind.IMAGE, file_count=self.queue.total, settings=self.settings, profile=profile)
        slots = compute_slots(self.app_settings, job)
        settings_copy = dict(self.settings)

        if slots <= 1:
            while self.is_running and not self.queue.is_stopped():
                file_path = self.queue.take_next()
                if file_path is None:
                    break
                self._convert_path(file_path, settings_copy)
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
                        fut = pool.submit(convert_image_task, file_path, self.output_dir, settings_copy)
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
                            path, ok, msg = fut.result()
                        except Exception as exc:
                            if self.queue.is_stopped():
                                path, ok, msg = fp, False, "stopped"
                            else:
                                path, ok, msg = fp, False, str(exc)[:80]
                        self._handle_result(path, ok, msg)
            except Exception as exc:
                logging.error("Image parallel pool failed: %s", exc, exc_info=True)
                self.log_signal.emit(self._i18n.t('status.image_parallel_err', err=str(exc)[:80]))
            finally:
                self._executor = None
                pool.shutdown(wait=False, cancel_futures=True)

        self.progress_signal.emit(100)
        self.batch_progress_signal.emit(self.queue.completed, max(1, self.queue.total))
        self.finished_all.emit()

    def stop(self):
        self.is_running = False
        self.queue.request_stop()
        if self._executor:
            try:
                self._executor.shutdown(wait=False, cancel_futures=True)
            except Exception:
                pass
