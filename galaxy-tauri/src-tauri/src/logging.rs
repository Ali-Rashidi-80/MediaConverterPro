use parking_lot::Mutex;
use std::collections::VecDeque;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::LazyLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::io::AsyncWriteExt;

use crate::constants::{
    APP_DATA_DIR_NAME, APP_LOG_FILE_NAME, CRASH_LOG_FILE_NAME, LOG_DIR_NAME, LOG_RETENTION_DAYS,
    MAX_LOG_ARCHIVES, MAX_LOG_FILE_BYTES, STALE_TEMP_MAX_AGE_SECS,
};
use crate::models::AppError;

/// Global mutex serializing synchronous log writes, rotations, and log pruning/reads.
static LOG_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

/// Monotonic sequence counter ensuring unique atomic temp filenames across concurrent tasks.
static ATOMIC_WRITE_SEQ: AtomicU64 = AtomicU64::new(0);

/// Centralized application logger, storage directory resolver, and atomic file I/O utility.
pub struct AppLogger;

impl AppLogger {
    /// Resolves the unified application data directory.
    ///
    /// Checks non-empty `GALAXY_DATA_DIR` first, otherwise falls back to
    /// `data_local_dir` -> `config_dir` -> `"."`, joined with [`APP_DATA_DIR_NAME`].
    /// Creates the directory if it does not yet exist.
    pub fn app_data_dir() -> PathBuf {
        let dir = match std::env::var("GALAXY_DATA_DIR") {
            Ok(val) if !val.trim().is_empty() => PathBuf::from(val.trim()),
            _ => dirs::data_local_dir()
                .or_else(dirs::config_dir)
                .unwrap_or_else(|| PathBuf::from("."))
                .join(APP_DATA_DIR_NAME),
        };

        if let Err(err) = std::fs::create_dir_all(&dir) {
            eprintln!(
                "Failed to create application data directory {:?}: {}",
                dir, err
            );
        }
        dir
    }

    /// Resolves the logs directory (`<app_data_dir>/logs`), creating it if needed.
    pub fn logs_dir() -> PathBuf {
        let dir = Self::app_data_dir().join(LOG_DIR_NAME);
        if let Err(err) = std::fs::create_dir_all(&dir) {
            eprintln!("Failed to create logs directory {:?}: {}", dir, err);
        }
        dir
    }

    /// Returns the path to the active application log file (`galaxy.log`).
    pub fn log_file_path() -> PathBuf {
        Self::logs_dir().join(APP_LOG_FILE_NAME)
    }

    /// Returns the path to the panic crash log file (`crash.log`).
    pub fn crash_log_path() -> PathBuf {
        Self::logs_dir().join(CRASH_LOG_FILE_NAME)
    }

    /// Formats a Unix epoch timestamp in seconds as an ISO-8601 UTC string (`YYYY-MM-DDTHH:MM:SSZ`).
    pub fn format_utc_timestamp(epoch_secs: u64) -> String {
        let total_secs = epoch_secs as i64;
        let days = total_secs.div_euclid(86_400);
        let secs_of_day = total_secs.rem_euclid(86_400);
        let hour = secs_of_day / 3600;
        let minute = (secs_of_day % 3600) / 60;
        let second = secs_of_day % 60;

        // Civil calendar conversion from days since 1970-01-01 (Howard Hinnant's algorithm).
        let z = days + 719_468;
        let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
        let doe = (z - era * 146_097) as u64;
        let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
        let y = (yoe as i64) + era * 400;
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        let mp = (5 * doy + 2) / 153;
        let day = doy - (153 * mp + 2) / 5 + 1;
        let month = if mp < 10 { mp + 3 } else { mp - 9 };
        let year = y + if month <= 2 { 1 } else { 0 };

        format!(
            "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
            year, month, day, hour, minute, second
        )
    }

    fn current_epoch_secs() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
    }

    fn archive_path(base: &Path, index: usize) -> PathBuf {
        let mut os = base.as_os_str().to_os_string();
        os.push(format!(".{}", index));
        PathBuf::from(os)
    }

    fn rotate_if_needed(path: &Path, max_bytes: u64, strict_gt: bool) {
        let should_rotate = match std::fs::metadata(path) {
            Ok(meta) => {
                if strict_gt {
                    meta.len() > max_bytes
                } else {
                    meta.len() >= max_bytes
                }
            }
            Err(_) => false,
        };

        if !should_rotate {
            return;
        }

        if MAX_LOG_ARCHIVES == 0 {
            if let Err(err) = std::fs::remove_file(path) {
                eprintln!("Failed to remove oversized log {:?}: {}", path, err);
            }
            return;
        }

        let oldest = Self::archive_path(path, MAX_LOG_ARCHIVES);
        if oldest.exists() {
            if let Err(err) = std::fs::remove_file(&oldest) {
                eprintln!("Failed to prune oldest log archive {:?}: {}", oldest, err);
            }
        }

        for idx in (1..MAX_LOG_ARCHIVES).rev() {
            let src = Self::archive_path(path, idx);
            if src.exists() {
                let dst = Self::archive_path(path, idx + 1);
                if dst.exists() {
                    let _ = std::fs::remove_file(&dst);
                }
                if let Err(err) = std::fs::rename(&src, &dst) {
                    eprintln!("Failed to rotate log {:?} -> {:?}: {}", src, dst, err);
                }
            }
        }

        let first = Self::archive_path(path, 1);
        if first.exists() {
            let _ = std::fs::remove_file(&first);
        }
        if let Err(err) = std::fs::rename(path, &first) {
            eprintln!(
                "Failed to rotate active log {:?} -> {:?}: {}",
                path, first, err
            );
        }
    }

    fn append_line(path: &Path, line: &str) {
        if let Some(parent) = path.parent() {
            if let Err(err) = std::fs::create_dir_all(parent) {
                eprintln!("Failed to create log parent dir {:?}: {}", parent, err);
                return;
            }
        }

        match OpenOptions::new().create(true).append(true).open(path) {
            Ok(mut file) => {
                if let Err(err) = file.write_all(line.as_bytes()) {
                    eprintln!("Failed to write log entry to {:?}: {}", path, err);
                }
            }
            Err(err) => {
                eprintln!("Failed to open log file {:?}: {}", path, err);
            }
        }
    }

    /// Writes a structured, thread-safe log entry to `galaxy.log`, rotating archives if needed.
    pub fn write(level: &str, module: &str, message: &str) {
        let _guard = LOG_LOCK.lock();
        let log_path = Self::log_file_path();
        Self::rotate_if_needed(&log_path, MAX_LOG_FILE_BYTES, false);

        let timestamp = Self::format_utc_timestamp(Self::current_epoch_secs());
        let clean_msg = message.replace('\r', "").replace('\n', " \\n ");
        let line = format!(
            "[{}] [{}] [{}] {}\n",
            timestamp,
            level.to_ascii_uppercase(),
            module,
            clean_msg
        );
        Self::append_line(&log_path, &line);
    }

    /// Writes an `INFO` log entry.
    pub fn info(module: &str, msg: &str) {
        Self::write("INFO", module, msg);
    }

    /// Writes a `WARN` log entry.
    pub fn warn(module: &str, msg: &str) {
        Self::write("WARN", module, msg);
    }

    /// Writes an `ERROR` log entry.
    pub fn error(module: &str, msg: &str) {
        Self::write("ERROR", module, msg);
    }

    /// Writes a panic/crash report to `crash.log`, rotating archives if size exceeds `MAX_LOG_FILE_BYTES`.
    ///
    /// Designed to be panic-safe so it can be called directly from `std::panic::set_hook`.
    pub fn write_crash_log(msg: &str) {
        let _guard = LOG_LOCK.lock();
        let crash_path = Self::crash_log_path();
        Self::rotate_if_needed(&crash_path, MAX_LOG_FILE_BYTES, true);

        let timestamp = Self::format_utc_timestamp(Self::current_epoch_secs());
        let entry = format!("[{}] [CRASH] {}\n", timestamp, msg.trim_end());
        Self::append_line(&crash_path, &entry);
    }

    fn is_older_than(path: &Path, now: SystemTime, max_age: Duration) -> bool {
        let Ok(meta) = std::fs::metadata(path) else {
            return false;
        };
        let modified = match meta.modified().or_else(|_| meta.created()) {
            Ok(ts) => ts,
            Err(_) => return false,
        };
        now.duration_since(modified)
            .map(|age| age > max_age)
            .unwrap_or(false)
    }

    fn is_log_filename(name: &str) -> bool {
        name.ends_with(".log") || name.contains(".log.")
    }

    /// Initializes storage/log directories, prunes expired `.log*` files older than `LOG_RETENTION_DAYS`,
    /// and removes stale `.galaxy_part_*` temporary files older than `STALE_TEMP_MAX_AGE_SECS`.
    pub fn init_and_prune(output_dir: Option<&Path>) {
        let now = SystemTime::now();
        let log_max_age = Duration::from_secs(LOG_RETENTION_DAYS.saturating_mul(86_400));
        let logs_dir = Self::logs_dir();

        if let Ok(entries) = std::fs::read_dir(&logs_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                let is_file = entry.file_type().map(|ft| ft.is_file()).unwrap_or(false);
                if !is_file {
                    continue;
                }
                let name = entry.file_name();
                let name_str = name.to_string_lossy();
                if Self::is_log_filename(&name_str) && Self::is_older_than(&path, now, log_max_age)
                {
                    if let Err(err) = std::fs::remove_file(&path) {
                        eprintln!("Failed to prune expired log file {:?}: {}", path, err);
                    }
                }
            }
        }

        let default_dir = PathBuf::from(crate::settings::SettingsStore::default_output_dir());
        let mut dirs_to_prune = vec![default_dir];
        if let Some(dir) = output_dir {
            if !dir.as_os_str().is_empty() && !dirs_to_prune.iter().any(|existing| existing == dir)
            {
                dirs_to_prune.push(dir.to_path_buf());
            }
        }

        let temp_max_age = Duration::from_secs(STALE_TEMP_MAX_AGE_SECS);
        for dir in dirs_to_prune {
            if !dir.is_dir() {
                continue;
            }
            let Ok(entries) = std::fs::read_dir(&dir) else {
                continue;
            };
            for entry in entries.flatten() {
                let is_file = entry.file_type().map(|ft| ft.is_file()).unwrap_or(false);
                if !is_file {
                    continue;
                }
                let name = entry.file_name();
                if name.to_string_lossy().starts_with(".galaxy_part_") {
                    let path = entry.path();
                    if Self::is_older_than(&path, now, temp_max_age) {
                        if let Err(err) = std::fs::remove_file(&path) {
                            Self::warn(
                                "logging",
                                &format!("Failed to delete stale temp file {:?}: {}", path, err),
                            );
                        }
                    }
                }
            }
        }
    }

    fn read_lines_from_file(path: &Path) -> Vec<String> {
        let Ok(bytes) = std::fs::read(path) else {
            return Vec::new();
        };
        let text = String::from_utf8_lossy(&bytes);
        text.lines().map(|line| line.to_string()).collect()
    }

    /// Reads up to `max_lines` of the most recent lines from `galaxy.log` (and `.1` archive if needed).
    pub fn read_recent_logs(max_lines: usize) -> Vec<String> {
        if max_lines == 0 {
            return Vec::new();
        }

        let _guard = LOG_LOCK.lock();
        let active_path = Self::log_file_path();
        let mut tail = VecDeque::with_capacity(max_lines);

        let active_lines = Self::read_lines_from_file(&active_path);
        if active_lines.len() < max_lines {
            let archive_one = Self::archive_path(&active_path, 1);
            if archive_one.is_file() {
                for line in Self::read_lines_from_file(&archive_one) {
                    if tail.len() == max_lines {
                        tail.pop_front();
                    }
                    tail.push_back(line);
                }
            }
        }

        for line in active_lines {
            if tail.len() == max_lines {
                tail.pop_front();
            }
            tail.push_back(line);
        }

        tail.into_iter().collect()
    }

    /// Removes rotated log archives and expired `.log` files in `logs_dir()`, returning the number deleted.
    pub fn clear_old_logs() -> Result<usize, AppError> {
        let _guard = LOG_LOCK.lock();
        let logs_dir = Self::logs_dir();
        let now = SystemTime::now();
        let retention = Duration::from_secs(LOG_RETENTION_DAYS.saturating_mul(86_400));

        let entries = std::fs::read_dir(&logs_dir).map_err(|e| AppError::Io {
            message: format!("Failed to read logs directory: {}", e),
            path: Some(logs_dir.to_string_lossy().to_string()),
        })?;

        let mut deleted_count = 0usize;
        for entry_res in entries {
            let entry = entry_res.map_err(|e| AppError::Io {
                message: format!("Failed to iterate logs directory: {}", e),
                path: Some(logs_dir.to_string_lossy().to_string()),
            })?;
            let is_file = entry.file_type().map(|ft| ft.is_file()).unwrap_or(false);
            if !is_file {
                continue;
            }
            let path = entry.path();
            let name = entry.file_name();
            let name_str = name.to_string_lossy();

            let is_rotated_archive = name_str.contains(".log.");
            let is_expired_log =
                name_str.ends_with(".log") && Self::is_older_than(&path, now, retention);

            if is_rotated_archive || is_expired_log {
                std::fs::remove_file(&path).map_err(|e| AppError::Io {
                    message: format!("Failed to delete old log file: {}", e),
                    path: Some(path.to_string_lossy().to_string()),
                })?;
                deleted_count += 1;
            }
        }

        Ok(deleted_count)
    }

    /// Atomically writes `bytes` to `target` using a unique `{filename}.{pid}.{seq}.tmp` file,
    /// `sync_all`, and rename (with a Windows remove-before-replace fallback).
    pub async fn write_atomic(target: &Path, bytes: &[u8]) -> Result<(), AppError> {
        if let Some(parent) = target.parent() {
            if !parent.as_os_str().is_empty() {
                tokio::fs::create_dir_all(parent)
                    .await
                    .map_err(|e| AppError::Io {
                        message: format!("Failed to create target parent directory: {}", e),
                        path: Some(parent.to_string_lossy().to_string()),
                    })?;
            }
        }

        let base_name = target
            .file_name()
            .and_then(|n| n.to_str())
            .filter(|s| !s.is_empty())
            .unwrap_or("data");
        let pid = std::process::id();
        let seq = ATOMIC_WRITE_SEQ.fetch_add(1, Ordering::Relaxed);
        let tmp_name = format!("{}.{}.{}.tmp", base_name, pid, seq);
        let tmp_path = match target.parent() {
            Some(parent) if !parent.as_os_str().is_empty() => parent.join(tmp_name),
            _ => PathBuf::from(tmp_name),
        };

        let mut file = tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp_path)
            .await
            .map_err(|e| AppError::Io {
                message: format!("Failed to create temporary atomic file: {}", e),
                path: Some(tmp_path.to_string_lossy().to_string()),
            })?;

        if let Err(e) = file.write_all(bytes).await {
            drop(file);
            let _ = tokio::fs::remove_file(&tmp_path).await;
            return Err(AppError::Io {
                message: format!("Failed to write temporary atomic file: {}", e),
                path: Some(tmp_path.to_string_lossy().to_string()),
            });
        }

        if let Err(e) = file.sync_all().await {
            drop(file);
            let _ = tokio::fs::remove_file(&tmp_path).await;
            return Err(AppError::Io {
                message: format!("Failed to sync temporary atomic file: {}", e),
                path: Some(tmp_path.to_string_lossy().to_string()),
            });
        }
        drop(file);

        match tokio::fs::rename(&tmp_path, target).await {
            Ok(()) => Ok(()),
            Err(first_err) => {
                #[cfg(target_os = "windows")]
                {
                    if target.exists() {
                        if let Err(remove_err) = tokio::fs::remove_file(target).await {
                            let _ = tokio::fs::remove_file(&tmp_path).await;
                            return Err(AppError::Io {
                                message: format!(
                                    "Failed to replace existing target file ({}); initial rename error: {}",
                                    remove_err, first_err
                                ),
                                path: Some(target.to_string_lossy().to_string()),
                            });
                        }
                        if let Err(retry_err) = tokio::fs::rename(&tmp_path, target).await {
                            let _ = tokio::fs::remove_file(&tmp_path).await;
                            return Err(AppError::Io {
                                message: format!(
                                    "Failed to rename atomic temp file on retry: {}",
                                    retry_err
                                ),
                                path: Some(target.to_string_lossy().to_string()),
                            });
                        }
                        return Ok(());
                    }
                }

                let _ = tokio::fs::remove_file(&tmp_path).await;
                Err(AppError::Io {
                    message: format!("Failed to atomically commit file: {}", first_err),
                    path: Some(target.to_string_lossy().to_string()),
                })
            }
        }
    }

    /// Moves a corrupt JSON/config file aside to `{path}.corrupt.{ts}.bak` and logs a warning.
    pub async fn backup_corrupt_file(path: &Path, module: &str, reason: &str) {
        let ts = Self::current_epoch_secs();
        let mut bak_os = path.as_os_str().to_os_string();
        bak_os.push(format!(".corrupt.{}.bak", ts));
        let mut bak_path = PathBuf::from(&bak_os);

        if bak_path.exists() {
            let seq = ATOMIC_WRITE_SEQ.fetch_add(1, Ordering::Relaxed);
            let mut unique_os = path.as_os_str().to_os_string();
            unique_os.push(format!(".corrupt.{}_{}.bak", ts, seq));
            bak_path = PathBuf::from(unique_os);
        }

        match tokio::fs::rename(path, &bak_path).await {
            Ok(()) => {
                Self::warn(
                    module,
                    &format!(
                        "Corrupt file {:?} backed up to {:?}: {}",
                        path, bak_path, reason
                    ),
                );
            }
            Err(err) => {
                Self::warn(
                    module,
                    &format!(
                        "Corrupt file {:?} could not be backed up ({}): {}",
                        path, err, reason
                    ),
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::AppLogger;

    #[test]
    fn test_format_utc_timestamp() {
        assert_eq!(AppLogger::format_utc_timestamp(0), "1970-01-01T00:00:00Z");
        // 2026-11-18T00:00:00Z = 20775 * 86400
        assert_eq!(
            AppLogger::format_utc_timestamp(20_775 * 86_400 + 3661),
            "2026-11-18T01:01:01Z"
        );
    }
}
