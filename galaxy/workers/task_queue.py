"""Thread-safe conversion task queue — supports append during run and cooperative stop."""
from __future__ import annotations

import threading


class ConversionTaskQueue:
    """FIFO queue of file paths shared between UI and worker threads."""

    def __init__(self, paths: list[str] | None = None):
        self._lock = threading.Lock()
        self._pending: list[str] = list(paths or [])
        self._stop_requested = False
        self._submitted_total = len(self._pending)
        self._completed = 0

    def append(self, paths: list[str]) -> list[str]:
        """Append new paths; returns list actually added (deduped against pending)."""
        with self._lock:
            pending_set = set(self._pending)
            added: list[str] = []
            for path in paths:
                if path not in pending_set:
                    self._pending.append(path)
                    pending_set.add(path)
                    added.append(path)
            self._submitted_total += len(added)
            return added

    def take_next(self) -> str | None:
        with self._lock:
            if self._stop_requested or not self._pending:
                return None
            return self._pending.pop(0)

    def request_stop(self) -> None:
        with self._lock:
            self._stop_requested = True
            self._pending.clear()

    def is_stopped(self) -> bool:
        with self._lock:
            return self._stop_requested

    def mark_complete(self) -> None:
        with self._lock:
            self._completed += 1

    @property
    def completed(self) -> int:
        with self._lock:
            return self._completed

    @property
    def total(self) -> int:
        with self._lock:
            return self._submitted_total

    def pending_count(self) -> int:
        with self._lock:
            return len(self._pending)
