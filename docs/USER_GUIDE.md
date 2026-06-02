# راهنمای کاربر — Galaxy Media Pro

---

## شروع در ۳ مرحله

```
۱. فایل اضافه کنید     →  Drag & Drop یا «انتخاب فایل»
۲. تنظیمات را ببینید   →  فرمت و کیفیت (پیش‌فرض کافی است)
۳. شروع تبدیل         →  دکمه پایین صفحه
```

خروجی در **پوشه خروجی** (footer) ذخیره می‌شود.

---

## تب‌ها

| تب | کاربرد |
|----|--------|
| **تصویر** | تبدیل فرمت · resize · rotate · grayscale |
| **ویدیو** | MP4/MKV · preset · GPU · trim |
| **صدا** | MP3/WAV/FLAC · normalize · trim |
| **تنظیمات** | تم · زبان · Pro mode · Performance |
| **راهنما** | FAQ · وضعیت سیستم · GPL |

---

## حالت Simple vs Pro

| | Simple | Pro |
|---|--------|-----|
| تنظیمات اصلی | ✅ | ✅ |
| تنظیمات بیشتر (هر صفحه) | مخفی | باز |
| Performance (GPU/parallel) | — | ✅ |

**Settings → Interface mode → Pro**

---

## presetهای ویدیو

| preset | کاربرد |
|--------|--------|
| **Remux only** | فقط تغییر container — سریع‌ترین |
| **Mobile** | 720p · حجم کم |
| **YouTube** | 1080p · کیفیت بالا |
| **Original** | بدون preset اضافی |

---

## شتاب GPU (Pro)

**Settings → Performance → Accelerator**

| گزینه | معنی |
|--------|------|
| Auto | تشخیص NVIDIA / AMD / Intel |
| CPU only | همیشه CPU |
| NVIDIA / AMD / Intel | اجبار backend |

**نشانه pipeline** (بالای صفحه ویدیو):

| نشان | معنی |
|------|------|
| Full GPU | decode + filter + encode روی GPU |
| Encode GPU | فقط encode GPU — فیلتر CPU |
| Remux | copy stream |
| CPU | کامل CPU |

---

## موازی‌سازی (Pro)

**Settings → Processing mode**

| حالت | رفتار |
|------|--------|
| Sequential | یک فایل |
| Parallel | حداکثر سرعت |
| Smart | پیشنهاد خودکار (توصیه) |

---

## Footer در حین تبدیل

```
🔄 NVENC p4 · 2/5 · ⚡ Encode GPU
     │         │         └── tier
     │         └── پیشرفت
     └── encoder
```

---

## FAQ سریع

**ویدیو تبدیل نمی‌شود؟**  
→ Help → FFmpeg باید «آماده» باشد.

**GPU خطا داد؟**  
→ خودکار CPU ادامه می‌دهد — در log «GPU ناموفق» می‌بینید.

**خروجی کجاست؟**  
→ footer «مسیر ذخیره‌سازی» · بعد از تبدیل «باز کردن پوشه».

**کند است؟**  
→ Remux only · Smart parallel · Auto accel.

---

## زبان

**Settings → Language → فارسی / English**  
تغییر بلافاصله اعمال می‌شود.

---

[← فهرست](INDEX.md) · [نصب](INSTALL.md) · [FFmpeg](FFMPEG_BUNDLE.md)
