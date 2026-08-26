# Contributing — Galaxy Media Pro

**Language:** [English](#english) · [فارسی](#فارسی)

---

## English

Thank you for your interest. **Galaxy Media Pro** is a **proprietary** project (see [LICENSE](LICENSE)). External contributions are welcome **only by prior agreement** with the author.

### Before you start

1. Contact: Telegram [@a_ra_80](https://t.me/a_ra_80) or channel [@writeyourway](https://t.me/writeyourway)
2. Agree on scope (bugfix, docs, tests, feature)
3. Fork / branch only after agreement

### Dev setup

```powershell
git clone https://github.com/Ali-Rashidi-80/MediaConverterPro.git
cd MediaConverterPro
pip install -r requirements.txt -r requirements-dev.txt
python tools/bootstrap_ffmpeg.py    # if ffmpeg.exe is missing
python galaxy_ultimate.py
```

Full guide: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)

### Conventions (non-negotiable)

| Topic | Rule |
|-------|------|
| Entry | `galaxy_ultimate.py` — PyInstaller target |
| Package | All app logic under `galaxy/` |
| i18n | Every user-facing string in `galaxy_i18n.py` — **both FA + EN** |
| Workers | No Qt imports in `image_task.py` |
| Docs | Default language **English**; keep Persian parity where docs are bilingual |
| Tests | Add/adjust pytest coverage for behavior changes |

### Quality gate (required before merge)

```powershell
python tools/qa_full.py --full
# minimum: python -m pytest tests -q
```

Also expected locally:

```powershell
python -m ruff check galaxy tests tools
python -m mypy galaxy galaxy_i18n.py galaxy_fonts.py
```

### Pull requests

- One focused change per PR
- Describe **why**, not only what
- Update `docs/CHANGELOG.md` for user-visible fixes/features
- Do not commit secrets, `dist/`, `build/`, or `.cursor/`
- Do not expand scope into `archive/` legacy rewrites

### Code of collaboration

- Be respectful and precise
- Prefer reproducible bug reports (OS, GPU, FFmpeg build, steps)
- Security issues → [SECURITY.md](SECURITY.md), not public issues

---

## فارسی

از علاقه‌مندی‌تان سپاسگزاریم. **Galaxy Media Pro** پروژهٔ **اختصاصی (proprietary)** است ([LICENSE](LICENSE)). مشارکت خارجی **فقط با توافق قبلی** با نویسنده پذیرفته می‌شود.

### قبل از شروع

1. تماس: تلگرام [@a_ra_80](https://t.me/a_ra_80) یا کانال [@writeyourway](https://t.me/writeyourway)
2. توافق روی دامنه (باگ‌فیکس، docs، تست، فیچر)
3. فقط پس از توافق، fork / branch بسازید

### راه‌اندازی توسعه

```powershell
git clone https://github.com/Ali-Rashidi-80/MediaConverterPro.git
cd MediaConverterPro
pip install -r requirements.txt -r requirements-dev.txt
python tools/bootstrap_ffmpeg.py
python galaxy_ultimate.py
```

راهنمای کامل: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)

### قراردادها

| موضوع | قاعده |
|--------|--------|
| Entry | `galaxy_ultimate.py` |
| Package | منطق اپ فقط در `galaxy/` |
| i18n | هر رشتهٔ کاربر در `galaxy_i18n.py` — **FA + EN** |
| Docs | زبان پیش‌فرض **انگلیسی**؛ هم‌ترازی فارسی در اسناد دو زبانه |
| Tests | برای تغییر رفتار، پوشش pytest |

### Gate کیفیت

```powershell
python tools/qa_full.py --full
```

### درخواست ادغام (PR)

- یک تغییر متمرکز در هر PR
- توضیح **چرا**، نه فقط چه
- به‌روزرسانی `docs/CHANGELOG.md` برای تغییرات قابل‌دیدن کاربر
- بدون commit کردن secrets یا `dist/` / `build/`
- مسائل امنیتی → [SECURITY.md](SECURITY.md)

---

[← README](README.md) · [Docs index](docs/INDEX.md)
