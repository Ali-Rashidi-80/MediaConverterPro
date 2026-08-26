# Install & Build — Galaxy Media Pro

**Language:** [English](#english) · [فارسی](#فارسی)

---

## English

### 1. Run from source (dev / test)

#### Prerequisites

| Item | Version |
|------|---------|
| Windows | 10 / 11 |
| Python | 3.11+ (3.12 recommended) |
| FFmpeg | `ffmpeg.exe` at project root |

#### Dependencies

```powershell
cd MediaConverterPro
pip install -r requirements.txt
pip install -r requirements-dev.txt   # optional — for QA
```

#### FFmpeg

1. Download from [BtbN win64-gpl](https://github.com/BtbN/FFmpeg-Builds/releases)
2. Copy `bin/ffmpeg.exe` and `bin/ffprobe.exe` to the project root
3. Verify:

```powershell
python tools/verify_ffmpeg_caps.py
```

Details: [FFMPEG_BUNDLE.md](FFMPEG_BUNDLE.md)

#### Run

```powershell
python galaxy_ultimate.py
```

Settings live in: `%USERPROFILE%\.galaxy_converter\settings.json`

---

### 2. Build EXE — Portable (default)

```powershell
.\build.bat
# or
.\build_portable.bat
```

**Output:** `dist\GalaxyMediaPro_Portable.exe` (~90–100 MB)

| Note | Detail |
|------|--------|
| FFmpeg | Bundled inside the EXE |
| First launch | 10–20 seconds (cache extract) |
| UPX | Auto from `tools\upx` or download |

---

### 3. Folder (onedir) build

```powershell
.\build_onedir.bat
```

**Output:** onedir folder under `dist\` (exe + `_internal\ffmpeg.exe`)

---

### 4. FFmpeg resolution at runtime

The app searches in order:

1. PyInstaller bundle (`_MEIPASS` / next to exe)
2. Project root (dev mode)
3. System `PATH`

---

### 5. Root files — what do you need?

| File | Required | Role |
|------|----------|------|
| `ffmpeg.exe` | ✅ | encode/decode |
| `ffprobe.exe` | ⚙️ | integration tests (dev) |
| `ffplay.exe` | ❌ | playback — app does not use it |
| `icon.ico` | ✅ build | icon |
| `fonts/` | ✅ | Vazirmatn |

---

### 6. Install troubleshooting

| Problem | Fix |
|---------|-----|
| FFmpeg not found | `ffmpeg.exe` next to exe or on PATH |
| NVENC disabled | NVIDIA driver + GPL build with NVENC |
| HEIC fails | `pip install pillow-heif` |
| Portable is slow | First launch is normal; SSD helps |

---

## فارسی

### ۱. اجرا از سورس (توسعه / تست)

#### پیش‌نیاز

| مورد | نسخه |
|------|------|
| Windows | 10 / 11 |
| Python | 3.11+ (3.12 توصیه) |
| FFmpeg | `ffmpeg.exe` در ریشه پروژه |

#### وابستگی‌ها

```powershell
cd MediaConverterPro
pip install -r requirements.txt
pip install -r requirements-dev.txt   # اختیاری — برای QA
```

#### FFmpeg

1. از [BtbN win64-gpl](https://github.com/BtbN/FFmpeg-Builds/releases) دانلود کنید
2. `bin/ffmpeg.exe` و `bin/ffprobe.exe` را در ریشه پروژه کپی کنید
3. تأیید: `python tools/verify_ffmpeg_caps.py`

جزئیات: [FFMPEG_BUNDLE.md](FFMPEG_BUNDLE.md)

#### اجرا

```powershell
python galaxy_ultimate.py
```

تنظیمات در: `%USERPROFILE%\.galaxy_converter\settings.json`

### ۲. ساخت EXE — Portable (پیش‌فرض)

```powershell
.\build.bat
# یا .\build_portable.bat
```

**خروجی:** `dist\GalaxyMediaPro_Portable.exe` (~90–100 MB)

### ۳. ساخت پوشه‌ای (onedir)

```powershell
.\build_onedir.bat
```

### ۶. عیب‌یابی نصب

| مشکل | راه‌حل |
|------|--------|
| FFmpeg not found | `ffmpeg.exe` کنار exe یا در PATH |
| NVENC غیرفعال | درایور NVIDIA + build GPL با NVENC |
| HEIC کار نمی‌کند | `pip install pillow-heif` |
| Portable کند است | اولین اجرا طبیعی است؛ SSD کمک می‌کند |

---

[← Docs index](INDEX.md) · [User guide](USER_GUIDE.md) · [README](../README.md)
