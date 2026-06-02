# توسعه — Galaxy Media Pro

---

## محیط توسعه

```powershell
git clone <repo>
cd MediaConverter
pip install -r requirements.txt -r requirements-dev.txt
python tools/bootstrap_ffmpeg.py    # اگر ffmpeg ندارید
python galaxy_ultimate.py
```

---

## Conventions

| موضوع | قاعده |
|--------|--------|
| Entry | `galaxy_ultimate.py` — PyInstaller target |
| Package | `galaxy/` — همه منطق اپ |
| i18n | کلید در `galaxy_i18n.py` — **هر دو FA+EN** |
| Workers | بدون import Qt در `image_task.py` (ThreadPool برای تصویر) |
| Settings | `PERF_DEFAULTS` + `SettingsManager` |
| UI combo | `FormComboBox` + `fill_combo_keys` |

---

## ساختار ماژول‌ها

```
galaxy/core/       paths, utils, constants — بدون Qt
galaxy/services/   ffmpeg, pipeline, probe, scheduler, settings
galaxy/workers/    QThread + top-level tasks
galaxy/ui/         pages, widgets, theme, help_content
```

---

## Lint & type

```powershell
python -m ruff check galaxy tests tools
python -m mypy galaxy galaxy_i18n.py galaxy_fonts.py
python -m bandit -r galaxy tools -c pyproject.toml
```

تنظیمات: `pyproject.toml`

---

## افزودن فرمت جدید

1. `galaxy_i18n.py` — `*_FMT_KEYS` + tooltips
2. `galaxy/services/ffmpeg.py` — `append_*_options` در صورت نیاز
3. صفحه UI — combo populate
4. تست — `tests/test_*`

---

## افزودن backend GPU

1. `hw_probe.py` — encoder/filter lists
2. `ffmpeg_pipeline.py` — branch در `append_video_encode_options`
3. Settings — `ACCEL_MODE_KEYS` + availability sync
4. Help — HW matrix row
5. `tools/verify_ffmpeg_caps.py` — required encoder

---

## Build

```powershell
.\build.bat              # onedir
.\build_portable.bat     # onefile
```

---

## آرشیو

`archive/legacy-phase5/` — **import نکنید**. مرجع تاریخی Phase 5.

---

[← فهرست](INDEX.md) · [معماری](ARCHITECTURE.md) · [تست](TESTING.md)
