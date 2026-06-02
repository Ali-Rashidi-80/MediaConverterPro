#!/usr/bin/env python3
"""Download BtbN FFmpeg GPL build when ffmpeg.exe is missing (CI bootstrap)."""
from __future__ import annotations

import shutil
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FFMPEG = ROOT / "ffmpeg.exe"
URL = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"


def main() -> int:
    if FFMPEG.is_file():
        print(f"OK — already present: {FFMPEG}")
        return 0
    if sys.platform != "win32":
        print("SKIP — bootstrap only implemented for Windows CI")
        return 0
    print(f"Downloading FFmpeg from {URL} ...")
    with tempfile.TemporaryDirectory() as tmp:
        zpath = Path(tmp) / "ffmpeg.zip"
        urllib.request.urlretrieve(URL, zpath)  # nosec B310 — fixed official BtbN release URL
        with zipfile.ZipFile(zpath) as zf:
            member = next(n for n in zf.namelist() if n.endswith("/bin/ffmpeg.exe"))
            zf.extract(member, tmp)
            src = Path(tmp) / member
            shutil.copy2(src, FFMPEG)
            probe_member = member.replace("ffmpeg.exe", "ffprobe.exe")
            if probe_member in zf.namelist():
                zf.extract(probe_member, tmp)
                shutil.copy2(Path(tmp) / probe_member, ROOT / "ffprobe.exe")
    print(f"Installed: {FFMPEG} ({FFMPEG.stat().st_size // (1024*1024)} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
