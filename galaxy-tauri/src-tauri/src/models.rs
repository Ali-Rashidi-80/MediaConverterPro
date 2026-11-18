use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Error, Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "kind", content = "payload")]
pub enum AppError {
    #[error("Filesystem I/O error: {message}")]
    Io {
        message: String,
        path: Option<String>,
    },

    #[error("File not found: {0}")]
    FileNotFound(String),

    #[error("FFmpeg binary not found in system PATH or application bundle")]
    FfmpegBinaryNotFound,

    #[error("FFmpeg execution failed with exit code {exit_code:?}")]
    FfmpegExecutionError {
        exit_code: Option<i32>,
        last_error_log: String,
    },

    #[error("GPU encoder session exhausted: {0}")]
    GpuSessionExhausted(String),

    #[error("Image exceeds maximum memory allocation limit: {width}x{height}")]
    ImageBombDetected {
        width: u32,
        height: u32,
    },

    #[error("Output file is corrupted or 0 bytes: {0}")]
    EncodingCorrupted(String),

    #[error("Operation was cancelled by user")]
    JobCancelled,

    #[error("Validation error: {0}")]
    Validation(String),

    #[error("Security policy violation: {0}")]
    SecurityViolation(String),

    #[error("Internal application error: {0}")]
    Internal(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MediaKind {
    Video,
    Audio,
    Image,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PipelineTier {
    Copy,
    Cpu,
    Tier1, // Full GPU (decode + scale + encode)
    Tier2, // Hybrid (CPU filters + GPU encode)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskProgressUpdate {
    pub job_id: String,
    pub percentage: f32,
    pub fps: f32,
    pub speed: f32,
    pub eta_seconds: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GpuDeviceInfo {
    pub index: u32,
    pub name: String,
    pub vendor: String, // nvidia | amd | intel | apple | unknown
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct HardwareProfile {
    pub gpus: Vec<GpuDeviceInfo>,
    pub cpu_count: usize,
    pub available_encoders: Vec<String>,
    pub available_hwaccels: Vec<String>,
    pub available_filters: Vec<String>,
    pub recommended_backend: String,
    pub recommended_gpu_slots: usize,
    pub ffmpeg_version: String,
    pub ffmpeg_available: bool,
    pub ffmpeg_path: Option<String>,
}

impl Default for HardwareProfile {
    fn default() -> Self {
        Self {
            gpus: Vec::new(),
            cpu_count: 1,
            available_encoders: Vec::new(),
            available_hwaccels: Vec::new(),
            available_filters: Vec::new(),
            recommended_backend: "cpu".into(),
            recommended_gpu_slots: 0,
            ffmpeg_version: "Not Found".into(),
            ffmpeg_available: false,
            ffmpeg_path: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaFileInfo {
    pub path: String,
    pub filename: String,
    pub size_bytes: u64,
    pub duration_secs: f64,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
    pub bitrate: Option<u64>,
    pub kind: MediaKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct VideoConversionSettings {
    pub format: String,
    pub codec: String,
    pub ui_preset_id: String,
    pub encoder_speed_preset: String,
    pub video_preset: String,
    pub source_audio_codec: Option<String>,
    pub crf: Option<u32>,
    pub bitrate: Option<String>,
    pub scale: Option<String>,
    pub fps: Option<u32>,
    pub rotate: Option<String>,
    pub denoise: bool,
    pub sharpen: bool,
    pub grayscale: bool,
    pub strip_audio: bool,
    pub strip_subs: bool,
    pub trim_start: Option<String>,
    pub trim_end: Option<String>,
    pub accel_mode: String, // auto | nvidia | amd | intel | cpu
    pub nvenc_preset: String, // p1 .. p7
    pub copy_streams: bool,
    pub output_dir: String,
    // Phase 2: Video Studio Controls
    pub brightness: Option<f32>,
    pub contrast: Option<f32>,
    pub saturation: Option<f32>,
    pub gamma: Option<f32>,
    pub crop: Option<String>,
    pub speed: Option<f32>,
    pub prores_profile: Option<String>,
    pub hdr_to_sdr: bool,
    pub subtitle_path: Option<String>,
    // Phase 8: Metadata & Privacy
    pub privacy_wipe: bool,
    pub metadata_title: Option<String>,
    pub metadata_artist: Option<String>,
    pub metadata_album: Option<String>,
    pub metadata_year: Option<String>,
    pub metadata_copyright: Option<String>,
}

impl Default for VideoConversionSettings {
    fn default() -> Self {
        Self {
            format: "mp4".into(),
            codec: "H.264".into(),
            ui_preset_id: "original".into(),
            encoder_speed_preset: "medium".into(),
            video_preset: "original".into(),
            source_audio_codec: None,
            crf: Some(23),
            bitrate: None,
            scale: Some("original".into()),
            fps: Some(0),
            rotate: None,
            denoise: false,
            sharpen: false,
            grayscale: false,
            strip_audio: false,
            strip_subs: false,
            trim_start: None,
            trim_end: None,
            accel_mode: "auto".into(),
            nvenc_preset: "p4".into(),
            copy_streams: false,
            output_dir: String::new(),
            brightness: None,
            contrast: None,
            saturation: None,
            gamma: None,
            crop: None,
            speed: None,
            prores_profile: None,
            hdr_to_sdr: false,
            subtitle_path: None,
            privacy_wipe: false,
            metadata_title: None,
            metadata_artist: None,
            metadata_album: None,
            metadata_year: None,
            metadata_copyright: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AudioConversionSettings {
    pub format: String,
    pub bitrate: String, // 128k, 192k, 256k, 320k
    pub sample_rate: u32, // 44100, 48000
    pub channels: String, // mono, stereo
    pub volume: Option<u32>, // 50 .. 200
    pub normalize: bool,
    pub trim_start: Option<String>,
    pub trim_end: Option<String>,
    pub output_dir: String,
    // Phase 4: Audio Studio & Mastering
    pub loudnorm_preset: Option<String>,
    pub bass_boost: Option<f32>,
    pub treble_boost: Option<f32>,
    pub compressor: bool,
    pub reverb: bool,
    pub downmix: bool,
    pub speed: Option<f32>,
    // Phase 8: Metadata & Privacy
    pub privacy_wipe: bool,
    pub metadata_title: Option<String>,
    pub metadata_artist: Option<String>,
    pub metadata_album: Option<String>,
    pub metadata_year: Option<String>,
    pub metadata_copyright: Option<String>,
}

impl Default for AudioConversionSettings {
    fn default() -> Self {
        Self {
            format: "mp3".into(),
            bitrate: "192k".into(),
            sample_rate: 0,
            channels: "original".into(),
            volume: Some(100),
            normalize: false,
            trim_start: None,
            trim_end: None,
            output_dir: String::new(),
            loudnorm_preset: None,
            bass_boost: None,
            treble_boost: None,
            compressor: false,
            reverb: false,
            downmix: false,
            speed: None,
            privacy_wipe: false,
            metadata_title: None,
            metadata_artist: None,
            metadata_album: None,
            metadata_year: None,
            metadata_copyright: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ImageConversionSettings {
    pub format: String, // webp, png, jpeg, avif, ico, bmp, tiff
    pub quality: u8, // 1..100
    pub resize_width: Option<u32>,
    pub resize_height: Option<u32>,
    pub strip_metadata: bool,
    pub flip_h: bool,
    pub flip_v: bool,
    pub grayscale: bool,
    pub rotate: Option<u32>,
    pub output_dir: String,
}

impl Default for ImageConversionSettings {
    fn default() -> Self {
        Self {
            format: "webp".into(),
            quality: 85,
            resize_width: None,
            resize_height: None,
            strip_metadata: true,
            flip_h: false,
            flip_v: false,
            grayscale: false,
            rotate: None,
            output_dir: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppSettings {
    pub language: String, // fa | en
    pub theme: String,    // dark | light
    pub output_dir: String,
    pub parallel_mode: String, // smart | parallel | sequential
    pub max_parallel_jobs: usize,
    pub accel_mode: String,
    pub nvenc_preset: String,
    pub is_pro_mode: bool,
    pub sound_notifications: bool,
    pub sleep_prevention: bool,
    pub font_scale: String, // small | medium | large
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            language: "fa".into(),
            theme: "dark".into(),
            output_dir: String::new(),
            parallel_mode: "smart".into(),
            max_parallel_jobs: 0,
            accel_mode: "auto".into(),
            nvenc_preset: "p4".into(),
            is_pro_mode: false,
            sound_notifications: true,
            sleep_prevention: true,
            font_scale: "medium".into(),
        }
    }
}

// Phase 6: Custom Presets
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomPreset {
    pub id: String,
    pub name: String,
    pub description: String,
    pub kind: MediaKind,
    pub video_settings: Option<VideoConversionSettings>,
    pub audio_settings: Option<AudioConversionSettings>,
    #[serde(default)]
    pub image_settings: Option<ImageConversionSettings>,
    pub created_at: u64,
}

// Phase 7: History & Analytics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub id: String,
    pub input_path: String,
    pub output_path: String,
    pub filename: String,
    pub source_size_bytes: u64,
    pub output_size_bytes: u64,
    pub duration_secs: f64,
    pub format: String,
    pub speed: f32,
    pub timestamp: u64,
    pub status: String, // "completed" | "failed"
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct HistorySummary {
    pub total_files: usize,
    pub total_source_bytes: u64,
    pub total_output_bytes: u64,
    pub total_saved_bytes: i64,
    pub saved_percentage: f32,
    pub avg_speed: f32,
}

// Phase 8: Duplicate Scanner
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DuplicateFile {
    pub path: String,
    pub filename: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DuplicateGroup {
    pub file_size: u64,
    pub hash: String,
    pub files: Vec<DuplicateFile>,
}

// Phase 9: Disk Space Info
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiskSpaceInfo {
    pub path: String,
    pub available_bytes: u64,
    pub total_bytes: u64,
    pub is_low: bool,
}


