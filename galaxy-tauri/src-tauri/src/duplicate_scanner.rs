use rayon::prelude::*;
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use tokio_util::sync::CancellationToken;

use crate::constants::ALL_SUPPORTED_EXTENSIONS;
use crate::logging::AppLogger;
use crate::models::{AppError, DuplicateFile, DuplicateGroup};

/// Two-stage parallel duplicate media scanner with zero-false-positive full-file verification.
pub struct DuplicateScanner;

impl DuplicateScanner {
    fn compute_chunk_hash(path: &Path, file_size: u64) -> Option<String> {
        let mut file = File::open(path).ok()?;
        let mut buffer = Vec::new();

        const CHUNK_SIZE: usize = 64 * 1024; // 64 KB

        if file_size <= (CHUNK_SIZE as u64 * 3) {
            buffer.resize(file_size as usize, 0);
            file.read_exact(&mut buffer).ok()?;
        } else {
            let mut head = vec![0u8; CHUNK_SIZE];
            let mut mid = vec![0u8; CHUNK_SIZE];
            let mut tail = vec![0u8; CHUNK_SIZE];

            file.read_exact(&mut head).ok()?;
            buffer.extend_from_slice(&head);

            let mid_offset = (file_size / 2).saturating_sub((CHUNK_SIZE / 2) as u64);
            file.seek(SeekFrom::Start(mid_offset)).ok()?;
            file.read_exact(&mut mid).ok()?;
            buffer.extend_from_slice(&mid);

            let tail_offset = file_size.saturating_sub(CHUNK_SIZE as u64);
            file.seek(SeekFrom::Start(tail_offset)).ok()?;
            file.read_exact(&mut tail).ok()?;
            buffer.extend_from_slice(&tail);
        }

        // Fast 128-bit dual FNV-1a hash
        let mut h1: u64 = 0xcbf29ce484222325;
        let mut h2: u64 = 0x100000001b3 ^ file_size;
        for &b in &buffer {
            h1 ^= b as u64;
            h1 = h1.wrapping_mul(0x100000001b3);
            h2 = h2.wrapping_add(b as u64);
            h2 = h2.rotate_left(5) ^ h1;
        }

        Some(format!("{:016x}{:016x}", h1, h2))
    }

    fn compute_full_hash(
        path: &Path,
        file_size: u64,
        cancel_token: &CancellationToken,
    ) -> Result<Option<String>, AppError> {
        let mut file = match File::open(path) {
            Ok(f) => f,
            Err(err) => {
                AppLogger::warn(
                    "duplicate_scanner",
                    &format!("Failed to open candidate {:?} for full hash: {}", path, err),
                );
                return Ok(None);
            }
        };

        const STREAM_BUF_SIZE: usize = 64 * 1024;
        let mut buf = vec![0u8; STREAM_BUF_SIZE];
        let mut h1: u64 = 0xcbf29ce484222325;
        let mut h2: u64 = 0x100000001b3 ^ file_size;
        let mut total_read = 0u64;

        loop {
            if cancel_token.is_cancelled() {
                return Err(AppError::JobCancelled);
            }

            let bytes_read = match file.read(&mut buf) {
                Ok(n) => n,
                Err(err) => {
                    AppLogger::warn(
                        "duplicate_scanner",
                        &format!("Failed reading {:?} during full hash: {}", path, err),
                    );
                    return Ok(None);
                }
            };

            if bytes_read == 0 {
                break;
            }

            total_read = total_read.saturating_add(bytes_read as u64);
            for &b in &buf[..bytes_read] {
                h1 ^= b as u64;
                h1 = h1.wrapping_mul(0x100000001b3);
                h2 = h2.wrapping_add(b as u64);
                h2 = h2.rotate_left(5) ^ h1;
            }
        }

        if total_read != file_size {
            AppLogger::warn(
                "duplicate_scanner",
                &format!(
                    "File size changed during full hash of {:?} (expected {}, read {}); skipping",
                    path, file_size, total_read
                ),
            );
            return Ok(None);
        }

        Ok(Some(format!("{:016x}{:016x}", h1, h2)))
    }

    /// Scans `dir_path` for exact duplicate media files without cancellation support.
    pub async fn scan_directory(dir_path: &str) -> Result<Vec<DuplicateGroup>, AppError> {
        Self::scan_directory_cancellable(dir_path, &CancellationToken::new()).await
    }

    /// Scans `dir_path` for exact duplicate media files using parallel chunk pre-filtering
    /// followed by full-file streaming hash verification, honoring `cancel_token`.
    pub async fn scan_directory_cancellable(
        dir_path: &str,
        cancel_token: &CancellationToken,
    ) -> Result<Vec<DuplicateGroup>, AppError> {
        if cancel_token.is_cancelled() {
            return Err(AppError::JobCancelled);
        }

        let root = PathBuf::from(dir_path);
        if !root.is_dir() {
            return Err(AppError::FileNotFound(dir_path.to_string()));
        }

        let mut size_buckets: HashMap<u64, Vec<PathBuf>> = HashMap::new();
        let mut dirs_to_visit = vec![(root, 0usize)];
        let mut visited_dirs = HashSet::new();

        const MAX_SCAN_DEPTH: usize = 16;

        while let Some((current_dir, depth)) = dirs_to_visit.pop() {
            if cancel_token.is_cancelled() {
                return Err(AppError::JobCancelled);
            }

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
                    if cancel_token.is_cancelled() {
                        return Err(AppError::JobCancelled);
                    }

                    let path = entry.path();
                    let file_type = match entry.file_type().await {
                        Ok(ft) => ft,
                        Err(_) => continue,
                    };

                    if file_type.is_file() {
                        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                            if ALL_SUPPORTED_EXTENSIONS.contains(&ext.to_lowercase().as_str()) {
                                if let Ok(meta) = entry.metadata().await {
                                    let size = meta.len();
                                    if size > 0 {
                                        size_buckets.entry(size).or_default().push(path);
                                    }
                                }
                            }
                        }
                    } else if file_type.is_dir()
                        && !file_type.is_symlink()
                        && depth < MAX_SCAN_DEPTH
                    {
                        dirs_to_visit.push((path, depth + 1));
                    }
                }
            }
        }

        let candidate_items: Vec<(u64, PathBuf)> = size_buckets
            .into_iter()
            .filter(|(_, files)| files.len() > 1)
            .flat_map(|(size, files)| files.into_iter().map(move |path| (size, path)))
            .collect();

        if candidate_items.is_empty() {
            return Ok(Vec::new());
        }

        // Stage 1: Parallel 3x64KB chunk hash inside spawn_blocking
        type StageHashResult = Result<Vec<Option<(u64, String, PathBuf)>>, AppError>;
        let stage1_token = cancel_token.clone();
        let stage1_hashed: Vec<(u64, String, PathBuf)> = tokio::task::spawn_blocking(move || {
            let results: StageHashResult = candidate_items
                .into_par_iter()
                .map(|(file_size, path)| {
                    if stage1_token.is_cancelled() {
                        return Err(AppError::JobCancelled);
                    }
                    Ok(Self::compute_chunk_hash(&path, file_size)
                        .map(|hash| (file_size, hash, path)))
                })
                .collect();

            Ok::<Vec<(u64, String, PathBuf)>, AppError>(results?.into_iter().flatten().collect())
        })
        .await
        .map_err(|e| AppError::Internal(format!("Duplicate scan Stage 1 failed: {}", e)))??;

        let mut stage1_groups: HashMap<(u64, String), Vec<PathBuf>> = HashMap::new();
        for (file_size, chunk_hash, path) in stage1_hashed {
            stage1_groups
                .entry((file_size, chunk_hash))
                .or_default()
                .push(path);
        }

        let stage2_candidates: Vec<(u64, PathBuf)> = stage1_groups
            .into_iter()
            .filter(|(_, files)| files.len() >= 2)
            .flat_map(|((size, _), files)| files.into_iter().map(move |path| (size, path)))
            .collect();

        if stage2_candidates.is_empty() {
            return Ok(Vec::new());
        }

        // Stage 2: Parallel full-file streaming hash for zero false positives
        let stage2_token = cancel_token.clone();
        let stage2_hashed: Vec<(u64, String, PathBuf)> = tokio::task::spawn_blocking(move || {
            let results: StageHashResult = stage2_candidates
                .into_par_iter()
                .map(|(file_size, path)| {
                    if stage2_token.is_cancelled() {
                        return Err(AppError::JobCancelled);
                    }
                    match Self::compute_full_hash(&path, file_size, &stage2_token)? {
                        Some(full_hash) => Ok(Some((file_size, full_hash, path))),
                        None => Ok(None),
                    }
                })
                .collect();

            Ok::<Vec<(u64, String, PathBuf)>, AppError>(results?.into_iter().flatten().collect())
        })
        .await
        .map_err(|e| AppError::Internal(format!("Duplicate scan Stage 2 failed: {}", e)))??;

        let mut exact_groups: HashMap<(u64, String), Vec<DuplicateFile>> = HashMap::new();
        for (file_size, full_hash, path) in stage2_hashed {
            let filename = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown")
                .to_string();

            exact_groups
                .entry((file_size, full_hash))
                .or_default()
                .push(DuplicateFile {
                    path: path.to_string_lossy().to_string(),
                    filename,
                    size_bytes: file_size,
                });
        }

        let mut duplicate_groups: Vec<DuplicateGroup> = exact_groups
            .into_iter()
            .filter(|(_, files)| files.len() >= 2)
            .map(|((file_size, hash), files)| DuplicateGroup {
                file_size,
                hash,
                files,
            })
            .collect();

        // Sort by reclaimable bytes descending (largest potential savings first)
        duplicate_groups.sort_by(|a, b| {
            let a_reclaim = a
                .file_size
                .saturating_mul(a.files.len().saturating_sub(1) as u64);
            let b_reclaim = b
                .file_size
                .saturating_mul(b.files.len().saturating_sub(1) as u64);
            b_reclaim.cmp(&a_reclaim)
        });

        Ok(duplicate_groups)
    }
}
