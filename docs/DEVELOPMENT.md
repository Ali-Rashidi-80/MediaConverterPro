# Development — Galaxy Media Pro

**Language:** [English](#english) · [فارسی](#فارسی)

---

## English

### Dev environment

```powershell
git clone https://github.com/Ali-Rashidi-80/MediaConverterPro.git
cd MediaConverterPro
pip install -r requirements.txt -r requirements-dev.txt
python tools/bootstrap_ffmpeg.py    # if you lack ffmpeg
python galaxy_ultimate.py
```

Also see: [CONTRIBUTING.md](../CONTRIBUTING.md)

---

### Conventions

| Topic | Rule |
|-------|------|
| Entry | `galaxy_ultimate.py` — PyInstaller target |
| Package | `galaxy/` — all app logic |
| i18n | Keys in `galaxy_i18n.py` — **both FA + EN** |
| Workers | No Qt import in `image_task.py` (image ThreadPool) |
| Settings | `PERF_DEFAULTS` + `SettingsManager` |
| UI combo | `FormComboBox` + `fill_combo_keys` |
| Docs | English default; keep Persian parity in bilingual docs |

---

### Module layout

```
galaxy/core/       paths, utils, constants — no Qt
galaxy/services/   ffmpeg, pipeline, probe, scheduler, settings
galaxy/workers/    QThread + top-level tasks
galaxy/ui/         pages, widgets, theme, help_content
```

---

### Lint & types

```powershell
python -m ruff check galaxy tests tools
python -m mypy galaxy galaxy_i18n.py galaxy_fonts.py
python -m bandit -r galaxy tools -c pyproject.toml
```

Config: `pyproject.toml`

---

### Adding a new format

1. `galaxy_i18n.py` — `*_FMT_KEYS` + tooltips (FA + EN)
2. `galaxy/services/ffmpeg.py` — `append_*_options` if needed
3. UI page — combo populate
4. Tests — `tests/test_*`

---

### Adding a GPU backend

1. `hw_probe.py` — encoder/filter lists
2. `ffmpeg_pipeline.py` — branch in `append_video_encode_options`
3. Settings — `ACCEL_MODE_KEYS` + availability sync
4. Help — HW matrix row
5. `tools/verify_ffmpeg_caps.py` — required encoder

---

### Build

```powershell
.\build.bat              # portable onefile (default)
.\build_portable.bat     # alias → build.bat
.\build_onedir.bat       # folder (onedir) build
```

---

### Archive

`archive/legacy-phase5/` — **do not import**. Historical Phase 5 reference only.

---

## فارسی

### محیط توسعه

```powershell
git clone https://github.com/Ali-Rashidi-80/MediaConverterPro.git
cd MediaConverterPro
pip install -r requirements.txt -r requirements-dev.txt
python tools/bootstrap_ffmpeg.py
python galaxy_ultimate.py
```

همچنین: [CONTRIBUTING.md](../CONTRIBUTING.md)

### Conventions

| موضوع | قاعده |
|--------|--------|
| Entry | `galaxy_ultimate.py` |
| Package | `galaxy/` — همه منطق اپ |
| i18n | کلید در `galaxy_i18n.py` — **هر دو FA+EN** |
| Workers | بدون import Qt در `image_task.py` |
| Docs | پیش‌فرض انگلیسی؛ هم‌ترازی فارسی در اسناد دو زبانه |

### ساختار ماژول‌ها

```
galaxy/core/       paths, utils, constants — بدون Qt
galaxy/services/   ffmpeg, pipeline, probe, scheduler, settings
galaxy/workers/    QThread + top-level tasks
galaxy/ui/         pages, widgets, theme, help_content
```

### Build

```powershell
.\build.bat              # portable onefile (پیش‌فرض)
.\build_portable.bat
.\build_onedir.bat
```

### آرشیو

`archive/legacy-phase5/` — **import نکنید**.

---

[← Docs index](INDEX.md) · [Architecture](ARCHITECTURE.md) · [Testing](TESTING.md)
