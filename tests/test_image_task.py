"""Image conversion task tests."""
from __future__ import annotations

import os
import tempfile

from galaxy.workers.image_task import convert_image_task
from PIL import Image


def test_convert_jpg_to_png():
    with tempfile.TemporaryDirectory() as tmp:
        src = os.path.join(tmp, "sample.jpg")
        Image.new("RGB", (32, 32), color=(255, 0, 0)).save(src, "JPEG")
        path, ok, msg = convert_image_task(src, tmp, {"format": "png", "quality": 90})
        assert ok, msg
        out = os.path.join(tmp, msg)
        assert os.path.isfile(out)
        assert out.lower().endswith(".png")
        with Image.open(out) as img:
            assert img.size == (32, 32)


def test_unreadable_file_returns_false():
    path, ok, msg = convert_image_task("/nonexistent/file.jpg", "/tmp", {"format": "jpg"})
    assert not ok
    assert msg == "unreadable"
