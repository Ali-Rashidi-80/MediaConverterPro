"""Theme-aware HTML builder for the Help / About page."""
from __future__ import annotations

import html

from galaxy_fonts import mono_font_stack, ui_font_stack

from galaxy.ui.theme import _pal


def _esc(text) -> str:
    return html.escape(str(text), quote=True)


def _badge(ok: bool, ok_label: str, bad_label: str) -> str:
    cls = "badge ok" if ok else "badge bad"
    label = ok_label if ok else bad_label
    return f'<span class="{cls}">{_esc(label)}</span>'


def _hw_badge(ok: bool, i18n) -> str:
    label = i18n.t("help.hw_yes") if ok else i18n.t("help.hw_no")
    cls = "badge ok" if ok else "badge neutral"
    return f'<span class="{cls}">{_esc(label)}</span>'


def _hw_matrix_rows(i18n, hw_profile) -> str:
    if not hw_profile:
        return ""
    nvidia = hw_profile.backends.get("nvidia")
    amd = hw_profile.backends.get("amd")
    intel = hw_profile.backends.get("intel")
    rows = [
        ("help.hw_row_h264_nvenc", nvidia and nvidia.has_encoder("h264_nvenc")),
        ("help.hw_row_hevc_nvenc", nvidia and nvidia.has_encoder("hevc_nvenc")),
        ("help.hw_row_h264_amf", amd and amd.has_encoder("h264_amf")),
        ("help.hw_row_h264_qsv", intel and intel.has_encoder("h264_qsv")),
        ("help.hw_row_scale_cuda", nvidia and "scale_cuda" in (nvidia.filters or [])),
        ("help.hw_row_vpp_amf", amd and "vpp_amf" in (amd.filters or [])),
        ("help.hw_row_scale_qsv", intel and "scale_qsv" in (intel.filters or [])),
    ]
    html_rows = ""
    for key, ok in rows:
        html_rows += f"<tr><td>{_esc(i18n.t(key))}</td><td>{_hw_badge(bool(ok), i18n)}</td></tr>"
    slots = hw_profile.recommended_parallel.gpu_slots if hw_profile.recommended_parallel else 0
    html_rows += (
        f"<tr><td>{_esc(i18n.t('help.hw_row_gpu_slots'))}</td>"
        f'<td><span class="badge neutral">{_esc(str(slots))}</span></td></tr>'
    )
    return html_rows


def build_help_html(
    i18n,
    theme_id: str,
    *,
    out_dir: str,
    out_ok: bool,
    ff_ok: bool,
    ff_ver: str,
    ff_path: str | None,
    heic_ok: bool,
    mode: str,
    bundled_ffmpeg: bool = False,
    hw_profile=None,
) -> str:
    """Render rich help content matching the active theme."""
    p = _pal(theme_id)
    rtl = i18n.is_rtl()
    dir_attr = "rtl" if rtl else "ltr"
    border_side = "right" if rtl else "left"
    ui_font = ui_font_stack(i18n.lang).split(",")[0].strip().strip("'")
    mono_font = mono_font_stack().split(",")[0].strip().strip("'")
    hi = p.get("highlight", p["accent_glow"])
    code_color = p["accent_dark"] if theme_id == "light" else p["accent_glow"]

    steps = [
        (i18n.t("help.step1_title"), i18n.t("help.quick_1")),
        (i18n.t("help.step2_title"), i18n.t("help.quick_2")),
        (i18n.t("help.step3_title"), i18n.t("help.quick_3")),
    ]
    steps_html = ""
    for n, (title, body) in enumerate(steps, 1):
        steps_html += f"""
        <div class="step">
            <div class="step-num">{n}</div>
            <div class="step-body">
                <div class="step-title">{_esc(title)}</div>
                <div class="step-desc">{_esc(body)}</div>
            </div>
        </div>"""

    tips = [i18n.t("help.tip_1"), i18n.t("help.tip_2"), i18n.t("help.tip_3")]
    tips_html = "".join(f"<li>{_esc(t)}</li>" for t in tips)

    faqs = [
        (i18n.t("help.faq_1q"), i18n.t("help.faq_1a")),
        (i18n.t("help.faq_2q"), i18n.t("help.faq_2a")),
        (i18n.t("help.faq_3q"), i18n.t("help.faq_3a")),
        (i18n.t("help.faq_4q"), i18n.t("help.faq_4a")),
        (i18n.t("help.faq_5q"), i18n.t("help.faq_5a")),
        (i18n.t("help.faq_6q"), i18n.t("help.faq_6a")),
        (i18n.t("help.faq_7q"), i18n.t("help.faq_7a")),
        (i18n.t("help.faq_8q"), i18n.t("help.faq_8a")),
    ]
    faq_html = ""
    for q, a in faqs:
        faq_html += f"""
        <div class="faq-item">
            <div class="faq-q">{_esc(q)}</div>
            <div class="faq-a">{_esc(a)}</div>
        </div>"""

    ff_detail = _esc(ff_ver)
    if bundled_ffmpeg and ff_path:
        ff_detail += f' · <span class="muted">{_esc(i18n.t("help.bundled_ffmpeg"))}</span>'

    hw_rows = ""
    if hw_profile:
        cpu_txt = i18n.t("help.hw_cpu", n=hw_profile.cpu_count)
        if hw_profile.gpu_devices:
            gpu_txt = i18n.t("help.hw_gpu", name=hw_profile.gpu_devices[0].name)
        else:
            gpu_txt = i18n.t("help.hw_none")
        backend_key = hw_profile.recommended_backend
        backend_names = {
            "nvidia": i18n.t("help.hw_nvenc"),
            "amd": i18n.t("help.hw_amf"),
            "intel": i18n.t("help.hw_qsv"),
            "cpu": i18n.t("help.hw_cpu_only"),
        }
        backend_txt = i18n.t("help.hw_backend", name=backend_names.get(backend_key, backend_key))
        hw_rows = f"""
    <tr><td>{_esc(cpu_txt)}</td><td><span class="badge neutral">OK</span></td></tr>
    <tr><td>{_esc(gpu_txt)}</td><td><span class="badge neutral">—</span></td></tr>
    <tr><td>{_esc(backend_txt)}</td><td><span class="badge ok">✓</span></td></tr>
    {_hw_matrix_rows(i18n, hw_profile)}"""

    status_rows = f"""
    <tr><td>{_esc(i18n.t("help.status_output"))}</td>
        <td>{_badge(out_ok, i18n.t("help.status_output_ok"), i18n.t("help.status_output_bad"))}</td></tr>
    <tr><td>{_esc(i18n.t("help.status_ffmpeg_label"))}</td>
        <td>{_badge(ff_ok, i18n.t("help.ffmpeg_ok"), i18n.t("help.ffmpeg_bad"))}
            <span class="muted">{ff_detail}</span></td></tr>
    <tr><td>{_esc(i18n.t("help.status_heic_label"))}</td>
        <td>{_badge(heic_ok, i18n.t("help.heic_ok"), i18n.t("help.heic_warn"))}</td></tr>
    <tr><td>{_esc(i18n.t("help.status_mode_label"))}</td>
        <td><span class="badge neutral">{_esc(mode)}</span></td></tr>"""

    return f"""
    <style>
        body {{
            font-family: '{_esc(ui_font)}','Tahoma','Segoe UI',sans-serif;
            color: {_esc(p['text'])}; direction: {dir_attr};
            line-height: 1.7; font-size: 15px; margin: 0; padding: 4px 2px 12px;
        }}
        .card {{
            background: {_esc(p['surface'])}; border: 1px solid {_esc(p['border_soft'])};
            border-{border_side}: 4px solid {_esc(p['accent'])};
            border-radius: 14px; padding: 18px 20px; margin-bottom: 14px;
        }}
        h3 {{
            font-family: '{_esc(ui_font)}','Tahoma',sans-serif;
            color: {_esc(p['accent'])}; margin: 0 0 14px 0;
            font-size: 16px; font-weight: 700; letter-spacing: 0.2px;
        }}
        .steps {{ display: block; }}
        .step {{
            display: flex; align-items: flex-start; gap: 12px;
            margin-bottom: 12px; padding-bottom: 12px;
            border-bottom: 1px solid {_esc(p['border_soft'])};
        }}
        .step:last-child {{ border-bottom: none; margin-bottom: 0; padding-bottom: 0; }}
        .step-num {{
            min-width: 28px; height: 28px; line-height: 28px; text-align: center;
            background: {_esc(p['accent_muted'])}; color: {_esc(hi)};
            border: 1px solid {_esc(p['border'])}; border-radius: 8px;
            font-weight: 800; font-size: 13px;
        }}
        .step-title {{ font-weight: 700; color: {_esc(p['text'])}; margin-bottom: 2px; }}
        .step-desc {{ color: {_esc(p['text_secondary'])}; font-size: 14px; }}
        .tips li {{ margin-bottom: 8px; color: {_esc(p['text_secondary'])}; }}
        .formats {{
            color: {_esc(p['text_secondary'])}; font-size: 14px; line-height: 1.8;
        }}
        .formats div {{ margin-bottom: 4px; }}
        table.status {{
            width: 100%; border-collapse: collapse; font-size: 14px;
        }}
        table.status td {{
            padding: 10px 8px; border-bottom: 1px solid {_esc(p['border_soft'])};
            vertical-align: middle;
        }}
        table.status tr:last-child td {{ border-bottom: none; }}
        table.status td:first-child {{ color: {_esc(p['text'])}; font-weight: 600; width: 42%; }}
        code.path {{
            font-family: '{_esc(mono_font)}','Consolas',monospace;
            background: {_esc(p['bg_alt'])}; padding: 3px 8px; border-radius: 6px;
            color: {_esc(code_color)}; font-size: 12px; word-break: break-all;
        }}
        .badge {{
            display: inline-block; padding: 2px 10px; border-radius: 999px;
            font-size: 12px; font-weight: 700; margin-{border_side}: 6px;
        }}
        .badge.ok {{ background: rgba(0,230,118,0.12); color: {_esc(p['success'])}; }}
        .badge.bad {{ background: rgba(255,82,82,0.12); color: {_esc(p['danger'])}; }}
        .badge.neutral {{ background: {_esc(p['accent_muted'])}; color: {_esc(hi)}; }}
        .muted {{ color: {_esc(p['text_muted'])}; font-size: 13px; }}
        .faq-item {{ margin-bottom: 14px; }}
        .faq-q {{ font-weight: 700; color: {_esc(p['text'])}; margin-bottom: 4px; }}
        .faq-a {{ color: {_esc(p['text_secondary'])}; font-size: 14px; padding-{border_side}: 12px; }}
        .footer {{
            text-align: center; color: {_esc(p['text_muted'])};
            font-size: 12px; margin-top: 8px; line-height: 1.6;
        }}
    </style>

    <div class="card"><h3>{_esc(i18n.t('help.quick_title'))}</h3>
    <div class="steps">{steps_html}</div></div>

    <div class="card"><h3>{_esc(i18n.t('help.tips_title'))}</h3>
    <ul class="tips">{tips_html}</ul>
    <p class="muted">{_esc(i18n.t('help.hover'))}</p></div>

    <div class="card"><h3>{_esc(i18n.t('help.formats_title'))}</h3>
    <div class="formats">
        <div>{_esc(i18n.t('help.formats_image'))}</div>
        <div>{_esc(i18n.t('help.formats_video'))}</div>
        <div>{_esc(i18n.t('help.formats_audio'))}</div>
    </div></div>

    <div class="card"><h3>{_esc(i18n.t('help.status_grid_title'))}</h3>
    <table class="status">{status_rows}</table>
    <p style="margin:14px 0 6px;color:{_esc(p['text_secondary'])}">{_esc(i18n.t('help.output_body'))}</p>
    <code class="path">{_esc(out_dir)}</code></div>

    <div class="card"><h3>{_esc(i18n.t('help.hw_title'))}</h3>
    <table class="status">{hw_rows if hw_rows else f'<tr><td colspan="2">{_esc(i18n.t("help.hw_none"))}</td></tr>'}</table></div>

    <div class="card"><h3>{_esc(i18n.t('help.custom_title'))}</h3>
    <p>{i18n.t('help.custom_body', mode=_esc(mode))}</p>
    <p class="muted">{_esc(i18n.t('help.custom_pro'))}</p></div>

    <div class="card"><h3>{_esc(i18n.t('help.faq_title'))}</h3>{faq_html}</div>

    <div class="card"><h3>{_esc(i18n.t('help.gpl_title'))}</h3>
    <p>{i18n.t('help.gpl_body')}</p></div>

    <div class="card"><h3>{_esc(i18n.t('help.author_title'))}</h3>
    <p><strong>{_esc(i18n.t('help.author_name'))}</strong><br>
    {_esc(i18n.t('help.author_body'))}</p>
    <p class="muted">
        <a href="https://t.me/writeyourway">{_esc(i18n.t('help.author_channel'))}</a>
        &nbsp;·&nbsp;
        <a href="https://t.me/a_ra_80">{_esc(i18n.t('help.author_contact'))}</a>
    </p></div>

    <div class="footer">
        <div>{_esc(i18n.t('help.footer_tagline'))}</div>
        <div class="muted">{_esc(i18n.t('help.log_hint'))}</div>
    </div>
    """
