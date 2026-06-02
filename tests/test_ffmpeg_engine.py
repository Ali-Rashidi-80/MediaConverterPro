"""FFmpegEngine pure-logic tests (no subprocess)."""
from __future__ import annotations

import pytest
from galaxy.services.ffmpeg import FFmpegEngine, find_ffmpeg_path


@pytest.mark.parametrize(
    "text,expected",
    [
        ("Duration: 00:01:30.00", 90),
        ("Duration: 01:00:00.00", 3600),
        ("no duration here", 10),
    ],
)
def test_get_duration(text, expected):
    assert FFmpegEngine.get_duration(text) == expected


@pytest.mark.parametrize(
    "value,expected",
    [
        ("", None),
        ("45", 45),
        ("00:01:05", 65),
        ("bad", None),
    ],
)
def test_parse_timecode(value, expected):
    assert FFmpegEngine.parse_timecode(value) == expected


def test_build_video_filters_rotate_and_denoise():
    vf = FFmpegEngine.build_video_filters({"rotate": 90, "denoise": True})
    assert vf is not None
    assert "transpose=1" in vf
    assert "hqdn3d" in vf


def test_build_video_filters_youtube_preset_scale():
    vf = FFmpegEngine.build_video_filters({"video_preset": "youtube"})
    assert vf is not None
    assert "1920:1080" in vf


def test_append_input_options_trim():
    cmd = ["ffmpeg"]
    FFmpegEngine.append_input_options(cmd, {"trim_start": "00:00:10", "trim_end": "00:00:40"})
    assert "-ss" in cmd and "10" in cmd
    assert "-t" in cmd


def test_append_audio_options_mp3():
    cmd = ["ffmpeg", "-i", "a.wav"]
    FFmpegEngine.append_audio_options(cmd, {"bitrate": "192k"}, "mp3")
    joined = " ".join(cmd)
    assert "libmp3lame" in joined
    assert "-vn" in cmd


def test_append_audio_options_wav_lossless():
    cmd = ["ffmpeg", "-i", "a.wav"]
    FFmpegEngine.append_audio_options(cmd, {}, "wav")
    assert "pcm_s16le" in cmd


def test_find_ffmpeg_path_when_bundled():
    path = find_ffmpeg_path()
    if path:
        assert path.endswith("ffmpeg.exe") or path.endswith("ffmpeg")
