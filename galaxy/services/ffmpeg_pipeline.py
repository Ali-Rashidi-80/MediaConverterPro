"""FFmpeg pipeline routing — multi-vendor HW accel with CPU fallback."""
from __future__ import annotations

from enum import Enum
from typing import Any, cast

from galaxy.services.ffmpeg import FFmpegEngine
from galaxy.services.hw_probe import AccelBackend, SystemProfile


class PipelineTier(str, Enum):
    COPY = "copy"
    CPU = "cpu"
    TIER1 = "tier1"
    TIER2 = "tier2"


def resolve_accel_mode(settings: dict[str, Any], profile: SystemProfile | None) -> AccelBackend:
    mode = settings.get("accel_mode") or AccelBackend.AUTO.value
    if settings.get("use_gpu") and mode == AccelBackend.AUTO.value:
        mode = AccelBackend.NVIDIA.value
    try:
        backend = AccelBackend(mode)
    except ValueError:
        backend = AccelBackend.AUTO
    if backend == AccelBackend.AUTO and profile:
        try:
            backend = AccelBackend(profile.recommended_backend)
        except ValueError:
            backend = AccelBackend.CPU
    if backend != AccelBackend.CPU and profile and not profile.backend_available(backend):
        backend = AccelBackend.CPU
    return backend


def _needs_cpu_filters(settings: dict[str, Any]) -> bool:
    preset = cast(dict[str, Any], FFmpegEngine.VIDEO_PRESETS.get(settings.get("video_preset", "original"), {}))
    if settings.get("rotate"):
        return True
    if settings.get("denoise") or settings.get("sharpen") or settings.get("grayscale"):
        return True
    if settings.get("fps"):
        return True
    scale = settings.get("scale") or preset.get("scale")
    if scale and scale != "original":
        return True
    return False


def pick_pipeline_tier(
    settings: dict[str, Any],
    profile: SystemProfile | None,
    force_cpu: bool = False,
) -> tuple[PipelineTier, AccelBackend]:
    preset_cfg = cast(dict[str, Any], FFmpegEngine.VIDEO_PRESETS.get(settings.get("video_preset", "original"), {}))
    if settings.get("copy_streams") or preset_cfg.get("copy"):
        return PipelineTier.COPY, AccelBackend.CPU

    fmt = settings.get("format", "mp4").lower()
    codec = settings.get("codec", "H.264")
    if fmt in ("gif", "webm") or "VP9" in codec or "AV1" in codec:
        return PipelineTier.CPU, AccelBackend.CPU

    backend = AccelBackend.CPU if force_cpu else resolve_accel_mode(settings, profile)
    if backend == AccelBackend.CPU:
        return PipelineTier.CPU, AccelBackend.CPU

    if _needs_cpu_filters(settings):
        return PipelineTier.TIER2, backend

    caps = profile.backends.get(backend.value) if profile else None
    if caps and caps.can_full_gpu_path():
        return PipelineTier.TIER1, backend
    return PipelineTier.TIER2, backend


def tier_label(tier: PipelineTier, backend: AccelBackend) -> str:
    if tier == PipelineTier.COPY:
        return "copy"
    if tier == PipelineTier.CPU:
        return "cpu"
    if tier == PipelineTier.TIER1:
        return f"full_gpu_{backend.value}"
    return f"encode_gpu_{backend.value}"


def _effective_crf(settings: dict[str, Any]) -> int:
    preset_cfg = cast(dict[str, Any], FFmpegEngine.VIDEO_PRESETS.get(settings.get("video_preset", "original"), {}))
    crf = int(settings.get("crf") or preset_cfg.get("crf", 23))
    profile = settings.get("quality_profile", "balanced")
    if profile == "speed":
        return min(crf + 2, 35)
    if profile == "quality":
        return max(crf - 2, 10)
    return crf


def _append_hw_input(cmd: list[str], tier: PipelineTier, backend: AccelBackend) -> None:
    if tier != PipelineTier.TIER1:
        return
    if backend == AccelBackend.NVIDIA:
        cmd.extend(["-hwaccel", "cuda", "-hwaccel_output_format", "cuda"])
    elif backend == AccelBackend.INTEL:
        cmd.extend(["-init_hw_device", "qsv=hw", "-filter_hw_device", "hw"])
    elif backend == AccelBackend.AMD:
        cmd.extend(["-hwaccel", "d3d11va", "-hwaccel_output_format", "d3d11"])


def _build_gpu_scale_filter(settings: dict[str, Any], tier: PipelineTier, backend: AccelBackend) -> str | None:
    preset = cast(dict[str, Any], FFmpegEngine.VIDEO_PRESETS.get(settings.get("video_preset", "original"), {}))
    scale = settings.get("scale") or preset.get("scale")
    if not scale or scale == "original":
        return None
    if tier == PipelineTier.TIER1 and backend == AccelBackend.NVIDIA:
        return f"scale_cuda={scale}"
    return None


def append_video_encode_options(
    cmd: list[str],
    settings: dict[str, Any],
    target_fmt: str,
    ffmpeg_path: str | None,
    profile: SystemProfile | None,
    force_cpu: bool = False,
) -> tuple[PipelineTier, AccelBackend]:
    """Append video encoding options; returns tier and backend used."""
    preset_cfg = cast(dict[str, Any], FFmpegEngine.VIDEO_PRESETS.get(settings.get("video_preset", "original"), {}))
    tier, backend = pick_pipeline_tier(settings, profile, force_cpu=force_cpu)

    if tier == PipelineTier.COPY or preset_cfg.get("copy") or settings.get("copy_streams"):
        cmd.extend(["-c", "copy"])
        if target_fmt == "mp4":
            cmd.extend(["-bsf:a", "aac_adtstoasc"])
        if settings.get("strip_audio"):
            cmd.extend(["-an"])
        if settings.get("strip_subs"):
            cmd.extend(["-sn"])
        return PipelineTier.COPY, AccelBackend.CPU

    if target_fmt == "gif":
        vf_gif = "fps=12,scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse"
        cmd.extend(["-an", "-vf", vf_gif])
        return PipelineTier.CPU, AccelBackend.CPU

    gpu_scale = _build_gpu_scale_filter(settings, tier, backend)
    vf = FFmpegEngine.build_video_filters(settings)
    if gpu_scale and tier == PipelineTier.TIER1:
        filters = [gpu_scale]
        fps = settings.get("fps") or preset_cfg.get("fps")
        if fps and str(fps) != "0":
            filters.append(f"fps={fps}")
        cmd.extend(["-vf", ",".join(filters)])
    elif vf:
        cmd.extend(["-vf", vf])

    codec = settings.get("codec", "H.264")
    use_hevc = "H.265" in codec or "HEVC" in codec
    use_vp9 = "VP9" in codec or target_fmt == "webm"
    use_av1 = "AV1" in codec
    crf = _effective_crf(settings)
    enc_preset = settings.get("enc_preset") or preset_cfg.get("preset", "medium")
    nvenc_preset = settings.get("nvenc_preset") or "p4"
    cpu_threads = settings.get("cpu_threads") or 0
    if not cpu_threads:
        cpu_threads = max(1, (profile.cpu_count - 1) if profile else 2)

    if target_fmt == "webm" or use_vp9:
        cmd.extend(["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", str(min(crf + 5, 35)), "-row-mt", "1"])
    elif use_av1:
        cmd.extend(["-c:v", "libsvtav1", "-crf", str(crf), "-preset", "6"])
    elif tier in (PipelineTier.TIER1, PipelineTier.TIER2) and backend == AccelBackend.NVIDIA:
        enc = "hevc_nvenc" if use_hevc else "h264_nvenc"
        cmd.extend(["-c:v", enc, "-rc", "vbr", "-cq", str(crf), "-preset", nvenc_preset])
        la = int(settings.get("nvenc_lookahead") or 0)
        if la > 0:
            cmd.extend(["-rc-lookahead", str(la)])
    elif tier in (PipelineTier.TIER1, PipelineTier.TIER2) and backend == AccelBackend.AMD:
        enc = "hevc_amf" if use_hevc else "h264_amf"
        cmd.extend(["-c:v", enc, "-rc", "vbr", "-qp_i", str(crf), "-quality", "balanced"])
    elif tier in (PipelineTier.TIER1, PipelineTier.TIER2) and backend == AccelBackend.INTEL:
        enc = "hevc_qsv" if use_hevc else "h264_qsv"
        cmd.extend(["-c:v", enc, "-global_quality", str(crf), "-preset", "medium"])
    elif use_hevc:
        cmd.extend(["-c:v", "libx265", "-crf", str(crf), "-preset", enc_preset, "-tag:v", "hvc1", "-pix_fmt", "yuv420p"])
        cmd.extend(["-threads", str(cpu_threads)])
    elif target_fmt == "avi":
        cmd.extend(["-c:v", "mpeg4", "-q:v", "5"])
    else:
        cmd.extend(["-c:v", "libx264", "-crf", str(crf), "-preset", enc_preset, "-pix_fmt", "yuv420p", "-profile:v", "high"])
        cmd.extend(["-threads", str(cpu_threads)])

    if settings.get("strip_audio"):
        cmd.extend(["-an"])
    else:
        abr = preset_cfg.get("audio_bitrate", settings.get("audio_bitrate", "192k"))
        ar = preset_cfg.get("ar", settings.get("audio_rate", 0))
        if target_fmt == "webm":
            cmd.extend(["-c:a", "libopus", "-b:a", "128k"])
        elif target_fmt == "avi":
            cmd.extend(["-c:a", "mp3", "-b:a", abr if isinstance(abr, str) else f"{abr}k"])
        else:
            cmd.extend(["-c:a", "aac", "-b:a", abr if isinstance(abr, str) else f"{abr}k"])
            if ar:
                cmd.extend(["-ar", str(ar)])

    if settings.get("strip_subs"):
        cmd.extend(["-sn"])

    if target_fmt in ("mp4", "mov"):
        cmd.extend(["-movflags", "+faststart"])
        if target_fmt == "mp4" and not settings.get("strip_audio"):
            cmd.extend(["-bsf:a", "aac_adtstoasc"])

    return tier, backend


def build_video_command(
    ffmpeg_cmd: str,
    file_path: str,
    save_path: str,
    settings: dict[str, Any],
    profile: SystemProfile | None,
    force_cpu: bool = False,
) -> tuple[list[str], PipelineTier, AccelBackend]:
    """Build full ffmpeg command for one video file."""
    tier, backend = pick_pipeline_tier(settings, profile, force_cpu=force_cpu)
    cmd = [ffmpeg_cmd, "-hide_banner", "-loglevel", "info", "-y"]
    FFmpegEngine.append_input_options(cmd, settings)
    _append_hw_input(cmd, tier, backend)
    cmd.extend(["-i", file_path])
    tier, backend = append_video_encode_options(
        cmd, settings, settings.get("format", "mp4").lower(), ffmpeg_cmd, profile, force_cpu=force_cpu
    )
    cmd.append(save_path)
    return cmd, tier, backend
