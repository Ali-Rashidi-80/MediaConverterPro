# Changelog — Galaxy Media Pro

All notable changes to **Galaxy Media Pro** are documented here.

**Language:** [English](#english) · [فارسی](#فارسی-خلاصه)

---

## English

## [3.0 Pro] — 2026

### Added

- **Galaxy Media Pro** branding (formerly Galaxy Converter)
- Package architecture (`galaxy/` — core, services, workers, ui)
- Multi-vendor GPU: NVIDIA NVENC · AMD AMF · Intel QSV
- Pipeline tiers: Full GPU · Encode GPU · Remux · CPU
- Smart parallel scheduling + `GlobalGpuSemaphore`
- Settings Pro mode: parallel, accel, NVENC preset, CPU threads
- Bilingual UI (FA RTL / EN LTR) with Vazirmatn fonts
- Footer performance badge during conversion
- Portable single EXE with bundled FFmpeg
- QA suite: **249** pytest tests · `tools/qa_full.py` · GitHub Actions
- Help: GPU FAQ · HW encoder matrix · GPL notice · Developer card (Ali Rashidi)
- `LICENSE` · `.gitattributes` · improved `.gitignore`
- Bilingual docs hub · `README.md` (EN default) · `README.fa.md` · `CONTRIBUTING.md` · `SECURITY.md`

### Fixed

- GPU semaphore always reset to 1 slot
- GPU sem held during CPU fallback
- Video parallel cancel blocking >5s
- EN mode Persian leaks in FFmpeg/output-dir errors
- Combo boxes in ScrollArea (FormComboBox)
- Settings retranslate preserving user values
- Start/Stop button stuck after finish, cancel, or list edits (UI flag vs `QThread.isRunning`)
- Re-convert after all-success; queue files added during starting/converting
- `closeEvent` joins still-running workers even when UI flags are idle (shutdown race)
- GPU semaphore acquire interruptible by Stop (no multi-minute block)
- Image stop mid-task reports cancelled instead of late success

### Changed

- Portable output: `dist/GalaxyMediaPro_Portable.exe`
- `build.bat` default target is portable onefile (`build_onedir.bat` for folder build)
- `pyproject.toml` version aligned to `3.0.0`
- Documentation default language: English (Persian parity retained)

### Removed from active codebase

- Legacy Phase 5 project moved to `archive/legacy-phase5/` (no runtime impact)

---

## Earlier versions

Pre-3.0 monolithic scripts and Phase 4/5 experiments are preserved in `archive/` for reference only.

---

## فارسی (خلاصه)

### [3.0 Pro] — ۲۰۲۶

**افزوده:** برند Galaxy Media Pro · معماری `galaxy/` · GPU چندوندوری · tierهای pipeline · موازی‌سازی هوشمند · UI دو زبانه · EXE قابل‌حمل · ۲۴۹ تست · اسناد دو زبانه (EN پیش‌فرض) · CONTRIBUTING / SECURITY

**رفع:** semaphore GPU · cancel موازی · نشت فارسی در EN · گیر کردن Start/Stop · صف حین تبدیل · `closeEvent` امن · acquire قطع‌پذیر با Stop

**تغییر:** خروجی `GalaxyMediaPro_Portable.exe` · `build.bat` = portable پیش‌فرض · زبان پیش‌فرض اسناد انگلیسی

---

[← Documentation index](INDEX.md)
