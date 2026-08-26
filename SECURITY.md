# Security Policy — Galaxy Media Pro

**Language:** [English](#english) · [فارسی](#فارسی)

---

## English

### Supported versions

| Version | Security updates |
|---------|------------------|
| 3.0 Pro | ✅ Supported |
| Pre-3.0 / archive | ❌ Not supported |

### Reporting a vulnerability

Please **do not** open a public GitHub issue for security-sensitive reports.

Preferred channel:

- Telegram: [@a_ra_80](https://t.me/a_ra_80)
- Channel (non-sensitive coordination): [@writeyourway](https://t.me/writeyourway)

Include when possible:

- Affected version / commit / build type (source vs portable EXE)
- OS and GPU driver details
- Clear reproduction steps
- Impact assessment (crash, data loss, privilege, etc.)

You should receive an acknowledgement when the author is available. Please allow reasonable time for triage before any public disclosure.

### Scope notes

- Bundled **FFmpeg** is third-party GPL software — report FFmpeg-core issues upstream when appropriate, and tell us if our packaging/usage amplifies risk.
- PySide6 / Qt and Python dependencies follow their upstream security processes.
- This app processes local media files; treat untrusted media with normal caution.

### Safe harbor

Good-faith research that follows this policy and avoids privacy violations, service disruption, or data destruction is appreciated.

---

## فارسی

### نسخه‌های پشتیبانی‌شده

| نسخه | به‌روزرسانی امنیتی |
|------|---------------------|
| 3.0 Pro | ✅ پشتیبانی می‌شود |
| پیش از 3.0 / archive | ❌ پشتیبانی نمی‌شود |

### گزارش آسیب‌پذیری

برای گزارش‌های حساس امنیتی، **issue عمومی** در GitHub باز نکنید.

کانال ترجیحی:

- تلگرام: [@a_ra_80](https://t.me/a_ra_80)
- کانال (هماهنگی غیرحساس): [@writeyourway](https://t.me/writeyourway)

در صورت امکان این موارد را بفرستید:

- نسخه / کامیت / نوع build (سورس یا EXE قابل‌حمل)
- سیستم‌عامل و درایور GPU
- مراحل بازتولید
- ارزیابی اثر (کرش، از دست رفتن داده، …)

پس از در دسترس بودن نویسنده، تأیید دریافت خواهید کرد. قبل از افشای عمومی، زمان معقول برای triage در نظر بگیرید.

### یادداشت دامنه

- **FFmpeg** باندل‌شده شخص ثالث (GPL) است — باگ‌های هسته را در صورت لزوم upstream گزارش کنید و اگر بسته‌بندی/استفاده ما ریسک را تشدید می‌کند به ما بگویید.
- این اپ فایل‌های محلی را پردازش می‌کند؛ با رسانهٔ نامطمئن محتاط باشید.

---

[← README](README.md) · [Contributing](CONTRIBUTING.md)
