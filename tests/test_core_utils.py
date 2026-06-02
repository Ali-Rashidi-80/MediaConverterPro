"""Core utility function tests."""
from __future__ import annotations

import os
import tempfile

import pytest
from galaxy.core.exceptions import OutputDirError
from galaxy.core.utils import (
    ensure_writable_dir,
    file_has_extension,
    format_size,
    parse_format_extensions,
    resolve_output_path,
)


def test_format_size_units():
    assert format_size(512) == "512.0 B"
    assert "KB" in format_size(2048)
    assert "MB" in format_size(5 * 1024 * 1024)


def test_parse_format_extensions():
    exts = parse_format_extensions("*.jpg *.png")
    assert ".jpg" in exts
    assert ".png" in exts


def test_file_has_extension():
    assert file_has_extension("photo.JPG", (".jpg",))
    assert not file_has_extension("photo.png", (".jpg",))


def test_resolve_output_path_collision_suffix():
    with tempfile.TemporaryDirectory() as tmp:
        src = os.path.join(tmp, "clip.mp4")
        open(src, "wb").close()
        out = resolve_output_path(tmp, src, "clip", "mp4")
        assert out.endswith("_converted.mp4")


def test_ensure_writable_dir_creates_and_checks():
    with tempfile.TemporaryDirectory() as tmp:
        sub = os.path.join(tmp, "nested", "out")
        ensure_writable_dir(sub)
        assert os.path.isdir(sub)


def test_ensure_writable_dir_rejects_file_path():
    with tempfile.NamedTemporaryFile(delete=False) as f:
        path = f.name
    try:
        with pytest.raises(OutputDirError) as exc:
            ensure_writable_dir(path)
        assert exc.value.code == "err.output_not_dir"
    finally:
        os.unlink(path)
