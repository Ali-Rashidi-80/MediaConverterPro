# FFmpeg Bundle — Galaxy Media Pro

**Language:** [English](#english) · [فارسی](#فارسی)

---

## English

Galaxy ships a **full Windows x64 FFmpeg GPL** binary next to the application.

| Binary | Required | Purpose |
|--------|----------|---------|
| `ffmpeg.exe` | ✅ Yes | encode/decode (bundled in portable EXE) |
| `ffprobe.exe` | ⚙️ Dev/QA | integration tests, metadata |
| `ffplay.exe` | ❌ No | not used by the app — optional at project root |

See also: [INSTALL.md](INSTALL.md) · [INDEX.md](INDEX.md)

### Recommended source

- [BtbN FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds) — variant **`win64-gpl`**
- Alternative: [gyan.dev release full](https://www.gyan.dev/ffmpeg/builds/)

### Required capabilities

Run verification after replacing the binary:

```powershell
python tools/verify_ffmpeg_caps.py
```

Required encoders: `h264_nvenc`, `hevc_nvenc`, `h264_amf`, `hevc_amf`, `h264_qsv`, `hevc_qsv`

### Replace bundle

1. Download `ffmpeg-master-latest-win64-gpl.zip` from BtbN releases
2. Extract `bin/ffmpeg.exe` to project root (replace existing)
3. Run `python tools/verify_ffmpeg_caps.py`
4. Rebuild portable EXE

### Legal

GPL builds include libx264/libx265. Galaxy About / Help → GPL notes FFmpeg attribution.  
When redistributing binaries that include FFmpeg, comply with GPL obligations.

### PyInstaller

`GalaxyConverter.portable.spec` bundles `ffmpeg.exe` as a binary. UPX is **disabled** for ffmpeg.

---

## فارسی

Galaxy یک باینری کامل **FFmpeg GPL ویندوز x64** کنار اپ می‌آورد.

| باینری | ضروری | نقش |
|--------|--------|-----|
| `ffmpeg.exe` | ✅ | encode/decode (داخل EXE قابل‌حمل) |
| `ffprobe.exe` | ⚙️ | تست integration / متادیتا |
| `ffplay.exe` | ❌ | اپ استفاده نمی‌کند |

### منبع پیشنهادی

- [BtbN](https://github.com/BtbN/FFmpeg-Builds) — **`win64-gpl`**
- جایگزین: [gyan.dev](https://www.gyan.dev/ffmpeg/builds/)

### بررسی قابلیت‌ها

```powershell
python tools/verify_ffmpeg_caps.py
```

Encoderهای لازم: `h264_nvenc`, `hevc_nvenc`, `h264_amf`, `hevc_amf`, `h264_qsv`, `hevc_qsv`

### جایگزینی باندل

1. دانلود zip از BtbN
2. کپی `bin/ffmpeg.exe` به ریشه پروژه
3. اجرای `verify_ffmpeg_caps.py`
4. rebuild EXE قابل‌حمل

### حقوقی

Buildهای GPL شامل libx264/libx265 هستند. attribution در Help → GPL داخل برنامه است.

---

[← Docs index](INDEX.md) · [Install](INSTALL.md)
