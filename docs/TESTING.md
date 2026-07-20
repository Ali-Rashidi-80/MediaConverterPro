# تست و QA — Galaxy Media Pro

---

## استراتژی (۳ لایه)

| لایه | ابزار | هدف |
|------|--------|-----|
| **Unit** | pytest | scheduler, pipeline, settings, i18n, mocks |
| **UI** | pytest-qt | window, combo, workers signals |
| **Integration** | FFmpeg واقعی | remux, encode, ffprobe |

---

## اجرای تست

```powershell
# همه (247)
python -m pytest tests -q

# فقط unit (سریع)
python -m pytest tests -m "not integration" -q

# integration FFmpeg
python -m pytest tests -m integration -q

# UI
python -m pytest tests -m ui -q

# coverage
python -m pytest tests -m "not integration" --cov=galaxy --cov=galaxy_i18n
```

---

## QA Gate (توصیه قبل از release)

```powershell
python tools/qa_full.py          # unit gate · cov ≥ 65%
python tools/qa_full.py --full   # + integration اجباری
.\tools\run_qa.ps1 --full
```

### چک‌های gate

| Check | ابزار |
|-------|--------|
| Syntax | py_compile |
| Lint | Ruff |
| Types | MyPy |
| Security | Bandit |
| Tests | pytest + coverage |
| FFmpeg | verify_ffmpeg_caps |
| Acceptance | benchmark_matrix |

---

## CI

`.github/workflows/qa.yml` — Windows · Python 3.12 · bootstrap FFmpeg · `--full`

---

## Manual QA (پیش از release)

- [ ] Cold start FA + EN
- [ ] Start → finish → Start again (re-convert / rerun)
- [ ] Stop → Start again؛ Stop disables until finished
- [ ] Add / drop / folder حین starting یا converting
- [ ] Clear list مسدود وقتی busy
- [ ] بستن پنجره درست پس از finish (thread join حتی اگر UI idle)
- [ ] Video tab — pipeline hint
- [ ] ۲ تب GPU همزمان
- [ ] Stop در parallel video (<5s)
- [ ] Footer badge حین تبدیل
- [ ] Settings Pro — NVENC gray-out بدون NVIDIA
- [ ] Help — FAQ GPU + GPL + matrix
- [ ] Task Manager kill وسط تبدیل
- [ ] Portable EXE روی سیستم تمیز

---

## Coverage فعلی

~**70%** unit · اهداف: services/workers ≥ 50% · UI pages ≥ 80%

---

## صادقانه

Gate خودکار **regression را می‌گیرد** — «۱۰۰٪ بدون باگ» با تست خودکار ممکن نیست.  
GPU/driver/matrix فایل‌های واقعی → Manual QA.

---

[← فهرست](INDEX.md) · [نصب](INSTALL.md)
