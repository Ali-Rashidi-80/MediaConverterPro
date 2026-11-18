use std::path::PathBuf;
use std::sync::LazyLock;
use tokio::fs;
use tokio::sync::Mutex;

use crate::constants::{
    DEFAULT_OUTPUT_DIR_NAME, LEGACY_CONFIG_DIR_NAME, LEGACY_SETTINGS_FILE_NAME, SETTINGS_FILE_NAME,
};
use crate::logging::AppLogger;
use crate::models::{AppError, AppSettings};

/// Async mutex serializing settings reads, migrations, and atomic writes.
static SETTINGS_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

const VALID_LANGUAGES: &[&str] = &["fa", "en"];
const VALID_THEMES: &[&str] = &["dark", "light"];
const VALID_FONT_SCALES: &[&str] = &["small", "medium", "large"];
const VALID_PARALLEL_MODES: &[&str] = &["smart", "parallel", "sequential"];

/// Persistent storage manager for application settings.
pub struct SettingsStore;

impl SettingsStore {
    /// Returns the unified settings file path (`<app_data_dir>/settings.json`).
    pub fn settings_path() -> PathBuf {
        AppLogger::app_data_dir().join(SETTINGS_FILE_NAME)
    }

    /// Returns the default output directory path for converted media.
    pub fn default_output_dir() -> String {
        if let Some(desktop) = dirs::desktop_dir() {
            desktop
                .join(DEFAULT_OUTPUT_DIR_NAME)
                .to_string_lossy()
                .to_string()
        } else if let Some(home) = dirs::home_dir() {
            home.join(DEFAULT_OUTPUT_DIR_NAME)
                .to_string_lossy()
                .to_string()
        } else {
            DEFAULT_OUTPUT_DIR_NAME.to_string()
        }
    }

    fn validate_settings(settings: &AppSettings) -> Result<(), AppError> {
        if !VALID_LANGUAGES.contains(&settings.language.as_str()) {
            return Err(AppError::Validation(format!(
                "Invalid language '{}'; expected one of {:?}",
                settings.language, VALID_LANGUAGES
            )));
        }
        if !VALID_THEMES.contains(&settings.theme.as_str()) {
            return Err(AppError::Validation(format!(
                "Invalid theme '{}'; expected one of {:?}",
                settings.theme, VALID_THEMES
            )));
        }
        if !VALID_FONT_SCALES.contains(&settings.font_scale.as_str()) {
            return Err(AppError::Validation(format!(
                "Invalid font_scale '{}'; expected one of {:?}",
                settings.font_scale, VALID_FONT_SCALES
            )));
        }
        if !VALID_PARALLEL_MODES.contains(&settings.parallel_mode.as_str()) {
            return Err(AppError::Validation(format!(
                "Invalid parallel_mode '{}'; expected one of {:?}",
                settings.parallel_mode, VALID_PARALLEL_MODES
            )));
        }
        Ok(())
    }

    /// Loads application settings, migrating from the legacy home config path if needed
    /// and backing up corrupt JSON files rather than silently discarding them.
    pub async fn load() -> AppSettings {
        let _guard = SETTINGS_LOCK.lock().await;
        let path = Self::settings_path();

        if path.is_file() {
            match fs::read_to_string(&path).await {
                Ok(content) if !content.trim().is_empty() => {
                    match serde_json::from_str::<AppSettings>(&content) {
                        Ok(mut settings) => {
                            if settings.output_dir.is_empty() {
                                settings.output_dir = Self::default_output_dir();
                            }
                            return settings;
                        }
                        Err(err) => {
                            AppLogger::backup_corrupt_file(&path, "settings", &err.to_string())
                                .await;
                        }
                    }
                }
                Ok(_) => {
                    AppLogger::warn(
                        "settings",
                        &format!("Settings file {:?} is empty; using defaults", path),
                    );
                }
                Err(err) => {
                    AppLogger::warn(
                        "settings",
                        &format!("Failed to read settings file {:?}: {}", path, err),
                    );
                }
            }
        } else if let Some(home) = dirs::home_dir() {
            let legacy_path = home
                .join(LEGACY_CONFIG_DIR_NAME)
                .join(LEGACY_SETTINGS_FILE_NAME);
            if legacy_path.is_file() {
                match fs::read_to_string(&legacy_path).await {
                    Ok(content) if !content.trim().is_empty() => {
                        match serde_json::from_str::<AppSettings>(&content) {
                            Ok(mut settings) => {
                                if settings.output_dir.is_empty() {
                                    settings.output_dir = Self::default_output_dir();
                                }
                                if let Ok(json) = serde_json::to_string_pretty(&settings) {
                                    match AppLogger::write_atomic(&path, json.as_bytes()).await {
                                        Ok(()) => AppLogger::info(
                                            "settings",
                                            &format!(
                                                "Migrated legacy settings from {:?} to {:?}",
                                                legacy_path, path
                                            ),
                                        ),
                                        Err(err) => AppLogger::warn(
                                            "settings",
                                            &format!(
                                                "Loaded legacy settings from {:?}, but failed to migrate to {:?}: {}",
                                                legacy_path, path, err
                                            ),
                                        ),
                                    }
                                }
                                return settings;
                            }
                            Err(err) => {
                                AppLogger::warn(
                                    "settings",
                                    &format!(
                                        "Legacy settings file {:?} is corrupt and was skipped: {}",
                                        legacy_path, err
                                    ),
                                );
                            }
                        }
                    }
                    Ok(_) => {}
                    Err(err) => {
                        AppLogger::warn(
                            "settings",
                            &format!(
                                "Failed to read legacy settings file {:?}: {}",
                                legacy_path, err
                            ),
                        );
                    }
                }
            }
        }

        AppSettings {
            output_dir: Self::default_output_dir(),
            ..Default::default()
        }
    }

    /// Validates and atomically persists application settings to disk.
    pub async fn save(settings: &AppSettings) -> Result<(), AppError> {
        Self::validate_settings(settings)?;

        let _guard = SETTINGS_LOCK.lock().await;
        let path = Self::settings_path();
        let json = serde_json::to_string_pretty(settings).map_err(|e| {
            AppError::Internal(format!("Failed to serialize application settings: {}", e))
        })?;

        AppLogger::write_atomic(&path, json.as_bytes()).await
    }
}
