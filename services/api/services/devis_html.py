"""Branded HTML template for devis (quotes) and DPGF documents.

Produces a complete A4 HTML string that reproduces the design reference
devis-Om2-2026.html: black header, red accent #E30613, Inter + JetBrains Mono
fonts, grouped line table, dark TTC block, accept block, 3-column footer.

Public API
----------
::

    html: str = render_devis_html(doc, company)

Never raises — missing data yields masked/empty sections.
"""

from __future__ import annotations

import html as _html_mod
from datetime import datetime
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from models import CompanySettings, Document

from services.exporters import _ch, _lst, _parse_quote, _s


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _eur_fr(x: Any) -> str:
    """Format a number as French-locale Euro: '8 494,00 €'."""
    try:
        value = float(x)
    except (TypeError, ValueError):
        return "0,00 €"
    # Format with 2 decimal places, then convert to French style
    # '8494.00' -> '8 494,00 €' (using non-breaking space as thousands sep)
    formatted = f"{value:,.2f}"          # '8,494.00'
    # Replace ',' thousands separator with non-breaking space, '.' with ','
    formatted = formatted.replace(",", " ").replace(".", ",")
    return f"{formatted} €"


def _e(value: Any) -> str:
    """html.escape a value coerced to string."""
    return _html_mod.escape(_s(value))


# Nom de société par défaut (placeholder) : non affiché sur le document, le
# logo OM2 portant l'identité visuelle. Si une vraie raison sociale est
# configurée, elle s'affiche normalement.
_PLACEHOLDER_NAME = "Mon Entreprise BTP"


def _display_name(name: Any) -> str:
    """Return the company name, or '' when it is the default placeholder."""
    s = _s(name).strip()
    return "" if s == _PLACEHOLDER_NAME else s


def _today() -> str:
    return datetime.now().strftime("%d/%m/%Y")


def _derive_number(doc: Any) -> str:
    """Derive a devis number from content fields or the document id."""
    content: dict = getattr(doc, "content", None) or {}
    num = _s(content.get("number") or content.get("devis_number"))
    if num:
        return num
    doc_id = _s(getattr(doc, "id", ""))
    year = datetime.now().year
    if doc_id:
        return f"{year}-{doc_id[:4].upper()}"
    return f"{year}-0001"


# ---------------------------------------------------------------------------
# Brand assets
# ---------------------------------------------------------------------------

# Logo OM² (Rénovation · Agencement) — SVG inline, anneau et exposant rouge
# accent #E30613. Le « M » prend la couleur passée en paramètre : blanc pour
# l'en-tête (fond noir), foncé pour la carte émetteur (fond clair).
def _om2_logo_svg(css_class: str = "logo", m_color: str = "#ffffff") -> str:
    return (
        f'<svg class="{css_class}" viewBox="0 0 320 96" xmlns="http://www.w3.org/2000/svg"'
        ' role="img" aria-label="OM2 — Rénovation Agencement">'
        '<circle cx="36" cy="40" r="28" fill="none" stroke="#E30613" stroke-width="15"/>'
        '<text x="78" y="62" font-family="Inter,Arial,sans-serif" font-size="62"'
        f' font-weight="700" fill="{m_color}">M</text>'
        '<text x="138" y="34" font-family="Inter,Arial,sans-serif" font-size="30"'
        ' font-weight="700" fill="#E30613">2</text>'
        '<text x="8" y="90" font-family="Inter,Arial,sans-serif" font-size="12"'
        ' letter-spacing="3.5" fill="#9aa0ac">R&#201;NOVATION &#183; AGENCEMENT</text>'
        '</svg>'
    )


# ---------------------------------------------------------------------------
# Sub-renderers
# ---------------------------------------------------------------------------


def _render_header(doc: Any, c: dict) -> str:
    number = _e(_derive_number(doc))
    company_name = _e(c["name"])
    logo_url = _s(c.get("logo_url", ""))

    if logo_url:
        logo_block = f'<img class="logo" src="{_html_mod.escape(logo_url)}" alt="{company_name}">'
    else:
        logo_block = _om2_logo_svg("logo", "#ffffff")

    return f"""  <header>
    {logo_block}
    <div class="right">
      <div class="k">Devis</div>
      <div class="n"><span class="h">#</span>{number}</div>
    </div>
  </header>"""


def _render_strip(content: dict) -> str:
    today = _today()
    validity = _e(content.get("validity") or "30 jours")
    # Cellules optionnelles : début prévu et durée (champs content.start_date / content.duration)
    start_date = _s(content.get("start_date"))
    duration = _s(content.get("duration"))
    optional_cells = ""
    if start_date:
        optional_cells += (
            f'\n    <div class="c"><div class="k">D&eacute;but pr&eacute;vu</div>'
            f'<div class="v mono">{_e(start_date)}</div></div>'
        )
    if duration:
        optional_cells += (
            f'\n    <div class="c"><div class="k">Dur&eacute;e</div>'
            f'<div class="v">{_e(duration)}</div></div>'
        )
    return f"""  <div class="strip">
    <div class="c"><div class="k">&Eacute;mis le</div><div class="v mono">{today}</div></div>
    <div class="c"><div class="k">Validit&eacute;</div><div class="v mono">{validity}</div></div>{optional_cells}
  </div>"""


def _render_parties(content: dict, c: dict, devis_title: str = "") -> str:
    # Emitter card — logo OM2 (ou logo personnalisé) au-dessus du nom.
    # Le nom par défaut "Mon Entreprise BTP" (placeholder) n'est pas affiché :
    # l'identité visuelle repose sur le logo.
    emitter_name = _e(_display_name(c["name"]))
    logo_url = _s(c.get("logo_url", ""))
    if logo_url:
        emitter_logo = f'<img class="brand" src="{_html_mod.escape(logo_url)}" alt="{emitter_name}">'
    else:
        emitter_logo = _om2_logo_svg("brand", "#0A0A0A")
    emitter_lines: list[str] = []
    if c["address"]:
        emitter_lines.append(_e(c["address"]))
    if c["phone"]:
        emitter_lines.append(f"T&eacute;l&nbsp;: {_e(c['phone'])}")
    if c["email"]:
        emitter_lines.append(f"Email&nbsp;: {_e(c['email'])}")
    if c["siret"]:
        emitter_lines.append(f"SIRET&nbsp;: {_e(c['siret'])}")
    if c["vat_number"]:
        emitter_lines.append(f"N&deg; TVA&nbsp;: {_e(c['vat_number'])}")
    emitter_detail = "<br>".join(emitter_lines) if emitter_lines else ""

    # Client card — nom = titre du devis, coordonnées client conservées
    client_name = _e(devis_title or content.get("client_name") or "Devis")
    client_lines: list[str] = []
    if content.get("client_name") and devis_title:
        client_lines.append(_e(content["client_name"]))
    if content.get("client_address"):
        client_lines.append(_e(content["client_address"]))
    if content.get("client_email"):
        client_lines.append(_e(content["client_email"]))
    if content.get("client_phone"):
        client_lines.append(_e(content["client_phone"]))
    client_detail = "<br>".join(client_lines) if client_lines else ""

    emitter_detail_html = f'<div class="line">{emitter_detail}</div>' if emitter_detail else ""
    client_detail_html = f'<div class="line">{client_detail}</div>' if client_detail else ""

    return f"""    <div class="parties">
      <div class="card">
        <div class="label">&Eacute;metteur</div>
        {emitter_logo}
        {f'<div class="name">{emitter_name}</div>' if emitter_name else ''}
        {emitter_detail_html}
      </div>
      <div class="card">
        <div class="label">Client</div>
        <div class="name">{client_name}</div>
        {client_detail_html}
      </div>
    </div>"""


def _render_lines_table(lines: list[dict], tva_rate: float) -> str:
    # Group lines by lot/group/section if any line carries that field
    has_groups = any(ln.get("lot") or ln.get("group") or ln.get("section") for ln in lines)

    rows_html: list[str] = []

    if has_groups:
        # Collect groups preserving insertion order
        groups: dict[str, list[dict]] = {}
        no_group: list[dict] = []
        for ln in lines:
            grp_name = _s(ln.get("lot") or ln.get("group") or ln.get("section"))
            if grp_name:
                groups.setdefault(grp_name, []).append(ln)
            else:
                no_group.append(ln)

        for grp_name, grp_lines in groups.items():
            rows_html.append(
                f'        <tr class="grp"><td colspan="6">{_e(grp_name)}</td></tr>'
            )
            for ln in grp_lines:
                rows_html.append(_render_line_row(ln, tva_rate))

        for ln in no_group:
            rows_html.append(_render_line_row(ln, tva_rate))
    else:
        for ln in lines:
            rows_html.append(_render_line_row(ln, tva_rate))

    tbody = "\n".join(rows_html)
    return f"""    <table class="lines">
      <thead><tr>
        <th>D&eacute;signation</th><th class="c">Qt&eacute;</th><th class="c">Un.</th>
        <th class="r">P.U. HT</th><th class="c">TVA</th><th class="r">Total HT</th>
      </tr></thead>
      <tbody>
{tbody}
      </tbody>
    </table>"""


def _render_line_row(ln: dict, tva_rate: float) -> str:
    label = _e(ln.get("label", ""))
    sub = _s(ln.get("sub") or ln.get("description"))
    ref = _s(ln.get("ref") or ln.get("reference"))
    qty = ln.get("qty", 0)
    unit = _e(ln.get("unit", "u"))
    unit_price_ht = ln.get("unit_price_ht", 0.0)
    total_ht = ln.get("total_ht", 0.0)

    # Per-line TVA: prefer line-level tva, else fall back to global tva_rate
    line_tva_rate = ln.get("tva")
    if line_tva_rate is not None:
        try:
            tva_pct_val = float(line_tva_rate)
            # If stored as 0.2 rather than 20, normalise
            if tva_pct_val <= 1:
                tva_pct_val *= 100
        except (TypeError, ValueError):
            tva_pct_val = tva_rate * 100
    else:
        tva_pct_val = tva_rate * 100

    # Format percentage: show as integer if whole, else 1 decimal
    if tva_pct_val == int(tva_pct_val):
        tva_str = f"{int(tva_pct_val)} %"
    else:
        tva_str = f"{tva_pct_val:.1f} %"

    try:
        qty_str = f"{float(qty):g}"
    except (TypeError, ValueError):
        qty_str = _e(qty)

    sub_html = f'<div class="sub">{_e(sub)}</div>' if sub else ""
    ref_html = f'<div class="ref mono">{_e(ref)}</div>' if ref else ""

    return (
        f"        <tr>"
        f'<td><div class="desc">{label}</div>{sub_html}{ref_html}</td>'
        f'<td class="c mono">{qty_str}</td>'
        f'<td class="c">{unit}</td>'
        f'<td class="r mono">{_eur_fr(unit_price_ht)}</td>'
        f'<td class="c mono">{_html_mod.escape(tva_str)}</td>'
        f'<td class="r mono">{_eur_fr(total_ht)}</td>'
        f"</tr>"
    )


def _render_foot(content: dict, total_ht: float, total_tva: float, total_ttc: float, tva_rate: float) -> str:
    payment_terms = _s(content.get("payment_terms"))
    if not payment_terms:
        payment_terms = (
            "Acompte de 30 % à la signature. "
            "Solde à la réception des travaux, sous 30 jours. "
            "Pénalités de retard : 3× taux légal · indemnité forfaitaire 40 €."
        )

    iban = _s(content.get("iban"))
    iban_html = (
        f'<span class="pill mono">{_e(iban)}</span>'
        if iban
        else ""
    )

    if tva_rate * 100 == int(tva_rate * 100):
        tva_pct = f"{int(tva_rate * 100)} %"
    else:
        tva_pct = f"{tva_rate * 100:.1f} %".replace(".", ",")
    tva_label = f"TVA \u00e0 taux r\u00e9duit ({tva_pct})"

    return f"""    <div class="foot">
      <div class="pay">
        <h4>Conditions de r&egrave;glement</h4>
        <p>{_html_mod.escape(payment_terms)}</p>
        {iban_html}
      </div>
      <div class="totals">
        <div class="row"><span class="lab">Total HT</span><span class="mono">{_eur_fr(total_ht)}</span></div>
        <div class="row"><span class="lab">{_html_mod.escape(tva_label)}</span><span class="mono">{_eur_fr(total_tva)}</span></div>
        <div class="ttc">
          <span class="lab">Total TTC</span>
          <span class="val mono">{_html_mod.escape(_eur_fr(total_ttc).replace(' €', ''))}<span class="cur">&euro;</span></span>
        </div>
      </div>
    </div>"""


def _render_accept(tva_rate: float) -> str:
    return f"""    <div class="accept">
      <div class="txt">
        <h4>Bon pour accord</h4>
        <p>&Agrave; retourner dat&eacute; et sign&eacute;. La signature transforme ce devis en contrat liant les deux parties. Recopier la mention manuscrite&nbsp;:</p>
        <p class="hand">&laquo;&nbsp;Devis re&ccedil;u avant l&rsquo;ex&eacute;cution des travaux, lu et accept&eacute;, bon pour accord.&nbsp;&raquo;</p>
      </div>
      <div class="sign">
        <div class="k">Date &amp; signature du client</div>
        <div class="box"></div>
      </div>
    </div>"""


def _render_footer(content: dict, c: dict) -> str:
    # Column 1 — Entreprise (le placeholder "Mon Entreprise BTP" est masqué)
    company_name = _e(_display_name(c["name"]))
    company_lines: list[str] = []
    if c["siret"]:
        company_lines.append(f"SIRET {_e(c['siret'])}")
    if c["vat_number"]:
        company_lines.append(f"TVA {_e(c['vat_number'])}")
    company_detail = " &middot; ".join(company_lines) if company_lines else ""
    company_body = "<br>".join(part for part in (company_name, company_detail) if part)
    col1 = f"<div><h5>Entreprise</h5>{company_body}</div>"


    # Column 2 — Mentions légales
    legal = _s(c.get("legal_mentions"))
    if legal:
        legal_lines = [_e(line.strip()) for line in legal.splitlines() if line.strip()]
        col3_body = "<br>".join(legal_lines)
    else:
        validity = _s(content.get("validity") or "30 jours")
        col3_body = (
            f"Prix en euros. Devis valable {_e(validity)}.<br>"
            "Médiation conso : [médiateur].<br>"
            "Conforme à l’arrêté du 24/01/2017."
        )
    col2 = f"<div><h5>Mentions</h5>{col3_body}</div>"

    return f"""  <footer>
    {col1}
    {col2}
  </footer>"""


# ---------------------------------------------------------------------------
# Public entrypoint
# ---------------------------------------------------------------------------


def render_devis_html(doc: Any, company: Any) -> str:
    """Render a complete A4 HTML string for a devis or DPGF document.

    Args:
        doc:     Document ORM row (or any object with ``content``, ``id``,
                 ``title``, ``document_type`` attributes).
        company: CompanySettings ORM row, or ``None``.

    Returns:
        A self-contained HTML string suitable for Chromium PDF rendering.
        Never raises; missing data yields empty/masked sections.
    """
    try:
        content: dict = getattr(doc, "content", None) or {}
        c = _ch(company)
        default_tva = c["default_tva_rate"]

        # Use _parse_quote only for computed totals and tva_rate.
        # The stripped line dicts it returns lose optional fields (lot, sub,
        # ref, tva).  For rendering we merge the raw rows back in so grouping
        # and sub-descriptions are preserved.
        _stripped, tva_rate, total_ht, total_tva, total_ttc = _parse_quote(content, default_tva)

        raw_rows = _lst(content.get("lines"))
        # Merge: take each stripped dict and overlay the original raw row so
        # that optional fields (lot/group/section, sub/description, ref/
        # reference, tva) are available to the renderer.
        render_lines: list[dict] = []
        for stripped, raw in zip(_stripped, (r for r in raw_rows if isinstance(r, dict))):
            merged = dict(raw)          # keep all raw fields
            merged.update(stripped)     # override with sanitised core fields
            render_lines.append(merged)

        devis_title = _s(getattr(doc, "title", ""))
        header_html = _render_header(doc, c)
        strip_html = _render_strip(content)
        parties_html = _render_parties(content, c, devis_title)
        table_html = _render_lines_table(render_lines, tva_rate) if render_lines else ""
        foot_html = _render_foot(content, total_ht, total_tva, total_ttc, tva_rate)
        accept_html = _render_accept(tva_rate)
        footer_html = _render_footer(content, c)

    except Exception:  # noqa: BLE001 — never propagate, render defensively
        header_html = ""
        strip_html = ""
        parties_html = ""
        table_html = ""
        foot_html = ""
        accept_html = ""
        footer_html = ""

    return f"""<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Devis</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>
  :root{{--noir:#0A0A0A;--rouge:#E30613;--g900:#16181d;--g600:#5b616e;--g400:#9aa0ac;--g200:#e7e9ee;--g100:#f3f4f7;--papier:#fdfdfd}}
  *{{margin:0;padding:0;box-sizing:border-box}}
  html{{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  body{{font-family:'Inter',system-ui,sans-serif;color:var(--noir);background:#d9dbe0;line-height:1.5;padding:32px 16px}}
  .mono{{font-family:'JetBrains Mono',monospace;font-variant-numeric:tabular-nums}}
  .sheet{{width:210mm;min-height:297mm;margin:0 auto;background:var(--papier);box-shadow:0 24px 60px rgba(10,10,10,.28);position:relative;overflow:hidden}}

  /* En-tête version A */
  header{{background:var(--noir);color:#fff;padding:24px 26mm;display:flex;align-items:center;justify-content:space-between;gap:24px}}
  header .logo{{height:50px;display:block}}
  header .right{{text-align:right;border-left:1px solid #2a2c31;padding-left:22px}}
  header .right .k{{font-size:10px;letter-spacing:.24em;text-transform:uppercase;color:var(--g400)}}
  header .right .n{{font-size:21px;font-weight:700;margin-top:3px}}
  header .right .n .h{{color:var(--rouge)}}
  header .right .tag{{font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--g400);margin-top:5px}}

  .strip{{display:flex;border-bottom:1px solid var(--g200)}}
  .strip .c{{flex:1;padding:11px 16px;border-right:1px solid var(--g200)}}
  .strip .c:first-child{{padding-left:26mm}}.strip .c:last-child{{border-right:none;padding-right:26mm}}
  .strip .k{{font-size:8.5px;letter-spacing:.13em;text-transform:uppercase;color:var(--g400)}}
  .strip .v{{font-size:12.5px;font-weight:600;margin-top:3px}}

  main{{padding:22px 26mm 0}}
  .parties{{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:20px}}
  .card{{border:1px solid var(--g200);border-radius:12px;padding:14px 16px}}
  .card .label{{font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--g400);margin-bottom:7px}}
  .card .brand{{height:32px;width:auto;display:block;margin-bottom:8px}}
  .card .name{{font-size:14px;font-weight:600;margin-bottom:3px}}
  .card .line{{font-size:11.5px;color:var(--g600);line-height:1.6}}

  .lines{{width:100%;border-collapse:collapse;font-size:11.5px}}
  .lines thead th{{background:var(--noir);color:#fff;text-align:left;font-weight:500;font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;padding:10px 12px}}
  .lines thead th.r{{text-align:right}}.lines thead th.c{{text-align:center}}
  .lines tbody td{{padding:11px 12px;border-bottom:1px solid var(--g200);vertical-align:top}}
  .lines td.r{{text-align:right}}.lines td.c{{text-align:center}}
  .lines .desc{{font-weight:600}}
  .lines .sub{{color:var(--g600);font-size:10.5px;margin-top:2px;font-weight:400}}
  .lines .ref{{color:var(--g400);font-size:10px}}
  .grp td{{background:var(--g100);font-size:9.5px;letter-spacing:.13em;text-transform:uppercase;font-weight:700;color:var(--g600);padding:8px 12px}}

  .foot{{display:flex;justify-content:space-between;gap:26px;margin-top:18px;align-items:flex-start}}
  .pay{{flex:1;max-width:300px}}
  .pay h4{{font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--g400);margin-bottom:8px}}
  .pay p{{font-size:10.5px;color:var(--g600);line-height:1.65}}
  .pay .pill{{display:inline-block;background:var(--g100);border-radius:6px;padding:2px 8px;font-size:10px;font-weight:600;margin-top:6px}}
  .totals{{width:280px;flex-shrink:0}}
  .totals .row{{display:flex;justify-content:space-between;padding:8px 0;font-size:12px;border-bottom:1px solid var(--g200)}}
  .totals .row .lab{{color:var(--g600)}}
  .totals .ttc{{background:var(--noir);color:#fff;border-radius:10px;padding:14px 16px;margin-top:10px;display:flex;justify-content:space-between;align-items:center}}
  .totals .ttc .lab{{font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--g400)}}
  .totals .ttc .val{{font-size:20px;font-weight:700}}
  .totals .ttc .val .cur{{color:var(--rouge);font-size:14px;margin-left:2px}}

  .accept{{margin-top:24px;border:1px dashed var(--g400);border-radius:12px;padding:16px 18px;display:flex;gap:22px;align-items:stretch}}
  .accept .txt{{flex:1.4}}
  .accept .txt h4{{font-size:11px;font-weight:700;margin-bottom:5px}}
  .accept .txt p{{font-size:10px;color:var(--g600);line-height:1.6}}
  .accept .txt .hand{{font-style:italic;color:var(--noir);margin-top:6px;font-size:10.5px}}
  .accept .sign{{flex:1;border-left:1px solid var(--g200);padding-left:20px}}
  .accept .sign .k{{font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:var(--g400)}}
  .accept .sign .box{{height:54px;border-bottom:1px solid var(--g400);margin-top:6px}}

  footer{{margin:24px 26mm 0;border-top:2px solid var(--noir);padding:14px 0 26px;font-size:9px;color:var(--g600);line-height:1.6;display:grid;grid-template-columns:repeat(2,1fr);gap:14px}}
  footer h5{{font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:var(--noir);margin-bottom:4px}}
  .ribbon{{position:absolute;bottom:0;left:0;right:0;height:5px;background:linear-gradient(90deg,var(--noir) 0 62%,var(--rouge) 62% 100%)}}

  @media print{{body{{background:#fff;padding:0}}.sheet{{box-shadow:none;width:auto;min-height:auto}}@page{{size:A4;margin:0}}}}
  @media (max-width:760px){{
    .sheet{{width:100%}}header{{padding-left:18px;padding-right:18px}}
    main{{padding-left:18px;padding-right:18px}}
    footer{{margin-left:18px;margin-right:18px;grid-template-columns:1fr}}
    .strip{{flex-wrap:wrap}}.strip .c{{min-width:50%;flex:none}}.strip .c:first-child{{padding-left:18px}}
    .parties{{grid-template-columns:1fr}}.foot{{flex-direction:column}}.totals{{width:100%}}
    header{{flex-wrap:wrap}}header .logo{{height:42px}}
  }}
</style>
</head>
<body>
<div class="sheet">

{header_html}

{strip_html}

  <main>
{parties_html}

{table_html}

{foot_html}

{accept_html}
  </main>

{footer_html}

  <div class="ribbon"></div>
</div>
</body>
</html>"""
