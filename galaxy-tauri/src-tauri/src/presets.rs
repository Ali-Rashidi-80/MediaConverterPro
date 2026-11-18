use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use tokio::fs;
use tokio::sync::Mutex;

use crate::constants::{LEGACY_APPDATA_DIR_NAME, PRESETS_FILE_NAME};
use crate::logging::AppLogger;
use crate::models::{AppError, CustomPreset};

const MAX_PRESETS_IMPORT_BYTES: u64 = 5 * 1024 * 1024;
const MAX_PRESETS_IMPORT_COUNT: usize = 500;

const ALLOWED_MEDIA_FORMATS: &[&str] = &[
    "mp4", "mkv", "mov", "webm", "avi", "gif", "mp3", "aac", "flac", "wav", "ogg", "opus", "m4a",
    "wma", "alac", "webp", "avif", "png", "jpeg", "jpg", "ico", "bmp", "tiff",
];

/// Async mutex serializing custom preset read-modify-write operations.
static PRESETS_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

/// Persistent storage manager for user-defined conversion presets.
pub struct PresetsStore;

impl PresetsStore {
    /// Returns the unified presets file path (`<app_data_dir>/presets.json`).
    pub fn presets_path() -> PathBuf {
        AppLogger::app_data_dir().join(PRESETS_FILE_NAME)
    }

    async fn save_all_unlocked(presets: &[CustomPreset]) -> Result<(), AppError> {
        let path = Self::presets_path();
        let json = serde_json::to_string_pretty(presets)
            .map_err(|e| AppError::Internal(format!("Failed to serialize presets: {}", e)))?;
        AppLogger::write_atomic(&path, json.as_bytes()).await
    }

    async fn load_unlocked() -> Vec<CustomPreset> {
        let path = Self::presets_path();

        if path.is_file() {
            match fs::read_to_string(&path).await {
                Ok(content) if !content.trim().is_empty() => {
                    match serde_json::from_str::<Vec<CustomPreset>>(&content) {
                        Ok(presets) => return presets,
                        Err(err) => {
                            AppLogger::backup_corrupt_file(&path, "presets", &err.to_string())
                                .await;
                            return Vec::new();
                        }
                    }
                }
                Ok(_) => return Vec::new(),
                Err(err) => {
                    AppLogger::warn(
                        "presets",
                        &format!("Failed to read presets file {:?}: {}", path, err),
                    );
                    return Vec::new();
                }
            }
        }

        if let Some(cfg_dir) = dirs::config_dir() {
            let legacy_path = cfg_dir
                .join(LEGACY_APPDATA_DIR_NAME)
                .join(PRESETS_FILE_NAME);
            if legacy_path.is_file() {
                match fs::read_to_string(&legacy_path).await {
                    Ok(content) if !content.trim().is_empty() => {
                        match serde_json::from_str::<Vec<CustomPreset>>(&content) {
                            Ok(presets) => {
                                match Self::save_all_unlocked(&presets).await {
                                    Ok(()) => AppLogger::info(
                                        "presets",
                                        &format!(
                                            "Migrated {} legacy presets from {:?} to {:?}",
                                            presets.len(),
                                            legacy_path,
                                            path
                                        ),
                                    ),
                                    Err(err) => AppLogger::warn(
                                        "presets",
                                        &format!(
                                            "Loaded legacy presets from {:?}, but failed to persist migration: {}",
                                            legacy_path, err
                                        ),
                                    ),
                                }
                                return presets;
                            }
                            Err(err) => {
                                AppLogger::warn(
                                    "presets",
                                    &format!(
                                        "Legacy presets file {:?} is corrupt and was skipped: {}",
                                        legacy_path, err
                                    ),
                                );
                            }
                        }
                    }
                    Ok(_) => {}
                    Err(err) => {
                        AppLogger::warn(
                            "presets",
                            &format!(
                                "Failed to read legacy presets file {:?}: {}",
                                legacy_path, err
                            ),
                        );
                    }
                }
            }
        }

        Vec::new()
    }

    /// Loads all custom presets, migrating legacy presets if the primary file is absent.
    pub async fn load() -> Vec<CustomPreset> {
        let _guard = PRESETS_LOCK.lock().await;
        Self::load_unlocked().await
    }

    /// Atomically saves the provided preset list.
    pub async fn save_all(presets: &[CustomPreset]) -> Result<(), AppError> {
        let _guard = PRESETS_LOCK.lock().await;
        Self::save_all_unlocked(presets).await
    }

    /// Adds a new custom preset or replaces an existing preset with the same `id`.
    pub async fn add_or_update(preset: CustomPreset) -> Result<(), AppError> {
        if preset.id.trim().is_empty() || preset.name.trim().is_empty() {
            return Err(AppError::Validation(
                "Preset id and name must not be empty".into(),
            ));
        }

        let _guard = PRESETS_LOCK.lock().await;
        let mut list = Self::load_unlocked().await;
        if let Some(pos) = list.iter().position(|p| p.id == preset.id) {
            list[pos] = preset;
        } else {
            list.push(preset);
        }
        Self::save_all_unlocked(&list).await
    }

    /// Deletes a custom preset by `id`.
    pub async fn delete(id: &str) -> Result<(), AppError> {
        let _guard = PRESETS_LOCK.lock().await;
        let mut list = Self::load_unlocked().await;
        list.retain(|p| p.id != id);
        Self::save_all_unlocked(&list).await
    }

    fn strip_machine_local_paths(preset: &mut CustomPreset) {
        if let Some(ref mut vs) = preset.video_settings {
            vs.output_dir.clear();
            vs.subtitle_path = None;
        }
        if let Some(ref mut aus) = preset.audio_settings {
            aus.output_dir.clear();
        }
        if let Some(ref mut ims) = preset.image_settings {
            ims.output_dir.clear();
        }
    }

    fn is_safe_scale(scale: &str) -> bool {
        let trimmed = scale.trim();
        if trimmed.is_empty() {
            return true;
        }
        let lower = trimmed.to_ascii_lowercase();
        if matches!(
            lower.as_str(),
            "original" | "4k" | "2160p" | "1440p" | "1080p" | "720p" | "480p" | "360p"
        ) {
            return true;
        }

        let sep = if trimmed.contains(':') {
            ':'
        } else if trimmed.contains('x') {
            'x'
        } else if trimmed.contains('X') {
            'X'
        } else {
            return false;
        };

        let parts: Vec<&str> = trimmed.split(sep).collect();
        if parts.len() != 2 {
            return false;
        }

        parts.iter().all(|part| {
            *part == "-1"
                || *part == "-2"
                || (!part.is_empty() && part.len() <= 5 && part.bytes().all(|b| b.is_ascii_digit()))
        })
    }

    fn is_safe_crop(crop: &str) -> bool {
        let trimmed = crop.trim();
        if trimmed.is_empty() {
            return true;
        }
        let lower = trimmed.to_ascii_lowercase();
        if matches!(lower.as_str(), "none" | "original") {
            return true;
        }

        let parts: Vec<&str> = trimmed.split(':').collect();
        if parts.len() != 2 && parts.len() != 4 {
            return false;
        }

        parts.iter().all(|part| {
            !part.is_empty() && part.len() <= 6 && part.bytes().all(|b| b.is_ascii_digit())
        })
    }

    fn validate_and_sanitize_imported_preset(preset: &mut CustomPreset) -> Result<(), AppError> {
        if preset.id.trim().is_empty() || preset.name.trim().is_empty() {
            return Err(AppError::Validation(
                "Imported preset must contain a non-empty id and name".into(),
            ));
        }

        Self::strip_machine_local_paths(preset);

        if let Some(ref mut vs) = preset.video_settings {
            let normalized_fmt = vs.format.trim().to_ascii_lowercase();
            if !ALLOWED_MEDIA_FORMATS.contains(&normalized_fmt.as_str()) {
                return Err(AppError::Validation(format!(
                    "Unsupported video format '{}' in imported preset '{}'",
                    vs.format, preset.name
                )));
            }
            vs.format = normalized_fmt;

            if let Some(crf) = vs.crf {
                vs.crf = Some(crf.min(51));
            }
            if let Some(speed) = vs.speed {
                vs.speed = if speed.is_finite() {
                    Some(speed.clamp(0.25, 4.0))
                } else {
                    None
                };
            }
            if let Some(ref scale) = vs.scale {
                if !Self::is_safe_scale(scale) {
                    AppLogger::warn(
                        "presets",
                        &format!(
                            "Cleared unsafe scale '{}' from imported preset '{}'",
                            scale, preset.name
                        ),
                    );
                    vs.scale = None;
                }
            }
            if let Some(ref crop) = vs.crop {
                if !Self::is_safe_crop(crop) {
                    AppLogger::warn(
                        "presets",
                        &format!(
                            "Cleared unsafe crop '{}' from imported preset '{}'",
                            crop, preset.name
                        ),
                    );
                    vs.crop = None;
                }
            }
        }

        if let Some(ref mut aus) = preset.audio_settings {
            let normalized_fmt = aus.format.trim().to_ascii_lowercase();
            if !ALLOWED_MEDIA_FORMATS.contains(&normalized_fmt.as_str()) {
                return Err(AppError::Validation(format!(
                    "Unsupported audio format '{}' in imported preset '{}'",
                    aus.format, preset.name
                )));
            }
            aus.format = normalized_fmt;

            if let Some(vol) = aus.volume {
                aus.volume = Some(vol.clamp(0, 300));
            }
            if let Some(speed) = aus.speed {
                aus.speed = if speed.is_finite() {
                    Some(speed.clamp(0.25, 4.0))
                } else {
                    None
                };
            }
        }

        if let Some(ref mut ims) = preset.image_settings {
            let normalized_fmt = ims.format.trim().to_ascii_lowercase();
            if !ALLOWED_MEDIA_FORMATS.contains(&normalized_fmt.as_str()) {
                return Err(AppError::Validation(format!(
                    "Unsupported image format '{}' in imported preset '{}'",
                    ims.format, preset.name
                )));
            }
            ims.format = normalized_fmt;
            ims.quality = ims.quality.clamp(1, 100);
        }

        Ok(())
    }

    /// Exports all presets atomically, stripping machine-local `output_dir` and `subtitle_path`.
    pub async fn export_to_file(target_path: &Path) -> Result<(), AppError> {
        let mut list = Self::load().await;
        for preset in &mut list {
            Self::strip_machine_local_paths(preset);
        }

        let json = serde_json::to_string_pretty(&list).map_err(|e| {
            AppError::Internal(format!("Failed to serialize presets for export: {}", e))
        })?;
        AppLogger::write_atomic(target_path, json.as_bytes()).await
    }

    /// Imports presets from a JSON file after enforcing size/count limits and sanitizing parameters.
    pub async fn import_from_file(source_path: &Path) -> Result<Vec<CustomPreset>, AppError> {
        let meta = fs::metadata(source_path).await.map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                AppError::FileNotFound(source_path.to_string_lossy().to_string())
            } else {
                AppError::Io {
                    message: format!("Failed to inspect presets import file: {}", e),
                    path: Some(source_path.to_string_lossy().to_string()),
                }
            }
        })?;

        if meta.len() > MAX_PRESETS_IMPORT_BYTES {
            return Err(AppError::Validation(format!(
                "Presets import file exceeds 5 MiB limit ({} bytes)",
                meta.len()
            )));
        }

        let content = fs::read_to_string(source_path)
            .await
            .map_err(|e| AppError::Io {
                message: format!("Failed to read presets import file: {}", e),
                path: Some(source_path.to_string_lossy().to_string()),
            })?;

        if content.len() as u64 > MAX_PRESETS_IMPORT_BYTES {
            return Err(AppError::Validation(
                "Presets import content exceeds 5 MiB limit".into(),
            ));
        }

        let mut imported: Vec<CustomPreset> = serde_json::from_str(&content)
            .map_err(|e| AppError::Validation(format!("Invalid presets JSON schema: {}", e)))?;

        if imported.len() > MAX_PRESETS_IMPORT_COUNT {
            return Err(AppError::Validation(format!(
                "Presets file contains {} entries, exceeding limit of {}",
                imported.len(),
                MAX_PRESETS_IMPORT_COUNT
            )));
        }

        for preset in &mut imported {
            Self::validate_and_sanitize_imported_preset(preset)?;
        }

        let _guard = PRESETS_LOCK.lock().await;
        let mut existing = Self::load_unlocked().await;
        for item in imported {
            if let Some(pos) = existing.iter().position(|p| p.id == item.id) {
                existing[pos] = item;
            } else {
                existing.push(item);
            }
        }
        Self::save_all_unlocked(&existing).await?;
        Ok(existing)
    }
}
