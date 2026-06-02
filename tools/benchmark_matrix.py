#!/usr/bin/env python3
"""Quick acceptance matrix — FFmpeg caps, hw_probe, pipeline tiers, ship checks."""
import importlib
import json
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

WORKER_I18N_KEYS = (
    "status.file_ok",
    "status.file_fail",
    "status.gpu_fallback",
    "status.gpu_queue_timeout",
    "err.ffmpeg_empty",
    "err.ffmpeg_incomplete",
)

HIDDEN_IMPORTS = (
    "galaxy.services.hw_probe",
    "galaxy.services.ffmpeg_pipeline",
    "galaxy.services.job_scheduler",
    "galaxy.workers.worker_i18n",
    "galaxy.workers.image_task",
)


def main() -> int:
    report = {"checks": []}

    # 1. FFmpeg caps
    from tools import verify_ffmpeg_caps as vfc

    rc = vfc.main()
    report["checks"].append({"name": "verify_ffmpeg_caps", "ok": rc == 0})
    if rc != 0:
        print(json.dumps(report, indent=2))
        return rc

    # 2. hw_probe warm
    from galaxy.services.hw_probe import get_system_profile

    t0 = time.perf_counter()
    profile = get_system_profile(refresh=True)
    elapsed = time.perf_counter() - t0
    probe_ok = elapsed < 3.0 and profile is not None
    report["checks"].append({
        "name": "hw_probe_warm",
        "ok": probe_ok,
        "elapsed_sec": round(elapsed, 2),
        "backend": profile.recommended_backend if profile else None,
        "cpu_count": profile.cpu_count if profile else 0,
    })

    # 3. Pipeline tier sanity
    from galaxy.services.ffmpeg_pipeline import PipelineTier, pick_pipeline_tier

    tier_copy, _ = pick_pipeline_tier({"copy_streams": True, "video_preset": "fast_copy"}, profile)
    tier_yt, _ = pick_pipeline_tier({"video_preset": "youtube", "codec": "H.264", "accel_mode": "nvidia"}, profile)
    tier_cpu, _ = pick_pipeline_tier({"format": "webm", "codec": "VP9"}, profile)
    report["checks"].append({
        "name": "pipeline_tiers",
        "ok": tier_copy == PipelineTier.COPY and tier_cpu == PipelineTier.CPU,
        "youtube_tier": tier_yt.value,
    })
    report["checks"].append({
        "name": "tier_youtube_is_tier2",
        "ok": tier_yt in (PipelineTier.TIER1, PipelineTier.TIER2),
        "tier": tier_yt.value,
    })

    # 4. Job scheduler slots
    from galaxy.services.job_scheduler import JobDescriptor, JobKind, compute_slots

    job_img = JobDescriptor(kind=JobKind.IMAGE, file_count=10, settings={}, profile=profile)
    slots = compute_slots({"parallel_mode": "smart"}, job_img)
    report["checks"].append({"name": "image_smart_slots", "ok": slots >= 1, "slots": slots})
    min_slots_ok = profile.cpu_count < 4 or slots >= 2
    report["checks"].append({
        "name": "image_smart_slots_min_2_on_4core",
        "ok": min_slots_ok,
        "cpu_count": profile.cpu_count,
        "slots": slots,
    })

    # 5. GlobalGpuSemaphore two-slot configure
    from galaxy.services.job_scheduler import GlobalGpuSemaphore

    GlobalGpuSemaphore.configure(2)
    acquired = [False, False]

    def _try_acquire(idx: int):
        acquired[idx] = GlobalGpuSemaphore.acquire(timeout=0.05)

    t1 = threading.Thread(target=_try_acquire, args=(0,))
    t2 = threading.Thread(target=_try_acquire, args=(1,))
    t1.start()
    t2.start()
    t1.join()
    t2.join()
    sem_ok = acquired[0] and acquired[1]
    for _ in range(2):
        GlobalGpuSemaphore.release()
    report["checks"].append({
        "name": "semaphore_two_slots",
        "ok": sem_ok,
        "acquired": acquired,
    })

    # 6. Worker i18n keys
    from galaxy_i18n import I18n

    i18n_fa = I18n("fa")
    i18n_en = I18n("en")
    missing = []
    for key in WORKER_I18N_KEYS:
        if i18n_fa.t(key).startswith("[") or i18n_en.t(key).startswith("["):
            missing.append(key)
    report["checks"].append({
        "name": "i18n_worker_keys_present",
        "ok": not missing,
        "missing": missing,
    })

    # 7. Hidden imports importable
    import_errors = []
    for mod in HIDDEN_IMPORTS:
        try:
            importlib.import_module(mod)
        except Exception as exc:
            import_errors.append(f"{mod}: {exc}")
    report["checks"].append({
        "name": "hiddenimports_importable",
        "ok": not import_errors,
        "errors": import_errors,
    })

    all_ok = all(c["ok"] for c in report["checks"])
    report["verdict"] = "PASS" if all_ok else "FAIL"
    print(json.dumps(report, indent=2))
    return 0 if all_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
