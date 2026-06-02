#!/usr/bin/env python3
"""Verify bundled FFmpeg hardware encoder capabilities."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FFMPEG = ROOT / "ffmpeg.exe"

REQUIRED_ENCODERS = ("h264_nvenc", "hevc_nvenc", "h264_amf", "hevc_amf", "h264_qsv", "hevc_qsv")
OPTIONAL_ENCODERS = ("av1_nvenc", "av1_amf", "av1_qsv")
REQUIRED_HWACCELS = ("cuda", "d3d11va", "qsv")
OPTIONAL_FILTERS = ("scale_cuda", "scale_qsv", "vpp_amf")


def main() -> int:
    if not FFMPEG.is_file():
        print(f"MISSING: {FFMPEG}")
        return 1

    import subprocess

    def run(flag: str) -> str:
        r = subprocess.run(
            [str(FFMPEG), "-hide_banner", flag],
            capture_output=True,
            text=True,
            timeout=30,
            encoding="utf-8",
            errors="replace",
        )
        return r.stdout or ""

    enc = run("-encoders")
    hw = run("-hwaccels")
    flt = run("-filters")

    report = {
        "ffmpeg": str(FFMPEG),
        "size_mb": round(FFMPEG.stat().st_size / (1024 * 1024), 1),
        "required_encoders": {e: e in enc for e in REQUIRED_ENCODERS},
        "optional_encoders": {e: e in enc for e in OPTIONAL_ENCODERS},
        "required_hwaccels": {h: h in hw for h in REQUIRED_HWACCELS},
        "optional_filters": {f: f in flt for f in OPTIONAL_FILTERS},
    }
    print(json.dumps(report, indent=2))
    missing = [k for k, ok in report["required_encoders"].items() if not ok]
    if missing:
        print(f"FAIL missing encoders: {missing}", file=sys.stderr)
        return 2
    print("OK — required encoders present")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
