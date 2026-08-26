"""Shared pytest fixtures and markers for Galaxy Converter QA."""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

# Headless CI / agents: set before any Qt import creates a QApplication.
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
os.environ.setdefault("QT_OPENGL", "software")

import pytest
from PIL import Image
from PySide6.QtWidgets import QApplication

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from galaxy.services.ffmpeg import find_ffmpeg_path
from galaxy.services.hw_probe import BackendCaps, ParallelCaps, SystemProfile
from galaxy.services.settings import SettingsManager


def _shutdown_galaxy_window(win, qapp) -> None:
    """Stop workers and reset page state before destroying the window (avoids Qt teardown crashes)."""
    from galaxy.ui.base_page import BasePage

    for i in range(win.stack.count()):
        page = win.stack.widget(i)
        if isinstance(page, BasePage):
            page.shutdown_conversion_workers()
    win.close()
    win.deleteLater()
    if qapp:
        qapp.processEvents()
        qapp.processEvents()


def pytest_configure(config):
    config.addinivalue_line("markers", "integration: real FFmpeg / slow tests")
    config.addinivalue_line("markers", "ui: Qt widget interaction tests")
    config.addinivalue_line("markers", "gpu: requires GPU-related probe data")


@pytest.fixture(scope="session")
def ffmpeg_path():
    path = find_ffmpeg_path()
    if not path or not os.path.isfile(path):
        pytest.skip("FFmpeg binary not found")
    return path


@pytest.fixture(scope="session")
def qapp():
    app = QApplication.instance()
    if app is None:
        app = QApplication([])
    app.setQuitOnLastWindowClosed(False)
    yield app


@pytest.fixture
def qtbot(qapp):
    """Prefer real pytest-qt; fall back to a small local helper if the plugin is missing."""
    try:
        from pytestqt.qtbot import QtBot

        yield QtBot(qapp)
        return
    except ImportError:
        pass

    import time
    from contextlib import contextmanager

    class _LocalQtBot:
        def __init__(self, app):
            self._app = app

        def wait(self, ms: int) -> None:
            deadline = time.perf_counter() + (ms / 1000.0)
            while time.perf_counter() < deadline:
                self._app.processEvents()
                time.sleep(0.005)

        def waitUntil(self, callback, timeout: int = 5000) -> None:
            deadline = time.perf_counter() + (timeout / 1000.0)
            while time.perf_counter() < deadline:
                self._app.processEvents()
                try:
                    if callback():
                        return
                except Exception:
                    pass
                time.sleep(0.01)
            raise TimeoutError(f"waitUntil timed out after {timeout}ms")

        @contextmanager
        def waitSignal(self, signal, timeout: int = 5000):
            from PySide6.QtCore import QEventLoop, QTimer

            loop = QEventLoop()
            result = {"ok": False}

            def _ok(*_a):
                result["ok"] = True
                loop.quit()

            signal.connect(_ok)
            timer = QTimer()
            timer.setSingleShot(True)
            timer.timeout.connect(loop.quit)
            timer.start(timeout)
            try:
                yield result
            finally:
                if not result["ok"]:
                    loop.exec()
                try:
                    signal.disconnect(_ok)
                except (RuntimeError, TypeError):
                    pass
            if not result["ok"]:
                raise TimeoutError(f"waitSignal timed out after {timeout}ms")

        def addWidget(self, widget) -> None:
            widget.show()
            self._app.processEvents()

    yield _LocalQtBot(qapp)


@pytest.fixture(autouse=True)
def _qt_process_events_after_ui(request, qapp):
    yield
    if "ui" not in request.keywords:
        return
    if qapp:
        qapp.processEvents()


@pytest.fixture
def nvidia_profile() -> SystemProfile:
    p = SystemProfile(cpu_count=8, recommended_backend="nvidia")
    p.backends["nvidia"] = BackendCaps(
        encoders=["h264_nvenc", "hevc_nvenc"],
        filters=["scale_cuda"],
        hwaccels=["cuda"],
    )
    p.recommended_parallel = ParallelCaps(gpu_slots=2, cpu_slots=4, image_slots=6)
    return p


@pytest.fixture
def amd_profile() -> SystemProfile:
    p = SystemProfile(cpu_count=8, recommended_backend="amd")
    p.backends["amd"] = BackendCaps(encoders=["h264_amf"], filters=["vpp_amf"])
    return p


@pytest.fixture
def temp_output(tmp_path):
    out = tmp_path / "out"
    out.mkdir()
    return out


@pytest.fixture
def sample_jpg(temp_output) -> Path:
    path = temp_output / "sample.jpg"
    Image.new("RGB", (64, 48), color=(10, 120, 200)).save(path, "JPEG", quality=90)
    return path


@pytest.fixture
def sample_png(temp_output) -> Path:
    path = temp_output / "sample.png"
    Image.new("RGBA", (32, 32), color=(255, 0, 0, 128)).save(path, "PNG")
    return path


@pytest.fixture
def app_settings():
    return {
        "language": "en",
        "parallel_mode": "sequential",
        "max_parallel_jobs": 0,
        "accel_mode": "auto",
        "nvenc_preset": "p4",
        "cpu_threads": 0,
        "quality_profile": "balanced",
        "ui_mode": "professional",
    }


@pytest.fixture
def galaxy_window(qapp, monkeypatch, tmp_path):
    out = tmp_path / "output"
    out.mkdir()
    prefs = dict(SettingsManager.load())
    prefs["output_dir"] = str(out)
    prefs["language"] = "fa"
    prefs["ui_mode"] = "professional"
    monkeypatch.setattr(SettingsManager, "load", lambda: dict(prefs))
    monkeypatch.setattr(
        "galaxy.ui.main_window.get_system_profile",
        lambda refresh=False: SystemProfile(cpu_count=8, recommended_backend="nvidia"),
    )
    from galaxy.ui.main_window import GalaxyWindow

    win = GalaxyWindow()
    yield win
    _shutdown_galaxy_window(win, qapp)


@pytest.fixture
def tiny_mp4(temp_output, ffmpeg_path):
    """One-second black video for integration tests."""
    src = temp_output / "tiny.mp4"
    cmd = [
        ffmpeg_path, "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "color=c=black:s=160x120:d=1",
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
        str(src),
    ]
    r = subprocess.run(cmd, capture_output=True, timeout=60)
    if r.returncode != 0 or not src.is_file():
        pytest.skip("Could not generate test video")
    return src


def ffprobe_field(ffmpeg_path: str, media: Path, field: str) -> str:
    ffprobe = Path(ffmpeg_path).with_name("ffprobe.exe" if os.name == "nt" else "ffprobe")
    if not ffprobe.is_file():
        alt = Path(ffmpeg_path).parent / ("ffprobe.exe" if os.name == "nt" else "ffprobe")
        if alt.is_file():
            ffprobe = alt
    if not ffprobe.is_file():
        pytest.skip("ffprobe not found")
    r = subprocess.run(
        [str(ffprobe), "-v", "error", "-show_entries", f"stream={field}",
         "-of", "default=noprint_wrappers=1:nokey=1", str(media)],
        capture_output=True, text=True, timeout=30,
    )
    lines = [ln.strip() for ln in (r.stdout or "").splitlines() if ln.strip()]
    return lines[0] if lines else ""


@pytest.fixture
def ffprobe(ffmpeg_path):
    def _probe(media: Path, field: str) -> str:
        return ffprobe_field(ffmpeg_path, media, field)
    return _probe
