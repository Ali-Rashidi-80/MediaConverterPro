"""Help HTML builder tests (requires QApplication for font registration)."""
from __future__ import annotations

import pytest
from galaxy.services.hw_probe import BackendCaps, SystemProfile
from galaxy.ui.help_content import build_help_html
from galaxy_i18n import I18n

pytestmark = pytest.mark.ui


def test_build_help_html_fa_contains_sections(qapp):
    profile = SystemProfile(cpu_count=8, recommended_backend="nvidia")
    profile.backends["nvidia"] = BackendCaps(encoders=["h264_nvenc"], filters=["scale_cuda"])
    html = build_help_html(
        I18n("fa"),
        "dark_cyan",
        out_dir="/tmp/out",
        out_ok=True,
        ff_ok=True,
        ff_ver="ffmpeg version test",
        ff_path="ffmpeg.exe",
        heic_ok=True,
        mode="simple",
        hw_profile=profile,
    )
    assert "h264_nvenc" in html
    assert "سوالات" in html or "FAQ" in html


def test_build_help_html_en_faq_gpu(qapp):
    html = build_help_html(
        I18n("en"),
        "light",
        out_dir="C:/out",
        out_ok=True,
        ff_ok=True,
        ff_ver="ffmpeg 7.0",
        ff_path=None,
        heic_ok=False,
        mode="professional",
        hw_profile=None,
    )
    assert "Full GPU" in html or "Encode GPU" in html


def test_build_help_html_contains_author_links(qapp):
    html = build_help_html(
        I18n("en"),
        "dark_cyan",
        out_dir="C:/out",
        out_ok=True,
        ff_ok=True,
        ff_ver="ffmpeg 7.0",
        ff_path="ffmpeg.exe",
        heic_ok=True,
        mode="simple",
        hw_profile=None,
    )
    assert "Ali Rashidi" in html
    assert "t.me/writeyourway" in html
    assert "t.me/a_ra_80" in html
    assert "Developer" in html or "👤" in html
