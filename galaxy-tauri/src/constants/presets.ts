export interface VideoPresetItem {
  id: string;
  nameFa: string;
  nameEn: string;
  descFa: string;
  descEn: string;
  scale?: string;
  crf: number;
  preset: string;
  encoder_speed_preset: string;
  fps?: number;
  copyStreams?: boolean;
}

export const VIDEO_PRESETS: VideoPresetItem[] = [
  {
    id: 'original',
    nameFa: 'کیفیت استاندارد متعادل',
    nameEn: 'Standard Balanced',
    descFa: 'حفظ رزولوشن اصلی با فشرده‌سازی استاندارد و حجم متناسب',
    descEn: 'Original resolution with standard balanced compression',
    crf: 23,
    preset: 'medium',
    encoder_speed_preset: 'medium',
  },
  {
    id: 'youtube',
    nameFa: 'یوتیوب ۱۰۸۰p پرکیفیت',
    nameEn: 'YouTube 1080p High Quality',
    descFa: 'رزولوشن ۱۰۸۰p با نرخ بیت بالا مناسب آپلود در یوتیوب',
    descEn: 'Full HD 1080p optimized for YouTube uploads',
    scale: '1920:1080',
    crf: 18,
    preset: 'slow',
    encoder_speed_preset: 'slow',
    fps: 30,
  },
  {
    id: 'instagram',
    nameFa: 'اینستاگرام ریلز و استوری',
    nameEn: 'Instagram Reels / Story',
    descFa: 'رزولوشن عمودی ۱۰۸۰x۱۹۲۰ برای ریلز و استوری بدون افت کیفیت',
    descEn: 'Vertical 9:16 (1080x1920) optimized for Instagram',
    scale: '1080:1920',
    crf: 23,
    preset: 'medium',
    encoder_speed_preset: 'medium',
    fps: 30,
  },
  {
    id: 'mobile',
    nameFa: 'موبایل و اشتراک سریع',
    nameEn: 'Mobile / Fast Share',
    descFa: 'رزولوشن ۷۲۰p سبک و بهینه برای تلگرام و واتساپ',
    descEn: 'Compact 720p for fast messenger sharing',
    scale: '1280:720',
    crf: 28,
    preset: 'fast',
    encoder_speed_preset: 'fast',
  },
  {
    id: 'web',
    nameFa: 'وب سبک (480p سریع)',
    nameEn: 'Web Compact (480p Fast)',
    descFa: 'حجم بسیار کم ۴۸۰p با انکود سریع جهت اشتراک‌گذاری سریع وب',
    descEn: 'Lightweight 480p with faster encoding for instant web uploads',
    scale: '854:480',
    crf: 28,
    preset: 'faster',
    encoder_speed_preset: 'faster',
  },
  {
    id: 'aparat',
    nameFa: '🇮🇷 آپارات (Aparat 1080p)',
    nameEn: '🇮🇷 Aparat Full HD',
    descFa: 'کانتینر MP4 بهینه با فست‌استارت و صدای AAC 192k جهت آپلود سریع در آپارات',
    descEn: 'Optimized 1080p with FastStart and AAC 192k for Aparat',
    scale: '1920:1080',
    crf: 20,
    preset: 'medium',
    encoder_speed_preset: 'medium',
    fps: 30,
  },
  {
    id: 'rubika_eitaa',
    nameFa: '🇮🇷 پیام‌رسان‌ها (ایتا، روبیکا، بله زیر ۵۰MB)',
    nameEn: '🇮🇷 Messengers (Under 50MB)',
    descFa: 'فشرده‌سازی هوشمند رزولوشن ۷۲۰p سبک جهت ارسال آنی بدون نیاز به اشتراک ویژه',
    descEn: 'Dynamic lightweight 720p compression under 50MB for national messengers',
    scale: '1280:720',
    crf: 27,
    preset: 'fast',
    encoder_speed_preset: 'fast',
    fps: 25,
  },
  {
    id: 'discord',
    nameFa: '🌐 دیسکورد (زیر ۲۵MB)',
    nameEn: '🌐 Discord (< 25MB)',
    descFa: 'محدودسازی حجم ویدیو به سقف رایگان ۲۵ مگابایت دیسکورد',
    descEn: 'Compact compression optimized for Discord 25MB free limit',
    scale: '1280:720',
    crf: 28,
    preset: 'fast',
    encoder_speed_preset: 'fast',
  },
  {
    id: 'youtube_4k',
    nameFa: '🌐 یوتیوب 4K Ultra HD',
    nameEn: '🌐 YouTube 4K Ultra HD',
    descFa: 'رزولوشن 4K با CRF 18 و نهایت وضوح بصری برای یوتیوب',
    descEn: 'Stunning 4K resolution with CRF 18 for YouTube',
    scale: '3840:2160',
    crf: 18,
    preset: 'slow',
    encoder_speed_preset: 'slow',
    fps: 60,
  },
  {
    id: 'archive',
    nameFa: 'آرشیو کیفیت بالا',
    nameEn: 'High Fidelity Archive',
    descFa: 'حداکثر شفافیت بصری جهت نگهداری طولانی‌مدت ویدیوها',
    descEn: 'Near-lossless archiving with slow compression',
    crf: 18,
    preset: 'slow',
    encoder_speed_preset: 'slow',
  },
  {
    id: 'fast_copy',
    nameFa: 'تغییر کانتینر بدون انکود (فوری)',
    nameEn: 'Direct Stream Remux (Instant)',
    descFa: 'تبدیل پسوند بدون افت کیفیت در ۱ ثانیه با کپی جریان',
    descEn: 'Instant container change in seconds without re-encoding',
    crf: 0,
    preset: 'fast',
    encoder_speed_preset: 'fast',
    copyStreams: true,
  },
];

