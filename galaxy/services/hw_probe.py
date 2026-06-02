"""Hardware probe — FFmpeg encoders, GPU devices, parallel recommendations."""
from __future__ import annotations

import hashlib
import json
import logging
import os
import platform
import subprocess
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from enum import Enum
from typing import Any

from galaxy.core.utils import get_startupinfo
from galaxy.services.ffmpeg import find_ffmpeg_path, verify_ffmpeg

CACHE_PATH = os.path.join(os.path.expanduser("~"), ".galaxy_converter", "hw_cache.json")
CACHE_TTL_SEC = 86400

NVENC_ENCODERS = ("h264_nvenc", "hevc_nvenc", "av1_nvenc")
AMF_ENCODERS = ("h264_amf", "hevc_amf", "av1_amf")
QSV_ENCODERS = ("h264_qsv", "hevc_qsv")
GPU_FILTERS = ("scale_cuda", "scale_npp", "scale_qsv", "vpp_amf")


class AccelBackend(str, Enum):
    AUTO = "auto"
    CPU = "cpu"
    NVIDIA = "nvidia"
    AMD = "amd"
    INTEL = "intel"
    APPLE = "apple"


@dataclass
class GpuDevice:
    index: int
    name: str
    vendor: str  # nvidia | amd | intel | unknown


@dataclass
class BackendCaps:
    encoders: list[str] = field(default_factory=list)
    hwaccels: list[str] = field(default_factory=list)
    filters: list[str] = field(default_factory=list)

    def has_encoder(self, name: str) -> bool:
        return name in self.encoders

    def can_full_gpu_path(self) -> bool:
        if self.has_encoder("h264_nvenc") and "scale_cuda" in self.filters:
            return True
        if self.has_encoder("h264_qsv") and "scale_qsv" in self.filters:
            return True
        if self.has_encoder("h264_amf") and "vpp_amf" in self.filters:
            return True
        return False


@dataclass
class ParallelCaps:
    gpu_slots: int = 1
    cpu_slots: int = 2
    image_slots: int = 4


@dataclass
class SystemProfile:
    cpu_count: int = 1
    gpu_devices: list[GpuDevice] = field(default_factory=list)
    backends: dict[str, BackendCaps] = field(default_factory=dict)
    recommended_backend: str = AccelBackend.CPU.value
    recommended_parallel: ParallelCaps = field(default_factory=ParallelCaps)
    ffmpeg_build: str = ""
    ffmpeg_hash: str = ""
    hwaccels: list[str] = field(default_factory=list)
    probe_timestamp: str = ""

    def backend_available(self, backend: AccelBackend | str) -> bool:
        key = backend.value if isinstance(backend, AccelBackend) else str(backend)
        if key == AccelBackend.CPU.value:
            return True
        if key == AccelBackend.AUTO.value:
            return True
        caps = self.backends.get(key)
        if not caps:
            return False
        if key == AccelBackend.NVIDIA.value:
            return any(caps.has_encoder(e) for e in NVENC_ENCODERS)
        if key == AccelBackend.AMD.value:
            return any(caps.has_encoder(e) for e in AMF_ENCODERS)
        if key == AccelBackend.INTEL.value:
            return any(caps.has_encoder(e) for e in QSV_ENCODERS)
        if key == AccelBackend.APPLE.value:
            return caps.has_encoder("h264_videotoolbox")
        return False

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["recommended_parallel"] = asdict(self.recommended_parallel)
        d["gpu_devices"] = [asdict(g) for g in self.gpu_devices]
        d["backends"] = {k: asdict(v) for k, v in self.backends.items()}
        return d

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> SystemProfile:
        rp = data.get("recommended_parallel") or {}
        gpus = [GpuDevice(**g) for g in data.get("gpu_devices") or []]
        backends = {}
        for k, v in (data.get("backends") or {}).items():
            backends[k] = BackendCaps(**v)
        return cls(
            cpu_count=int(data.get("cpu_count") or 1),
            gpu_devices=gpus,
            backends=backends,
            recommended_backend=str(data.get("recommended_backend") or AccelBackend.CPU.value),
            recommended_parallel=ParallelCaps(
                gpu_slots=int(rp.get("gpu_slots") or 1),
                cpu_slots=int(rp.get("cpu_slots") or 2),
                image_slots=int(rp.get("image_slots") or 4),
            ),
            ffmpeg_build=str(data.get("ffmpeg_build") or ""),
            ffmpeg_hash=str(data.get("ffmpeg_hash") or ""),
            hwaccels=list(data.get("hwaccels") or []),
            probe_timestamp=str(data.get("probe_timestamp") or ""),
        )


_profile_cache: SystemProfile | None = None


def _ffmpeg_hash(path: str | None) -> str:
    if not path or not os.path.isfile(path):
        return ""
    try:
        st = os.stat(path)
        return hashlib.sha256(f"{path}:{st.st_size}:{st.st_mtime_ns}".encode()).hexdigest()[:16]
    except OSError:
        return ""


def _run_ffmpeg_list(ffmpeg_path: str, flag: str) -> str:
    try:
        r = subprocess.run(
            [ffmpeg_path, "-hide_banner", flag],
            capture_output=True,
            text=True,
            timeout=20,
            startupinfo=get_startupinfo(),
            encoding="utf-8",
            errors="replace",
        )
        return (r.stdout or "") + (r.stderr or "")
    except Exception as exc:
        logging.debug("ffmpeg %s failed: %s", flag, exc)
        return ""


def _parse_encoders(text: str) -> list[str]:
    found = []
    for line in text.splitlines():
        parts = line.split()
        if len(parts) >= 2 and parts[0].startswith("V"):
            found.append(parts[1])
    return found


def _detect_gpu_devices() -> list[GpuDevice]:
    devices: list[GpuDevice] = []
    if platform.system() != "Windows":
        return devices
    try:
        ps = (
            "Get-CimInstance Win32_VideoController | "
            "Select-Object Name | ConvertTo-Json -Compress"
        )
        r = subprocess.run(
            ["powershell", "-NoProfile", "-Command", ps],
            capture_output=True,
            text=True,
            timeout=12,
            startupinfo=get_startupinfo(),
            encoding="utf-8",
            errors="replace",
        )
        raw = (r.stdout or "").strip()
        if not raw:
            return devices
        data = json.loads(raw)
        if isinstance(data, dict):
            data = [data]
        for i, item in enumerate(data):
            name = str(item.get("Name") or "GPU").strip()
            lower = name.lower()
            if "nvidia" in lower:
                vendor = "nvidia"
            elif "amd" in lower or "radeon" in lower:
                vendor = "amd"
            elif "intel" in lower:
                vendor = "intel"
            else:
                vendor = "unknown"
            devices.append(GpuDevice(index=i, name=name, vendor=vendor))
    except Exception as exc:
        logging.debug("GPU device detection failed: %s", exc)
    return devices


def _recommend_backend(devices: list[GpuDevice], backends: dict[str, BackendCaps]) -> str:
    order = []
    for d in devices:
        if d.vendor == "nvidia" and backends.get("nvidia") and any(
            backends["nvidia"].has_encoder(e) for e in NVENC_ENCODERS
        ):
            order.append(AccelBackend.NVIDIA.value)
        elif d.vendor == "amd" and backends.get("amd") and any(
            backends["amd"].has_encoder(e) for e in AMF_ENCODERS
        ):
            order.append(AccelBackend.AMD.value)
        elif d.vendor == "intel" and backends.get("intel") and any(
            backends["intel"].has_encoder(e) for e in QSV_ENCODERS
        ):
            order.append(AccelBackend.INTEL.value)
    if AccelBackend.NVIDIA.value in order:
        return AccelBackend.NVIDIA.value
    if AccelBackend.AMD.value in order:
        return AccelBackend.AMD.value
    if AccelBackend.INTEL.value in order:
        return AccelBackend.INTEL.value
    if backends.get("nvidia") and any(backends["nvidia"].has_encoder(e) for e in NVENC_ENCODERS):
        return AccelBackend.NVIDIA.value
    if backends.get("amd") and any(backends["amd"].has_encoder(e) for e in AMF_ENCODERS):
        return AccelBackend.AMD.value
    if backends.get("intel") and any(backends["intel"].has_encoder(e) for e in QSV_ENCODERS):
        return AccelBackend.INTEL.value
    return AccelBackend.CPU.value


def _gpu_slots(devices: list[GpuDevice]) -> int:
    for d in devices:
        if d.vendor == "nvidia":
            name = d.name.lower()
            if any(x in name for x in ("rtx 40", "rtx 50", "quadro", "a100", "a6000")):
                return 2
    return 1


def probe_system(ffmpeg_path: str | None = None, force: bool = False) -> SystemProfile:
    global _profile_cache
    ffmpeg_path = ffmpeg_path or find_ffmpeg_path()
    ff_hash = _ffmpeg_hash(ffmpeg_path)
    if not force and _profile_cache and _profile_cache.ffmpeg_hash == ff_hash:
        return _profile_cache

    if not force and os.path.isfile(CACHE_PATH):
        try:
            with open(CACHE_PATH, encoding="utf-8") as f:
                cached = json.load(f)
            if cached.get("ffmpeg_hash") == ff_hash:
                ts = cached.get("probe_timestamp") or ""
                if ts:
                    dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                    age = (datetime.now(UTC) - dt).total_seconds()
                    if age < CACHE_TTL_SEC:
                        _profile_cache = SystemProfile.from_dict(cached)
                        return _profile_cache
        except (OSError, json.JSONDecodeError, ValueError, TypeError):
            pass

    cpu_count = os.cpu_count() or 1
    enc_text = _run_ffmpeg_list(ffmpeg_path, "-encoders") if ffmpeg_path else ""
    hw_text = _run_ffmpeg_list(ffmpeg_path, "-hwaccels") if ffmpeg_path else ""
    flt_text = _run_ffmpeg_list(ffmpeg_path, "-filters") if ffmpeg_path else ""
    encoders = _parse_encoders(enc_text)
    hwaccels = [ln.strip() for ln in hw_text.splitlines() if ln.strip() and not ln.startswith("Hardware")]
    filters = [ln.split()[1] for ln in flt_text.splitlines() if len(ln.split()) >= 2]

    backends = {
        "nvidia": BackendCaps(
            encoders=[e for e in encoders if "nvenc" in e],
            hwaccels=[h for h in hwaccels if h in ("cuda", "dxva2", "d3d11va")],
            filters=[f for f in filters if f in GPU_FILTERS or "cuda" in f],
        ),
        "amd": BackendCaps(
            encoders=[e for e in encoders if "_amf" in e],
            hwaccels=[h for h in hwaccels if h in ("d3d11va", "dxva2", "amf")],
            filters=[f for f in filters if "amf" in f or f in GPU_FILTERS],
        ),
        "intel": BackendCaps(
            encoders=[e for e in encoders if "_qsv" in e],
            hwaccels=[h for h in hwaccels if h == "qsv"],
            filters=[f for f in filters if "qsv" in f],
        ),
        "apple": BackendCaps(
            encoders=[e for e in encoders if "videotoolbox" in e],
            hwaccels=[h for h in hwaccels if h == "videotoolbox"],
            filters=[],
        ),
    }

    devices = _detect_gpu_devices()
    ok, ver = verify_ffmpeg(ffmpeg_path)
    build = ver if ok else "Unknown"
    gpu_slot = _gpu_slots(devices) if _recommend_backend(devices, backends) != AccelBackend.CPU.value else 0

    profile = SystemProfile(
        cpu_count=cpu_count,
        gpu_devices=devices,
        backends=backends,
        recommended_backend=_recommend_backend(devices, backends),
        recommended_parallel=ParallelCaps(
            gpu_slots=max(1, gpu_slot) if gpu_slot else 1,
            cpu_slots=max(1, min(cpu_count - 1, 4)),
            image_slots=max(1, min(cpu_count - 1, 6)),
        ),
        ffmpeg_build=build,
        ffmpeg_hash=ff_hash,
        hwaccels=hwaccels,
        probe_timestamp=datetime.now(UTC).isoformat(),
    )

    try:
        os.makedirs(os.path.dirname(CACHE_PATH), exist_ok=True)
        with open(CACHE_PATH, "w", encoding="utf-8") as f:
            json.dump(profile.to_dict(), f, ensure_ascii=False, indent=2)
    except OSError as exc:
        logging.warning("Could not save hw cache: %s", exc)

    _profile_cache = profile
    return profile


def get_system_profile(refresh: bool = False) -> SystemProfile:
    return probe_system(force=refresh)


def invalidate_profile_cache() -> None:
    global _profile_cache
    _profile_cache = None
