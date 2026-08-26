# User Guide — Galaxy Media Pro

**Language:** [English](#english) · [فارسی](#فارسی)

---

## English

### Start in 3 steps

```
1. Add files        →  Drag & Drop or “Choose files”
2. Review settings  →  Format & quality (defaults are fine)
3. Start conversion →  Bottom-of-page Start button
```

### While converting

| Action | Behavior |
|--------|----------|
| **⏹ Stop** | Red button — cancels FFmpeg/jobs; unfinished rows show cancelled |
| **➕ Add files** | File / folder / drag & drop — queued and auto-converted |
| **Remove from list** | Only queued or completed — in-progress rows stay |
| **Clear all** | Only when conversion is stopped |

Output is saved to the **output folder** (footer).

---

### Tabs

| Tab | Use |
|-----|-----|
| **Image** | Format convert · resize · rotate · grayscale |
| **Video** | MP4/MKV · preset · GPU · trim |
| **Audio** | MP3/WAV/FLAC · normalize · trim |
| **Settings** | Theme · language · Pro mode · Performance |
| **Help** | FAQ · system status · GPL |

---

### Simple vs Pro

| | Simple | Pro |
|---|--------|-----|
| Main settings | ✅ | ✅ |
| Extra per-page settings | Hidden | Open |
| Performance (GPU/parallel) | — | ✅ |

**Settings → Interface mode → Pro**

---

### Video presets

| Preset | Use |
|--------|-----|
| **Remux only** | Container change only — fastest |
| **Mobile** | 720p · smaller size |
| **YouTube** | 1080p · higher quality |
| **Original** | No extra preset |

---

### GPU acceleration (Pro)

**Settings → Performance → Accelerator**

| Option | Meaning |
|--------|---------|
| Auto | Detect NVIDIA / AMD / Intel |
| CPU only | Always CPU |
| NVIDIA / AMD / Intel | Force backend |

**Pipeline badge** (above video page):

| Badge | Meaning |
|-------|---------|
| Full GPU | decode + filter + encode on GPU |
| Encode GPU | encode on GPU — filters on CPU |
| Remux | stream copy |
| CPU | full CPU |

---

### Parallelism (Pro)

**Settings → Processing mode**

| Mode | Behavior |
|------|----------|
| Sequential | One file at a time |
| Parallel | Max throughput |
| Smart | Automatic suggestion (recommended) |

---

### Footer during conversion

```
🔄 NVENC p4 · 2/5 · ⚡ Encode GPU
     │         │         └── tier
     │         └── progress
     └── encoder
```

---

### Quick FAQ

**Video won’t convert?**  
→ Help → FFmpeg must show Ready.

**GPU failed?**  
→ Continues on CPU — log may show “GPU failed”.

**Where is the output?**  
→ Footer storage path · after convert “Open folder”.

**Too slow?**  
→ Remux only · Smart parallel · Auto accel.

---

### Language

**Settings → Language → فارسی / English**  
Applies immediately.

---

## فارسی

### شروع در ۳ مرحله

```
۱. فایل اضافه کنید     →  Drag & Drop یا «انتخاب فایل»
۲. تنظیمات را ببینید   →  فرمت و کیفیت (پیش‌فرض کافی است)
۳. شروع تبدیل         →  دکمه پایین صفحه
```

### در حین تبدیل

| عمل | رفتار |
|-----|--------|
| **⏹ توقف** | دکمه قرمز — FFmpeg/کارها قطع؛ ناتمام‌ها «لغو شد» |
| **➕ افزودن فایل** | فایل / پوشه / Drag & Drop — به **صف** و تبدیل خودکار |
| **حذف از لیست** | فقط صف یا تکمیل‌شده — «در حال کار» حذف نمی‌شود |
| **پاک کردن همه** | فقط وقتی تبدیل متوقف است |

خروجی در **پوشه خروجی** (footer) ذخیره می‌شود.

### تب‌ها

| تب | کاربرد |
|----|--------|
| **تصویر** | تبدیل فرمت · resize · rotate · grayscale |
| **ویدیو** | MP4/MKV · preset · GPU · trim |
| **صدا** | MP3/WAV/FLAC · normalize · trim |
| **تنظیمات** | تم · زبان · Pro mode · Performance |
| **راهنما** | FAQ · وضعیت سیستم · GPL |

### Simple vs Pro

**Settings → Interface mode → Pro** برای Performance (GPU/parallel).

### FAQ سریع

**ویدیو تبدیل نمی‌شود؟** → Help → FFmpeg باید «آماده» باشد.  
**GPU خطا داد؟** → خودکار CPU.  
**خروجی کجاست؟** → footer مسیر ذخیره‌سازی.  
**کند است؟** → Remux only · Smart parallel · Auto accel.

### زبان

**Settings → Language → فارسی / English**

---

[← Docs index](INDEX.md) · [Install](INSTALL.md) · [FFmpeg](FFMPEG_BUNDLE.md)
