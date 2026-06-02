"""hw_probe parsing and profile serialization tests."""
from __future__ import annotations

from galaxy.services import hw_probe as hp
from galaxy.services.hw_probe import AccelBackend, BackendCaps, GpuDevice, SystemProfile

SAMPLE_ENCODER_TEXT = """
 V..... h264_nvenc           NVIDIA NVENC H.264 encoder
 V..... hevc_nvenc           NVIDIA NVENC HEVC encoder
 V..... libx264              libx264 H.264
"""


def test_parse_encoders():
    enc = hp._parse_encoders(SAMPLE_ENCODER_TEXT)
    assert "h264_nvenc" in enc
    assert "libx264" in enc


def test_recommend_backend_nvidia_gpu():
    devices = [GpuDevice(0, "NVIDIA RTX 4070", "nvidia")]
    backends = {
        "nvidia": BackendCaps(encoders=["h264_nvenc"], filters=["scale_cuda"]),
    }
    assert hp._recommend_backend(devices, backends) == AccelBackend.NVIDIA.value


def test_recommend_backend_cpu_when_no_encoders():
    assert hp._recommend_backend([], {}) == AccelBackend.CPU.value


def test_gpu_slots_rtx():
    devices = [GpuDevice(0, "NVIDIA GeForce RTX 4090", "nvidia")]
    assert hp._gpu_slots(devices) == 2


def test_gpu_slots_default_one():
    devices = [GpuDevice(0, "NVIDIA GTX 1050", "nvidia")]
    assert hp._gpu_slots(devices) == 1


def test_system_profile_roundtrip(nvidia_profile):
    data = nvidia_profile.to_dict()
    restored = SystemProfile.from_dict(data)
    assert restored.cpu_count == nvidia_profile.cpu_count
    assert restored.recommended_backend == nvidia_profile.recommended_backend
    assert restored.backends["nvidia"].has_encoder("h264_nvenc")


def test_backend_caps_full_gpu_path():
    caps = BackendCaps(encoders=["h264_nvenc"], filters=["scale_cuda"])
    assert caps.can_full_gpu_path()


def test_backend_caps_encode_only_without_scale_cuda():
    caps = BackendCaps(encoders=["h264_nvenc"], filters=[])
    assert not caps.can_full_gpu_path()
