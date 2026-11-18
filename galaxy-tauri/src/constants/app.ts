export const APP_METADATA = {
  name: 'Galaxy Media Pro',
  version: '3.1.0',
  edition: 'Studio Edition',
  defaultOutputFolderName: 'GalaxyOutput',
  techStackSummary: 'Pure Rust + React 19 + Tauri v2 + Tailwind CSS v4',
  authorName: 'Ali Rashidi',
  authorBrand: 'Write Your Way',
  telegramChannel: 'https://t.me/writeyourway',
  telegramHandle: '@writeyourway',
  contactUrl: 'https://t.me/a_ra_80',
  contactHandle: '@a_ra_80',
} as const;

export const SUPPORTED_VIDEO_FORMATS = ['mp4', 'mkv', 'mov', 'webm', 'avi', 'gif'] as const;
export const SUPPORTED_VIDEO_CODECS = ['H.264', 'H.265', 'AV1', 'VP9', 'ProRes 422'] as const;

export const CROP_PRESETS = [
  { id: 'none', labelFa: 'ابعاد اصلی (بدون برش)', labelEn: 'Original Framing (No Crop)' },
  { id: '1:1', labelFa: 'مربع ۱:۱ (اینستاگرام)', labelEn: '1:1 Square (Instagram)' },
  { id: '9:16', labelFa: 'عمودی ۹:۱۶ (ریلز، استوری)', labelEn: '9:16 Vertical (Reels / Story)' },
  { id: '16:9', labelFa: 'افقی ۱۶:۹ (یوتیوب، عریض)', labelEn: '16:9 Widescreen (YouTube)' },
  { id: '4:3', labelFa: 'کلاسیک ۴:۳ (تلویزیون)', labelEn: '4:3 Classic Standard' },
] as const;

export const SPEED_PRESETS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0] as const;

export const PRORES_PROFILES = [
  {
    id: 'proxy',
    labelFa: 'ProRes 422 Proxy (سبک و سریع / تدوین آفلاین)',
    labelEn: 'ProRes 422 Proxy (Light & Fast / Offline Edit)',
  },
  {
    id: 'lt',
    labelFa: 'ProRes 422 LT (کیفیت بالا / حجم بهینه)',
    labelEn: 'ProRes 422 LT (High Quality / Compact)',
  },
  {
    id: 'standard',
    labelFa: 'ProRes 422 Standard (استاندارد تدوین)',
    labelEn: 'ProRes 422 Standard (Editing Standard)',
  },
  {
    id: 'hq',
    labelFa: 'ProRes 422 HQ (حداکثر جزئیات بصری)',
    labelEn: 'ProRes 422 HQ (Maximum Visual Fidelity)',
  },
] as const;

export const LOUDNORM_PRESETS = [
  { id: 'none', labelFa: 'غیرفعال (بدون نرمال‌سازی)', labelEn: 'Disabled (Native Loudness)' },
  { id: 'youtube', labelFa: 'یوتیوب و اسپاتیفای (-14 LUFS)', labelEn: 'YouTube / Spotify (-14 LUFS)' },
  { id: 'podcast', labelFa: 'پادکست اپل (-16 LUFS)', labelEn: 'Apple Podcast (-16 LUFS)' },
  { id: 'broadcast', labelFa: 'استاندارد تلویزیون (-23 LUFS)', labelEn: 'Broadcast Standard (-23 LUFS)' },
  { id: 'peak', labelFa: 'کنترل قله صوت (-0.5 dB Peak)', labelEn: 'True Peak Limiter (-0.5 dB Peak)' },
] as const;

export const SUPPORTED_AUDIO_FORMATS = ['mp3', 'aac', 'flac', 'wav', 'ogg', 'opus', 'm4a', 'wma', 'alac'] as const;
export const SUPPORTED_AUDIO_BITRATES = ['64k', '128k', '192k', '256k', '320k'] as const;

export const SUPPORTED_IMAGE_FORMATS = ['webp', 'avif', 'png', 'jpeg', 'gif', 'ico', 'bmp', 'tiff'] as const;

export const ALL_MEDIA_EXTENSIONS = [
  'mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv', 'm4v', 'ts', 'gif', '3gp', 'mpeg', 'mpg', 'mts',
  'mp3', 'wav', 'flac', 'aac', 'ogg', 'opus', 'm4a', 'alac', 'wma', 'aiff',
  'jpg', 'jpeg', 'png', 'webp', 'avif', 'bmp', 'tiff', 'tif', 'ico',
] as const;

export const ACCELERATION_MODES = [
  { id: 'auto', labelKey: 'auto' },
  { id: 'nvidia', labelKey: 'nvidia' },
  { id: 'amd', labelKey: 'amd' },
  { id: 'intel', labelKey: 'intel' },
  { id: 'cpu', labelKey: 'cpu' },
] as const;

export const RESOLUTION_PRESETS = [
  { id: 'original', labelKey: 'scaleOriginal' },
  { id: '3840:2160', labelFa: '4K UHD (3840×2160)', labelEn: '4K UHD (3840×2160)' },
  { id: '1920:1080', labelFa: '1080p Full HD (1920×1080)', labelEn: '1080p FHD (1920×1080)' },
  { id: '1280:720', labelFa: '720p HD (1280×720)', labelEn: '720p HD (1280×720)' },
  { id: '1080:1920', labelFa: 'عمودی / استوری (1080×1920)', labelEn: 'Vertical / Story (1080×1920)' },
  { id: '854:480', labelFa: '480p استاندارد (854×480)', labelEn: '480p SD (854×480)' },
] as const;

export const FRAMERATE_PRESETS = [
  { value: 0, labelKey: 'fpsOriginal' },
  { value: 24, labelFa: '۲۴ فریم (سینمایی)', labelEn: '24 FPS (Cinematic Film)' },
  { value: 30, labelFa: '۳۰ فریم (استاندارد پخش)', labelEn: '30 FPS (Standard Broadcast)' },
  { value: 60, labelFa: '۶۰ فریم (فوق‌العاده روان)', labelEn: '60 FPS (High Smoothness)' },
] as const;

export const AUDIO_SAMPLE_RATES = [
  { value: 0, labelKey: 'sampleRateOriginal' },
  { value: 44100, labelFa: '۴۴.۱ کیلوهرتز (استاندارد CD)', labelEn: '44.1 kHz (CD Standard)' },
  { value: 48000, labelFa: '۴۸.۰ کیلوهرتز (استودیویی / پخش)', labelEn: '48.0 kHz (Studio / Broadcast)' },
  { value: 96000, labelFa: '۹۶.۰ کیلوهرتز (صدای Hi-Res)', labelEn: '96.0 kHz (Hi-Res Audio)' },
] as const;

export const NVENC_PRESETS = [
  { id: 'p1', labelFa: 'P1: سریع‌ترین (کمترین فشار پردازشی)', labelEn: 'P1: Fastest (Low Overhead)' },
  { id: 'p2', labelFa: 'P2: خیلی سریع', labelEn: 'P2: Faster' },
  { id: 'p3', labelFa: 'P3: سریع', labelEn: 'P3: Fast' },
  { id: 'p4', labelFa: 'P4: متعادل (استاندارد پیشنهادی)', labelEn: 'P4: Balanced (Standard)' },
  { id: 'p5', labelFa: 'P5: کیفیت بالا', labelEn: 'P5: High Quality' },
  { id: 'p6', labelFa: 'P6: کیفیت بسیار بالا', labelEn: 'P6: Higher Quality' },
  { id: 'p7', labelFa: 'P7: حداکثر کیفیت بصری', labelEn: 'P7: Maximum Quality' },
] as const;
