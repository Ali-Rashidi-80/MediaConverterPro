use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;

use crate::constants::{
    DEFAULT_AUDIO_BITRATE, DEFAULT_AUDIO_CODEC, MAX_TIMECODE_SECS, SUBPROCESS_TIMEOUT_SECS,
    SUPPORTED_AUDIO_EXTENSIONS, SUPPORTED_IMAGE_EXTENSIONS,
};
use crate::models::{
    AppError, AudioConversionSettings, MediaFileInfo, MediaKind, PipelineTier,
    VideoConversionSettings,
};

const VALID_VIDEO_OUTPUT_FORMATS: &[&str] =
    &["mp4", "mkv", "mov", "webm", "avi", "gif", "m4v", "ts"];
const VALID_AUDIO_OUTPUT_FORMATS: &[&str] = &[
    "mp3", "aac", "flac", "wav", "ogg", "opus", "m4a", "wma", "alac",
];

pub struct FFmpegEngine;

impl FFmpegEngine {
    /// Resolves the path to an FFmpeg suite binary (`ffmpeg`, `ffprobe`, `ffplay`).
    ///
    /// In release builds, checks only env override, the immediate executable directory,
    /// its `resources` subdirectory, and system `PATH` (preventing CWE-427 traversal).
    /// Under `#[cfg(debug_assertions)]`, also searches up to 2 ancestor levels from
    /// `CARGO_MANIFEST_DIR` and `current_dir()`.
    pub fn find_binary(binary_name: &str) -> Result<PathBuf, AppError> {
        let exe_name =
            if cfg!(target_os = "windows") && !binary_name.to_ascii_lowercase().ends_with(".exe") {
                format!("{}.exe", binary_name)
            } else {
                binary_name.to_string()
            };

        // 1. Environment variable override
        let normalized = binary_name.trim().to_ascii_lowercase();
        let stem = normalized.trim_end_matches(".exe");
        let env_var_name = match stem {
            "ffprobe" => "FFPROBE_PATH",
            "ffplay" => "FFPLAY_PATH",
            _ => "FFMPEG_PATH",
        };
        if let Ok(custom_path) = std::env::var(env_var_name) {
            let trimmed = custom_path.trim();
            if !trimmed.is_empty() {
                let p = PathBuf::from(trimmed);
                if p.is_file() {
                    return Ok(dunce::canonicalize(&p).unwrap_or(p));
                }
            }
        }

        // 2. Immediate application directory and `<exe_dir>/resources` (safe for release)
        if let Ok(curr_exe) = std::env::current_exe() {
            if let Some(exe_dir) = curr_exe.parent() {
                for candidate in [
                    exe_dir.join(&exe_name),
                    exe_dir.join("resources").join(&exe_name),
                ] {
                    if candidate.is_file() {
                        return Ok(dunce::canonicalize(&candidate).unwrap_or(candidate));
                    }
                }
            }
        }

        // 3. Development-only ancestor search (up to 2 ancestor levels)
        #[cfg(debug_assertions)]
        {
            let manifest_dir = std::env::var("CARGO_MANIFEST_DIR")
                .ok()
                .filter(|s| !s.trim().is_empty())
                .or_else(|| option_env!("CARGO_MANIFEST_DIR").map(String::from));

            if let Some(dir_str) = manifest_dir {
                let p = PathBuf::from(dir_str);
                let mut current = Some(p.as_path());
                for _ in 0..=2 {
                    if let Some(dir) = current {
                        let candidate = dir.join(&exe_name);
                        if candidate.is_file() {
                            return Ok(dunce::canonicalize(&candidate).unwrap_or(candidate));
                        }
                        current = dir.parent();
                    } else {
                        break;
                    }
                }
            }

            if let Ok(curr_dir) = std::env::current_dir() {
                let mut current = Some(curr_dir.as_path());
                for _ in 0..=2 {
                    if let Some(dir) = current {
                        let candidate = dir.join(&exe_name);
                        if candidate.is_file() {
                            return Ok(dunce::canonicalize(&candidate).unwrap_or(candidate));
                        }
                        current = dir.parent();
                    } else {
                        break;
                    }
                }
            }
        }

        // 4. System PATH fallback
        if let Ok(path) = which::which(&exe_name) {
            return Ok(dunce::canonicalize(&path).unwrap_or(path));
        }

        Err(AppError::FfmpegBinaryNotFound)
    }

    /// Probes a media file for format, dimensions, codecs, size, and duration.
    ///
    /// Raster images (except animated GIFs) use a pure-Rust fast-path via `image::ImageReader`
    /// with zero `ffprobe` dependency. Video/audio (and GIFs) probe via `ffprobe` with timeout,
    /// falling back to `ffmpeg -i` stderr parsing if `ffprobe` is unavailable.
    pub async fn probe_file(file_path: &Path) -> Result<MediaFileInfo, AppError> {
        if !file_path.is_file() {
            return Err(AppError::FileNotFound(
                file_path.to_string_lossy().to_string(),
            ));
        }

        let size_bytes = tokio::fs::metadata(file_path)
            .await
            .map(|m| m.len())
            .unwrap_or(0);
        let ext = file_path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let filename = file_path
            .file_name()
            .and_then(|f| f.to_str())
            .unwrap_or("unknown")
            .to_string();

        // Pure-Rust Image Fast-Path (GIF falls through to ffprobe/ffmpeg so animated duration is probed)
        if SUPPORTED_IMAGE_EXTENSIONS.contains(&ext.as_str()) && ext != "gif" {
            let img_path = file_path.to_path_buf();
            let dim_result = tokio::task::spawn_blocking(move || {
                let reader = image::ImageReader::open(&img_path)
                    .map_err(|e| AppError::Io {
                        message: format!("Failed to open image file: {}", e),
                        path: Some(img_path.to_string_lossy().to_string()),
                    })?
                    .with_guessed_format()
                    .map_err(|e| AppError::Io {
                        message: format!("Failed to read image header: {}", e),
                        path: Some(img_path.to_string_lossy().to_string()),
                    })?;

                reader.into_dimensions().map_err(|e| match e {
                    image::ImageError::Unsupported(_) => AppError::Internal("unsupported".into()),
                    other => AppError::EncodingCorrupted(format!(
                        "Unsupported or corrupted image file: {}",
                        other
                    )),
                })
            })
            .await
            .map_err(|e| AppError::Internal(format!("Image probe thread failed: {}", e)))?;

            match dim_result {
                Ok((w, h)) => {
                    return Ok(MediaFileInfo {
                        path: file_path.to_string_lossy().to_string(),
                        filename,
                        size_bytes,
                        duration_secs: 0.0,
                        width: Some(w),
                        height: Some(h),
                        video_codec: None,
                        audio_codec: None,
                        bitrate: None,
                        kind: MediaKind::Image,
                    });
                }
                Err(AppError::Internal(ref msg)) if msg == "unsupported" => {
                    // e.g. AVIF without avif-native decoder: fall through to ffprobe/ffmpeg,
                    // or return basic image info if neither binary exists.
                    match Self::probe_via_binaries(file_path, size_bytes).await {
                        Ok(mut info) => {
                            info.kind = MediaKind::Image;
                            return Ok(info);
                        }
                        Err(AppError::FfmpegBinaryNotFound) => {
                            return Ok(MediaFileInfo {
                                path: file_path.to_string_lossy().to_string(),
                                filename,
                                size_bytes,
                                duration_secs: 0.0,
                                width: None,
                                height: None,
                                video_codec: None,
                                audio_codec: None,
                                bitrate: None,
                                kind: MediaKind::Image,
                            });
                        }
                        Err(e) => return Err(e),
                    }
                }
                Err(e) => return Err(e),
            }
        }

        Self::probe_via_binaries(file_path, size_bytes).await
    }

    async fn probe_via_binaries(
        file_path: &Path,
        fallback_size_bytes: u64,
    ) -> Result<MediaFileInfo, AppError> {
        match Self::find_binary("ffprobe") {
            Ok(ffprobe_path) => {
                let mut cmd = Command::new(&ffprobe_path);
                cmd.args([
                    "-v",
                    "quiet",
                    "-print_format",
                    "json",
                    "-show_format",
                    "-show_streams",
                    "--",
                ]);
                cmd.arg(file_path);
                cmd.stdin(Stdio::null());
                cmd.stdout(Stdio::piped());
                cmd.stderr(Stdio::null());
                cmd.kill_on_drop(true);

                #[cfg(target_os = "windows")]
                {
                    cmd.creation_flags(0x08000000 | 0x00004000);
                }

                let output = tokio::time::timeout(
                    Duration::from_secs(SUBPROCESS_TIMEOUT_SECS),
                    cmd.output(),
                )
                .await
                .map_err(|_| AppError::Internal("Media probe (ffprobe) timed out".into()))?
                .map_err(|e| AppError::Io {
                    message: format!("Failed to execute ffprobe: {}", e),
                    path: Some(file_path.to_string_lossy().to_string()),
                })?;

                if !output.status.success() {
                    return Err(AppError::EncodingCorrupted(
                        "Unsupported or corrupted media file".into(),
                    ));
                }

                let json_str = String::from_utf8_lossy(&output.stdout);
                let parsed: serde_json::Value = serde_json::from_str(&json_str).map_err(|_| {
                    AppError::EncodingCorrupted("Unsupported or corrupted media file".into())
                })?;

                let has_streams = parsed
                    .get("streams")
                    .and_then(|s| s.as_array())
                    .map(|arr| !arr.is_empty())
                    .unwrap_or(false);
                let has_format = parsed
                    .get("format")
                    .and_then(|f| f.as_object())
                    .map(|obj| !obj.is_empty())
                    .unwrap_or(false);

                if !has_streams && !has_format {
                    return Err(AppError::EncodingCorrupted(
                        "Unsupported or corrupted media file".into(),
                    ));
                }

                let mut info = Self::parse_probe_metadata(&parsed, file_path);
                if info.size_bytes == 0 {
                    info.size_bytes = fallback_size_bytes;
                }
                if info.video_codec.is_none()
                    && info.audio_codec.is_none()
                    && info.duration_secs <= 0.0
                    && info.kind != MediaKind::Image
                {
                    return Err(AppError::EncodingCorrupted(
                        "Unsupported or corrupted media file".into(),
                    ));
                }
                Ok(info)
            }
            Err(AppError::FfmpegBinaryNotFound) => {
                // Fallback to `ffmpeg -hide_banner -i -- <file>`
                let ffmpeg_path = Self::find_binary("ffmpeg")?;
                let mut cmd = Command::new(&ffmpeg_path);
                cmd.args(["-hide_banner", "-i", "--"]);
                cmd.arg(file_path);
                cmd.stdin(Stdio::null());
                cmd.stdout(Stdio::null());
                cmd.stderr(Stdio::piped());
                cmd.kill_on_drop(true);

                #[cfg(target_os = "windows")]
                {
                    cmd.creation_flags(0x08000000 | 0x00004000);
                }

                let output = tokio::time::timeout(
                    Duration::from_secs(SUBPROCESS_TIMEOUT_SECS),
                    cmd.output(),
                )
                .await
                .map_err(|_| AppError::Internal("Media probe (ffmpeg) timed out".into()))?
                .map_err(|e| AppError::Io {
                    message: format!("Failed to execute ffmpeg probe: {}", e),
                    path: Some(file_path.to_string_lossy().to_string()),
                })?;

                let stderr = String::from_utf8_lossy(&output.stderr);
                Self::parse_ffmpeg_i_stderr(&stderr, file_path, fallback_size_bytes)
            }
            Err(e) => Err(e),
        }
    }

    /// Parses `ffmpeg -i` stderr output as a fallback when `ffprobe` is unavailable.
    pub fn parse_ffmpeg_i_stderr(
        stderr: &str,
        file_path: &Path,
        size_bytes: u64,
    ) -> Result<MediaFileInfo, AppError> {
        let mut duration_secs = 0.0f64;
        let mut bitrate: Option<u64> = None;
        let mut video_codec: Option<String> = None;
        let mut audio_codec: Option<String> = None;
        let mut width: Option<u32> = None;
        let mut height: Option<u32> = None;

        for line in stderr.lines() {
            let trimmed = line.trim();
            if let Some(after_dur) = trimmed.strip_prefix("Duration:") {
                if let Some(dur_part) = after_dur.split(',').next() {
                    let dur_str = dur_part.trim();
                    if !dur_str.eq_ignore_ascii_case("N/A") {
                        if let Some(secs) = Self::parse_timecode(dur_str) {
                            duration_secs = secs;
                        }
                    }
                }
                if let Some(br_idx) = trimmed.find("bitrate:") {
                    let br_str = trimmed[br_idx + 8..].trim();
                    if let Some(num_token) = br_str.split_whitespace().next() {
                        if let Ok(kbps) = num_token.parse::<u64>() {
                            bitrate = Some(kbps.saturating_mul(1000));
                        }
                    }
                }
            } else if trimmed.starts_with("Stream #") {
                if let Some(v_idx) = trimmed.find("Video:") {
                    if !trimmed.contains("(attached pic)") && video_codec.is_none() {
                        let rest = trimmed[v_idx + 6..].trim();
                        if let Some(codec) = rest
                            .split(|c: char| c.is_whitespace() || c == ',' || c == '(')
                            .find(|s| !s.is_empty())
                        {
                            video_codec = Some(codec.to_string());
                        }
                        if let Some((w, h)) = Self::extract_resolution_from_stream_line(rest) {
                            width = Some(w);
                            height = Some(h);
                        }
                    }
                } else if let Some(a_idx) = trimmed.find("Audio:") {
                    if audio_codec.is_none() {
                        let rest = trimmed[a_idx + 6..].trim();
                        if let Some(codec) = rest
                            .split(|c: char| c.is_whitespace() || c == ',' || c == '(')
                            .find(|s| !s.is_empty())
                        {
                            audio_codec = Some(codec.to_string());
                        }
                    }
                }
            }
        }

        let ext = file_path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();

        if video_codec.is_none()
            && audio_codec.is_none()
            && duration_secs <= 0.0
            && !SUPPORTED_IMAGE_EXTENSIONS.contains(&ext.as_str())
        {
            return Err(AppError::EncodingCorrupted(
                "Unsupported or corrupted media file".into(),
            ));
        }

        let kind = if SUPPORTED_IMAGE_EXTENSIONS.contains(&ext.as_str()) {
            MediaKind::Image
        } else if video_codec.is_some() {
            MediaKind::Video
        } else if audio_codec.is_some() || SUPPORTED_AUDIO_EXTENSIONS.contains(&ext.as_str()) {
            MediaKind::Audio
        } else {
            MediaKind::Video
        };

        let filename = file_path
            .file_name()
            .and_then(|f| f.to_str())
            .unwrap_or("unknown")
            .to_string();

        Ok(MediaFileInfo {
            path: file_path.to_string_lossy().to_string(),
            filename,
            size_bytes,
            duration_secs,
            width,
            height,
            video_codec,
            audio_codec,
            bitrate,
            kind,
        })
    }

    fn extract_resolution_from_stream_line(rest: &str) -> Option<(u32, u32)> {
        for segment in rest.split(',') {
            for token in segment.split_whitespace() {
                let clean = token.trim_matches(|c: char| c == '[' || c == ']');
                if let Some((w_str, h_str)) = clean.split_once('x') {
                    if !w_str.is_empty()
                        && !h_str.is_empty()
                        && w_str.bytes().all(|b| b.is_ascii_digit())
                        && h_str.bytes().all(|b| b.is_ascii_digit())
                    {
                        if let (Ok(w), Ok(h)) = (w_str.parse::<u32>(), h_str.parse::<u32>()) {
                            if w >= 16 && h >= 16 && w <= 32768 && h <= 32768 {
                                return Some((w, h));
                            }
                        }
                    }
                }
            }
        }
        None
    }

    pub fn parse_probe_metadata(parsed: &serde_json::Value, file_path: &Path) -> MediaFileInfo {
        let format_obj = parsed.get("format");
        let duration_secs = format_obj
            .and_then(|f| f.get("duration"))
            .and_then(|d| d.as_str())
            .and_then(|s| s.parse::<f64>().ok())
            .filter(|d| d.is_finite() && *d >= 0.0)
            .unwrap_or(0.0);

        let size_bytes = format_obj
            .and_then(|f| f.get("size"))
            .and_then(|s| s.as_str())
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0);

        let bitrate = format_obj
            .and_then(|f| f.get("bit_rate"))
            .and_then(|b| b.as_str())
            .and_then(|s| s.parse::<u64>().ok());

        let streams = parsed.get("streams").and_then(|s| s.as_array());
        let mut video_codec = None;
        let mut audio_codec = None;
        let mut width = None;
        let mut height = None;
        let mut has_video = false;
        let mut has_audio = false;

        if let Some(stream_list) = streams {
            for stream in stream_list {
                let codec_type = stream
                    .get("codec_type")
                    .and_then(|t| t.as_str())
                    .unwrap_or("");
                let codec_name = stream
                    .get("codec_name")
                    .and_then(|c| c.as_str())
                    .map(|s| s.to_string());
                let is_attached_pic = stream
                    .get("disposition")
                    .and_then(|d| d.get("attached_pic"))
                    .map(|v| {
                        v.as_bool().unwrap_or(false)
                            || v.as_i64() == Some(1)
                            || v.as_str() == Some("1")
                            || v.as_str() == Some("true")
                    })
                    .unwrap_or(false);

                if codec_type == "video" && !is_attached_pic && !has_video {
                    has_video = true;
                    video_codec = codec_name;
                    width = stream
                        .get("width")
                        .and_then(|w| w.as_u64())
                        .map(|w| w as u32);
                    height = stream
                        .get("height")
                        .and_then(|h| h.as_u64())
                        .map(|h| h as u32);
                } else if codec_type == "audio" && !has_audio {
                    has_audio = true;
                    audio_codec = codec_name;
                }
            }
        }

        let ext = file_path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let kind = if SUPPORTED_IMAGE_EXTENSIONS.contains(&ext.as_str()) {
            MediaKind::Image
        } else if has_video {
            MediaKind::Video
        } else if has_audio || SUPPORTED_AUDIO_EXTENSIONS.contains(&ext.as_str()) {
            MediaKind::Audio
        } else {
            MediaKind::Video
        };

        let filename = file_path
            .file_name()
            .and_then(|f| f.to_str())
            .unwrap_or("unknown")
            .to_string();

        MediaFileInfo {
            path: file_path.to_string_lossy().to_string(),
            filename,
            size_bytes,
            duration_secs,
            width,
            height,
            video_codec,
            audio_codec,
            bitrate,
            kind,
        }
    }

    fn parse_nonneg_decimal(part: &str) -> Option<f64> {
        let trimmed = part.trim();
        if trimmed.is_empty() {
            return None;
        }
        let mut saw_dot = false;
        let mut saw_digit = false;
        for b in trimmed.bytes() {
            if b.is_ascii_digit() {
                saw_digit = true;
            } else if b == b'.' && !saw_dot {
                saw_dot = true;
            } else {
                return None;
            }
        }
        if !saw_digit {
            return None;
        }
        let val = trimmed.parse::<f64>().ok()?;
        if val.is_finite() && val >= 0.0 {
            Some(val)
        } else {
            None
        }
    }

    fn parse_nonneg_uint(part: &str) -> Option<u64> {
        let trimmed = part.trim();
        if trimmed.is_empty() || !trimmed.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        trimmed.parse::<u64>().ok()
    }

    /// Parses `"SS"`, `"SS.ms"`, `"MM:SS"`, `"MM:SS.ms"`, `"HH:MM:SS"`, or `"HH:MM:SS.ms"`
    /// into seconds (`f64`), rejecting negative, non-finite, out-of-range, or overflowing values.
    pub fn parse_timecode(value: &str) -> Option<f64> {
        let s = value.trim();
        if s.is_empty() {
            return None;
        }

        if !s.contains(':') {
            let secs = Self::parse_nonneg_decimal(s)?;
            if secs > MAX_TIMECODE_SECS {
                return None;
            }
            return Some(secs);
        }

        let parts: Vec<&str> = s.split(':').collect();
        match parts.len() {
            2 => {
                let m = Self::parse_nonneg_uint(parts[0])?;
                let sec = Self::parse_nonneg_decimal(parts[1])?;
                if sec >= 60.0 {
                    return None;
                }
                let mins_secs = m.checked_mul(60)?;
                let total = (mins_secs as f64) + sec;
                if !total.is_finite() || total > MAX_TIMECODE_SECS {
                    return None;
                }
                Some(total)
            }
            3 => {
                let h = Self::parse_nonneg_uint(parts[0])?;
                let m = Self::parse_nonneg_uint(parts[1])?;
                let sec = Self::parse_nonneg_decimal(parts[2])?;
                if m >= 60 || sec >= 60.0 {
                    return None;
                }
                let h_secs = h.checked_mul(3600)?;
                let m_secs = m.checked_mul(60)?;
                let base_secs = h_secs.checked_add(m_secs)?;
                let total = (base_secs as f64) + sec;
                if !total.is_finite() || total > MAX_TIMECODE_SECS {
                    return None;
                }
                Some(total)
            }
            _ => None,
        }
    }

    /// Formats seconds cleanly (`90` or `90.5` without trailing `.0`).
    pub fn format_timecode_secs(secs: f64) -> String {
        let clamped = if secs.is_finite() && secs >= 0.0 {
            (secs * 1000.0).round() / 1000.0
        } else {
            0.0
        };
        if (clamped - clamped.round()).abs() < 1e-6 {
            format!("{}", clamped.round() as u64)
        } else {
            let s = format!("{:.3}", clamped);
            s.trim_end_matches('0').trim_end_matches('.').to_string()
        }
    }

    fn validate_trim_pair(
        trim_start: &Option<String>,
        trim_end: &Option<String>,
    ) -> Result<(), AppError> {
        let start = match trim_start
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            Some(s) => Some(Self::parse_timecode(s).ok_or_else(|| {
                AppError::Validation(format!("Invalid trim_start timecode: '{}'", s))
            })?),
            None => None,
        };
        let end = match trim_end.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            Some(s) => Some(Self::parse_timecode(s).ok_or_else(|| {
                AppError::Validation(format!("Invalid trim_end timecode: '{}'", s))
            })?),
            None => None,
        };
        if let (Some(s), Some(e)) = (start, end) {
            if s >= e {
                return Err(AppError::Validation(
                    "trim_start must be strictly less than trim_end".into(),
                ));
            }
        }
        Ok(())
    }

    fn is_valid_bitrate(raw: &str) -> bool {
        let trimmed = raw.trim();
        if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("auto") {
            return true;
        }
        let digits = trimmed
            .strip_suffix(['k', 'K', 'm', 'M'])
            .unwrap_or(trimmed);
        !digits.is_empty()
            && digits.len() <= 9
            && digits.bytes().all(|b| b.is_ascii_digit())
            && digits.parse::<u64>().map(|v| v > 0).unwrap_or(false)
    }

    fn is_valid_scale(raw: &str) -> bool {
        let trimmed = raw.trim();
        if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("original") {
            return true;
        }
        let lower = trimmed.to_ascii_lowercase();
        if matches!(
            lower.as_str(),
            "3840:2160"
                | "4k"
                | "1920:1080"
                | "1080p"
                | "1280:720"
                | "720p"
                | "854:480"
                | "480p"
                | "1080:1920"
                | "story"
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
        let valid_dim = |p: &str| -> bool {
            let t = p.trim();
            t == "-2"
                || (!t.is_empty()
                    && t.len() <= 5
                    && t.bytes().all(|b| b.is_ascii_digit())
                    && t.parse::<u32>()
                        .map(|v| (1..=16384).contains(&v))
                        .unwrap_or(false))
        };
        if !valid_dim(parts[0]) || !valid_dim(parts[1]) {
            return false;
        }
        // Prevent -2:-2
        !(parts[0].trim() == "-2" && parts[1].trim() == "-2")
    }

    fn is_valid_crop(raw: &str) -> bool {
        let trimmed = raw.trim();
        if trimmed.is_empty()
            || trimmed.eq_ignore_ascii_case("none")
            || trimmed.eq_ignore_ascii_case("original")
        {
            return true;
        }
        if matches!(trimmed, "1:1" | "9:16" | "16:9" | "4:3") {
            return true;
        }
        let parts: Vec<&str> = trimmed.split(':').collect();
        if !(parts.len() == 2 || parts.len() == 3 || parts.len() == 4) {
            return false;
        }
        for (idx, part) in parts.iter().enumerate() {
            let p = part.trim();
            if p.is_empty() || p.len() > 6 || !p.bytes().all(|b| b.is_ascii_digit()) {
                return false;
            }
            if idx < 2 && p.parse::<u32>().map(|v| v == 0).unwrap_or(true) {
                return false;
            }
        }
        true
    }

    /// Validates video conversion settings before scheduling or spawning FFmpeg.
    pub fn validate_video_settings(settings: &VideoConversionSettings) -> Result<(), AppError> {
        let fmt = settings.format.trim().to_ascii_lowercase();
        if !VALID_VIDEO_OUTPUT_FORMATS.contains(&fmt.as_str()) {
            return Err(AppError::Validation(format!(
                "Unsupported video output format '{}'",
                settings.format
            )));
        }

        Self::validate_trim_pair(&settings.trim_start, &settings.trim_end)?;

        if let Some(ref scale) = settings.scale {
            if !Self::is_valid_scale(scale) {
                return Err(AppError::Validation(format!(
                    "Invalid scale specification '{}'",
                    scale
                )));
            }
        }

        if let Some(ref crop) = settings.crop {
            if !Self::is_valid_crop(crop) {
                return Err(AppError::Validation(format!(
                    "Invalid crop specification '{}'",
                    crop
                )));
            }
        }

        if let Some(ref br) = settings.bitrate {
            if !Self::is_valid_bitrate(br) {
                return Err(AppError::Validation(format!(
                    "Invalid video bitrate '{}'",
                    br
                )));
            }
        }

        if let Some(crf) = settings.crf {
            if crf > 51 {
                return Err(AppError::Validation(format!(
                    "CRF value {} is out of valid range (0..=51)",
                    crf
                )));
            }
        }

        if let Some(speed) = settings.speed {
            if !speed.is_finite() || speed <= 0.0 {
                return Err(AppError::Validation(
                    "Video speed must be a finite positive number".into(),
                ));
            }
        }

        for (name, val) in [
            ("brightness", settings.brightness),
            ("contrast", settings.contrast),
            ("saturation", settings.saturation),
            ("gamma", settings.gamma),
        ] {
            if let Some(v) = val {
                if !v.is_finite() {
                    return Err(AppError::Validation(format!(
                        "{} must be a finite number",
                        name
                    )));
                }
            }
        }

        if let Some(ref sub) = settings.subtitle_path {
            let trimmed = sub.trim();
            if !trimmed.is_empty() && !Path::new(trimmed).is_file() {
                return Err(AppError::FileNotFound(trimmed.to_string()));
            }
        }

        Ok(())
    }

    /// Validates audio conversion settings before scheduling or spawning FFmpeg.
    pub fn validate_audio_settings(settings: &AudioConversionSettings) -> Result<(), AppError> {
        let fmt = settings.format.trim().to_ascii_lowercase();
        if !VALID_AUDIO_OUTPUT_FORMATS.contains(&fmt.as_str()) {
            return Err(AppError::Validation(format!(
                "Unsupported audio output format '{}'",
                settings.format
            )));
        }

        Self::validate_trim_pair(&settings.trim_start, &settings.trim_end)?;

        if !Self::is_valid_bitrate(&settings.bitrate) {
            return Err(AppError::Validation(format!(
                "Invalid audio bitrate '{}'",
                settings.bitrate
            )));
        }

        let ch = settings.channels.trim().to_ascii_lowercase();
        if !matches!(ch.as_str(), "" | "original" | "mono" | "stereo") {
            return Err(AppError::Validation(format!(
                "Unsupported audio channel layout '{}'",
                settings.channels
            )));
        }

        if let Some(speed) = settings.speed {
            if !speed.is_finite() || speed <= 0.0 {
                return Err(AppError::Validation(
                    "Audio speed must be a finite positive number".into(),
                ));
            }
        }

        if let Some(b) = settings.bass_boost {
            if !b.is_finite() {
                return Err(AppError::Validation("bass_boost must be finite".into()));
            }
        }
        if let Some(t) = settings.treble_boost {
            if !t.is_finite() {
                return Err(AppError::Validation("treble_boost must be finite".into()));
            }
        }

        Ok(())
    }

    /// Escapes a path for FFmpeg libavfilter `subtitles='...'` / `fontsdir='...'`.
    pub fn escape_ffmpeg_subtitles_path(raw: &str) -> String {
        let normalized = raw.replace('\\', "/");
        let mut out = String::with_capacity(normalized.len() + 8);
        for c in normalized.chars() {
            match c {
                '\\' => out.push_str("\\\\"),
                '\'' => out.push_str("\\'"),
                ':' => out.push_str("\\:"),
                '[' => out.push_str("\\["),
                ']' => out.push_str("\\]"),
                ',' => out.push_str("\\,"),
                ';' => out.push_str("\\;"),
                other => out.push(other),
            }
        }
        out
    }

    fn find_bundled_fonts_dir() -> Option<PathBuf> {
        let mut candidates: Vec<PathBuf> = Vec::new();
        if let Ok(curr_exe) = std::env::current_exe() {
            if let Some(exe_dir) = curr_exe.parent() {
                candidates.push(exe_dir.join("resources").join("fonts"));
                candidates.push(exe_dir.join("fonts"));
            }
        }

        #[cfg(debug_assertions)]
        {
            let manifest_dir = std::env::var("CARGO_MANIFEST_DIR")
                .ok()
                .filter(|s| !s.trim().is_empty())
                .or_else(|| option_env!("CARGO_MANIFEST_DIR").map(String::from));
            if let Some(m) = manifest_dir {
                let p = PathBuf::from(m);
                if let Some(parent) = p.parent() {
                    candidates.push(parent.join("src").join("assets").join("fonts"));
                }
            }
            if let Ok(curr) = std::env::current_dir() {
                candidates.push(curr.join("src").join("assets").join("fonts"));
                if let Some(parent) = curr.parent() {
                    candidates.push(parent.join("src").join("assets").join("fonts"));
                }
            }
        }

        for dir in candidates {
            if dir.join("Vazir-Regular.ttf").is_file() {
                return Some(dunce::canonicalize(&dir).unwrap_or(dir));
            }
        }
        None
    }

    pub fn build_atempo_chain(mut speed: f32) -> Vec<String> {
        let mut filters = Vec::new();
        if !speed.is_finite() || speed <= 0.0 || (speed - 1.0).abs() < 0.001 {
            return filters;
        }
        speed = speed.clamp(0.25, 4.0);
        while speed > 2.0 {
            filters.push("atempo=2.0".to_string());
            speed /= 2.0;
        }
        while speed < 0.5 {
            filters.push("atempo=0.5".to_string());
            speed /= 0.5;
        }
        if (speed - 1.0).abs() >= 0.01 {
            if (speed - 0.5).abs() < 0.001 {
                filters.push("atempo=0.5".to_string());
            } else if (speed - 2.0).abs() < 0.001 {
                filters.push("atempo=2.0".to_string());
            } else {
                filters.push(format!("atempo={:.3}", speed));
            }
        }
        filters
    }

    fn append_trim_args(
        args: &mut Vec<String>,
        trim_start: &Option<String>,
        trim_end: &Option<String>,
    ) {
        let start = trim_start.as_deref().and_then(Self::parse_timecode);
        let end = trim_end.as_deref().and_then(Self::parse_timecode);
        if let Some(s) = start {
            args.extend(["-ss".to_string(), Self::format_timecode_secs(s)]);
        }
        if let Some(e) = end {
            let duration = if let Some(s) = start {
                (e - s).max(0.1)
            } else {
                e
            };
            args.extend(["-t".to_string(), Self::format_timecode_secs(duration)]);
        }
    }

    fn append_metadata_args(
        args: &mut Vec<String>,
        privacy_wipe: bool,
        title: &Option<String>,
        artist: &Option<String>,
        album: &Option<String>,
        year: &Option<String>,
        copyright: &Option<String>,
    ) {
        if privacy_wipe {
            args.extend(["-map_metadata".to_string(), "-1".to_string()]);
        }
        for (key, opt) in [
            ("title", title),
            ("artist", artist),
            ("album", album),
            ("date", year),
            ("copyright", copyright),
        ] {
            if let Some(ref val) = opt {
                if !val.is_empty() {
                    args.extend(["-metadata".to_string(), format!("{}={}", key, val)]);
                }
            }
        }
    }

    pub fn build_video_args(
        input_path: &Path,
        output_path: &Path,
        settings: &VideoConversionSettings,
        tier: PipelineTier,
        encoder_name: &str,
    ) -> Vec<String> {
        let mut args = vec![
            "-hide_banner".to_string(),
            "-y".to_string(),
            "-progress".to_string(),
            "pipe:1".to_string(),
            "-nostats".to_string(),
        ];

        Self::append_trim_args(&mut args, &settings.trim_start, &settings.trim_end);

        // Hardware input decoding only when Tier 1 (pure GPU pipeline without CPU filters)
        if tier == PipelineTier::Tier1 && encoder_name.contains("nvenc") {
            args.extend(["-hwaccel".to_string(), "cuda".to_string()]);
        } else if tier == PipelineTier::Tier1 && encoder_name.contains("qsv") {
            args.extend(["-hwaccel".to_string(), "qsv".to_string()]);
        }

        args.extend(["-i".to_string(), input_path.to_string_lossy().to_string()]);

        let target_fmt = settings.format.trim().to_ascii_lowercase();

        Self::append_metadata_args(
            &mut args,
            settings.privacy_wipe,
            &settings.metadata_title,
            &settings.metadata_artist,
            &settings.metadata_album,
            &settings.metadata_year,
            &settings.metadata_copyright,
        );

        if settings.copy_streams {
            args.extend(["-c".to_string(), "copy".to_string()]);
            let is_audio_aac = settings
                .source_audio_codec
                .as_deref()
                .map(|c| c.to_ascii_lowercase().contains("aac"))
                .unwrap_or(false);
            if target_fmt == "mp4" && !settings.strip_audio && is_audio_aac {
                args.extend(["-bsf:a".to_string(), "aac_adtstoasc".to_string()]);
            }
            if settings.strip_audio {
                args.push("-an".to_string());
            }
            if settings.strip_subs {
                args.push("-sn".to_string());
            }
            if target_fmt == "mp4" || target_fmt == "mov" {
                args.extend(["-movflags".to_string(), "+faststart".to_string()]);
            }
            args.push(output_path.to_string_lossy().to_string());
            return args;
        }

        // ProRes applies ONLY when target container is MOV and codec explicitly requests ProRes.
        let is_prores =
            target_fmt == "mov" && settings.codec.to_ascii_lowercase().contains("prores");
        let is_gif = target_fmt == "gif";

        let explicit_bitrate = settings
            .bitrate
            .as_deref()
            .map(str::trim)
            .filter(|b| !b.is_empty() && !b.eq_ignore_ascii_case("auto"));

        let speed_preset = if !settings.encoder_speed_preset.trim().is_empty() {
            settings.encoder_speed_preset.trim()
        } else {
            settings.video_preset.trim()
        };
        let speed_lower = speed_preset.to_ascii_lowercase();

        if is_gif {
            // GIF uses palettegen/paletteuse filter_complex
        } else if is_prores {
            let profile_num = match settings
                .prores_profile
                .as_deref()
                .unwrap_or("standard")
                .to_ascii_lowercase()
                .as_str()
            {
                "proxy" => "0",
                "lt" => "1",
                "standard" | "normal" => "2",
                "hq" => "3",
                "4444" => "4",
                _ => "2",
            };
            args.extend([
                "-c:v".to_string(),
                "prores_ks".to_string(),
                "-profile:v".to_string(),
                profile_num.to_string(),
                "-vendor".to_string(),
                "apl0".to_string(),
                "-bits_per_mb".to_string(),
                "8000".to_string(),
                "-pix_fmt".to_string(),
                "yuv422p10le".to_string(),
            ]);
        } else {
            args.extend(["-c:v".to_string(), encoder_name.to_string()]);

            if encoder_name.contains("nvenc") {
                let nv_lower = settings.nvenc_preset.trim().to_ascii_lowercase();
                let preset = match nv_lower.as_str() {
                    "p1" | "p2" | "p3" | "p4" | "p5" | "p6" | "p7" | "slow" | "medium" | "fast"
                    | "default" | "hp" | "hq" => nv_lower.as_str(),
                    _ => "p4",
                };
                args.extend(["-preset".to_string(), preset.to_string()]);
                args.extend(["-rc".to_string(), "vbr".to_string()]);
                if explicit_bitrate.is_none() {
                    args.extend(["-b:v".to_string(), "0".to_string()]);
                }
                if let Some(crf) = settings.crf {
                    args.extend(["-cq".to_string(), crf.to_string()]);
                }
            } else if encoder_name.contains("amf") {
                let quality = match speed_lower.as_str() {
                    "speed" | "fast" | "ultrafast" | "superfast" | "veryfast" => "speed",
                    "quality" | "slow" | "veryslow" | "slower" => "quality",
                    _ => "balanced",
                };
                args.extend(["-quality".to_string(), quality.to_string()]);
                if let Some(crf) = settings.crf {
                    args.extend([
                        "-qp_i".to_string(),
                        crf.to_string(),
                        "-qp_p".to_string(),
                        crf.to_string(),
                    ]);
                }
            } else if encoder_name.contains("qsv") {
                let preset = match speed_lower.as_str() {
                    "veryfast" | "faster" | "fast" | "medium" | "slow" | "slower" | "veryslow" => {
                        speed_lower.as_str()
                    }
                    _ => "medium",
                };
                args.extend(["-preset".to_string(), preset.to_string()]);
                if let Some(crf) = settings.crf {
                    args.extend(["-global_quality".to_string(), crf.to_string()]);
                }
            } else if encoder_name == "libsvtav1" {
                let svt_preset = match speed_lower.as_str() {
                    "ultrafast" => "10",
                    "superfast" => "9",
                    "veryfast" => "8",
                    "faster" => "7",
                    "fast" | "medium" => "6",
                    "slow" => "5",
                    "slower" => "4",
                    "veryslow" => "3",
                    _ => "6",
                };
                args.extend(["-preset".to_string(), svt_preset.to_string()]);
                if let Some(crf) = settings.crf {
                    args.extend(["-crf".to_string(), crf.to_string()]);
                }
            } else if encoder_name == "libaom-av1" {
                args.extend(["-cpu-used".to_string(), "6".to_string()]);
                if explicit_bitrate.is_none() {
                    args.extend(["-b:v".to_string(), "0".to_string()]);
                }
                if let Some(crf) = settings.crf {
                    args.extend(["-crf".to_string(), crf.to_string()]);
                }
                args.extend(["-row-mt".to_string(), "1".to_string()]);
            } else if encoder_name == "libvpx-vp9" {
                let cpu_used = match speed_lower.as_str() {
                    "ultrafast" | "superfast" | "veryfast" | "faster" | "fast" => "4",
                    "slow" | "slower" | "veryslow" => "1",
                    _ => "2",
                };
                if explicit_bitrate.is_none() {
                    args.extend(["-b:v".to_string(), "0".to_string()]);
                }
                if let Some(crf) = settings.crf {
                    args.extend(["-crf".to_string(), crf.to_string()]);
                }
                args.extend([
                    "-deadline".to_string(),
                    "good".to_string(),
                    "-cpu-used".to_string(),
                    cpu_used.to_string(),
                    "-row-mt".to_string(),
                    "1".to_string(),
                ]);
            } else {
                // libx264 / libx265
                let preset = match speed_lower.as_str() {
                    "ultrafast" | "superfast" | "veryfast" | "faster" | "fast" | "medium"
                    | "slow" | "slower" | "veryslow" => speed_lower.as_str(),
                    _ => "medium",
                };
                args.extend(["-preset".to_string(), preset.to_string()]);
                if let Some(crf) = settings.crf {
                    args.extend(["-crf".to_string(), crf.to_string()]);
                }
            }

            if encoder_name.contains("hevc")
                || encoder_name == "libx265"
                || settings.codec.contains("H.265")
            {
                args.extend(["-tag:v".to_string(), "hvc1".to_string()]);
            }

            if !encoder_name.contains("av1") {
                args.extend(["-pix_fmt".to_string(), "yuv420p".to_string()]);
            }
        }

        if let Some(br) = explicit_bitrate {
            args.extend(["-b:v".to_string(), br.to_string()]);
        }

        // Video Filter Pipeline
        let mut vf_filters = Vec::new();

        if let Some(ref crop_mode) = settings.crop {
            let trimmed = crop_mode.trim();
            let cf = match trimmed {
                "1:1" => Some("crop='trunc(min(iw,ih)/2)*2':'trunc(min(iw,ih)/2)*2'".to_string()),
                "9:16" => Some(
                    "crop='trunc(min(iw,ih*9/16)/2)*2':'trunc(min(ih,iw*16/9)/2)*2'".to_string(),
                ),
                "16:9" => Some(
                    "crop='trunc(min(iw,ih*16/9)/2)*2':'trunc(min(ih,iw*9/16)/2)*2'".to_string(),
                ),
                "4:3" => {
                    Some("crop='trunc(min(iw,ih*4/3)/2)*2':'trunc(min(ih,iw*3/4)/2)*2'".to_string())
                }
                custom
                    if !custom.is_empty()
                        && !custom.eq_ignore_ascii_case("none")
                        && !custom.eq_ignore_ascii_case("original") =>
                {
                    let parts: Vec<&str> = custom.split(':').collect();
                    if parts.len() >= 2 {
                        let w = parts[0].trim();
                        let h = parts[1].trim();
                        let rest = if parts.len() > 2 {
                            format!(":{}", parts[2..].join(":"))
                        } else {
                            String::new()
                        };
                        Some(format!(
                            "crop='trunc({}/2)*2':'trunc({}/2)*2'{}",
                            w, h, rest
                        ))
                    } else {
                        Some(format!("crop='trunc({}/2)*2'", custom))
                    }
                }
                _ => None,
            };
            if let Some(filter_str) = cf {
                vf_filters.push(filter_str);
            }
        }

        if let Some(ref scale) = settings.scale {
            let trimmed = scale.trim();
            if !trimmed.is_empty() && !trimmed.eq_ignore_ascii_case("original") {
                let normalized_dim =
                    if !trimmed.contains(':') && (trimmed.contains('x') || trimmed.contains('X')) {
                        trimmed.replace(['x', 'X'], ":")
                    } else {
                        trimmed.to_string()
                    };
                let safe_scale = match normalized_dim.to_ascii_lowercase().as_str() {
                    "3840:2160" | "4k" => "-2:2160".to_string(),
                    "1920:1080" | "1080p" => "-2:1080".to_string(),
                    "1280:720" | "720p" => "-2:720".to_string(),
                    "854:480" | "480p" => "-2:480".to_string(),
                    "1080:1920" | "story" => "1080:-2".to_string(),
                    _ => normalized_dim,
                };
                vf_filters.push(format!("scale={}:flags=lanczos", safe_scale));
            }
        }

        let b = settings.brightness.filter(|v| v.is_finite()).unwrap_or(0.0);
        let c = settings.contrast.filter(|v| v.is_finite()).unwrap_or(1.0);
        let s = settings.saturation.filter(|v| v.is_finite()).unwrap_or(1.0);
        let g = settings.gamma.filter(|v| v.is_finite()).unwrap_or(1.0);
        if (b != 0.0) || (c != 1.0) || (s != 1.0) || (g != 1.0) {
            vf_filters.push(format!(
                "eq=brightness={:.2}:contrast={:.2}:saturation={:.2}:gamma={:.2}",
                b, c, s, g
            ));
        }

        if settings.hdr_to_sdr {
            vf_filters.push(
                "zscale=t=linear:npl=100,tonemap=mobius,zscale=p=bt709:t=bt709:m=bt709:r=limited"
                    .to_string(),
            );
        }

        if let Some(fps) = settings.fps {
            if fps > 0 {
                vf_filters.push(format!("fps={}", fps));
                args.extend(["-fps_mode".to_string(), "cfr".to_string()]);
            }
        }

        if let Some(ref sub_path) = settings.subtitle_path {
            let trimmed = sub_path.trim();
            if !trimmed.is_empty() {
                let escaped_path = Self::escape_ffmpeg_subtitles_path(trimmed);
                let mut sub_filter = format!(
                    "subtitles='{}':force_style='Fontname=Vazirmatn,FontSize=20'",
                    escaped_path
                );
                if let Some(fonts_dir) = Self::find_bundled_fonts_dir() {
                    let escaped_fonts =
                        Self::escape_ffmpeg_subtitles_path(&fonts_dir.to_string_lossy());
                    sub_filter.push_str(&format!(":fontsdir='{}'", escaped_fonts));
                }
                vf_filters.push(sub_filter);
            }
        }

        if settings.grayscale {
            vf_filters.push("format=gray".to_string());
        }
        if settings.denoise {
            vf_filters.push("hqdn3d=4:3:6:4.5".to_string());
        }
        if settings.sharpen {
            vf_filters.push("unsharp=5:5:1.0:5:5:0.0".to_string());
        }
        if let Some(ref rot) = settings.rotate {
            match rot.trim() {
                "90" => vf_filters.push("transpose=1".to_string()),
                "180" => vf_filters.push("transpose=2,transpose=2".to_string()),
                "270" => vf_filters.push("transpose=2".to_string()),
                _ => {}
            }
        }

        let raw_speed = settings.speed.unwrap_or(1.0);
        let video_speed = if raw_speed.is_finite() && raw_speed > 0.0 {
            raw_speed.clamp(0.25, 4.0)
        } else {
            1.0
        };
        if (video_speed - 1.0).abs() >= 0.01 {
            let pts_factor = 1.0 / video_speed;
            vf_filters.push(format!("setpts={:.4}*PTS", pts_factor));
            if settings.fps.unwrap_or(0) == 0 {
                args.extend(["-fps_mode".to_string(), "cfr".to_string()]);
            }
        }

        if is_gif {
            let pre_filter = if !vf_filters.is_empty() {
                format!("{},", vf_filters.join(","))
            } else {
                String::new()
            };
            let gif_filtergraph = format!(
                "{}split[s0][s1];[s0]palettegen=reserve_transparent=on:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5",
                pre_filter
            );
            args.extend(["-filter_complex".to_string(), gif_filtergraph]);
        } else if !vf_filters.is_empty() {
            args.extend(["-vf".to_string(), vf_filters.join(",")]);
        }

        // Audio options
        let mut af_filters = Vec::new();
        if (video_speed - 1.0).abs() >= 0.01 {
            af_filters.extend(Self::build_atempo_chain(video_speed));
        }

        if settings.strip_audio || is_gif {
            args.push("-an".to_string());
        } else if target_fmt == "webm" {
            args.extend([
                "-c:a".to_string(),
                "libopus".to_string(),
                "-b:a".to_string(),
                "128k".to_string(),
            ]);
            if !af_filters.is_empty() {
                args.extend(["-af".to_string(), af_filters.join(",")]);
            }
        } else if target_fmt == "avi" {
            args.extend([
                "-c:a".to_string(),
                "mp3".to_string(),
                "-b:a".to_string(),
                "192k".to_string(),
            ]);
            if !af_filters.is_empty() {
                args.extend(["-af".to_string(), af_filters.join(",")]);
            }
        } else {
            args.extend([
                "-c:a".to_string(),
                DEFAULT_AUDIO_CODEC.to_string(),
                "-b:a".to_string(),
                DEFAULT_AUDIO_BITRATE.to_string(),
            ]);
            if !af_filters.is_empty() {
                args.extend(["-af".to_string(), af_filters.join(",")]);
            }
        }

        if settings.strip_subs {
            args.push("-sn".to_string());
        }

        if target_fmt == "mp4" || target_fmt == "mov" {
            args.extend(["-movflags".to_string(), "+faststart".to_string()]);
        }

        args.extend(["-max_muxing_queue_size".to_string(), "1024".to_string()]);
        args.push(output_path.to_string_lossy().to_string());
        args
    }

    fn vorbis_quality_for_bitrate(bitrate: &str) -> &'static str {
        let lower = bitrate.trim().to_ascii_lowercase();
        match lower.as_str() {
            "64k" => "1",
            "96k" => "2",
            "128k" => "4",
            "160k" => "5",
            "192k" => "6",
            "256k" => "8",
            "320k" => "9",
            _ => {
                let kbps = lower
                    .strip_suffix('k')
                    .and_then(|n| n.parse::<u32>().ok())
                    .unwrap_or(192);
                if kbps <= 64 {
                    "1"
                } else if kbps <= 128 {
                    "4"
                } else if kbps <= 192 {
                    "6"
                } else if kbps <= 256 {
                    "8"
                } else {
                    "9"
                }
            }
        }
    }

    pub fn build_audio_args(
        input_path: &Path,
        output_path: &Path,
        settings: &AudioConversionSettings,
    ) -> Vec<String> {
        let mut args = vec![
            "-hide_banner".to_string(),
            "-y".to_string(),
            "-progress".to_string(),
            "pipe:1".to_string(),
            "-nostats".to_string(),
        ];

        Self::append_trim_args(&mut args, &settings.trim_start, &settings.trim_end);

        args.extend([
            "-i".to_string(),
            input_path.to_string_lossy().to_string(),
            "-vn".to_string(),
        ]);

        Self::append_metadata_args(
            &mut args,
            settings.privacy_wipe,
            &settings.metadata_title,
            &settings.metadata_artist,
            &settings.metadata_album,
            &settings.metadata_year,
            &settings.metadata_copyright,
        );

        let fmt = settings.format.trim().to_ascii_lowercase();
        match fmt.as_str() {
            "mp3" => args.extend(["-c:a".to_string(), "libmp3lame".to_string()]),
            "aac" | "m4a" => args.extend(["-c:a".to_string(), "aac".to_string()]),
            "flac" => args.extend(["-c:a".to_string(), "flac".to_string()]),
            "wav" => args.extend(["-c:a".to_string(), "pcm_s16le".to_string()]),
            "ogg" => args.extend(["-c:a".to_string(), "libvorbis".to_string()]),
            "opus" => args.extend(["-c:a".to_string(), "libopus".to_string()]),
            "wma" => args.extend(["-c:a".to_string(), "wmav2".to_string()]),
            "alac" => args.extend(["-c:a".to_string(), "alac".to_string()]),
            _ => args.extend(["-c:a".to_string(), "aac".to_string()]),
        }

        if fmt == "ogg" {
            let q = Self::vorbis_quality_for_bitrate(&settings.bitrate);
            args.extend(["-q:a".to_string(), q.to_string()]);
        } else if !settings.bitrate.trim().is_empty()
            && !settings.bitrate.trim().eq_ignore_ascii_case("auto")
            && fmt != "flac"
            && fmt != "wav"
            && fmt != "alac"
        {
            args.extend(["-b:a".to_string(), settings.bitrate.trim().to_string()]);
        }

        // MP3 (libmp3lame) does not support sample rates above 48kHz
        let effective_sample_rate = if fmt == "mp3" && settings.sample_rate > 48000 {
            48000
        } else {
            settings.sample_rate
        };

        if effective_sample_rate > 0 {
            args.extend(["-ar".to_string(), effective_sample_rate.to_string()]);
        }

        match settings.channels.trim().to_ascii_lowercase().as_str() {
            "mono" => args.extend(["-ac".to_string(), "1".to_string()]),
            "stereo" => args.extend(["-ac".to_string(), "2".to_string()]),
            _ => {}
        }

        let mut af_filters = Vec::new();
        if let Some(vol) = settings.volume {
            if vol != 100 {
                let factor = (vol.min(300) as f32) / 100.0;
                af_filters.push(format!("volume={:.2}", factor));
            }
        }

        if let Some(bass) = settings.bass_boost {
            if bass.is_finite() && bass.abs() >= 0.1 {
                af_filters.push(format!("bass=g={:.1}:f=100:w=0.5", bass));
            }
        }

        if let Some(treble) = settings.treble_boost {
            if treble.is_finite() && treble.abs() >= 0.1 {
                af_filters.push(format!("treble=g={:.1}:f=3000:w=0.5", treble));
            }
        }

        if settings.compressor {
            af_filters.push("acompressor=threshold=-21dB:ratio=4:attack=5:release=50".to_string());
        }

        if settings.reverb {
            af_filters.push("aecho=0.8:0.88:60:0.4".to_string());
        }

        if settings.downmix {
            af_filters.push(
                "pan=stereo|c0=0.5*c0+0.707*c2+0.707*c4|c1=0.5*c1+0.707*c2+0.707*c5".to_string(),
            );
        }

        let raw_speed = settings.speed.unwrap_or(1.0);
        let audio_speed = if raw_speed.is_finite() && raw_speed > 0.0 {
            raw_speed.clamp(0.25, 4.0)
        } else {
            1.0
        };
        if (audio_speed - 1.0).abs() >= 0.01 {
            af_filters.extend(Self::build_atempo_chain(audio_speed));
        }

        let active_loudnorm = settings
            .loudnorm_preset
            .as_deref()
            .map(str::trim)
            .filter(|p| !p.is_empty() && !p.eq_ignore_ascii_case("none"));

        if let Some(lpreset) = active_loudnorm {
            match lpreset.to_ascii_lowercase().as_str() {
                "youtube" | "spotify" => {
                    af_filters.push("loudnorm=I=-14:TP=-1.0:LRA=11".to_string())
                }
                "podcast" | "apple" => af_filters.push("loudnorm=I=-16:TP=-1.0:LRA=11".to_string()),
                "broadcast" | "tv" => af_filters.push("loudnorm=I=-23:TP=-1.5:LRA=14".to_string()),
                "peak" => af_filters.push("loudnorm=I=-16:TP=-0.5:LRA=11".to_string()),
                _ => af_filters.push("loudnorm=I=-14:TP=-1.5:LRA=11".to_string()),
            }
        } else if settings.normalize {
            af_filters.push("loudnorm=I=-14:TP=-1.5:LRA=11".to_string());
        }

        if !af_filters.is_empty() {
            args.extend(["-af".to_string(), af_filters.join(",")]);
        }

        args.extend(["-max_muxing_queue_size".to_string(), "1024".to_string()]);
        args.push(output_path.to_string_lossy().to_string());
        args
    }
}
