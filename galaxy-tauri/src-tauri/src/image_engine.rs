use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;

use image::codecs::avif::AvifEncoder;
use image::codecs::ico::{IcoEncoder, IcoFrame};
use image::codecs::jpeg::JpegEncoder;
use image::codecs::png::PngEncoder;
use image::codecs::webp::WebPEncoder;
use image::imageops::FilterType;
use image::{DynamicImage, ExtendedColorType, ImageDecoder, ImageEncoder, ImageFormat};
use parking_lot::Mutex;
use tokio::process::Command;
use tokio_util::sync::CancellationToken;

use crate::constants::{CANCELLATION_GRACE_PERIOD_MS, MAX_IMAGE_ALLOC_BYTES, MAX_IMAGE_PIXELS};
use crate::ffmpeg_engine::FFmpegEngine;
use crate::fs_guard::OutputFileGuard;
use crate::models::{AppError, ImageConversionSettings, TaskProgressUpdate};
use crate::process_runner::attach_to_job_object;

const VALID_IMAGE_OUTPUT_FORMATS: &[&str] = &[
    "webp", "avif", "png", "jpeg", "jpg", "gif", "ico", "bmp", "tiff", "tif",
];

pub struct ImageEngine;

impl ImageEngine {
    fn emit_progress(
        pending_updates: &Arc<Mutex<Vec<TaskProgressUpdate>>>,
        job_id: &str,
        percentage: f32,
    ) {
        let update = TaskProgressUpdate {
            job_id: job_id.to_string(),
            percentage,
            fps: 0.0,
            speed: 1.0,
            eta_seconds: 0,
        };
        let mut guard = pending_updates.lock();
        if let Some(pos) = guard.iter().position(|u| u.job_id == job_id) {
            guard[pos] = update;
        } else {
            guard.push(update);
        }
    }

    pub fn validate_image_settings(settings: &ImageConversionSettings) -> Result<(), AppError> {
        let fmt = settings.format.trim().to_ascii_lowercase();
        if !VALID_IMAGE_OUTPUT_FORMATS.contains(&fmt.as_str()) {
            return Err(AppError::Validation(format!(
                "Unsupported image output format '{}'",
                settings.format
            )));
        }
        if let Some(rot) = settings.rotate {
            if !matches!(rot, 0 | 90 | 180 | 270) {
                return Err(AppError::Validation(format!(
                    "Invalid image rotation '{}' (expected 0, 90, 180, or 270)",
                    rot
                )));
            }
        }
        Ok(())
    }

    /// Converts an image using pure-Rust `image` / `webp` / `ravif` codecs, preserving ICC profiles
    /// when `strip_metadata == false`, or delegating `.gif` / unsupported-decode sources to FFmpeg.
    pub async fn convert_image(
        input_path: PathBuf,
        target_dir: PathBuf,
        settings: ImageConversionSettings,
        job_id: String,
        cancel_token: CancellationToken,
        pending_updates: Arc<Mutex<Vec<TaskProgressUpdate>>>,
    ) -> Result<PathBuf, AppError> {
        Self::validate_image_settings(&settings)?;

        if cancel_token.is_cancelled() {
            return Err(AppError::JobCancelled);
        }

        let source_ext = input_path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let target_ext = match settings.format.trim().to_ascii_lowercase().as_str() {
            "tif" => "tiff".to_string(),
            other => other.to_string(),
        };

        let file_stem = input_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("image")
            .to_string();
        let final_filename = format!("{}.{}", file_stem, target_ext);

        // GIF input or output (and AVIF input if pure-Rust decoder is unavailable) uses FFmpeg
        if source_ext == "gif" || target_ext == "gif" || source_ext == "avif" {
            return Self::convert_via_ffmpeg(
                &input_path,
                &target_dir,
                &final_filename,
                &target_ext,
                &settings,
                &job_id,
                cancel_token,
                &pending_updates,
            )
            .await;
        }

        let mut file_guard = OutputFileGuard::new(&target_dir, &final_filename, &job_id).await?;
        let temp_output = file_guard.temp_path.clone();

        let job_id_worker = job_id.clone();
        let token_worker = cancel_token.clone();
        let updates_worker = Arc::clone(&pending_updates);

        let blocking_res = tauri::async_runtime::spawn_blocking(move || -> Result<(), AppError> {
            if token_worker.is_cancelled() {
                return Err(AppError::JobCancelled);
            }

            // 1. Pre-flight dimension check
            let reader = image::ImageReader::open(&input_path)
                .map_err(|e| AppError::Io {
                    message: format!("Failed to open image file: {}", e),
                    path: Some(input_path.to_string_lossy().to_string()),
                })?
                .with_guessed_format()
                .map_err(|e| {
                    AppError::Internal(format!("Invalid or unsupported image format: {}", e))
                })?;

            let (w, h) = reader.into_dimensions().map_err(|e| {
                AppError::EncodingCorrupted(format!("Failed to read image dimensions: {}", e))
            })?;

            if (w as u64).saturating_mul(h as u64) > MAX_IMAGE_PIXELS {
                return Err(AppError::ImageBombDetected {
                    width: w,
                    height: h,
                });
            }

            if token_worker.is_cancelled() {
                return Err(AppError::JobCancelled);
            }

            // 2. Decode image with safe allocation limits and optional ICC profile extraction
            let mut limits = image::Limits::default();
            limits.max_alloc = Some(MAX_IMAGE_ALLOC_BYTES);

            let mut reader_with_limits = image::ImageReader::open(&input_path)
                .map_err(|e| AppError::Io {
                    message: e.to_string(),
                    path: Some(input_path.to_string_lossy().to_string()),
                })?
                .with_guessed_format()
                .map_err(|e| AppError::Internal(e.to_string()))?;
            reader_with_limits.limits(limits);

            let mut decoder = reader_with_limits.into_decoder().map_err(|e| {
                AppError::Internal(format!("Failed to initialize image decoder: {}", e))
            })?;

            let icc_profile = if !settings.strip_metadata {
                decoder
                    .icc_profile()
                    .ok()
                    .flatten()
                    .filter(|b| !b.is_empty())
            } else {
                None
            };

            let mut img = DynamicImage::from_decoder(decoder)
                .map_err(|e| AppError::Internal(format!("Failed to decode image: {}", e)))?;

            Self::emit_progress(&updates_worker, &job_id_worker, 15.0);

            if token_worker.is_cancelled() {
                return Err(AppError::JobCancelled);
            }

            // 3. Resize if requested (proportional single-axis or bounded dual-axis)
            match (settings.resize_width, settings.resize_height) {
                (Some(rw), Some(rh)) if rw > 0 && rh > 0 && (rw != w || rh != h) => {
                    img = img.resize(rw, rh, FilterType::Lanczos3);
                }
                (Some(rw), _) if rw > 0 && rw != w => {
                    let target_h = ((h as f64) * (rw as f64 / w as f64)).round().max(1.0) as u32;
                    img = img.resize_exact(rw, target_h, FilterType::Lanczos3);
                }
                (_, Some(rh)) if rh > 0 && rh != h => {
                    let target_w = ((w as f64) * (rh as f64 / h as f64)).round().max(1.0) as u32;
                    img = img.resize_exact(target_w, rh, FilterType::Lanczos3);
                }
                _ => {}
            }

            // 4. Transformations: Rotation, Flips & Grayscale
            if let Some(deg) = settings.rotate {
                match deg {
                    90 => img = img.rotate90(),
                    180 => img = img.rotate180(),
                    270 => img = img.rotate270(),
                    _ => {}
                }
            }

            if settings.flip_h {
                img = img.fliph();
            }
            if settings.flip_v {
                img = img.flipv();
            }
            if settings.grayscale {
                img = img.grayscale();
            }

            if token_worker.is_cancelled() {
                return Err(AppError::JobCancelled);
            }

            // 5. Encode to target format
            let target_format = match target_ext.as_str() {
                "webp" => ImageFormat::WebP,
                "png" => ImageFormat::Png,
                "jpg" | "jpeg" => ImageFormat::Jpeg,
                "avif" => ImageFormat::Avif,
                "bmp" => ImageFormat::Bmp,
                "ico" => ImageFormat::Ico,
                "tiff" | "tif" => ImageFormat::Tiff,
                _ => ImageFormat::WebP,
            };

            let quality = settings.quality.clamp(1, 100);

            match target_format {
                ImageFormat::Ico => {
                    let max_dim = std::cmp::max(img.width(), img.height());
                    let candidate_sizes = [256u32, 128, 64, 48, 32, 16];
                    let mut sizes: Vec<u32> = candidate_sizes
                        .iter()
                        .copied()
                        .filter(|&s| s <= max_dim.max(16))
                        .collect();
                    if sizes.is_empty() {
                        sizes.push(16);
                    }

                    let mut frames = Vec::with_capacity(sizes.len());
                    for size in sizes {
                        let fitted = img.resize(size, size, FilterType::Lanczos3).to_rgba8();
                        let mut square_canvas = image::RgbaImage::new(size, size);
                        let x_offset = (size.saturating_sub(fitted.width())) / 2;
                        let y_offset = (size.saturating_sub(fitted.height())) / 2;
                        image::imageops::overlay(
                            &mut square_canvas,
                            &fitted,
                            x_offset as i64,
                            y_offset as i64,
                        );
                        let frame = IcoFrame::as_png(
                            square_canvas.as_raw(),
                            size,
                            size,
                            ExtendedColorType::Rgba8,
                        )
                        .map_err(|e| {
                            AppError::Internal(format!(
                                "Failed to build ICO frame {}x{}: {}",
                                size, size, e
                            ))
                        })?;
                        frames.push(frame);
                    }

                    let file = std::fs::File::create(&temp_output).map_err(|e| AppError::Io {
                        message: format!("Failed to create ICO output file: {}", e),
                        path: Some(temp_output.to_string_lossy().to_string()),
                    })?;
                    IcoEncoder::new(file).encode_images(&frames).map_err(|e| {
                        AppError::Internal(format!("Failed to encode multi-size ICO: {}", e))
                    })?;
                }
                ImageFormat::Avif => {
                    let mut file =
                        std::fs::File::create(&temp_output).map_err(|e| AppError::Io {
                            message: format!("Failed to create AVIF output file: {}", e),
                            path: Some(temp_output.to_string_lossy().to_string()),
                        })?;
                    let encoder = AvifEncoder::new_with_speed_quality(&mut file, 6, quality);
                    img.write_with_encoder(encoder).map_err(|e| {
                        AppError::Internal(format!("Failed to encode AVIF image: {}", e))
                    })?;
                }
                ImageFormat::Png => {
                    let mut file =
                        std::fs::File::create(&temp_output).map_err(|e| AppError::Io {
                            message: format!("Failed to create PNG output file: {}", e),
                            path: Some(temp_output.to_string_lossy().to_string()),
                        })?;
                    let mut encoder = PngEncoder::new(&mut file);
                    if let Some(icc) = icc_profile {
                        let _ = encoder.set_icc_profile(icc);
                    }
                    img.write_with_encoder(encoder).map_err(|e| {
                        AppError::Internal(format!("Failed to encode PNG image: {}", e))
                    })?;
                }
                ImageFormat::Jpeg => {
                    if img.color().has_alpha() {
                        img = DynamicImage::ImageRgb8(img.to_rgb8());
                    }
                    let mut file =
                        std::fs::File::create(&temp_output).map_err(|e| AppError::Io {
                            message: format!("Failed to create JPEG output file: {}", e),
                            path: Some(temp_output.to_string_lossy().to_string()),
                        })?;
                    let mut encoder = JpegEncoder::new_with_quality(&mut file, quality);
                    if let Some(icc) = icc_profile {
                        let _ = encoder.set_icc_profile(icc);
                    }
                    img.write_with_encoder(encoder).map_err(|e| {
                        AppError::Internal(format!(
                            "Failed to encode JPEG image with quality {}: {}",
                            quality, e
                        ))
                    })?;
                }
                ImageFormat::WebP => {
                    if quality >= 100 {
                        let mut file =
                            std::fs::File::create(&temp_output).map_err(|e| AppError::Io {
                                message: format!("Failed to create WebP output file: {}", e),
                                path: Some(temp_output.to_string_lossy().to_string()),
                            })?;
                        let mut encoder = WebPEncoder::new_lossless(&mut file);
                        if let Some(icc) = icc_profile {
                            let _ = encoder.set_icc_profile(icc);
                        }
                        img.write_with_encoder(encoder).map_err(|e| {
                            AppError::Internal(format!("Failed to encode lossless WebP: {}", e))
                        })?;
                    } else {
                        // webp::Encoder accepts Rgb8 or Rgba8 only
                        let webp_ready = match img {
                            DynamicImage::ImageRgb8(_) | DynamicImage::ImageRgba8(_) => img,
                            other if other.color().has_alpha() => {
                                DynamicImage::ImageRgba8(other.to_rgba8())
                            }
                            other => DynamicImage::ImageRgb8(other.to_rgb8()),
                        };
                        let encoder = webp::Encoder::from_image(&webp_ready).map_err(|e| {
                            AppError::Internal(format!("Failed to initialize WebP encoder: {}", e))
                        })?;
                        let memory = encoder.encode(quality as f32);
                        let final_bytes = if let Some(icc) = icc_profile {
                            Self::inject_webp_icc_chunk(
                                &memory,
                                webp_ready.width(),
                                webp_ready.height(),
                                webp_ready.color().has_alpha(),
                                &icc,
                            )
                        } else {
                            memory.to_vec()
                        };
                        std::fs::write(&temp_output, &final_bytes).map_err(|e| AppError::Io {
                            message: format!("Failed to write WebP output: {}", e),
                            path: Some(temp_output.to_string_lossy().to_string()),
                        })?;
                    }
                }
                ImageFormat::Bmp => {
                    if img.color().has_alpha() {
                        img = DynamicImage::ImageRgb8(img.to_rgb8());
                    }
                    img.save_with_format(&temp_output, ImageFormat::Bmp)
                        .map_err(|e| {
                            AppError::Internal(format!("Failed to encode BMP image: {}", e))
                        })?;
                }
                ImageFormat::Tiff => {
                    img.save_with_format(&temp_output, ImageFormat::Tiff)
                        .map_err(|e| {
                            AppError::Internal(format!("Failed to encode TIFF image: {}", e))
                        })?;
                }
                other => {
                    img.save_with_format(&temp_output, other).map_err(|e| {
                        AppError::Internal(format!("Failed to encode output image: {}", e))
                    })?;
                }
            }

            Ok(())
        })
        .await;

        let worker_result = match blocking_res {
            Ok(inner) => inner,
            Err(join_err) => {
                file_guard.abort_cleanup().await;
                return Err(AppError::Internal(format!(
                    "Image processing worker thread panicked: {}",
                    join_err
                )));
            }
        };

        if let Err(err) = worker_result {
            file_guard.abort_cleanup().await;
            return Err(err);
        }

        if cancel_token.is_cancelled() {
            file_guard.abort_cleanup().await;
            return Err(AppError::JobCancelled);
        }

        let final_path = file_guard.commit().await?;
        Self::emit_progress(&pending_updates, &job_id, 100.0);
        Ok(final_path)
    }

    /// Injects a WebP `ICCP` chunk (upgrading simple WebP to extended `VP8X` container if needed).
    fn inject_webp_icc_chunk(
        webp_bytes: &[u8],
        width: u32,
        height: u32,
        has_alpha: bool,
        icc: &[u8],
    ) -> Vec<u8> {
        if webp_bytes.len() < 12 || &webp_bytes[0..4] != b"RIFF" || &webp_bytes[8..12] != b"WEBP" {
            return webp_bytes.to_vec();
        }
        if width == 0 || height == 0 || icc.is_empty() {
            return webp_bytes.to_vec();
        }

        // Parse existing RIFF chunks
        let mut chunks: Vec<([u8; 4], &[u8])> = Vec::new();
        let mut offset = 12usize;
        while offset + 8 <= webp_bytes.len() {
            let mut fourcc = [0u8; 4];
            fourcc.copy_from_slice(&webp_bytes[offset..offset + 4]);
            let len = u32::from_le_bytes([
                webp_bytes[offset + 4],
                webp_bytes[offset + 5],
                webp_bytes[offset + 6],
                webp_bytes[offset + 7],
            ]) as usize;
            let data_start = offset + 8;
            let Some(data_end) = data_start.checked_add(len) else {
                return webp_bytes.to_vec();
            };
            if data_end > webp_bytes.len() {
                return webp_bytes.to_vec();
            }
            chunks.push((fourcc, &webp_bytes[data_start..data_end]));
            offset = data_end + (len % 2);
        }

        if chunks.is_empty() {
            return webp_bytes.to_vec();
        }

        let mut vp8x_payload = [0u8; 10];
        let mut start_idx = 0usize;
        if chunks[0].0 == *b"VP8X" && chunks[0].1.len() == 10 {
            vp8x_payload.copy_from_slice(chunks[0].1);
            start_idx = 1;
        } else {
            let w_m1 = (width - 1).to_le_bytes();
            let h_m1 = (height - 1).to_le_bytes();
            vp8x_payload[4..7].copy_from_slice(&w_m1[..3]);
            vp8x_payload[7..10].copy_from_slice(&h_m1[..3]);
        }

        vp8x_payload[0] |= 1 << 5; // ICC profile flag
        if has_alpha || chunks[start_idx..].iter().any(|(tag, _)| tag == b"ALPH") {
            vp8x_payload[0] |= 1 << 4; // Alpha flag
        }

        let write_chunk = |out: &mut Vec<u8>, tag: &[u8; 4], data: &[u8]| {
            out.extend_from_slice(tag);
            out.extend_from_slice(&(data.len() as u32).to_le_bytes());
            out.extend_from_slice(data);
            if data.len() % 2 == 1 {
                out.push(0);
            }
        };

        let mut body = Vec::with_capacity(webp_bytes.len() + icc.len() + 32);
        body.extend_from_slice(b"WEBP");
        write_chunk(&mut body, b"VP8X", &vp8x_payload);
        write_chunk(&mut body, b"ICCP", icc);
        for (tag, data) in &chunks[start_idx..] {
            if tag != b"ICCP" {
                write_chunk(&mut body, tag, data);
            }
        }

        let mut out = Vec::with_capacity(8 + body.len());
        out.extend_from_slice(b"RIFF");
        out.extend_from_slice(&(body.len() as u32).to_le_bytes());
        out.extend_from_slice(&body);
        out
    }

    #[allow(clippy::too_many_arguments)]
    async fn convert_via_ffmpeg(
        input_path: &Path,
        target_dir: &Path,
        final_filename: &str,
        target_ext: &str,
        settings: &ImageConversionSettings,
        job_id: &str,
        cancel_token: CancellationToken,
        pending_updates: &Arc<Mutex<Vec<TaskProgressUpdate>>>,
    ) -> Result<PathBuf, AppError> {
        let ffmpeg_path = FFmpegEngine::find_binary("ffmpeg")?;
        let mut file_guard = OutputFileGuard::new(target_dir, final_filename, job_id).await?;
        let temp_output = file_guard.temp_path.clone();

        let mut vf_filters: Vec<String> = Vec::new();
        match (settings.resize_width, settings.resize_height) {
            (Some(rw), Some(rh)) if rw > 0 && rh > 0 => {
                vf_filters.push(format!(
                    "scale={}:{}:force_original_aspect_ratio=decrease:flags=lanczos",
                    rw, rh
                ));
            }
            (Some(rw), _) if rw > 0 => {
                vf_filters.push(format!("scale={}:-2:flags=lanczos", rw));
            }
            (_, Some(rh)) if rh > 0 => {
                vf_filters.push(format!("scale=-2:{}:flags=lanczos", rh));
            }
            _ => {}
        }

        if let Some(deg) = settings.rotate {
            match deg {
                90 => vf_filters.push("transpose=1".to_string()),
                180 => vf_filters.push("transpose=2,transpose=2".to_string()),
                270 => vf_filters.push("transpose=2".to_string()),
                _ => {}
            }
        }

        if settings.flip_h {
            vf_filters.push("hflip".to_string());
        }
        if settings.flip_v {
            vf_filters.push("vflip".to_string());
        }
        if settings.grayscale {
            vf_filters.push("format=gray".to_string());
        }

        let mut cmd = Command::new(&ffmpeg_path);
        cmd.args(["-hide_banner", "-y", "-i"]);
        cmd.arg(input_path);

        if settings.strip_metadata {
            cmd.args(["-map_metadata", "-1"]);
        }

        if target_ext == "gif" {
            let pre_filter = if vf_filters.is_empty() {
                String::new()
            } else {
                format!("{},", vf_filters.join(","))
            };
            let filtergraph = format!(
                "{}split[s0][s1];[s0]palettegen=reserve_transparent=on:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5",
                pre_filter
            );
            cmd.args(["-filter_complex", &filtergraph]);
        } else {
            if !vf_filters.is_empty() {
                cmd.args(["-vf", &vf_filters.join(",")]);
            }
            cmd.args(["-frames:v", "1"]);
            if matches!(target_ext, "jpeg" | "jpg") {
                let q = ((100u8.saturating_sub(settings.quality.clamp(1, 100))) * 30 / 99 + 1)
                    .clamp(1, 31);
                cmd.args(["-q:v", &q.to_string()]);
            } else if target_ext == "webp" {
                cmd.args(["-quality", &settings.quality.clamp(1, 100).to_string()]);
            }
        }

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
                    message: format!("Failed to spawn FFmpeg for image conversion: {}", e),
                    path: Some(temp_output.to_string_lossy().to_string()),
                });
            }
        };

        attach_to_job_object(&child);
        Self::emit_progress(pending_updates, job_id, 15.0);

        let stderr = child.stderr.take();
        let stderr_task = tauri::async_runtime::spawn(async move {
            let mut buf = Vec::new();
            if let Some(mut se) = stderr {
                use tokio::io::AsyncReadExt;
                let _ = se.read_to_end(&mut buf).await;
            }
            String::from_utf8_lossy(&buf).to_string()
        });

        let wait_result = tokio::select! {
            biased;
            _ = cancel_token.cancelled() => {
                let grace = std::time::Duration::from_millis(CANCELLATION_GRACE_PERIOD_MS);
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

        match wait_result {
            Ok(status) if status.success() => {
                let committed = file_guard.commit().await?;
                Self::emit_progress(pending_updates, job_id, 100.0);
                Ok(committed)
            }
            Ok(status) => {
                file_guard.abort_cleanup().await;
                let tail = stderr_text
                    .lines()
                    .rev()
                    .take(10)
                    .collect::<Vec<_>>()
                    .into_iter()
                    .rev()
                    .collect::<Vec<_>>()
                    .join("\n");
                Err(AppError::FfmpegExecutionError {
                    exit_code: status.code(),
                    last_error_log: tail,
                })
            }
            Err(e) => {
                file_guard.abort_cleanup().await;
                Err(AppError::Io {
                    message: format!("Failed to wait for FFmpeg image conversion: {}", e),
                    path: Some(temp_output.to_string_lossy().to_string()),
                })
            }
        }
    }
}
