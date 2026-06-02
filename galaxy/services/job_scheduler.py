"""Job scheduling — smart parallel slot computation and GPU semaphore."""
from __future__ import annotations

import threading
from dataclasses import dataclass
from enum import Enum

from galaxy.services.ffmpeg_pipeline import PipelineTier, pick_pipeline_tier
from galaxy.services.hw_probe import SystemProfile


class ParallelMode(str, Enum):
    SEQUENTIAL = "sequential"
    PARALLEL = "parallel"
    SMART = "smart"


class JobKind(str, Enum):
    IMAGE = "image"
    AUDIO = "audio"
    VIDEO = "video"


@dataclass
class JobDescriptor:
    kind: JobKind
    file_count: int
    settings: dict
    profile: SystemProfile | None = None


class GlobalGpuSemaphore:
    """System-wide cap on concurrent GPU encode jobs."""

    _lock = threading.Lock()
    _sem: threading.Semaphore | None = None
    _slots: int = 1

    @classmethod
    def configure(cls, slots: int) -> None:
        with cls._lock:
            slots = max(1, min(slots, 4))
            if cls._sem is None or cls._slots != slots:
                cls._sem = threading.Semaphore(slots)
                cls._slots = slots

    @classmethod
    def acquire(cls, timeout: float | None = None) -> bool:
        with cls._lock:
            if cls._sem is None:
                cls.configure(1)
        if cls._sem is None:
            return True
        if timeout is None:
            cls._sem.acquire()
            return True
        return cls._sem.acquire(timeout=timeout)

    @classmethod
    def release(cls) -> None:
        if cls._sem:
            try:
                cls._sem.release()
            except ValueError:
                pass


def compute_slots(settings: dict, job: JobDescriptor) -> int:
    profile = job.profile
    cpu = profile.cpu_count if profile else 2
    user_cap = int(settings.get("max_parallel_jobs") or 0)
    mode = settings.get("parallel_mode") or ParallelMode.SMART.value

    tier, _ = pick_pipeline_tier(job.settings, profile)
    uses_gpu = job.kind == JobKind.VIDEO and tier in (PipelineTier.TIER1, PipelineTier.TIER2)

    if job.kind == JobKind.IMAGE:
        auto = max(1, min(cpu - 1, 6))
    elif job.kind == JobKind.AUDIO:
        auto = max(1, min(cpu - 1, 4))
    elif uses_gpu and profile:
        auto = profile.recommended_parallel.gpu_slots
    else:
        auto = max(1, min(cpu - 1, 3))

    cap = user_cap if user_cap > 0 else auto

    if mode == ParallelMode.SEQUENTIAL.value:
        return 1
    if mode == ParallelMode.PARALLEL.value:
        return cap
    # smart
    if job.file_count <= 2:
        return 1
    if uses_gpu and job.file_count > 3:
        return min(cap, profile.recommended_parallel.gpu_slots if profile else 1)
    return cap


def per_job_cpu_threads(settings: dict, slots: int, profile: SystemProfile | None) -> int:
    explicit = int(settings.get("cpu_threads") or 0)
    if explicit > 0:
        return explicit
    cpu = profile.cpu_count if profile else 2
    return max(1, cpu // max(1, slots))
