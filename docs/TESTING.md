# Testing & QA — Galaxy Media Pro

**Language:** [English](#english) · [فارسی](#فارسی)

---

## English

### Strategy (3 layers)

| Layer | Tool | Goal |
|-------|------|------|
| **Unit** | pytest | scheduler, pipeline, settings, i18n, mocks |
| **UI** | pytest-qt | window, combo, worker signals |
| **Integration** | real FFmpeg | remux, encode, ffprobe |

---

### Running tests

```powershell
# all (249)
python -m pytest tests -q

# unit only (fast)
python -m pytest tests -m "not integration" -q

# FFmpeg integration
python -m pytest tests -m integration -q

# UI
python -m pytest tests -m ui -q

# coverage
python -m pytest tests -m "not integration" --cov=galaxy --cov=galaxy_i18n
```

---

### QA gate (recommended before release)

```powershell
python tools/qa_full.py          # unit gate · cov ≥ 65%
python tools/qa_full.py --full   # + mandatory integration
.\tools\run_qa.ps1 --full
```

#### Gate checks

| Check | Tool |
|-------|------|
| Syntax | py_compile |
| Lint | Ruff |
| Types | MyPy |
| Security | Bandit |
| Tests | pytest + coverage |
| FFmpeg | verify_ffmpeg_caps |
| Acceptance | benchmark_matrix |

---

### CI

`.github/workflows/qa.yml` — Windows · Python 3.12 · bootstrap FFmpeg · `--full`

---

### Manual QA (pre-release)

- [ ] Cold start FA + EN
- [ ] Start → finish → Start again (re-convert / rerun)
- [ ] Stop → Start again; Stop disables until finished
- [ ] Add / drop / folder while starting or converting
- [ ] Clear list blocked when busy
- [ ] Close window right after finish (thread join even if UI idle)
- [ ] Video tab — pipeline hint
- [ ] Two GPU tabs at once
- [ ] Stop during parallel video (<5s)
- [ ] Footer badge during conversion
- [ ] Settings Pro — NVENC gray-out without NVIDIA
- [ ] Help — FAQ GPU + GPL + matrix
- [ ] Task Manager kill mid-conversion
- [ ] Portable EXE on a clean machine

---

### Current coverage

~**70%** unit · targets: services/workers ≥ 50% · UI pages ≥ 80%

---

### Honest limits

Automated gates catch **regressions** — “100% bug-free” is not a claim tests can prove.  
Real GPU/driver/file matrices → Manual QA.

---

## فارسی

### استراتژی (۳ لایه)

| لایه | ابزار | هدف |
|------|--------|-----|
| **Unit** | pytest | scheduler, pipeline, settings, i18n, mocks |
| **UI** | pytest-qt | window, combo, سیگنال workers |
| **Integration** | FFmpeg واقعی | remux, encode, ffprobe |

### اجرای تست

```powershell
python -m pytest tests -q                          # همه (249)
python -m pytest tests -m "not integration" -q     # فقط unit
python tools/qa_full.py --full                     # gate کامل
```

### Manual QA (پیش از release)

همان چک‌لیست انگلیسی: cold start FA/EN، Start/Stop/rerun، add حین busy، بستن پنجره پس از finish، dual-tab GPU، Stop موازی، Task Manager kill، portable روی سیستم تمیز.

### صادقانه

Gate خودکار regression را می‌گیرد — «۱۰۰٪ بدون باگ» با تست خودکار ممکن نیست.

---

[← Docs index](INDEX.md) · [Install](INSTALL.md)
