use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use tokio::fs;
use tokio::sync::Mutex;

use crate::constants::{HISTORY_FILE_NAME, LEGACY_APPDATA_DIR_NAME};
use crate::logging::AppLogger;
use crate::models::{AppError, HistoryEntry, HistorySummary};

/// Maximum number of retained conversion history entries.
const MAX_HISTORY_ENTRIES: usize = 1000;

/// Async mutex serializing history read-modify-write operations.
static HISTORY_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

/// Persistent storage manager for conversion history and summary analytics.
pub struct HistoryStore;

impl HistoryStore {
    /// Returns the unified history file path (`<app_data_dir>/history.json`).
    pub fn history_path() -> PathBuf {
        AppLogger::app_data_dir().join(HISTORY_FILE_NAME)
    }

    async fn save_all_unlocked(entries: &[HistoryEntry]) -> Result<(), AppError> {
        let path = Self::history_path();
        let json = serde_json::to_string_pretty(entries)
            .map_err(|e| AppError::Internal(format!("Failed to serialize history: {}", e)))?;
        AppLogger::write_atomic(&path, json.as_bytes()).await
    }

    async fn load_unlocked() -> Vec<HistoryEntry> {
        let path = Self::history_path();

        if path.is_file() {
            match fs::read_to_string(&path).await {
                Ok(content) if !content.trim().is_empty() => {
                    match serde_json::from_str::<Vec<HistoryEntry>>(&content) {
                        Ok(entries) => return entries,
                        Err(err) => {
                            AppLogger::backup_corrupt_file(&path, "history", &err.to_string())
                                .await;
                            return Vec::new();
                        }
                    }
                }
                Ok(_) => return Vec::new(),
                Err(err) => {
                    AppLogger::warn(
                        "history",
                        &format!("Failed to read history file {:?}: {}", path, err),
                    );
                    return Vec::new();
                }
            }
        }

        if let Some(cfg_dir) = dirs::config_dir() {
            let legacy_path = cfg_dir
                .join(LEGACY_APPDATA_DIR_NAME)
                .join(HISTORY_FILE_NAME);
            if legacy_path.is_file() {
                match fs::read_to_string(&legacy_path).await {
                    Ok(content) if !content.trim().is_empty() => {
                        match serde_json::from_str::<Vec<HistoryEntry>>(&content) {
                            Ok(entries) => {
                                match Self::save_all_unlocked(&entries).await {
                                    Ok(()) => AppLogger::info(
                                        "history",
                                        &format!(
                                            "Migrated {} legacy history entries from {:?} to {:?}",
                                            entries.len(),
                                            legacy_path,
                                            path
                                        ),
                                    ),
                                    Err(err) => AppLogger::warn(
                                        "history",
                                        &format!(
                                            "Loaded legacy history from {:?}, but failed to persist migration: {}",
                                            legacy_path, err
                                        ),
                                    ),
                                }
                                return entries;
                            }
                            Err(err) => {
                                AppLogger::warn(
                                    "history",
                                    &format!(
                                        "Legacy history file {:?} is corrupt and was skipped: {}",
                                        legacy_path, err
                                    ),
                                );
                            }
                        }
                    }
                    Ok(_) => {}
                    Err(err) => {
                        AppLogger::warn(
                            "history",
                            &format!(
                                "Failed to read legacy history file {:?}: {}",
                                legacy_path, err
                            ),
                        );
                    }
                }
            }
        }

        Vec::new()
    }

    /// Loads all conversion history entries, migrating legacy data if the primary file is absent.
    pub async fn load() -> Vec<HistoryEntry> {
        let _guard = HISTORY_LOCK.lock().await;
        Self::load_unlocked().await
    }

    /// Atomically replaces all stored history entries.
    pub async fn save_all(entries: &[HistoryEntry]) -> Result<(), AppError> {
        let _guard = HISTORY_LOCK.lock().await;
        Self::save_all_unlocked(entries).await
    }

    /// Inserts or updates a history entry by `entry.id` (idempotent upsert), capped at 1000 entries.
    pub async fn add_entry(entry: HistoryEntry) -> Result<(), AppError> {
        let _guard = HISTORY_LOCK.lock().await;
        let mut list = Self::load_unlocked().await;

        if let Some(pos) = list.iter().position(|existing| existing.id == entry.id) {
            list[pos] = entry;
        } else {
            list.push(entry);
        }

        if list.len() > MAX_HISTORY_ENTRIES {
            let excess = list.len() - MAX_HISTORY_ENTRIES;
            list.drain(0..excess);
        }

        Self::save_all_unlocked(&list).await
    }

    /// Deletes a single history entry by `id`, returning `true` if an entry was removed.
    pub async fn delete_entry(id: &str) -> Result<bool, AppError> {
        let _guard = HISTORY_LOCK.lock().await;
        let mut list = Self::load_unlocked().await;
        let original_len = list.len();
        list.retain(|entry| entry.id != id);

        if list.len() == original_len {
            return Ok(false);
        }

        Self::save_all_unlocked(&list).await?;
        Ok(true)
    }

    /// Clears all stored conversion history entries.
    pub async fn clear() -> Result<(), AppError> {
        let _guard = HISTORY_LOCK.lock().await;
        Self::save_all_unlocked(&[]).await
    }

    /// Computes overflow-safe aggregate statistics across all history entries.
    pub async fn get_summary() -> HistorySummary {
        let entries = Self::load().await;
        if entries.is_empty() {
            return HistorySummary::default();
        }

        let total_files = entries.len();
        let mut total_source_bytes = 0u64;
        let mut total_output_bytes = 0u64;
        let mut speed_sum = 0.0f64;
        let mut speed_count = 0usize;

        for e in &entries {
            total_source_bytes = total_source_bytes.saturating_add(e.source_size_bytes);
            total_output_bytes = total_output_bytes.saturating_add(e.output_size_bytes);
            if e.speed.is_finite() && e.speed > 0.0 {
                speed_sum += e.speed as f64;
                speed_count += 1;
            }
        }

        let saved_i128 = (total_source_bytes as i128) - (total_output_bytes as i128);
        let total_saved_bytes = saved_i128.clamp(i64::MIN as i128, i64::MAX as i128) as i64;
        let saved_percentage = if total_source_bytes > 0 {
            ((saved_i128 as f64 / total_source_bytes as f64) * 100.0) as f32
        } else {
            0.0
        };

        let avg_speed = if speed_count > 0 {
            (speed_sum / (speed_count as f64)) as f32
        } else {
            0.0
        };

        HistorySummary {
            total_files,
            total_source_bytes,
            total_output_bytes,
            total_saved_bytes,
            saved_percentage,
            avg_speed,
        }
    }

    /// Neutralizes spreadsheet formula-injection prefixes and escapes double quotes for CSV cells.
    pub fn sanitize_csv_cell(s: &str) -> String {
        let neutralized = if s.starts_with(['=', '+', '-', '@', '\t', '\r']) {
            format!("'{}", s)
        } else {
            s.to_string()
        };
        neutralized.replace('"', "\"\"")
    }

    /// Atomically exports conversion history to CSV with formula-injection protection on all string fields.
    pub async fn export_csv(target_path: &Path) -> Result<(), AppError> {
        let entries = Self::load().await;
        let mut csv = String::from(
            "id,filename,format,source_bytes,output_bytes,duration_secs,speed,status,timestamp,input_path,output_path\n",
        );

        for e in entries {
            csv.push_str(&format!(
                "\"{}\",\"{}\",\"{}\",{},{},{:.2},{:.2},\"{}\",{},\"{}\",\"{}\"\n",
                Self::sanitize_csv_cell(&e.id),
                Self::sanitize_csv_cell(&e.filename),
                Self::sanitize_csv_cell(&e.format),
                e.source_size_bytes,
                e.output_size_bytes,
                e.duration_secs,
                e.speed,
                Self::sanitize_csv_cell(&e.status),
                e.timestamp,
                Self::sanitize_csv_cell(&e.input_path),
                Self::sanitize_csv_cell(&e.output_path)
            ));
        }

        AppLogger::write_atomic(target_path, csv.as_bytes()).await
    }
}
