# نصب و ساخت — Galaxy Media Pro

---

## ۱. اجرا از سورس (توسعه / تست)

### پیش‌نیاز

| مورد | نسخه |
|------|------|
| Windows | 10 / 11 |
| Python | 3.11+ (3.12 توصیه) |
| FFmpeg | `ffmpeg.exe` در ریشه پروژه |

### وابستگی‌ها

```powershell
cd MediaConverter
pip install -r requirements.txt
pip install -r requirements-dev.txt   # اختیاری — برای QA
```

### FFmpeg

1. از [BtbN win64-gpl](https://github.com/BtbN/FFmpeg-Builds/releases) دانلود کنید
2. `bin/ffmpeg.exe` و `bin/ffprobe.exe` را در ریشه پروژه کپی کنید
3. تأیید:

```powershell
python tools/verify_ffmpeg_caps.py
```

جزئیات: [FFMPEG_BUNDLE.md](FFMPEG_BUNDLE.md)

### اجرا

```powershell
python galaxy_ultimate.py
```

تنظیمات در: `%USERPROFILE%\.galaxy_converter\settings.json`

---

## ۲. ساخت EXE — نسخه پوشه‌ای (onedir)

```powershell
.\build.bat
```

**خروجی:** `dist\GalaxyConverter\`  
شامل `GalaxyConverter.exe` + `_internal\ffmpeg.exe`

---

## ۳. ساخت Portable — یک فایل

```powershell
.\build_portable.bat
```

**خروجی:** `dist\GalaxyMediaPro_Portable.exe` (~90–100 MB)

| نکته | توضیح |
|------|--------|
| FFmpeg | داخل EXE باندل است |
| اولین اجرا | ۱۰–۲۰ ثانیه (استخراج cache) |
| UPX | خودکار از `tools\upx` یا دانلود |

---

## ۴. مسیر FFmpeg در runtime

برنامه به ترتیب جستجو می‌کند:

1. باندل PyInstaller (`_MEIPASS` / کنار exe)
2. ریشه پروژه (حالت dev)
3. `PATH` سیستم

---

## ۵. فایل‌های ریشه — چه چیزی لازم است؟

| فایل | ضروری | نقش |
|------|--------|-----|
| `ffmpeg.exe` | ✅ | encode/decode |
| `ffprobe.exe` | ⚙️ | تست integration (dev) |
| `ffplay.exe` | ❌ | پخش — اپ استفاده نمی‌کند |
| `icon.ico` | ✅ build | آیکون |
| `fonts/` | ✅ | Vazirmatn |

---

## ۶. عیب‌یابی نصب

| مشکل | راه‌حل |
|------|--------|
| FFmpeg not found | `ffmpeg.exe` کنار exe یا در PATH |
| NVENC غیرفعال | درایور NVIDIA + build GPL با NVENC |
| HEIC کار نمی‌کند | `pip install pillow-heif` |
| Portable کند است | اولین اجرا طبیعی است؛ SSD کمک می‌کند |

---

[← فهرست مستندات](INDEX.md) · [راهنمای کاربر](USER_GUIDE.md)
