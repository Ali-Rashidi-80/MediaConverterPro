use parking_lot::Mutex;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use tokio::fs;

use crate::logging::AppLogger;
use crate::models::AppError;

/// In-memory map of normalized reserved output paths to owning job IDs.
static RESERVED_OUTPUT_PATHS: LazyLock<Mutex<HashMap<String, String>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn reservation_key(path: &Path) -> String {
    #[cfg(target_os = "windows")]
    {
        path.to_string_lossy().to_lowercase()
    }
    #[cfg(not(target_os = "windows"))]
    {
        path.to_string_lossy().into_owned()
    }
}

/// Returns `true` if `path` is currently reserved by any active job.
pub fn is_path_reserved(path: &Path) -> bool {
    let key = reservation_key(path);
    let guard = RESERVED_OUTPUT_PATHS.lock();
    guard.contains_key(&key)
}

/// Unconditionally releases an output path reservation.
pub fn release_reserved_path(path: &Path) {
    let key = reservation_key(path);
    let mut guard = RESERVED_OUTPUT_PATHS.lock();
    guard.remove(&key);
}

/// Releases an output path reservation only if `job_id` is the current owner.
pub fn release_reserved_path_by_owner(path: &Path, job_id: &str) {
    let key = reservation_key(path);
    let mut guard = RESERVED_OUTPUT_PATHS.lock();
    if let Some(owner) = guard.get(&key) {
        if owner == job_id {
            guard.remove(&key);
        }
    }
}

/// Clears all output path reservations.
pub fn clear_all_reserved_paths() {
    let mut guard = RESERVED_OUTPUT_PATHS.lock();
    guard.clear();
}

/// Two-phase atomic output file guard that reserves a collision-free destination path,
/// stages writes in a `.galaxy_part_*` temp file, and cleans up on drop/abort.
pub struct OutputFileGuard {
    pub temp_path: PathBuf,
    pub final_target_path: PathBuf,
    pub job_id: String,
    reserved: bool,
    committed: bool,
}

impl OutputFileGuard {
    /// Reserves a unique collision-safe final path in `target_dir` and prepares a temporary staging file.
    pub async fn new(target_dir: &Path, file_name: &str, job_id: &str) -> Result<Self, AppError> {
        fs::create_dir_all(target_dir)
            .await
            .map_err(|e| AppError::Io {
                message: format!("Failed to create destination directory: {}", e),
                path: Some(target_dir.to_string_lossy().to_string()),
            })?;

        let canonical_dir = dunce::canonicalize(target_dir).map_err(|e| AppError::Io {
            message: format!("Failed to access directory: {}", e),
            path: Some(target_dir.to_string_lossy().to_string()),
        })?;

        let safe_file_name = sanitize_filename(file_name);
        let final_target_path =
            resolve_unique_collision_for_job(&canonical_dir, &safe_file_name, job_id).await;
        let temp_file_name = format!(
            ".galaxy_part_{}_{}",
            sanitize_filename(job_id),
            safe_file_name
        );
        let temp_path = canonical_dir.join(temp_file_name);

        Ok(Self {
            temp_path,
            final_target_path,
            job_id: job_id.to_string(),
            reserved: true,
            committed: false,
        })
    }

    /// Validates the staged file is non-empty and atomically promotes it to `final_target_path`.
    pub async fn commit(mut self) -> Result<PathBuf, AppError> {
        let meta = fs::metadata(&self.temp_path)
            .await
            .map_err(|e| AppError::Io {
                message: format!("Temporary output file was not created: {}", e),
                path: Some(self.temp_path.to_string_lossy().to_string()),
            })?;

        if meta.len() == 0 {
            let _ = fs::remove_file(&self.temp_path).await;
            if self.reserved {
                release_reserved_path_by_owner(&self.final_target_path, &self.job_id);
                self.reserved = false;
            }
            return Err(AppError::EncodingCorrupted("Output file is 0 bytes".into()));
        }

        fs::rename(&self.temp_path, &self.final_target_path)
            .await
            .map_err(|e| AppError::Io {
                message: format!("Failed to atomically rename final output file: {}", e),
                path: Some(self.final_target_path.to_string_lossy().to_string()),
            })?;

        self.committed = true;
        if self.reserved {
            release_reserved_path_by_owner(&self.final_target_path, &self.job_id);
            self.reserved = false;
        }
        Ok(self.final_target_path.clone())
    }

    /// Explicitly releases the reservation and deletes any uncommitted temporary output file.
    pub async fn abort_cleanup(&mut self) {
        if self.reserved {
            release_reserved_path_by_owner(&self.final_target_path, &self.job_id);
            self.reserved = false;
        }
        if !self.committed && self.temp_path.exists() {
            if let Err(err) = fs::remove_file(&self.temp_path).await {
                AppLogger::warn(
                    "fs_guard",
                    &format!(
                        "Failed to remove temporary file {:?} during abort cleanup: {}",
                        self.temp_path, err
                    ),
                );
            }
        }
    }
}

impl Drop for OutputFileGuard {
    fn drop(&mut self) {
        if self.reserved {
            if !self.committed {
                AppLogger::warn(
                    "fs_guard",
                    &format!(
                        "OutputFileGuard dropped while still reserved and uncommitted for job '{}' ({:?})",
                        self.job_id, self.final_target_path
                    ),
                );
            }
            release_reserved_path_by_owner(&self.final_target_path, &self.job_id);
            self.reserved = false;
        }
        if !self.committed && self.temp_path.exists() {
            let _ = std::fs::remove_file(&self.temp_path);
        }
    }
}

fn is_windows_reserved_stem(stem_before_first_dot: &str) -> bool {
    let upper = stem_before_first_dot.trim().to_ascii_uppercase();
    matches!(
        upper.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    )
}

/// Sanitizes a filename for cross-platform and Windows NTFS safety.
///
/// Strips control characters, replaces forbidden path/wildcard characters, trims whitespace and
/// trailing dots, rejects `.` and `..`, prefixes `_` on Windows reserved device stems, and truncates
/// stems on a UTF-8 char boundary to at most 160 characters while preserving the extension.
pub fn sanitize_filename(name: &str) -> String {
    const MAX_STEM_CHARS: usize = 160;

    let cleaned: String = name
        .chars()
        .filter(|c| !c.is_control())
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            other => other,
        })
        .collect();

    let trimmed = cleaned
        .trim()
        .trim_end_matches(|c: char| c == '.' || c.is_whitespace());

    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        return "output".to_string();
    }

    let first_dot_stem = trimmed.split('.').next().unwrap_or(trimmed);
    let guarded = if is_windows_reserved_stem(first_dot_stem) {
        format!("_{}", trimmed)
    } else {
        trimmed.to_string()
    };

    let (stem, ext_with_dot) = match guarded.rfind('.') {
        Some(idx) if idx > 0 && idx + 1 < guarded.len() => (&guarded[..idx], &guarded[idx..]),
        _ => (guarded.as_str(), ""),
    };

    let truncated_stem: String = if stem.chars().count() > MAX_STEM_CHARS {
        stem.chars().take(MAX_STEM_CHARS).collect()
    } else {
        stem.to_string()
    };

    let final_stem = truncated_stem.trim_end_matches(|c: char| c == '.' || c.is_whitespace());
    let final_stem = if final_stem.is_empty() {
        "output"
    } else {
        final_stem
    };

    format!("{}{}", final_stem, ext_with_dot)
}

/// Resolves a collision-free output path inside `dir` and reserves it for `job_id`.
pub async fn resolve_unique_collision_for_job(
    dir: &Path,
    file_name: &str,
    job_id: &str,
) -> PathBuf {
    let p = Path::new(file_name);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("output");
    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");

    let mut reserved_guard = RESERVED_OUTPUT_PATHS.lock();

    let mut candidate = dir.join(file_name);
    let mut candidate_key = reservation_key(&candidate);
    if !candidate.exists() && !reserved_guard.contains_key(&candidate_key) {
        reserved_guard.insert(candidate_key, job_id.to_string());
        return candidate;
    }

    let mut counter = 1u64;
    loop {
        let new_name = if ext.is_empty() {
            format!("{} ({})", stem, counter)
        } else {
            format!("{} ({}).{}", stem, counter, ext)
        };
        candidate = dir.join(new_name);
        candidate_key = reservation_key(&candidate);
        if !candidate.exists() && !reserved_guard.contains_key(&candidate_key) {
            reserved_guard.insert(candidate_key, job_id.to_string());
            return candidate;
        }
        counter += 1;
    }
}

/// Resolves a collision-free output path using the default reservation owner.
pub async fn resolve_unique_collision(dir: &Path, file_name: &str) -> PathBuf {
    resolve_unique_collision_for_job(dir, file_name, "default").await
}

/// Queries available and total disk space for `target_path` by walking up to its nearest existing ancestor.
pub fn check_disk_space(target_path: &Path, estimated_bytes: u64) -> crate::models::DiskSpaceInfo {
    let disks = sysinfo::Disks::new_with_refreshed_list();
    let existing_ancestor = target_path
        .ancestors()
        .find(|p| !p.as_os_str().is_empty() && p.exists())
        .unwrap_or(target_path);

    let abs_path =
        dunce::canonicalize(existing_ancestor).unwrap_or_else(|_| existing_ancestor.to_path_buf());
    let abs_str = abs_path.to_string_lossy().to_lowercase();

    let mut best_match = None;
    let mut best_len = 0;
    for disk in &disks {
        let mount = disk.mount_point();
        let mount_str = mount.to_string_lossy().to_lowercase();
        let mount_prefix = mount_str.trim_end_matches(['\\', '/']);

        let matches = if mount_prefix.is_empty() {
            !mount_str.is_empty() && abs_str.starts_with(&mount_str)
        } else {
            abs_str == mount_prefix
                || abs_str.starts_with(&format!("{}\\", mount_prefix))
                || abs_str.starts_with(&format!("{}/", mount_prefix))
                || (!mount_str.is_empty() && abs_str.starts_with(&mount_str))
        };

        if matches {
            let len = mount_str.len();
            if len > best_len {
                best_len = len;
                best_match = Some(disk);
            }
        }
    }

    if let Some(disk) = best_match {
        let available = disk.available_space();
        let total = disk.total_space();
        let is_low = available < (1024 * 1024 * 1024)
            || (estimated_bytes > 0 && available < estimated_bytes);
        crate::models::DiskSpaceInfo {
            path: abs_path.to_string_lossy().to_string(),
            available_bytes: available,
            total_bytes: total,
            is_low,
        }
    } else {
        crate::models::DiskSpaceInfo {
            path: abs_path.to_string_lossy().to_string(),
            available_bytes: 0,
            total_bytes: 0,
            is_low: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::sanitize_filename;

    #[test]
    fn test_sanitize_filename_hardening() {
        assert_eq!(sanitize_filename("."), "output");
        assert_eq!(sanitize_filename(".."), "output");
        assert_eq!(sanitize_filename("   ...  "), "output");
        assert_eq!(sanitize_filename("CON.mp4"), "_CON.mp4");
        assert_eq!(sanitize_filename("lpt9.srt"), "_lpt9.srt");
        assert_eq!(sanitize_filename("movie.mp4... "), "movie.mp4");
        assert_eq!(
            sanitize_filename("a<b>c:d\"e/f\\g|h?i*j\x07.mkv"),
            "a_b_c_d_e_f_g_h_i_j.mkv"
        );

        let long_stem = "ش".repeat(200);
        let sanitized_long = sanitize_filename(&format!("{}.mp4", long_stem));
        assert_eq!(sanitized_long, format!("{}.mp4", "ش".repeat(160)));
    }
}
