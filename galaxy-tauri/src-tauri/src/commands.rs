use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use parking_lot::Mutex;
use tauri::{AppHandle, Emitter, State};
use tokio::process::Command;
use tokio_util::sync::CancellationToken;

use crate::constants::{
    ALL_SUPPORTED_EXTENSIONS, CANCELLATION_GRACE_PERIOD_MS, SUBPROCESS_TIMEOUT_SECS,
};
use crate::duplicate_scanner::DuplicateScanner;
use crate::ffmpeg_engine::FFmpegEngine;
use crate::fs_guard::OutputFileGuard;
use crate::history::HistoryStore;
use crate::hw_probe::HardwareProber;
use crate::image_engine::ImageEngine;
use crate::job_scheduler::JobScheduler;
use crate::logging::AppLogger;
use crate::models::{
    AppError, AppSettings, AudioConversionSettings, CustomPreset, DiskSpaceInfo, DuplicateGroup,
    HardwareProfile, HistoryEntry, HistorySummary, ImageConversionSettings, MediaFileInfo,
    MediaKind, PipelineTier, TaskProgressUpdate, VideoConversionSettings,
};
use crate::presets::PresetsStore;
use crate::process_runner::{attach_to_job_object, FfmpegConversionJob, ProcessRunner};
use crate::settings::SettingsStore;
use crate::social_splitter::SocialSplitter;
use crate::subtitle_fixer::SubtitleFixer;

static EXTRACT_SEQ: AtomicU64 = AtomicU64::new(0);

#[cfg(target_os = "windows")]
static SLEEP_PREVENTION_TX: std::sync::OnceLock<std::sync::mpsc::Sender<bool>> =
    std::sync::OnceLock::new();

pub struct AppState {
    pub scheduler: JobScheduler,
    pub pending_updates: Arc<Mutex<Vec<TaskProgressUpdate>>>,
    pub hardware: Mutex<Option<HardwareProfile>>,
    pub probe_lock: tokio::sync::Mutex<()>,
    pub verified_duplicates: Mutex<HashSet<PathBuf>>,
}

/// RAII guard guaranteeing `unregister_job` runs on all exit paths (success, error, cancellation, or panic).
struct ActiveJobGuard {
    scheduler: JobScheduler,
    job_id: String,
}

impl ActiveJobGuard {
    fn new(scheduler: JobScheduler, job_id: &str) -> Self {
        Self {
            scheduler,
            job_id: job_id.to_string(),
        }
    }
}

impl Drop for ActiveJobGuard {
    fn drop(&mut self) {
        self.scheduler.unregister_job(&self.job_id);
    }
}

#[allow(clippy::too_many_arguments)]
async fn record_history_entry(
    job_id: &str,
    in_path: &Path,
    out_path: Option<&Path>,
    filename: &str,
    source_bytes: u64,
    duration_secs: f64,
    format: &str,
    speed: f32,
    status: &str,
    privacy_wipe: bool,
) {
    let out_size = match out_path {
        Some(p) => tokio::fs::metadata(p).await.map(|m| m.len()).unwrap_or(0),
        None => 0,
    };
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let (stored_in, stored_out) = if privacy_wipe {
        ("[redacted]".to_string(), "[redacted]".to_string())
    } else {
        (
            in_path.to_string_lossy().to_string(),
            out_path
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default(),
        )
    };

    let entry = HistoryEntry {
        id: job_id.to_string(),
        input_path: stored_in,
        output_path: stored_out,
        filename: filename.to_string(),
        source_size_bytes: source_bytes,
        output_size_bytes: out_size,
        duration_secs,
        format: format.to_string(),
        speed: if speed.is_finite() && speed >= 0.0 {
            speed
        } else {
            0.0
        },
        timestamp: now,
        status: status.to_string(),
    };
    if let Err(err) = HistoryStore::add_entry(entry).await {
        AppLogger::warn(
            "commands",
            &format!("Failed to record history entry '{}': {}", job_id, err),
        );
    }
}

async fn resolve_target_dir(explicit_dir: &str) -> PathBuf {
    let trimmed = explicit_dir.trim();
    if trimmed.is_empty() {
        let settings = SettingsStore::load().await;
        PathBuf::from(settings.output_dir)
    } else {
        PathBuf::from(trimmed)
    }
}

fn has_cpu_filters(settings: &VideoConversionSettings) -> bool {
    let has_crop = settings
        .crop
        .as_deref()
        .map(str::trim)
        .filter(|c| {
            !c.is_empty() && !c.eq_ignore_ascii_case("none") && !c.eq_ignore_ascii_case("original")
        })
        .is_some();

    let has_scale = settings
        .scale
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty() && !s.eq_ignore_ascii_case("original"))
        .is_some();

    let has_eq = settings
        .brightness
        .filter(|v| v.is_finite() && *v != 0.0)
        .is_some()
        || settings
            .contrast
            .filter(|v| v.is_finite() && (*v - 1.0).abs() > 1e-4)
            .is_some()
        || settings
            .saturation
            .filter(|v| v.is_finite() && (*v - 1.0).abs() > 1e-4)
            .is_some()
        || settings
            .gamma
            .filter(|v| v.is_finite() && (*v - 1.0).abs() > 1e-4)
            .is_some();

    let has_fps = settings.fps.unwrap_or(0) > 0;
    let has_sub = settings
        .subtitle_path
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .is_some();
    let has_rotate = settings
        .rotate
        .as_deref()
        .map(str::trim)
        .filter(|r| matches!(*r, "90" | "180" | "270"))
        .is_some();
    let has_speed = settings
        .speed
        .filter(|v| v.is_finite() && (*v - 1.0).abs() >= 0.01)
        .is_some();

    has_crop
        || has_scale
        || has_eq
        || settings.hdr_to_sdr
        || has_fps
        || has_sub
        || settings.grayscale
        || settings.denoise
        || settings.sharpen
        || has_rotate
        || has_speed
}

fn resolve_cpu_encoder(codec: &str, hw: &HardwareProfile) -> (PipelineTier, &'static str) {
    match codec {
        "AV1" => {
            if hw.available_encoders.iter().any(|e| e == "libsvtav1") {
                (PipelineTier::Cpu, "libsvtav1")
            } else if hw.available_encoders.iter().any(|e| e == "libaom-av1") {
                (PipelineTier::Cpu, "libaom-av1")
            } else {
                (PipelineTier::Cpu, "libx264")
            }
        }
        "VP9" => (PipelineTier::Cpu, "libvpx-vp9"),
        "H.265" => (PipelineTier::Cpu, "libx265"),
        _ => (PipelineTier::Cpu, "libx264"),
    }
}

fn resolve_video_encoder(
    codec: &str,
    accel_mode: &str,
    hw: &HardwareProfile,
) -> (PipelineTier, &'static str) {
    let has = |name: &str| hw.available_encoders.iter().any(|e| e == name);

    match accel_mode {
        "nvidia" => match codec {
            "AV1" if has("av1_nvenc") => (PipelineTier::Tier1, "av1_nvenc"),
            "H.265" if has("hevc_nvenc") => (PipelineTier::Tier1, "hevc_nvenc"),
            "VP9" => resolve_cpu_encoder(codec, hw),
            _ if has("h264_nvenc") => (PipelineTier::Tier1, "h264_nvenc"),
            _ => resolve_cpu_encoder(codec, hw),
        },
        "amd" => match codec {
            "AV1" if has("av1_amf") => (PipelineTier::Tier2, "av1_amf"),
            "H.265" if has("hevc_amf") => (PipelineTier::Tier2, "hevc_amf"),
            "VP9" => resolve_cpu_encoder(codec, hw),
            _ if has("h264_amf") => (PipelineTier::Tier2, "h264_amf"),
            _ => resolve_cpu_encoder(codec, hw),
        },
        "intel" => match codec {
            "AV1" if has("av1_qsv") => (PipelineTier::Tier1, "av1_qsv"),
            "H.265" if has("hevc_qsv") => (PipelineTier::Tier1, "hevc_qsv"),
            "VP9" if has("vp9_qsv") => (PipelineTier::Tier1, "vp9_qsv"),
            _ if has("h264_qsv") => (PipelineTier::Tier1, "h264_qsv"),
            _ => resolve_cpu_encoder(codec, hw),
        },
        "auto" => match codec {
            "AV1" => {
                if has("av1_nvenc") {
                    (PipelineTier::Tier1, "av1_nvenc")
                } else if has("av1_amf") {
                    (PipelineTier::Tier2, "av1_amf")
                } else if has("av1_qsv") {
                    (PipelineTier::Tier1, "av1_qsv")
                } else {
                    resolve_cpu_encoder(codec, hw)
                }
            }
            "VP9" => {
                if has("vp9_qsv") {
                    (PipelineTier::Tier1, "vp9_qsv")
                } else {
                    resolve_cpu_encoder(codec, hw)
                }
            }
            "H.265" => {
                if has("hevc_nvenc") {
                    (PipelineTier::Tier1, "hevc_nvenc")
                } else if has("hevc_amf") {
                    (PipelineTier::Tier2, "hevc_amf")
                } else if has("hevc_qsv") {
                    (PipelineTier::Tier1, "hevc_qsv")
                } else {
                    (PipelineTier::Cpu, "libx265")
                }
            }
            _ => {
                if has("h264_nvenc") {
                    (PipelineTier::Tier1, "h264_nvenc")
                } else if has("h264_amf") {
                    (PipelineTier::Tier2, "h264_amf")
                } else if has("h264_qsv") {
                    (PipelineTier::Tier1, "h264_qsv")
                } else {
                    (PipelineTier::Cpu, "libx264")
                }
            }
        },
        _ => resolve_cpu_encoder(codec, hw),
    }
}

async fn get_or_probe_hardware(state: &AppState) -> HardwareProfile {
    if let Some(hw) = state.hardware.lock().clone() {
        return hw;
    }

    let _probe_guard = state.probe_lock.lock().await;
    if let Some(hw) = state.hardware.lock().clone() {
        return hw;
    }

    let hw = HardwareProber::probe(false).await;
    *state.hardware.lock() = Some(hw.clone());
    hw
}

#[tauri::command]
pub async fn probe_hardware(
    force_refresh: Option<bool>,
    state: State<'_, AppState>,
) -> Result<HardwareProfile, AppError> {
    let force = force_refresh.unwrap_or(false);
    let _probe_guard = state.probe_lock.lock().await;

    if !force {
        if let Some(hw) = state.hardware.lock().clone() {
            return Ok(hw);
        }
    }

    let hw = HardwareProber::probe(force).await;
    *state.hardware.lock() = Some(hw.clone());

    let app_settings = SettingsStore::load().await;
    state.scheduler.reconfigure(
        hw.recommended_gpu_slots.max(1),
        hw.cpu_count,
        app_settings.max_parallel_jobs,
        &app_settings.parallel_mode,
    );

    Ok(hw)
}

#[tauri::command]
pub async fn probe_media_file(path: String) -> Result<MediaFileInfo, AppError> {
    let p = PathBuf::from(&path);
    FFmpegEngine::probe_file(&p).await
}

#[tauri::command]
pub async fn start_video_conversion(
    input_path: String,
    settings: VideoConversionSettings,
    job_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    FFmpegEngine::validate_video_settings(&settings)?;

    let in_path = PathBuf::from(&input_path);
    if !in_path.is_file() {
        return Err(AppError::FileNotFound(input_path));
    }

    let ffmpeg_path = FFmpegEngine::find_binary("ffmpeg")?;
    let target_dir = resolve_target_dir(&settings.output_dir).await;

    let cancel_token = state.scheduler.register_job(&job_id)?;
    let _job_guard = ActiveJobGuard::new(state.scheduler.clone(), &job_id);

    let file_stem = in_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output");
    let target_ext = settings.format.trim().to_ascii_lowercase();
    let final_filename = format!("{}.{}", file_stem, target_ext);

    let hw = get_or_probe_hardware(&state).await;

    let probe_info = FFmpegEngine::probe_file(&in_path).await.ok();
    let duration_secs = probe_info.as_ref().map(|p| p.duration_secs).unwrap_or(0.0);
    let source_bytes = probe_info
        .as_ref()
        .map(|p| p.size_bytes)
        .filter(|&s| s > 0)
        .unwrap_or_else(|| std::fs::metadata(&in_path).map(|m| m.len()).unwrap_or(0));

    let mut settings = settings;
    if settings.source_audio_codec.is_none() {
        settings.source_audio_codec = probe_info.as_ref().and_then(|p| p.audio_codec.clone());
    }

    let is_prores = target_ext == "mov" && settings.codec.to_ascii_lowercase().contains("prores");
    let (tier, encoder_name) = if settings.copy_streams {
        (PipelineTier::Copy, "copy")
    } else if target_ext == "gif" {
        (PipelineTier::Cpu, "gif")
    } else if is_prores {
        (PipelineTier::Cpu, "prores_ks")
    } else {
        let (mut resolved_tier, enc) =
            resolve_video_encoder(&settings.codec, &settings.accel_mode, &hw);
        if resolved_tier == PipelineTier::Tier1 && has_cpu_filters(&settings) {
            resolved_tier = PipelineTier::Tier2;
        }
        (resolved_tier, enc)
    };

    let permit = state
        .scheduler
        .acquire_permit_cancellable(MediaKind::Video, tier, &cancel_token)
        .await?;

    let dummy_output = target_dir.join(&final_filename);
    let args =
        FFmpegEngine::build_video_args(&in_path, &dummy_output, &settings, tier, encoder_name);

    let result = ProcessRunner::run_ffmpeg_conversion(FfmpegConversionJob {
        ffmpeg_path: &ffmpeg_path,
        args: &args,
        target_dir: &target_dir,
        final_filename: &final_filename,
        job_id: &job_id,
        total_duration_secs: duration_secs,
        cancel_token: cancel_token.clone(),
        pending_updates: Arc::clone(&state.pending_updates),
    })
    .await;

    match result {
        Ok((path, speed)) => {
            record_history_entry(
                &job_id,
                &in_path,
                Some(&path),
                &final_filename,
                source_bytes,
                duration_secs,
                &target_ext,
                speed,
                "completed",
                settings.privacy_wipe,
            )
            .await;
            Ok(path.to_string_lossy().to_string())
        }
        Err(AppError::FfmpegExecutionError { .. })
            if matches!(tier, PipelineTier::Tier1 | PipelineTier::Tier2) =>
        {
            if cancel_token.is_cancelled() {
                return Err(AppError::JobCancelled);
            }

            // Release GPU permit BEFORE acquiring CPU permit to prevent deadlock/starvation
            drop(permit);

            let _cpu_permit = state
                .scheduler
                .acquire_permit_cancellable(MediaKind::Video, PipelineTier::Cpu, &cancel_token)
                .await?;

            let (_, cpu_encoder) = resolve_cpu_encoder(&settings.codec, &hw);
            AppLogger::warn(
                "commands",
                &format!(
                    "Job '{}' GPU encoder '{}' failed; falling back to CPU encoder '{}'",
                    job_id, encoder_name, cpu_encoder
                ),
            );
            let _ = app.emit("job_gpu_fallback", &job_id);

            let cpu_args = FFmpegEngine::build_video_args(
                &in_path,
                &dummy_output,
                &settings,
                PipelineTier::Cpu,
                cpu_encoder,
            );
            let cpu_result = ProcessRunner::run_ffmpeg_conversion(FfmpegConversionJob {
                ffmpeg_path: &ffmpeg_path,
                args: &cpu_args,
                target_dir: &target_dir,
                final_filename: &final_filename,
                job_id: &job_id,
                total_duration_secs: duration_secs,
                cancel_token,
                pending_updates: Arc::clone(&state.pending_updates),
            })
            .await;

            match cpu_result {
                Ok((path, speed)) => {
                    record_history_entry(
                        &job_id,
                        &in_path,
                        Some(&path),
                        &final_filename,
                        source_bytes,
                        duration_secs,
                        &target_ext,
                        speed,
                        "completed",
                        settings.privacy_wipe,
                    )
                    .await;
                    Ok(path.to_string_lossy().to_string())
                }
                Err(AppError::JobCancelled) => Err(AppError::JobCancelled),
                Err(err) => {
                    record_history_entry(
                        &job_id,
                        &in_path,
                        None,
                        &final_filename,
                        source_bytes,
                        duration_secs,
                        &target_ext,
                        0.0,
                        "failed",
                        settings.privacy_wipe,
                    )
                    .await;
                    Err(err)
                }
            }
        }
        Err(AppError::JobCancelled) => Err(AppError::JobCancelled),
        Err(err) => {
            record_history_entry(
                &job_id,
                &in_path,
                None,
                &final_filename,
                source_bytes,
                duration_secs,
                &target_ext,
                0.0,
                "failed",
                settings.privacy_wipe,
            )
            .await;
            Err(err)
        }
    }
}

#[tauri::command]
pub async fn start_audio_conversion(
    input_path: String,
    settings: AudioConversionSettings,
    job_id: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    FFmpegEngine::validate_audio_settings(&settings)?;

    let in_path = PathBuf::from(&input_path);
    if !in_path.is_file() {
        return Err(AppError::FileNotFound(input_path));
    }

    let ffmpeg_path = FFmpegEngine::find_binary("ffmpeg")?;
    let target_dir = resolve_target_dir(&settings.output_dir).await;

    let cancel_token = state.scheduler.register_job(&job_id)?;
    let _job_guard = ActiveJobGuard::new(state.scheduler.clone(), &job_id);

    let file_stem = in_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("audio");
    let target_fmt = settings.format.trim().to_ascii_lowercase();
    let ext = match target_fmt.as_str() {
        "alac" => "m4a",
        other => other,
    };
    let final_filename = format!("{}.{}", file_stem, ext);

    let probe_info = FFmpegEngine::probe_file(&in_path).await.ok();
    let duration_secs = probe_info.as_ref().map(|p| p.duration_secs).unwrap_or(0.0);
    let source_bytes = probe_info
        .as_ref()
        .map(|p| p.size_bytes)
        .filter(|&s| s > 0)
        .unwrap_or_else(|| std::fs::metadata(&in_path).map(|m| m.len()).unwrap_or(0));

    let _permit = state
        .scheduler
        .acquire_permit_cancellable(MediaKind::Audio, PipelineTier::Cpu, &cancel_token)
        .await?;

    let dummy_output = target_dir.join(&final_filename);
    let args = FFmpegEngine::build_audio_args(&in_path, &dummy_output, &settings);

    let result = ProcessRunner::run_ffmpeg_conversion(FfmpegConversionJob {
        ffmpeg_path: &ffmpeg_path,
        args: &args,
        target_dir: &target_dir,
        final_filename: &final_filename,
        job_id: &job_id,
        total_duration_secs: duration_secs,
        cancel_token,
        pending_updates: Arc::clone(&state.pending_updates),
    })
    .await;

    match result {
        Ok((path, speed)) => {
            record_history_entry(
                &job_id,
                &in_path,
                Some(&path),
                &final_filename,
                source_bytes,
                duration_secs,
                &target_fmt,
                speed,
                "completed",
                settings.privacy_wipe,
            )
            .await;
            Ok(path.to_string_lossy().to_string())
        }
        Err(AppError::JobCancelled) => Err(AppError::JobCancelled),
        Err(err) => {
            record_history_entry(
                &job_id,
                &in_path,
                None,
                &final_filename,
                source_bytes,
                duration_secs,
                &target_fmt,
                0.0,
                "failed",
                settings.privacy_wipe,
            )
            .await;
            Err(err)
        }
    }
}

#[tauri::command]
pub async fn start_image_conversion(
    input_path: String,
    settings: ImageConversionSettings,
    job_id: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    ImageEngine::validate_image_settings(&settings)?;

    let in_path = PathBuf::from(&input_path);
    if !in_path.is_file() {
        return Err(AppError::FileNotFound(input_path));
    }

    let target_dir = resolve_target_dir(&settings.output_dir).await;
    let cancel_token = state.scheduler.register_job(&job_id)?;
    let _job_guard = ActiveJobGuard::new(state.scheduler.clone(), &job_id);

    let in_size = tokio::fs::metadata(&in_path)
        .await
        .map(|m| m.len())
        .unwrap_or(0);
    let file_stem = in_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("image")
        .to_string();
    let target_ext = match settings.format.trim().to_ascii_lowercase().as_str() {
        "tif" => "tiff".to_string(),
        other => other.to_string(),
    };
    let final_filename = format!("{}.{}", file_stem, target_ext);

    let _permit = state
        .scheduler
        .acquire_permit_cancellable(MediaKind::Image, PipelineTier::Cpu, &cancel_token)
        .await?;

    let res = ImageEngine::convert_image(
        in_path.clone(),
        target_dir,
        settings,
        job_id.clone(),
        cancel_token,
        Arc::clone(&state.pending_updates),
    )
    .await;

    match res {
        Ok(path) => {
            record_history_entry(
                &job_id,
                &in_path,
                Some(&path),
                &final_filename,
                in_size,
                0.0,
                &target_ext,
                1.0,
                "completed",
                false,
            )
            .await;
            Ok(path.to_string_lossy().to_string())
        }
        Err(AppError::JobCancelled) => Err(AppError::JobCancelled),
        Err(err) => {
            record_history_entry(
                &job_id,
                &in_path,
                None,
                &final_filename,
                in_size,
                0.0,
                &target_ext,
                0.0,
                "failed",
                false,
            )
            .await;
            Err(err)
        }
    }
}

#[tauri::command]
pub fn cancel_job(job_id: String, state: State<'_, AppState>) -> bool {
    state.scheduler.cancel_job(&job_id)
}

#[tauri::command]
pub fn cancel_all_jobs(state: State<'_, AppState>) {
    state.scheduler.cancel_all();
}

#[tauri::command]
pub async fn load_settings() -> AppSettings {
    SettingsStore::load().await
}

#[tauri::command]
pub async fn save_settings(
    settings: AppSettings,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    SettingsStore::save(&settings).await?;

    let (gpu_slots, cpu_count) = {
        let guard = state.hardware.lock();
        match *guard {
            Some(ref hw) => (hw.recommended_gpu_slots.max(1), hw.cpu_count),
            None => (1, num_cpus::get()),
        }
    };
    state.scheduler.reconfigure(
        gpu_slots,
        cpu_count,
        settings.max_parallel_jobs,
        &settings.parallel_mode,
    );

    Ok(())
}

fn validate_local_folder_arg(trimmed: &str) -> Result<(), AppError> {
    if trimmed.starts_with("\\\\") || trimmed.starts_with("//") {
        return Err(AppError::SecurityViolation(
            "UNC network paths are not permitted in open_output_folder".into(),
        ));
    }
    if trimmed.contains("://") {
        return Err(AppError::SecurityViolation(
            "URL schemes are not permitted in open_output_folder".into(),
        ));
    }
    for (idx, _) in trimmed.match_indices(':') {
        if idx != 1
            || !trimmed
                .as_bytes()
                .first()
                .map(|b| b.is_ascii_alphabetic())
                .unwrap_or(false)
        {
            return Err(AppError::SecurityViolation(
                "Invalid path scheme or colon in open_output_folder".into(),
            ));
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn open_output_folder(path: String) -> Result<(), AppError> {
    let trimmed = path.trim();
    validate_local_folder_arg(trimmed)?;

    let target = if trimmed.is_empty() || trimmed == "." {
        let default_dir = PathBuf::from(SettingsStore::load().await.output_dir);
        tokio::fs::create_dir_all(&default_dir)
            .await
            .map_err(|e| AppError::Io {
                message: format!("Failed to create output directory: {}", e),
                path: Some(default_dir.to_string_lossy().to_string()),
            })?;
        default_dir
    } else {
        PathBuf::from(trimmed)
    };

    #[cfg(target_os = "windows")]
    {
        if target.is_file() {
            let canon = dunce::canonicalize(&target).map_err(|e| AppError::Io {
                message: format!("Failed to resolve output file path: {}", e),
                path: Some(target.to_string_lossy().to_string()),
            })?;
            let canon_str = canon.to_string_lossy().to_string();
            if canon_str.starts_with("\\\\") {
                return Err(AppError::SecurityViolation(
                    "UNC network paths are not permitted".into(),
                ));
            }
            std::process::Command::new("explorer.exe")
                .arg(format!("/select,{}", canon_str))
                .spawn()
                .map_err(|e| AppError::Io {
                    message: format!("Failed to launch Explorer: {}", e),
                    path: Some(canon_str),
                })?;
        } else {
            let dir_to_open = if target.is_dir() {
                target
            } else if let Some(parent) = target.parent().filter(|p| p.is_dir()) {
                parent.to_path_buf()
            } else {
                return Err(AppError::FileNotFound(target.to_string_lossy().to_string()));
            };

            let canon = dunce::canonicalize(&dir_to_open).map_err(|e| AppError::Io {
                message: format!("Failed to resolve output folder path: {}", e),
                path: Some(dir_to_open.to_string_lossy().to_string()),
            })?;
            let canon_str = canon.to_string_lossy().to_string();
            if canon_str.starts_with("\\\\") {
                return Err(AppError::SecurityViolation(
                    "UNC network paths are not permitted".into(),
                ));
            }
            std::process::Command::new("explorer.exe")
                .arg(&canon_str)
                .spawn()
                .map_err(|e| AppError::Io {
                    message: format!("Failed to launch Explorer: {}", e),
                    path: Some(canon_str),
                })?;
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = target;
    }

    Ok(())
}

#[tauri::command]
pub fn set_sleep_prevention(enable: bool) {
    #[cfg(target_os = "windows")]
    {
        let tx = SLEEP_PREVENTION_TX.get_or_init(|| {
            let (tx, rx) = std::sync::mpsc::channel::<bool>();
            let spawn_res = std::thread::Builder::new()
                .name("galaxy-sleep-prevention".into())
                .spawn(move || {
                    #[link(name = "kernel32")]
                    extern "system" {
                        fn SetThreadExecutionState(esflags: u32) -> u32;
                    }
                    const ES_SYSTEM_REQUIRED: u32 = 0x0000_0001;
                    const ES_AWAYMODE_REQUIRED: u32 = 0x0000_0040;
                    const ES_CONTINUOUS: u32 = 0x8000_0000;

                    while let Ok(active) = rx.recv() {
                        unsafe {
                            if active {
                                SetThreadExecutionState(
                                    ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_AWAYMODE_REQUIRED,
                                );
                            } else {
                                SetThreadExecutionState(ES_CONTINUOUS);
                            }
                        }
                    }
                });
            if let Err(err) = spawn_res {
                AppLogger::warn(
                    "commands",
                    &format!("Failed to start sleep prevention thread: {}", err),
                );
            }
            tx
        });
        let _ = tx.send(enable);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = enable;
    }
}

#[tauri::command]
pub async fn scan_directory(dir_path: String) -> Result<Vec<String>, AppError> {
    let root = PathBuf::from(&dir_path);
    if !root.is_dir() {
        return Err(AppError::FileNotFound(dir_path));
    }

    let mut matched_files = Vec::new();
    let mut dirs_to_visit = vec![(root, 0usize)];
    let mut visited_dirs = HashSet::new();

    const MAX_SCAN_DEPTH: usize = 16;

    while let Some((current_dir, depth)) = dirs_to_visit.pop() {
        if depth > MAX_SCAN_DEPTH {
            continue;
        }

        let canonical = match dunce::canonicalize(&current_dir) {
            Ok(c) => c,
            Err(_) => continue,
        };

        if !visited_dirs.insert(canonical) {
            continue;
        }

        if let Ok(mut entries) = tokio::fs::read_dir(&current_dir).await {
            while let Ok(Some(entry)) = entries.next_entry().await {
                let path = entry.path();
                let file_type = match entry.file_type().await {
                    Ok(ft) => ft,
                    Err(_) => continue,
                };

                if file_type.is_file() {
                    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                        if ALL_SUPPORTED_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()) {
                            matched_files.push(path.to_string_lossy().to_string());
                        }
                    }
                } else if file_type.is_dir() && !file_type.is_symlink() && depth < MAX_SCAN_DEPTH {
                    dirs_to_visit.push((path, depth + 1));
                }
            }
        }
    }

    matched_files.sort();
    Ok(matched_files)
}

// Phase 6: Custom Presets Engine
#[tauri::command]
pub async fn get_custom_presets() -> Vec<CustomPreset> {
    PresetsStore::load().await
}

#[tauri::command]
pub async fn save_custom_preset(preset: CustomPreset) -> Result<(), AppError> {
    PresetsStore::add_or_update(preset).await
}

#[tauri::command]
pub async fn delete_custom_preset(id: String) -> Result<(), AppError> {
    PresetsStore::delete(&id).await
}

#[tauri::command]
pub async fn export_presets(target_path: String) -> Result<(), AppError> {
    let p = PathBuf::from(&target_path);
    PresetsStore::export_to_file(&p).await
}

#[tauri::command]
pub async fn import_presets(source_path: String) -> Result<Vec<CustomPreset>, AppError> {
    let p = PathBuf::from(&source_path);
    PresetsStore::import_from_file(&p).await
}

// Phase 7: History & Analytics
#[tauri::command]
pub async fn get_conversion_history() -> Vec<HistoryEntry> {
    HistoryStore::load().await
}

#[tauri::command]
pub async fn delete_history_entry(id: String) -> Result<bool, AppError> {
    HistoryStore::delete_entry(&id).await
}

#[tauri::command]
pub async fn clear_conversion_history() -> Result<(), AppError> {
    HistoryStore::clear().await
}

#[tauri::command]
pub async fn get_history_summary() -> HistorySummary {
    HistoryStore::get_summary().await
}

#[tauri::command]
pub async fn export_history_csv(target_path: String) -> Result<(), AppError> {
    let p = PathBuf::from(&target_path);
    HistoryStore::export_csv(&p).await
}

// Logging Commands
#[tauri::command]
pub fn get_recent_logs(max_lines: Option<usize>) -> Vec<String> {
    AppLogger::read_recent_logs(max_lines.unwrap_or(200).clamp(1, 2000))
}

#[tauri::command]
pub fn clear_old_logs() -> Result<usize, AppError> {
    AppLogger::clear_old_logs()
}

// Phase 8: Duplicate Scanner
#[tauri::command]
pub async fn scan_duplicate_media(
    dir_path: String,
    state: State<'_, AppState>,
) -> Result<Vec<DuplicateGroup>, AppError> {
    let groups = DuplicateScanner::scan_directory(&dir_path).await?;
    let mut verified = state.verified_duplicates.lock();
    verified.clear();
    for group in &groups {
        for file in &group.files {
            if let Ok(canon) = dunce::canonicalize(&file.path) {
                verified.insert(canon);
            }
        }
    }
    Ok(groups)
}

// Phase 5: Persian Subtitle Charset Fixer
#[tauri::command]
pub async fn fix_subtitle_charset(file_path: String) -> Result<String, AppError> {
    let p = PathBuf::from(&file_path);
    let out = SubtitleFixer::fix_subtitle_file(&p).await?;
    Ok(out.to_string_lossy().to_string())
}

// Phase 3: Social Splitter
#[tauri::command]
pub async fn split_social_video(
    input_path: String,
    segment_duration: u32,
    overlap_seconds: u32,
    blur_background: bool,
    output_dir: String,
) -> Result<Vec<String>, AppError> {
    let in_p = PathBuf::from(&input_path);
    if !in_p.is_file() {
        return Err(AppError::FileNotFound(input_path));
    }
    let out_dir = if output_dir.trim().is_empty() {
        match in_p.parent().filter(|p| !p.as_os_str().is_empty()) {
            Some(parent) => parent.to_path_buf(),
            None => PathBuf::from(SettingsStore::load().await.output_dir),
        }
    } else {
        PathBuf::from(output_dir.trim())
    };
    SocialSplitter::split_video(
        &in_p,
        segment_duration,
        overlap_seconds,
        blur_background,
        &out_dir,
        CancellationToken::new(),
    )
    .await
}

// Phase 9: Disk Space Guard
#[tauri::command]
pub fn check_disk_space(
    target_path: String,
    estimated_bytes: u64,
) -> Result<DiskSpaceInfo, AppError> {
    let p = PathBuf::from(&target_path);
    Ok(crate::fs_guard::check_disk_space(&p, estimated_bytes))
}

#[tauri::command]
pub async fn delete_file(file_path: String, state: State<'_, AppState>) -> Result<(), AppError> {
    let canon =
        dunce::canonicalize(&file_path).map_err(|_| AppError::FileNotFound(file_path.clone()))?;

    let is_verified = {
        let verified = state.verified_duplicates.lock();
        verified.contains(&canon)
    };

    let ext_allowed = canon
        .extension()
        .and_then(|e| e.to_str())
        .map(|ext| ALL_SUPPORTED_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
        .unwrap_or(false);

    if !is_verified || !canon.is_file() || !ext_allowed {
        return Err(AppError::SecurityViolation(
            "Only verified duplicate media files from an active scan may be deleted".into(),
        ));
    }

    tokio::fs::remove_file(&canon)
        .await
        .map_err(|e| AppError::Io {
            message: format!("Failed to delete file: {}", e),
            path: Some(canon.to_string_lossy().to_string()),
        })?;

    state.verified_duplicates.lock().remove(&canon);
    Ok(())
}

async fn run_guarded_ffmpeg_extract(
    ffmpeg_path: &Path,
    args: &[String],
    target_dir: &Path,
    filename: &str,
    job_id: &str,
) -> Result<PathBuf, AppError> {
    let mut guard = OutputFileGuard::new(target_dir, filename, job_id).await?;
    let temp_path = guard.temp_path.clone();

    let mut cmd = Command::new(ffmpeg_path);
    cmd.args(args);
    cmd.arg(&temp_path);
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::null());
    cmd.stderr(Stdio::piped());
    cmd.kill_on_drop(true);

    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(0x08000000 | 0x00004000);
    }

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            guard.abort_cleanup().await;
            return Err(AppError::Io {
                message: format!("Failed to spawn FFmpeg extraction process: {}", e),
                path: Some(temp_path.to_string_lossy().to_string()),
            });
        }
    };

    attach_to_job_object(&child);

    let stderr = child.stderr.take();
    let stderr_task = tauri::async_runtime::spawn(async move {
        let mut buf = Vec::new();
        if let Some(mut se) = stderr {
            use tokio::io::AsyncReadExt;
            let _ = se.read_to_end(&mut buf).await;
        }
        String::from_utf8_lossy(&buf).to_string()
    });

    let status = match child.wait().await {
        Ok(s) => s,
        Err(e) => {
            let _ = stderr_task.await;
            let _ = child.kill().await;
            let _ = child.wait().await;
            guard.abort_cleanup().await;
            return Err(AppError::Io {
                message: format!("Failed waiting for FFmpeg extraction process: {}", e),
                path: Some(temp_path.to_string_lossy().to_string()),
            });
        }
    };

    let stderr_text = stderr_task.await.unwrap_or_default();

    if !status.success() {
        guard.abort_cleanup().await;
        let _ = Duration::from_millis(CANCELLATION_GRACE_PERIOD_MS);
        let tail = stderr_text
            .lines()
            .rev()
            .take(5)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join("\n");
        return Err(AppError::FfmpegExecutionError {
            exit_code: status.code(),
            last_error_log: tail,
        });
    }

    guard.commit().await
}

fn audio_extension_for_codec(codec: &str) -> Option<&'static str> {
    match codec.trim().to_ascii_lowercase().as_str() {
        "aac" | "alac" => Some("m4a"),
        "mp3" | "mp2" => Some("mp3"),
        "opus" => Some("opus"),
        "vorbis" => Some("ogg"),
        "flac" => Some("flac"),
        "wmav2" | "wmapro" | "wmav1" => Some("wma"),
        c if c.starts_with("pcm_") => Some("wav"),
        _ => None,
    }
}

#[tauri::command]
pub async fn extract_audio_stream(
    input_path: String,
    output_dir: String,
) -> Result<String, AppError> {
    let in_path = PathBuf::from(&input_path);
    if !in_path.is_file() {
        return Err(AppError::FileNotFound(input_path));
    }

    let target_dir = if output_dir.trim().is_empty() {
        match in_path.parent().filter(|p| !p.as_os_str().is_empty()) {
            Some(parent) => parent.to_path_buf(),
            None => PathBuf::from(SettingsStore::load().await.output_dir),
        }
    } else {
        PathBuf::from(output_dir.trim())
    };

    let probe = FFmpegEngine::probe_file(&in_path).await?;
    let Some(ref audio_codec) = probe.audio_codec else {
        return Err(AppError::Validation(
            "Input media file does not contain an audio stream".into(),
        ));
    };

    let ffmpeg_path = FFmpegEngine::find_binary("ffmpeg")?;
    let stem = in_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("audio");
    let seq = EXTRACT_SEQ.fetch_add(1, Ordering::Relaxed);
    let in_lossy = in_path.to_string_lossy().to_string();

    if let Some(ext) = audio_extension_for_codec(audio_codec) {
        let filename = format!("{}_extracted_audio.{}", stem, ext);
        let job_id = format!("extract_aud_{}_{}", std::process::id(), seq);
        let copy_args = vec![
            "-hide_banner".to_string(),
            "-y".to_string(),
            "-i".to_string(),
            in_lossy.clone(),
            "-vn".to_string(),
            "-c:a".to_string(),
            "copy".to_string(),
        ];

        if let Ok(committed) =
            run_guarded_ffmpeg_extract(&ffmpeg_path, &copy_args, &target_dir, &filename, &job_id)
                .await
        {
            return Ok(committed.to_string_lossy().to_string());
        }
    }

    // Re-encode fallback to AAC (.m4a) when codec cannot be stream-copied directly
    let fallback_filename = format!("{}_extracted_audio.m4a", stem);
    let fallback_job_id = format!("extract_aud_fb_{}_{}", std::process::id(), seq);
    let fallback_args = vec![
        "-hide_banner".to_string(),
        "-y".to_string(),
        "-i".to_string(),
        in_lossy,
        "-vn".to_string(),
        "-c:a".to_string(),
        "aac".to_string(),
        "-b:a".to_string(),
        "192k".to_string(),
    ];

    let committed = run_guarded_ffmpeg_extract(
        &ffmpeg_path,
        &fallback_args,
        &target_dir,
        &fallback_filename,
        &fallback_job_id,
    )
    .await?;

    Ok(committed.to_string_lossy().to_string())
}

fn is_bitmap_subtitle_codec(codec: &str) -> bool {
    matches!(
        codec.trim().to_ascii_lowercase().as_str(),
        "hdmv_pgs_subtitle"
            | "pgs"
            | "pgssub"
            | "dvd_subtitle"
            | "dvdsub"
            | "dvb_subtitle"
            | "dvbsub"
            | "xsub"
            | "vobsub"
    )
}

async fn probe_subtitle_codecs(input_path: &Path) -> Result<Vec<String>, AppError> {
    if let Ok(ffprobe_path) = FFmpegEngine::find_binary("ffprobe") {
        let mut cmd = Command::new(&ffprobe_path);
        cmd.args([
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_streams",
            "-select_streams",
            "s",
            "--",
        ]);
        cmd.arg(input_path);
        cmd.stdin(Stdio::null());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::null());
        cmd.kill_on_drop(true);
        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x08000000 | 0x00004000);

        if let Ok(Ok(output)) =
            tokio::time::timeout(Duration::from_secs(SUBPROCESS_TIMEOUT_SECS), cmd.output()).await
        {
            if output.status.success() {
                let text = String::from_utf8_lossy(&output.stdout);
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                    let mut codecs = Vec::new();
                    if let Some(streams) = json.get("streams").and_then(|s| s.as_array()) {
                        for st in streams {
                            if let Some(name) = st.get("codec_name").and_then(|c| c.as_str()) {
                                codecs.push(name.to_string());
                            }
                        }
                    }
                    return Ok(codecs);
                }
            }
        }
    }

    // Fallback via `ffmpeg -i` stderr parsing
    let ffmpeg_path = FFmpegEngine::find_binary("ffmpeg")?;
    let mut cmd = Command::new(&ffmpeg_path);
    cmd.args(["-hide_banner", "-i", "--"]);
    cmd.arg(input_path);
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::null());
    cmd.stderr(Stdio::piped());
    cmd.kill_on_drop(true);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000 | 0x00004000);

    let output = tokio::time::timeout(Duration::from_secs(SUBPROCESS_TIMEOUT_SECS), cmd.output())
        .await
        .map_err(|_| AppError::Internal("Subtitle stream probe timed out".into()))?
        .map_err(|e| AppError::Io {
            message: format!("Failed to probe subtitle stream: {}", e),
            path: Some(input_path.to_string_lossy().to_string()),
        })?;

    let stderr = String::from_utf8_lossy(&output.stderr);
    let mut codecs = Vec::new();
    for line in stderr.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("Stream #") {
            if let Some(idx) = trimmed.find("Subtitle:") {
                let rest = trimmed[idx + 9..].trim();
                if let Some(codec) = rest
                    .split(|c: char| c.is_whitespace() || c == ',' || c == '(')
                    .find(|s| !s.is_empty())
                {
                    codecs.push(codec.to_string());
                }
            }
        }
    }
    Ok(codecs)
}

#[tauri::command]
pub async fn extract_subtitle_stream(
    input_path: String,
    output_dir: String,
) -> Result<String, AppError> {
    let in_path = PathBuf::from(&input_path);
    if !in_path.is_file() {
        return Err(AppError::FileNotFound(input_path));
    }

    let sub_codecs = probe_subtitle_codecs(&in_path).await?;
    if sub_codecs.is_empty() {
        return Err(AppError::Validation(
            "Input media file does not contain any subtitle stream".into(),
        ));
    }

    let text_stream_pos = sub_codecs.iter().position(|c| !is_bitmap_subtitle_codec(c));
    let Some(sub_idx) = text_stream_pos else {
        return Err(AppError::Validation(format!(
            "Bitmap subtitle stream ('{}') cannot be extracted to SRT text format",
            sub_codecs[0]
        )));
    };

    let target_dir = if output_dir.trim().is_empty() {
        match in_path.parent().filter(|p| !p.as_os_str().is_empty()) {
            Some(parent) => parent.to_path_buf(),
            None => PathBuf::from(SettingsStore::load().await.output_dir),
        }
    } else {
        PathBuf::from(output_dir.trim())
    };

    let stem = in_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("subtitle");
    let final_filename = format!("{}_extracted_sub.srt", stem);
    let seq = EXTRACT_SEQ.fetch_add(1, Ordering::Relaxed);
    let job_id = format!("extract_sub_{}_{}", std::process::id(), seq);

    let ffmpeg_path = FFmpegEngine::find_binary("ffmpeg")?;
    let args = vec![
        "-hide_banner".to_string(),
        "-y".to_string(),
        "-i".to_string(),
        in_path.to_string_lossy().to_string(),
        "-map".to_string(),
        format!("0:s:{}", sub_idx),
        "-vn".to_string(),
        "-an".to_string(),
        "-c:s".to_string(),
        "srt".to_string(),
    ];

    let committed =
        run_guarded_ffmpeg_extract(&ffmpeg_path, &args, &target_dir, &final_filename, &job_id)
            .await?;

    Ok(committed.to_string_lossy().to_string())
}
