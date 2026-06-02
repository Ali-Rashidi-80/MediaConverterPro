# FFmpeg bundle (Galaxy Media Pro)

Galaxy ships a **full Windows x64 FFmpeg GPL** binary next to the application.

| Binary | Required | Purpose |
|--------|----------|---------|
| `ffmpeg.exe` | ✅ Yes | encode/decode (bundled in portable EXE) |
| `ffprobe.exe` | ⚙️ Dev/QA | integration tests, metadata |
| `ffplay.exe` | ❌ No | not used by the app — optional at project root |

📚 See also: [docs/INSTALL.md](INSTALL.md) · [docs/INDEX.md](INDEX.md)

## Recommended source

- [BtbN FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds) — variant **`win64-gpl`**
- Alternative: [gyan.dev release full](https://www.gyan.dev/ffmpeg/builds/)

## Required capabilities

Run verification after replacing the binary:

```powershell
python tools/verify_ffmpeg_caps.py
```

Required encoders: `h264_nvenc`, `hevc_nvenc`, `h264_amf`, `hevc_amf`, `h264_qsv`, `hevc_qsv`

## Replace bundle

1. Download `ffmpeg-master-latest-win64-gpl.zip` from BtbN releases
2. Extract `bin/ffmpeg.exe` to project root (replace existing)
3. Run `python tools/verify_ffmpeg_caps.py`
4. Rebuild portable EXE

## Legal

GPL builds include libx264/libx265. Galaxy About page notes FFmpeg GPL attribution.

## PyInstaller

`GalaxyConverter.portable.spec` bundles `ffmpeg.exe` as a binary. UPX is **disabled** for ffmpeg.
