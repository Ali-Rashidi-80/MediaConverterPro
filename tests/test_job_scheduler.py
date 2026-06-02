"""Job scheduler and GPU semaphore tests."""
from __future__ import annotations

import threading

from galaxy.services.hw_probe import ParallelCaps, SystemProfile
from galaxy.services.job_scheduler import (
    GlobalGpuSemaphore,
    JobDescriptor,
    JobKind,
    ParallelMode,
    compute_slots,
    per_job_cpu_threads,
)


def _profile(cpu: int = 8, gpu_slots: int = 2) -> SystemProfile:
    p = SystemProfile(cpu_count=cpu)
    p.recommended_parallel = ParallelCaps(gpu_slots=gpu_slots, cpu_slots=3, image_slots=4)
    return p


def test_sequential_mode_always_one():
    job = JobDescriptor(kind=JobKind.IMAGE, file_count=10, settings={}, profile=_profile())
    assert compute_slots({"parallel_mode": ParallelMode.SEQUENTIAL.value}, job) == 1


def test_image_smart_slots_scale_with_cpu():
    job = JobDescriptor(kind=JobKind.IMAGE, file_count=10, settings={}, profile=_profile(cpu=8))
    slots = compute_slots({"parallel_mode": ParallelMode.SMART.value}, job)
    assert 2 <= slots <= 6


def test_user_cap_respected():
    job = JobDescriptor(kind=JobKind.IMAGE, file_count=10, settings={}, profile=_profile())
    slots = compute_slots({"parallel_mode": "parallel", "max_parallel_jobs": 2}, job)
    assert slots == 2


def test_smart_small_batch_single_slot():
    job = JobDescriptor(kind=JobKind.IMAGE, file_count=2, settings={}, profile=_profile())
    assert compute_slots({"parallel_mode": ParallelMode.SMART.value}, job) == 1


def test_per_job_cpu_threads_auto():
    profile = _profile(cpu=8)
    assert per_job_cpu_threads({"cpu_threads": 0}, 4, profile) == 2
    assert per_job_cpu_threads({"cpu_threads": 6}, 4, profile) == 6


def test_gpu_semaphore_two_slots():
    GlobalGpuSemaphore.configure(2)
    acquired = [False, False]

    def _try(idx: int):
        acquired[idx] = GlobalGpuSemaphore.acquire(timeout=0.05)

    t1 = threading.Thread(target=_try, args=(0,))
    t2 = threading.Thread(target=_try, args=(1,))
    t1.start()
    t2.start()
    t1.join()
    t2.join()
    assert acquired[0] and acquired[1]
    GlobalGpuSemaphore.release()
    GlobalGpuSemaphore.release()
