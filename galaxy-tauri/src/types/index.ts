export type MediaKind = 'video' | 'audio' | 'image';
export type TaskStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
export type QueueFilter = 'all' | 'processing' | 'queued' | 'completed' | 'failed';

export interface TaskItem {
  id: string;
  filePath: string;
  fileName: string;
  fileSize: number;
  outputSize?: number;
  durationSec: number;
  mediaKind: MediaKind;
  targetFormat: string;
  hasCustomFormat?: boolean;
  fallbackUsed?: boolean;
  progress: number;
  fps: number;
  speed: number;
  etaSeconds: number;
  status: TaskStatus;
  errorLog?: string;
  outputPath?: string;
  width?: number;
  height?: number;
  videoCodec?: string;
  audioCodec?: string;
  videoSettings?: VideoConversionSettings;
  audioSettings?: AudioConversionSettings;
  imageSettings?: ImageConversionSettings;
}

export interface QueueActions {
  addFiles: () => void;
  addFolder: () => void;
  startQueue: () => void;
  dispatch?: () => void;
}

export interface GpuDeviceInfo {
  index: number;
  name: string;
  vendor: string;
}

export interface HardwareProfile {
  gpus: GpuDeviceInfo[];
  cpu_count: number;
  available_encoders: string[];
  available_hwaccels: string[];
  available_filters?: string[];
  recommended_backend: string;
  recommended_gpu_slots: number;
  ffmpeg_version: string;
  ffmpeg_available: boolean;
  ffmpeg_path?: string | null;
}

export interface MediaFileInfo {
  path: string;
  filename: string;
  size_bytes: number;
  duration_secs: number;
  width?: number;
  height?: number;
  video_codec?: string;
  audio_codec?: string;
  bitrate?: number;
  kind: MediaKind;
}

export interface VideoConversionSettings {
  format: string;
  codec: string;
  ui_preset_id?: string;
  encoder_speed_preset?: string;
  video_preset: string;
  source_audio_codec?: string;
  crf?: number;
  bitrate?: string;
  scale?: string;
  fps?: number;
  rotate?: string;
  denoise: boolean;
  sharpen: boolean;
  grayscale: boolean;
  strip_audio: boolean;
  strip_subs: boolean;
  trim_start?: string;
  trim_end?: string;
  accel_mode: string;
  nvenc_preset: string;
  copy_streams: boolean;
  output_dir: string;
  // Phase 2: Video Studio Controls
  brightness?: number;
  contrast?: number;
  saturation?: number;
  gamma?: number;
  crop?: string;
  speed?: number;
  prores_profile?: string;
  hdr_to_sdr?: boolean;
  subtitle_path?: string;
  // Phase 8: Metadata & Privacy
  privacy_wipe?: boolean;
  metadata_title?: string;
  metadata_artist?: string;
  metadata_album?: string;
  metadata_year?: string;
  metadata_copyright?: string;
}

export interface AudioConversionSettings {
  format: string;
  bitrate: string;
  sample_rate: number;
  channels: string;
  volume?: number;
  normalize: boolean;
  trim_start?: string;
  trim_end?: string;
  output_dir: string;
  // Phase 4: Audio Studio & Mastering
  loudnorm_preset?: string;
  bass_boost?: number;
  treble_boost?: number;
  compressor?: boolean;
  reverb?: boolean;
  downmix?: boolean;
  speed?: number;
  // Phase 8: Metadata & Privacy
  privacy_wipe?: boolean;
  metadata_title?: string;
  metadata_artist?: string;
  metadata_album?: string;
  metadata_year?: string;
  metadata_copyright?: string;
}

export interface ImageConversionSettings {
  format: string;
  quality: number;
  resize_width?: number;
  resize_height?: number;
  strip_metadata: boolean;
  flip_h: boolean;
  flip_v: boolean;
  grayscale: boolean;
  rotate?: number;
  output_dir: string;
}

export interface AppSettings {
  language: string;
  theme: string;
  output_dir: string;
  parallel_mode: string;
  max_parallel_jobs: number;
  accel_mode: string;
  nvenc_preset: string;
  is_pro_mode: boolean;
  sound_notifications: boolean;
  sleep_prevention: boolean;
  font_scale: 'small' | 'medium' | 'large';
}

export interface TaskProgressUpdate {
  job_id: string;
  percentage: number;
  fps: number;
  speed: number;
  eta_seconds: number;
}

export interface CustomPreset {
  id: string;
  name: string;
  description: string;
  kind: MediaKind;
  video_settings?: VideoConversionSettings;
  audio_settings?: AudioConversionSettings;
  image_settings?: ImageConversionSettings;
  created_at: number;
}

export interface HistoryEntry {
  id: string;
  input_path: string;
  output_path: string;
  filename: string;
  source_size_bytes: number;
  output_size_bytes: number;
  duration_secs: number;
  format: string;
  speed: number;
  timestamp: number;
  status: string;
}

export interface HistorySummary {
  total_files: number;
  total_source_bytes: number;
  total_output_bytes: number;
  total_saved_bytes: number;
  saved_percentage: number;
  avg_speed: number;
}

export interface DuplicateFile {
  path: string;
  filename: string;
  size_bytes: number;
}

export interface DuplicateGroup {
  file_size: number;
  hash: string;
  files: DuplicateFile[];
}

export interface DiskSpaceInfo {
  path: string;
  available_bytes: number;
  total_bytes: number;
  is_low: boolean;
}
