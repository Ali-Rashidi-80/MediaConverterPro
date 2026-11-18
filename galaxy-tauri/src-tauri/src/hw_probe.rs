use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tokio::process::Command;

use crate::constants::{HW_CACHE_FILE_NAME, HW_CACHE_TTL_SECS, SUBPROCESS_TIMEOUT_SECS};
use crate::ffmpeg_engine::FFmpegEngine;
use crate::logging::AppLogger;
use crate::models::{GpuDeviceInfo, HardwareProfile};

#[derive(Debug, Serialize, Deserialize)]
struct CachedHardwareProfile {
    cached_at_epoch_secs: u64,
    ffmpeg_path: Option<String>,
    ffmpeg_size: Option<u64>,
    ffmpeg_mtime_secs: Option<u64>,
    profile: HardwareProfile,
}

pub struct HardwareProber;

impl HardwareProber {
    /// Probes hardware capabilities, using the persisted cache unless `force_refresh` is true
    /// or the cache is expired / FFmpeg binary fingerprint changed.
    pub async fn probe(force_refresh: bool) -> HardwareProfile {
        Self::probe_with_cache(force_refresh).await
    }

    /// Probes hardware capabilities with 24-hour disk caching and FFmpeg binary fingerprinting.
    pub async fn probe_with_cache(force_refresh: bool) -> HardwareProfile {
        let cache_path = Self::cache_path();
        let current_ffmpeg = FFmpegEngine::find_binary("ffmpeg").ok();
        let (curr_path_str, curr_size, curr_mtime) =
            Self::binary_fingerprint(current_ffmpeg.as_deref());
        let now_secs = Self::now_epoch_secs();

        if !force_refresh && cache_path.is_file() {
            if let Ok(content) = tokio::fs::read_to_string(&cache_path).await {
                if let Ok(cached) = serde_json::from_str::<CachedHardwareProfile>(&content) {
                    let within_ttl =
                        now_secs.saturating_sub(cached.cached_at_epoch_secs) < HW_CACHE_TTL_SECS;
                    let same_binary = cached.ffmpeg_path == curr_path_str
                        && cached.ffmpeg_size == curr_size
                        && cached.ffmpeg_mtime_secs == curr_mtime;
                    let same_cpu = cached.profile.cpu_count == num_cpus::get();

                    if within_ttl && same_binary && same_cpu {
                        return cached.profile;
                    }
                }
            }
        }

        let profile = Self::probe_uncached().await;
        let (fresh_path_str, fresh_size, fresh_mtime) =
            Self::binary_fingerprint(profile.ffmpeg_path.as_deref().map(Path::new));

        let cached = CachedHardwareProfile {
            cached_at_epoch_secs: Self::now_epoch_secs(),
            ffmpeg_path: fresh_path_str,
            ffmpeg_size: fresh_size,
            ffmpeg_mtime_secs: fresh_mtime,
            profile: profile.clone(),
        };

        if let Ok(json) = serde_json::to_string_pretty(&cached) {
            if let Err(err) = AppLogger::write_atomic(&cache_path, json.as_bytes()).await {
                AppLogger::warn(
                    "hw_probe",
                    &format!("Failed to write hardware cache {:?}: {}", cache_path, err),
                );
            }
        }

        profile
    }

    pub fn cache_path() -> PathBuf {
        AppLogger::app_data_dir().join(HW_CACHE_FILE_NAME)
    }

    fn now_epoch_secs() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
    }

    fn binary_fingerprint(path: Option<&Path>) -> (Option<String>, Option<u64>, Option<u64>) {
        let Some(p) = path else {
            return (None, None, None);
        };
        let path_str = Some(p.to_string_lossy().to_string());
        match std::fs::metadata(p) {
            Ok(meta) => {
                let size = Some(meta.len());
                let mtime = meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_secs());
                (path_str, size, mtime)
            }
            Err(_) => (path_str, None, None),
        }
    }

    async fn run_ffmpeg_query(ffmpeg_path: &Path, args: &[&str]) -> Option<String> {
        let mut cmd = Command::new(ffmpeg_path);
        cmd.args(args);
        cmd.stdin(Stdio::null());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::null());
        cmd.kill_on_drop(true);

        #[cfg(target_os = "windows")]
        {
            cmd.creation_flags(0x08000000 | 0x00004000);
        }

        let output =
            tokio::time::timeout(Duration::from_secs(SUBPROCESS_TIMEOUT_SECS), cmd.output())
                .await
                .ok()?
                .ok()?;

        if !output.status.success() {
            return None;
        }
        Some(String::from_utf8_lossy(&output.stdout).to_string())
    }

    /// Runs live FFmpeg & GPU hardware probing without reading/writing disk cache.
    pub async fn probe_uncached() -> HardwareProfile {
        let cpu_count = num_cpus::get();
        let mut available_encoders = Vec::new();
        let mut available_hwaccels = Vec::new();
        let mut available_filters = Vec::new();
        let mut ffmpeg_version = "Not Found".to_string();
        let mut ffmpeg_available = false;
        let mut ffmpeg_path_str = None;

        if let Ok(ffmpeg_path) = FFmpegEngine::find_binary("ffmpeg") {
            ffmpeg_available = true;
            ffmpeg_path_str = Some(ffmpeg_path.to_string_lossy().to_string());
            ffmpeg_version = "Unknown".to_string();

            let (ver_out, enc_out, hw_out, flt_out) = tokio::join!(
                Self::run_ffmpeg_query(&ffmpeg_path, &["-version"]),
                Self::run_ffmpeg_query(&ffmpeg_path, &["-hide_banner", "-encoders"]),
                Self::run_ffmpeg_query(&ffmpeg_path, &["-hide_banner", "-hwaccels"]),
                Self::run_ffmpeg_query(&ffmpeg_path, &["-hide_banner", "-filters"]),
            );

            if let Some(text) = ver_out {
                if let Some(first_line) = text.lines().next() {
                    let trimmed = first_line.trim();
                    if !trimmed.is_empty() {
                        ffmpeg_version = trimmed.to_string();
                    }
                }
            }

            if let Some(text) = enc_out {
                for line in text.lines() {
                    let trimmed = line.trim();
                    if trimmed.starts_with('V') || trimmed.starts_with('A') {
                        let parts: Vec<&str> = trimmed.split_whitespace().collect();
                        if parts.len() >= 2 && parts[0].len() == 6 {
                            available_encoders.push(parts[1].to_string());
                        }
                    }
                }
            }

            if let Some(text) = hw_out {
                for line in text.lines().skip(1) {
                    let trimmed = line.trim();
                    if !trimmed.is_empty() && !trimmed.ends_with(':') {
                        available_hwaccels.push(trimmed.to_string());
                    }
                }
            }

            if let Some(text) = flt_out {
                for line in text.lines() {
                    let trimmed = line.trim();
                    let parts: Vec<&str> = trimmed.split_whitespace().collect();
                    if parts.len() >= 3
                        && parts[0].len() == 3
                        && parts[0]
                            .bytes()
                            .all(|b| matches!(b, b'.' | b'T' | b'S' | b'C'))
                        && parts[2].contains("->")
                    {
                        available_filters.push(parts[1].to_string());
                    }
                }
            }
        }

        let gpus = Self::detect_gpus().await;
        let (recommended_backend, recommended_gpu_slots) =
            Self::compute_recommendation(&gpus, &available_encoders);

        HardwareProfile {
            gpus,
            cpu_count,
            available_encoders,
            available_hwaccels,
            available_filters,
            recommended_backend,
            recommended_gpu_slots,
            ffmpeg_version,
            ffmpeg_available,
            ffmpeg_path: ffmpeg_path_str,
        }
    }

    /// Computes `(recommended_backend, recommended_gpu_slots)` from detected GPUs and encoders.
    ///
    /// When GPUs are detected, requires BOTH a matching vendor GPU and a matching FFmpeg encoder
    /// so we never falsely recommend `"nvidia"` when no NVIDIA GPU is present.
    pub fn compute_recommendation(
        gpus: &[GpuDeviceInfo],
        available_encoders: &[String],
    ) -> (String, usize) {
        let has_nvenc = available_encoders
            .iter()
            .any(|e| e == "h264_nvenc" || e == "hevc_nvenc");
        let has_amf = available_encoders
            .iter()
            .any(|e| e == "h264_amf" || e == "hevc_amf");
        let has_qsv = available_encoders
            .iter()
            .any(|e| e == "h264_qsv" || e == "hevc_qsv");

        let recommended_backend = if !gpus.is_empty() {
            let has_vendor = |vendor: &str| gpus.iter().any(|g| g.vendor == vendor);
            if has_vendor("nvidia") && has_nvenc {
                "nvidia".to_string()
            } else if has_vendor("amd") && has_amf {
                "amd".to_string()
            } else if has_vendor("intel") && has_qsv {
                "intel".to_string()
            } else {
                "cpu".to_string()
            }
        } else if has_nvenc {
            "nvidia".to_string()
        } else if has_amf {
            "amd".to_string()
        } else if has_qsv {
            "intel".to_string()
        } else {
            "cpu".to_string()
        };

        let recommended_gpu_slots = if recommended_backend == "cpu" {
            0
        } else if recommended_backend == "nvidia"
            && gpus.iter().any(|g| {
                if g.vendor != "nvidia" {
                    return false;
                }
                let lower = g.name.to_ascii_lowercase();
                lower.contains("rtx 40")
                    || lower.contains("rtx 50")
                    || lower.contains("quadro")
                    || lower.contains("a100")
                    || lower.contains("a6000")
            })
        {
            2
        } else {
            1
        };

        (recommended_backend, recommended_gpu_slots)
    }

    async fn detect_gpus() -> Vec<GpuDeviceInfo> {
        let mut list = Vec::new();

        #[cfg(target_os = "windows")]
        {
            let mut cmd = Command::new("powershell.exe");
            cmd.args([
                "-NoProfile",
                "-Command",
                "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name",
            ]);
            cmd.stdin(Stdio::null());
            cmd.stdout(Stdio::piped());
            cmd.stderr(Stdio::null());
            cmd.kill_on_drop(true);
            cmd.creation_flags(0x08000000 | 0x00004000);

            if let Ok(Ok(output)) =
                tokio::time::timeout(Duration::from_secs(SUBPROCESS_TIMEOUT_SECS), cmd.output())
                    .await
            {
                let text = String::from_utf8_lossy(&output.stdout);
                let mut idx = 0;
                for line in text.lines() {
                    let name = line.trim().to_string();
                    if !name.is_empty() {
                        let lower = name.to_ascii_lowercase();
                        let vendor = if lower.contains("nvidia")
                            || lower.contains("geforce")
                            || lower.contains("quadro")
                            || lower.contains("rtx")
                        {
                            "nvidia".to_string()
                        } else if lower.contains("amd") || lower.contains("radeon") {
                            "amd".to_string()
                        } else if lower.contains("intel")
                            || lower.contains("iris")
                            || lower.contains("arc")
                        {
                            "intel".to_string()
                        } else {
                            "unknown".to_string()
                        };

                        list.push(GpuDeviceInfo {
                            index: idx,
                            name,
                            vendor,
                        });
                        idx += 1;
                    }
                }
            }
        }

        list
    }
}
