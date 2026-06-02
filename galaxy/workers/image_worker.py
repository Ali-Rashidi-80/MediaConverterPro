"""Image conversion worker thread."""
import logging
import os
import threading
from concurrent.futures import ProcessPoolExecutor, as_completed

from PySide6.QtCore import QThread, Signal

from galaxy.core.utils import ensure_writable_dir
from galaxy.services.hw_probe import get_system_profile
from galaxy.services.job_scheduler import JobDescriptor, JobKind, compute_slots
from galaxy.workers.image_task import convert_image_task
from galaxy.workers.worker_i18n import WorkerI18n


class ImageWorker(QThread):
    progress_signal = Signal(int)
    log_signal = Signal(str)
    file_status_signal = Signal(str, str)
    batch_progress_signal = Signal(int, int)
    finished_all = Signal()

    def __init__(self, tasks, output_dir, settings, app_settings=None):
        super().__init__()
        self.tasks = tasks
        self.output_dir = output_dir
        self.settings = settings
        self.app_settings = app_settings or {}
        self.is_running = True
        self._executor = None
        self._progress_lock = threading.Lock()
        self._files_done = 0
        self._i18n = WorkerI18n(self.app_settings.get('language', 'fa'))

    def _emit_progress(self, total: int):
        with self._progress_lock:
            self._files_done += 1
            done = self._files_done
        pct = int((done / total) * 100) if total else 0
        self.progress_signal.emit(min(99, pct))
        self.batch_progress_signal.emit(done, total)

    def run(self):
        total = len(self.tasks)
        if total == 0:
            self.finished_all.emit()
            return
        self._files_done = 0
        self.batch_progress_signal.emit(0, total)
        try:
            ensure_writable_dir(self.output_dir)
        except OSError as e:
            self.log_signal.emit(self._i18n.t('status.output_err', err=str(e)))
            self.finished_all.emit()
            return

        try:
            profile = get_system_profile()
        except Exception:
            profile = None

        job = JobDescriptor(kind=JobKind.IMAGE, file_count=total, settings=self.settings, profile=profile)
        slots = compute_slots(self.app_settings, job)
        settings_copy = dict(self.settings)

        if slots <= 1 or total <= 1:
            for file_path in self.tasks:
                if not self.is_running:
                    break
                path, ok, msg = convert_image_task(file_path, self.output_dir, settings_copy)
                self._emit_progress(total)
                if ok:
                    self.file_status_signal.emit(path, "success")
                    self.log_signal.emit(self._i18n.t('status.image_ok', name=msg))
                else:
                    self.file_status_signal.emit(path, "fail")
                    self.log_signal.emit(self._i18n.t('status.image_fail', name=os.path.basename(path), err=msg))
        else:
            self.log_signal.emit(self._i18n.t('status.parallel', n=slots))
            pool = ProcessPoolExecutor(max_workers=slots)
            self._executor = pool
            try:
                futures = {
                    pool.submit(convert_image_task, fp, self.output_dir, settings_copy): fp
                    for fp in self.tasks
                }
                for fut in as_completed(futures):
                    if not self.is_running:
                        pool.shutdown(wait=False, cancel_futures=True)
                        break
                    fp = futures[fut]
                    try:
                        path, ok, msg = fut.result()
                    except Exception as exc:
                        path, ok, msg = fp, False, str(exc)[:80]
                    self._emit_progress(total)
                    if ok:
                        self.file_status_signal.emit(path, "success")
                        self.log_signal.emit(self._i18n.t('status.image_ok', name=msg))
                    else:
                        self.file_status_signal.emit(path, "fail")
                        self.log_signal.emit(self._i18n.t('status.image_fail', name=os.path.basename(path), err=msg))
            except Exception as exc:
                logging.error("Image parallel pool failed: %s", exc, exc_info=True)
                self.log_signal.emit(self._i18n.t('status.image_parallel_err', err=str(exc)[:80]))
            finally:
                self._executor = None
                pool.shutdown(wait=False, cancel_futures=True)

        self.progress_signal.emit(100)
        self.batch_progress_signal.emit(total, total)
        self.finished_all.emit()

    def stop(self):
        self.is_running = False
        if self._executor:
            try:
                self._executor.shutdown(wait=False, cancel_futures=True)
            except Exception:
                pass
