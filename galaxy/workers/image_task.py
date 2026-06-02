"""Top-level image conversion task (thread-safe via per-path locks)."""
from __future__ import annotations

import logging
import os
import threading

from galaxy.core.constants import HEIF_SUPPORTED
from galaxy.core.utils import resolve_output_path

_output_locks: dict[str, threading.Lock] = {}
_output_locks_guard = threading.Lock()


def _output_lock(path: str) -> threading.Lock:
    with _output_locks_guard:
        if path not in _output_locks:
            _output_locks[path] = threading.Lock()
        return _output_locks[path]


def convert_image_task(file_path: str, output_dir: str, settings: dict) -> tuple[str, bool, str]:
    """Returns (file_path, success, message)."""
    from PIL import Image

    if not os.path.isfile(file_path) or not os.access(file_path, os.R_OK):
        return file_path, False, "unreadable"

    fname = os.path.basename(file_path)
    try:
        name, _ = os.path.splitext(fname)
        target_fmt = settings.get("format", "jpg").lower()
        if target_fmt == "jpeg":
            target_fmt = "jpg"
        save_path = resolve_output_path(output_dir, file_path, name, target_fmt)

        with _output_lock(save_path):
            with Image.open(file_path) as opened:
                img: Image.Image = opened.copy()
                if settings.get("rotate", 0):
                    rot = settings["rotate"]
                    if rot == 90:
                        img = img.transpose(Image.Transpose.ROTATE_270)
                    elif rot == 180:
                        img = img.transpose(Image.Transpose.ROTATE_180)
                    elif rot == 270:
                        img = img.transpose(Image.Transpose.ROTATE_90)
                if settings.get("flip_h"):
                    img = img.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
                if settings.get("flip_v"):
                    img = img.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
                if settings.get("grayscale") and img.mode != "L":
                    img = img.convert("L")
                if target_fmt in ("jpg", "bmp", "heic", "tiff") and img.mode not in ("RGB", "L"):
                    img = img.convert("RGB")
                elif target_fmt == "png" and img.mode in ("P", "LA"):
                    img = img.convert("RGBA")
                elif target_fmt == "webp" and img.mode in ("P", "LA"):
                    img = img.convert("RGBA")

                if settings.get("resize", 100) < 100:
                    w, h = img.size
                    pct = settings.get("resize", 100)
                    new_w = max(1, int(w * (pct / 100)))
                    new_h = max(1, int(h * (pct / 100)))
                    img = img.resize((new_w, new_h), Image.Resampling.LANCZOS)

                quality = settings.get("quality", 90)
                if target_fmt in ("jpg", "webp"):
                    img.save(save_path, format="JPEG" if target_fmt == "jpg" else "WEBP", quality=quality)
                elif target_fmt == "heic":
                    if HEIF_SUPPORTED:
                        try:
                            img.save(save_path, format="HEIF", quality=quality)
                        except (ValueError, OSError):
                            save_path = save_path.replace(".heic", ".jpg")
                            img.save(save_path, format="JPEG", quality=quality)
                    else:
                        save_path = save_path.replace(".heic", ".jpg")
                        img.save(save_path, format="JPEG", quality=quality)
                elif target_fmt == "ico":
                    img.save(save_path, format="ICO", sizes=[(256, 256), (128, 128), (64, 64), (32, 32)])
                elif target_fmt == "tiff":
                    img.save(save_path, format="TIFF", compression="tiff_deflate")
                elif target_fmt == "png":
                    img.save(save_path, format="PNG", optimize=True)
                else:
                    img.save(save_path)

        if os.path.exists(save_path) and os.path.getsize(save_path) > 0:
            return file_path, True, os.path.basename(save_path)
        return file_path, False, "empty output"
    except Exception as exc:
        logging.error("Image task error %s: %s", file_path, exc)
        return file_path, False, str(exc)[:80]
