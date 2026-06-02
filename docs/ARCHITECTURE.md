# معماری فنی — Galaxy Media Pro

---

## لایه‌ها

```
galaxy_ultimate.py          Entry (PyInstaller)
    └── galaxy.app.main     QApplication bootstrap
        └── GalaxyWindow    Shell + footer + navigation
            └── *Page       Image / Video / Audio / Settings / About
                └── *Worker ImageWorker | MediaWorker
                    └── services.*     FFmpeg · pipeline · scheduler
```

---

## Pipeline tiers (ویدیو)

| Tier | شرط | مسیر |
|------|-----|------|
| **COPY** | `copy_streams` / fast_copy | `-c copy` |
| **CPU** | VP9/AV1/GIF · force_cpu · no GPU | libx264/libx265 |
| **TIER1** | GPU + full path (scale_cuda/…) | hw decode + gpu filter + hw encode |
| **TIER2** | GPU encode · CPU filters | hybrid |

**فایل:** `galaxy/services/ffmpeg_pipeline.py`  
**انتخاب:** `pick_pipeline_tier()` · `build_video_command()`

---

## Hardware probe

```
ffmpeg -encoders / -hwaccels / -filters
        ↓
SystemProfile { backends, gpu_devices, recommended_parallel }
        ↓
cache ~/.galaxy_converter/hw_cache.json  (TTL 24h)
```

**فایل:** `galaxy/services/hw_probe.py`

---

## Job scheduler

```python
compute_slots(app_settings, JobDescriptor) → int
GlobalGpuSemaphore.configure(gpu_slots)    # startup
GlobalGpuSemaphore.acquire/release()       # per GPU encode
per_job_cpu_threads(...)                   # FFmpeg -threads
```

| Job kind | Smart slots (typical) |
|----------|------------------------|
| Image | min(cpu-1, 6) · ThreadPool |
| Audio | min(cpu-1, 4) · ThreadPool |
| Video GPU | gpu_slots cap |
| Video CPU | min(cpu-1, 3) |

**فایل:** `galaxy/services/job_scheduler.py`

---

## Workers

### MediaWorker (QThread)

- Sequential یا `ThreadPoolExecutor`
- GPU sem → encode → release قبل CPU fallback
- `_run_ffmpeg` progress از stderr `time=`

### ImageWorker (QThread)

- Sequential یا `ThreadPoolExecutor` (بدون spawn پردازش جدید — جلوگیری از باز شدن چند پنجره در Windows)
- Top-level `convert_image_task` (Windows spawn-safe)
- Module-level output lock

---

## Settings schema

```json
{
  "language": "fa",
  "theme": "dark_cyan",
  "ui_mode": "simple|professional",
  "parallel_mode": "smart|sequential|parallel",
  "accel_mode": "auto|cpu|nvidia|amd|intel",
  "nvenc_preset": "p4",
  "max_parallel_jobs": 0,
  "cpu_threads": 0
}
```

**فایل:** `galaxy/services/settings.py`

---

## i18n

- `galaxy_i18n.py` — `STRINGS['fa'|'en']`
- UI: `I18n.t(key)`
- Workers: `WorkerI18n` (بدون Qt)

---

## Build / bundle

| Spec | خروجی |
|------|--------|
| `GalaxyConverter.spec` | onedir |
| `GalaxyConverter.portable.spec` | onefile + UPX |

Hidden imports: `hw_probe`, `ffmpeg_pipeline`, `job_scheduler`, `worker_i18n`, …

---

[← فهرست](INDEX.md) · [توسعه](DEVELOPMENT.md) · [تست](TESTING.md)
