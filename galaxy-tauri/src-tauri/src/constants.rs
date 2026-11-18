pub const APP_NAME: &str = "Galaxy Media Pro";
pub const APP_VERSION: &str = "3.1.0";
pub const DEFAULT_OUTPUT_DIR_NAME: &str = "GalaxyOutput";

// Unified Storage & Logging Constants
pub const APP_DATA_DIR_NAME: &str = "GalaxyMediaPro";
pub const SETTINGS_FILE_NAME: &str = "settings.json";
pub const HISTORY_FILE_NAME: &str = "history.json";
pub const PRESETS_FILE_NAME: &str = "presets.json";
pub const HW_CACHE_FILE_NAME: &str = "hw_cache.json";
pub const HW_CACHE_TTL_SECS: u64 = 86_400; // 24 hours

// Legacy migration paths
pub const LEGACY_CONFIG_DIR_NAME: &str = ".galaxy_converter";
pub const LEGACY_SETTINGS_FILE_NAME: &str = "tauri_settings.json";
pub const LEGACY_APPDATA_DIR_NAME: &str = "GalaxyMediaConverter";

// Logging & Retention
pub const LOG_DIR_NAME: &str = "logs";
pub const APP_LOG_FILE_NAME: &str = "galaxy.log";
pub const CRASH_LOG_FILE_NAME: &str = "crash.log";
pub const MAX_LOG_FILE_BYTES: u64 = 5 * 1024 * 1024; // 5 MiB
pub const MAX_LOG_ARCHIVES: usize = 3;
pub const LOG_RETENTION_DAYS: u64 = 14;
pub const STALE_TEMP_MAX_AGE_SECS: u64 = 86_400; // 24 hours

// Media Extension Sets (Reference + Studio parity)
pub const SUPPORTED_VIDEO_EXTENSIONS: &[&str] = &[
    "mp4", "mkv", "avi", "mov", "webm", "flv", "wmv", "m4v", "ts", "gif", "3gp", "mpeg", "mpg",
    "mts",
];

pub const SUPPORTED_AUDIO_EXTENSIONS: &[&str] = &[
    "mp3", "wav", "flac", "aac", "ogg", "opus", "m4a", "alac", "wma", "aiff",
];

pub const SUPPORTED_IMAGE_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "webp", "avif", "ico", "bmp", "tiff", "tif", "gif",
];

pub const ALL_SUPPORTED_EXTENSIONS: &[&str] = &[
    "mp4", "mkv", "avi", "mov", "webm", "flv", "wmv", "m4v", "ts", "gif", "3gp", "mpeg", "mpg",
    "mts", "mp3", "wav", "flac", "aac", "ogg", "opus", "m4a", "alac", "wma", "aiff", "png", "jpg",
    "jpeg", "webp", "avif", "ico", "bmp", "tiff", "tif",
];

// Operational Limits
pub const MAX_IMAGE_PIXELS: u64 = 100_000_000; // 100 Megapixels
pub const MAX_IMAGE_ALLOC_BYTES: u64 = 512 * 1024 * 1024; // 512 Megabytes
pub const MAX_STDERR_RING_BUFFER_LINES: usize = 100;
pub const PROGRESS_EMITTER_INTERVAL_MS: u64 = 166; // ~6 Hz
pub const CANCELLATION_GRACE_PERIOD_MS: u64 = 500;
pub const DEFAULT_AUDIO_BITRATE: &str = "192k";
pub const DEFAULT_AUDIO_CODEC: &str = "aac";
pub const SUBPROCESS_TIMEOUT_SECS: u64 = 30;
pub const MAX_TIMECODE_SECS: f64 = 864_000.0; // 240 hours
