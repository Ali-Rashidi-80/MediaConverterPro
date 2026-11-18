use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio_util::sync::CancellationToken;

use crate::constants::CANCELLATION_GRACE_PERIOD_MS;
use crate::ffmpeg_engine::FFmpegEngine;
use crate::fs_guard::OutputFileGuard;
use crate::models::AppError;
use crate::process_runner::attach_to_job_object;

static SPLIT_SEQ: AtomicU64 = AtomicU64::new(0);

pub struct SocialSplitter;

#[derive(Debug, Clone)]
pub struct SplitSegment {
    pub part_index: usize,
    pub start_sec: f64,
    pub duration_sec: f64,
    pub output_file: PathBuf,
}

impl SocialSplitter {
    pub fn calculate_segments(
        total_duration: f64,
        segment_duration: f64,
        overlap_sec: f64,
        stem: &str,
        output_dir: &Path,
    ) -> Vec<SplitSegment> {
        let mut segments = Vec::new();
        if total_duration <= 0.0 || segment_duration <= 0.0 {
            return segments;
        }

        let step = (segment_duration - overlap_sec).max(1.0);
        let mut start = 0.0;
        let mut index = 1;

        while start < total_duration {
            let dur = (total_duration - start).min(segment_duration);
            let filename = format!("{}_part_{:02}.mp4", stem, index);
            let output_file = output_dir.join(filename);

            segments.push(SplitSegment {
                part_index: index,
                start_sec: start,
                duration_sec: dur,
                output_file,
            });

            start += step;
            index += 1;
            if index > 500 {
                break;
            }
        }

        segments
    }

    /// Splits a video into social-friendly MP4 clips with validation, `OutputFileGuard`,
    /// Windows Job Object attachment, and cancellation support.
    pub async fn split_video(
        input_path: &Path,
        segment_duration: u32,
        overlap_seconds: u32,
        blur_background: bool,
        output_dir: &Path,
        cancel_token: CancellationToken,
    ) -> Result<Vec<String>, AppError> {
        if segment_duration < 3 {
            return Err(AppError::Validation(
                "segment_duration must be at least 3 seconds".into(),
            ));
        }
        if overlap_seconds >= segment_duration {
            return Err(AppError::Validation(
                "overlap_seconds must be strictly less than segment_duration".into(),
            ));
        }
        if cancel_token.is_cancelled() {
            return Err(AppError::JobCancelled);
        }

        tokio::fs::create_dir_all(output_dir)
            .await
            .map_err(|e| AppError::Io {
                message: format!("Failed to create output directory: {}", e),
                path: Some(output_dir.to_string_lossy().to_string()),
            })?;

        let probe = FFmpegEngine::probe_file(input_path).await?;
        let total_duration = probe.duration_secs;
        if total_duration <= 0.0 {
            return Err(AppError::EncodingCorrupted(
                "Cannot determine media duration for splitting".into(),
            ));
        }

        let stem = input_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("video");
        let segments = Self::calculate_segments(
            total_duration,
            segment_duration as f64,
            overlap_seconds as f64,
            stem,
            output_dir,
        );

        let ffmpeg_path = FFmpegEngine::find_binary("ffmpeg")?;
        let has_audio = probe.audio_codec.is_some();
        let mut output_paths = Vec::with_capacity(segments.len());

        for seg in segments {
            if cancel_token.is_cancelled() {
                return Err(AppError::JobCancelled);
            }

            let seg_filename = seg
                .output_file
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("segment.mp4")
                .to_string();
            let seg_job_id = format!(
                "split_{}_{}_{}",
                std::process::id(),
                seg.part_index,
                SPLIT_SEQ.fetch_add(1, Ordering::Relaxed)
            );
            let mut file_guard =
                OutputFileGuard::new(output_dir, &seg_filename, &seg_job_id).await?;
            let temp_output = file_guard.temp_path.clone();

            let mut cmd = Command::new(&ffmpeg_path);
            cmd.args(["-hide_banner", "-y"]);
            cmd.args(["-ss", &format!("{:.2}", seg.start_sec)]);
            cmd.args(["-t", &format!("{:.2}", seg.duration_sec)]);
            cmd.args(["-i", &input_path.to_string_lossy()]);

            if blur_background {
                let filter = "[0:v]split=2[main][bg];[bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20:10[blurred];[main]scale=1080:1920:force_original_aspect_ratio=decrease,scale='trunc(iw/2)*2':'trunc(ih/2)*2'[fg];[blurred][fg]overlay=(W-w)/2:(H-h)/2[outv]";
                cmd.args(["-filter_complex", filter]);
                cmd.args(["-map", "[outv]"]);
                if has_audio {
                    cmd.args(["-map", "0:a?"]);
                }
                cmd.args([
                    "-c:v", "libx264", "-preset", "fast", "-crf", "22", "-pix_fmt", "yuv420p",
                ]);
            } else {
                cmd.args([
                    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
                ]);
            }

            if has_audio {
                cmd.args(["-c:a", "aac", "-b:a", "192k"]);
            } else {
                cmd.arg("-an");
            }
            cmd.args(["-movflags", "+faststart"]);
            cmd.args(["-max_muxing_queue_size", "1024"]);
            cmd.arg(&temp_output);

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
                    file_guard.abort_cleanup().await;
                    return Err(AppError::Io {
                        message: format!("Failed to run FFmpeg split: {}", e),
                        path: Some(seg.output_file.to_string_lossy().to_string()),
                    });
                }
            };

            attach_to_job_object(&child);

            let stderr = child.stderr.take();
            let stderr_task = tauri::async_runtime::spawn(async move {
                let mut buf = Vec::new();
                if let Some(mut se) = stderr {
                    let _ = se.read_to_end(&mut buf).await;
                }
                String::from_utf8_lossy(&buf).to_string()
            });

            let wait_res = tokio::select! {
                biased;
                _ = cancel_token.cancelled() => {
                    let grace = Duration::from_millis(CANCELLATION_GRACE_PERIOD_MS);
                    if tokio::time::timeout(grace, child.wait()).await.is_err() {
                        let _ = child.kill().await;
                        let _ = child.wait().await;
                    }
                    let _ = stderr_task.await;
                    file_guard.abort_cleanup().await;
                    return Err(AppError::JobCancelled);
                }
                res = child.wait() => res,
            };

            let stderr_text = stderr_task.await.unwrap_or_default();

            match wait_res {
                Ok(status) if status.success() => {
                    let committed = file_guard.commit().await?;
                    output_paths.push(committed.to_string_lossy().to_string());
                }
                Ok(status) => {
                    file_guard.abort_cleanup().await;
                    return Err(AppError::FfmpegExecutionError {
                        exit_code: status.code(),
                        last_error_log: stderr_text
                            .lines()
                            .rev()
                            .take(10)
                            .collect::<Vec<_>>()
                            .into_iter()
                            .rev()
                            .collect::<Vec<_>>()
                            .join("\n"),
                    });
                }
                Err(e) => {
                    file_guard.abort_cleanup().await;
                    return Err(AppError::Io {
                        message: format!("Failed while waiting for FFmpeg split: {}", e),
                        path: Some(seg.output_file.to_string_lossy().to_string()),
                    });
                }
            }
        }

        Ok(output_paths)
    }
}
