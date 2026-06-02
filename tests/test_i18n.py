"""i18n completeness and worker key tests."""
from __future__ import annotations

from galaxy_i18n import STRINGS, I18n

WORKER_KEYS = (
    "status.file_ok",
    "status.file_fail",
    "status.gpu_fallback",
    "status.gpu_queue_timeout",
    "status.ffmpeg_missing",
    "status.output_err",
    "status.rename_collision",
    "status.parallel",
    "status.image_ok",
    "status.image_fail",
    "err.ffmpeg_empty",
    "err.ffmpeg_incomplete",
    "footer.perf_idle",
    "footer.perf_active",
    "footer.enc_pil",
    "footer.enc_cpu",
    "value.auto",
)

SETTINGS_TIP_KEYS = (
    "tip.parallel_mode",
    "tip.max_parallel",
    "tip.accel_mode",
    "tip.nvenc_preset",
    "tip.cpu_threads",
    "tip.quality_profile",
)

HELP_KEYS = (
    "help.faq_6q",
    "help.faq_6a",
    "help.faq_7q",
    "help.faq_7a",
    "help.faq_8q",
    "help.faq_8a",
    "help.gpl_title",
    "help.gpl_body",
    "help.author_title",
    "help.author_name",
    "help.author_body",
    "help.author_channel",
    "help.author_contact",
)

I18N_ENGINE_KEYS = (
    "engine.err_not_found",
    "engine.err_no_response",
    "err.output_not_dir",
    "err.output_no_write",
    "app.name",
)


def test_fa_en_key_parity():
    fa_keys = set(STRINGS["fa"].keys())
    en_keys = set(STRINGS["en"].keys())
    missing_en = fa_keys - en_keys
    missing_fa = en_keys - fa_keys
    assert not missing_en, f"Missing in EN: {sorted(missing_en)[:10]}"
    assert not missing_fa, f"Missing in FA: {sorted(missing_fa)[:10]}"


def test_worker_keys_present_both_langs():
    for key in WORKER_KEYS:
        for lang in ("fa", "en"):
            text = I18n(lang).t(key, name="x", err="y", n=2, enc="NVENC", prog="1/2", tier="CPU")
            assert not text.startswith("["), f"{lang}:{key} missing"


def test_settings_and_help_keys():
    for key in SETTINGS_TIP_KEYS + HELP_KEYS + I18N_ENGINE_KEYS:
        for lang in ("fa", "en"):
            assert key in STRINGS[lang], f"{lang}:{key}"


def test_i18n_format_interpolation():
    fa = I18n("fa")
    out = fa.t("status.file_ok", name="test.mp4")
    assert "test.mp4" in out


def test_i18n_rtl_and_set_lang():
    i18n = I18n("en")
    assert i18n.is_rtl() is False
    i18n.set_lang("fa")
    assert i18n.is_rtl() is True
    assert i18n.lang == "fa"


def test_fill_combo_helpers(qapp):
    from galaxy_i18n import I18n, fill_combo_keys, fill_combo_texts
    from PySide6.QtWidgets import QComboBox

    combo = QComboBox()
    i18n = I18n("fa")
    fill_combo_keys(combo, ["auto", "sequential"], i18n, prefix="value", default_key="auto")
    assert combo.count() == 2
    assert combo.itemData(0) == "auto"

    combo2 = QComboBox()
    fill_combo_texts(combo2, ["A", "B"], current_text="B")
    assert combo2.currentText() == "B"
