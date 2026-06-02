# Changelog

All notable changes to **Galaxy Media Pro** are documented here.

---

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
- QA suite: 142+ pytest tests · `tools/qa_full.py` · GitHub Actions
- Help: GPU FAQ · HW encoder matrix · GPL notice · Developer card (Ali Rashidi)
- `LICENSE` · `.gitattributes` · improved `.gitignore`

### Fixed
- GPU semaphore always reset to 1 slot
- GPU sem held during CPU fallback
- Video parallel cancel blocking >5s
- EN mode Persian leaks in FFmpeg/output-dir errors
- Combo boxes in ScrollArea (FormComboBox)
- Settings retranslate preserving user values

### Changed
- Portable output: `dist/GalaxyMediaPro_Portable.exe`
- `pyproject.toml` version aligned to `3.0.0`

### Removed from active codebase
- Legacy Phase 5 project moved to `archive/legacy-phase5/` (no runtime impact)

---

## Earlier versions

Pre-3.0 monolithic scripts and Phase 4/5 experiments are preserved in `archive/` for reference only.

---

[← Documentation index](INDEX.md)
