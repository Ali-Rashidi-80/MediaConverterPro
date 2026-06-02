"""Extended image_task transformation tests."""
from __future__ import annotations

import os

from galaxy.workers.image_task import convert_image_task
from PIL import Image


def test_rotate_90(sample_jpg, temp_output):
    path, ok, msg = convert_image_task(
        str(sample_jpg), str(temp_output), {"format": "jpg", "rotate": 90},
    )
    assert ok, msg
    with Image.open(temp_output / msg) as img:
        assert img.size == (48, 64)


def test_grayscale(sample_jpg, temp_output):
    path, ok, msg = convert_image_task(
        str(sample_jpg), str(temp_output), {"format": "png", "grayscale": True},
    )
    assert ok, msg
    with Image.open(temp_output / msg) as img:
        assert img.mode in ("L", "LA", "RGB")


def test_resize_half(sample_jpg, temp_output):
    path, ok, msg = convert_image_task(
        str(sample_jpg), str(temp_output), {"format": "jpg", "resize": 50, "quality": 85},
    )
    assert ok, msg
    with Image.open(temp_output / msg) as img:
        assert img.size == (32, 24)


def test_flip_both(sample_jpg, temp_output):
    path, ok, msg = convert_image_task(
        str(sample_jpg), str(temp_output),
        {"format": "jpg", "flip_h": True, "flip_v": True},
    )
    assert ok, msg
    assert os.path.getsize(temp_output / msg) > 0


def test_png_with_transparency(sample_png, temp_output):
    path, ok, msg = convert_image_task(
        str(sample_png), str(temp_output), {"format": "webp", "quality": 80},
    )
    assert ok, msg
    assert msg.lower().endswith(".webp")
