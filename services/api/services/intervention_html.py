"""Branded HTML template for intervention reports (compte rendu d'intervention).

The *trame* (layout, sections, styling) is fixed here; the *modèle* (field
values, checkbox options, section content, material rows, photos…) comes from
the document ``content`` JSON. An agent can edit ``content`` (via update_document)
to change the model without ever touching this template.

Public API::

    html: str = render_intervention_html(doc, company, brand="om2")

Branding (accent colour + logo) reuses the same per-company variants as the
devis (``om2`` red, ``ced`` green, ``suivisio`` / ``brume`` blue). Never raises.
"""

from __future__ import annotations

import html as _html_mod
from typing import Any

from services.devis_html import (
    _BRANDS,
    _asset_data_uri,
    _derive_number,
    _display_name,
    _e,
    _om2_logo_svg,
    _today,
    _OM2_RED,
)
from services.exporters import _ch, _lst, _s

# ---------------------------------------------------------------------------
# Defaults for the model (used when content does not override them).
# ---------------------------------------------------------------------------
_DEFAULT_TYPE_OPTIONS = ["Diagnostic", "Installation", "Maintenance", "Dépannage"]
_DEFAULT_TRAVAUX_OPTIONS = [
    "Étude / Diagnostic",
    "Installation",
    "Modification",
    "Mise en conformité",
    "Maintenance préventive",
    "Dépannage",
]
_DEFAULT_PHOTOS = [
    {"caption": "Avant intervention"},
    {"caption": "Pendant l'intervention"},
    {"caption": "Après intervention"},
]


def _txt_or_lines(value: Any, n: int = 3) -> str:
    """Render text (with <br>) when present, else ``n`` blank dotted lines."""
    s = _s(value).strip()
    if s:
        return f'<div class="filled">{_e(s).replace(chr(10), "<br>")}</div>'
    return "".join('<div class="row-line"></div>' for _ in range(n))


def _checkbox(label: str, checked: bool) -> str:
    cls = "box on" if checked else "box"
    return f'<span class="chk"><span class="{cls}"></span>{_e(label)}</span>'


def _field(label: str, value: Any, mono: bool = False) -> str:
    s = _s(value).strip()
    val_cls = "val mono" if mono else "val"
    inner = f'<div class="{val_cls}">{_e(s)}</div>' if s else '<div class="fill"></div>'
    return f'<div class="fld"><div class="k">{_e(label)}</div>{inner}</div>'


def _render_header(doc: Any, brand: str) -> str:
    number = _e(_derive_number(doc))
    if brand in _BRANDS:
        name = _BRANDS[brand]["name"]
        logo = _asset_data_uri(_BRANDS[brand]["header_logo"])
        logo_block = (
            f'<img class="logo logo-{brand}" src="{logo}" alt="{name}">'
            if logo
            else f'<div style="color:#fff;font-size:22px;font-weight:800">{name}</div>'
        )
    else:
        logo_block = _om2_logo_svg("logo", "#ffffff")
    return f"""  <header>
    {logo_block}
    <div class="right">
      <div class="k">Compte rendu d'intervention</div>
      <div class="n"><span class="h">#</span>{number}</div>
    </div>
  </header>"""


def _render_parties(content: dict, c: dict, brand: str) -> str:
    # Emitter card — brand logo + company details.
    if brand in _BRANDS:
        elogo = _asset_data_uri(_BRANDS[brand]["emitter_logo"])
        emitter_logo = (
            f'<img class="brand brand-{brand}" src="{elogo}" alt="{_BRANDS[brand]["name"]}">'
            if elogo
            else _om2_logo_svg("brand", "#0A0A0A")
        )
    else:
        emitter_logo = _om2_logo_svg("brand", "#0A0A0A")

    em_lines: list[str] = []
    if c["address"]:
        em_lines.append(_e(c["address"]))
    em_detail = "<br>".join(em_lines)
    em_contact: list[str] = []
    if c["phone"]:
        em_contact.append(f'<b>Tél :</b> {_e(c["phone"])}')
    if c["email"]:
        em_contact.append(f'<b>Email :</b> {_e(c["email"])}')
    if c.get("website"):
        em_contact.append(f'<b>Web :</b> {_e(c["website"])}')
    em_contact_html = "<br>".join(em_contact)

    client_name = _e(content.get("client_name") or "Client")
    cl_lines: list[str] = []
    if content.get("client_address"):
        cl_lines.append(_e(content["client_address"]))
    cl_detail = "<br>".join(cl_lines)
    cl_contact: list[str] = []
    if content.get("client_phone"):
        cl_contact.append(f'<b>Tél :</b> {_e(content["client_phone"])}')
    if content.get("client_email"):
        cl_contact.append(f'<b>Email :</b> {_e(content["client_email"])}')
    cl_contact_html = "<br>".join(cl_contact)

    return f"""    <div class="parties">
      <div class="card">
        <div class="label">Émetteur</div>
        {emitter_logo}
        {f'<div class="name" style="font-size:14px">{_e(_display_name(c["name"]))}</div>' if _display_name(c["name"]) else ''}
        {f'<div class="line">{em_detail}</div>' if em_detail else ''}
        {f'<div class="contact">{em_contact_html}</div>' if em_contact_html else ''}
      </div>
      <div class="card">
        <div class="label">Client</div>
        <div class="name">{client_name}</div>
        {f'<div class="line">{cl_detail}</div>' if cl_detail else ''}
        {f'<div class="contact">{cl_contact_html}</div>' if cl_contact_html else ''}
      </div>
    </div>"""


def _render_infos(doc: Any, content: dict) -> str:
    ref = _s(content.get("reference")) or f"#{_derive_number(doc)}"
    type_opts = _lst(content.get("type_options")) or _DEFAULT_TYPE_OPTIONS
    type_checked = {str(x) for x in (_lst(content.get("type_checked")) or [])}
    type_boxes = "".join(_checkbox(str(o), str(o) in type_checked) for o in type_opts)

    return f"""    <div class="sec">
      <div class="h">Informations générales</div>
      <div class="body">
        <div class="grid4" style="margin-bottom:12px">
          <div class="fld"><div class="k">Référence / N° d'affaire</div><div class="val">{_e(ref)}</div></div>
          {_field("Date d'intervention", content.get("date_intervention"), mono=True)}
          {_field("Heure d'arrivée", content.get("heure_arrivee"), mono=True)}
          {_field("Heure de départ", content.get("heure_depart"), mono=True)}
        </div>
        <div class="grid4" style="margin-bottom:12px;align-items:start">
          {_field("Technicien intervenant", content.get("technicien"))}
          {_field("Fonction", content.get("fonction"))}
          {_field("Météo / Conditions", content.get("meteo"))}
          <div class="fld"><div class="k">Type d'intervention</div>
            <div class="checks">{type_boxes}
              <span class="chk" style="grid-column:1 / -1"><span class="box"></span>Autre :&nbsp;<span style="flex:1;border-bottom:1px solid var(--g300)"></span></span>
            </div>
          </div>
        </div>
        {_field("Adresse d'intervention", content.get("intervention_address"))}
      </div>
    </div>"""


def _render_travaux_commentaires(content: dict) -> str:
    tr_opts = _lst(content.get("travaux_options")) or _DEFAULT_TRAVAUX_OPTIONS
    tr_checked = {str(x) for x in (_lst(content.get("travaux_checked")) or [])}
    tr_boxes = "".join(_checkbox(str(o), str(o) in tr_checked) for o in tr_opts)
    return f"""    <div class="two">
      <div class="sec">
        <div class="h">Objet de l'intervention</div>
        <div class="body">{_txt_or_lines(content.get("objet"), 6)}</div>
      </div>
      <div>
        <div class="sec">
          <div class="h">Travaux réalisés</div>
          <div class="body"><div class="checks">{tr_boxes}
            <span class="chk"><span class="box"></span>Autre : ______</span>
          </div></div>
        </div>
        <div class="sec">
          <div class="h">Commentaires généraux</div>
          <div class="body">{_txt_or_lines(content.get("commentaires"), 2)}</div>
        </div>
      </div>
    </div>"""


def _render_photos(content: dict) -> str:
    photos = _lst(content.get("photos"))

    def _has_img(p: Any) -> bool:
        u = _s((p or {}).get("url") if isinstance(p, dict) else "").strip()
        return u.startswith("data:image/") or u.startswith("http://") or u.startswith("https://")

    # Ne garder que les emplacements qui ont une vraie image. Si aucune image
    # n'est présente (modèle vierge à imprimer), afficher les emplacements tels
    # quels (ou les 3 par défaut).
    real = [p for p in photos if _has_img(p)]
    if real:
        photos = real
    elif not photos:
        photos = _DEFAULT_PHOTOS

    blocks: list[str] = []
    for ph in photos:
        if not isinstance(ph, dict):
            ph = {}
        cap = _e(ph.get("caption") or "Photo")
        url = _s(ph.get("url")).strip()
        # N'afficher une image que si l'URL est réellement une image
        # (data:image/... ou http[s]://). Évite les cadres « cassés » quand un
        # agent a rempli url avec autre chose qu'une image.
        is_img = url.startswith("data:image/") or url.startswith("http://") or url.startswith("https://")
        if is_img:
            media = f'<div class="ph"><img src="{_html_mod.escape(url)}" alt="{cap}"></div>'
        else:
            media = '<div class="ph"><span class="t">Insérer photo ici</span></div>'
        desc = _s(ph.get("description")).strip()
        desc_html = (
            f'<div class="desc"><div class="k">Description / Commentaire</div>'
            f'<div class="filled">{_e(desc)}</div></div>'
            if desc
            else '<div class="desc"><div class="k">Description / Commentaire</div>'
            '<div class="l"></div><div class="l" style="margin-top:5px"></div></div>'
        )
        blocks.append(f'<div class="photo"><div class="cap">{cap}</div>{media}{desc_html}</div>')
    return f"""    <div class="sec sec-photos">
      <div class="h">Photos de l'intervention</div>
      <div class="body"><div class="photos">{''.join(blocks)}</div></div>
    </div>"""


def _render_materiel_reserves(content: dict) -> str:
    rows = _lst(content.get("materiel"))
    if not rows:
        rows = [{}, {}, {}]
    body_rows = []
    for r in rows:
        if not isinstance(r, dict):
            r = {}
        body_rows.append(
            f'<tr><td>{_e(r.get("designation",""))}</td>'
            f'<td>{_e(r.get("reference",""))}</td>'
            f'<td>{_e(r.get("quantite",""))}</td></tr>'
        )
    return f"""    <div class="two">
      <div class="sec">
        <div class="h">Matériel utilisé</div>
        <div class="body" style="padding:0">
          <table class="mat">
            <thead><tr><th>Désignation</th><th>Référence</th><th style="width:80px">Quantité</th></tr></thead>
            <tbody>{''.join(body_rows)}</tbody>
          </table>
        </div>
      </div>
      <div class="sec">
        <div class="h">Réserves / Observations / Actions à prévoir</div>
        <div class="body">{_txt_or_lines(content.get("reserves"), 4)}</div>
      </div>
    </div>"""


def render_intervention_html(doc: Any, company: Any, brand: str = "om2") -> str:
    """Render a complete A4 HTML intervention report. Never raises."""
    accent = _BRANDS[brand]["accent"] if brand in _BRANDS else _OM2_RED
    try:
        content: dict = getattr(doc, "content", None) or {}
        c = _ch(company)
        emitted = _s(content.get("emitted_at")) or _today()
        header_html = _render_header(doc, brand)
        parties_html = _render_parties(content, c, brand)
        infos_html = _render_infos(doc, content)
        travaux_html = _render_travaux_commentaires(content)
        photos_html = _render_photos(content)
        materiel_html = _render_materiel_reserves(content)
    except Exception:  # noqa: BLE001 — render defensively
        emitted = _today()
        header_html = parties_html = infos_html = travaux_html = photos_html = materiel_html = ""

    return f"""<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Compte rendu d'intervention</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>
  :root{{--noir:#0A0A0A;--accent:{accent};--g700:#3a3d42;--g600:#5b616e;--g400:#9aa0ac;--g300:#c3c7cf;--g200:#e7e9ee;--g100:#f3f4f7;--papier:#fff}}
  *{{margin:0;padding:0;box-sizing:border-box}}
  html{{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  body{{font-family:'Inter',system-ui,sans-serif;color:var(--noir);background:#d9dbe0;line-height:1.5;padding:28px 14px}}
  .mono{{font-family:'JetBrains Mono',monospace;font-variant-numeric:tabular-nums}}
  .sheet{{width:210mm;margin:0 auto;background:var(--papier);box-shadow:0 20px 50px rgba(10,10,10,.28);position:relative;overflow:hidden}}
  header{{background:var(--noir);color:#fff;padding:20px 22mm;display:flex;align-items:center;justify-content:space-between;gap:20px}}
  header .logo{{height:70px;width:auto;display:block}}
  header .right{{text-align:right;border-left:2px solid #2a2c31;padding-left:20px}}
  header .right .k{{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--g300);font-weight:600}}
  header .right .n{{font-size:30px;font-weight:800;margin-top:2px}}
  header .right .n .h{{color:var(--accent)}}
  .strip{{display:flex;border-bottom:1px solid var(--g200)}}
  .strip .c{{padding:12px 16px;padding-left:22mm}}
  .strip .k{{font-size:8.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--g400)}}
  .strip .v{{font-size:14px;font-weight:700;margin-top:2px}}
  main{{padding:16px 22mm 22px}}
  .parties{{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px}}
  .card{{border:1px solid var(--g200);border-radius:12px;padding:14px 16px}}
  .card .label{{font-size:9px;letter-spacing:.16em;text-transform:uppercase;color:var(--g400);margin-bottom:9px;font-weight:600}}
  .card .brand{{height:46px;width:auto;display:block;margin-bottom:8px}}
  .card .name{{font-size:15px;font-weight:700;margin-bottom:5px}}
  .card .line{{font-size:11.5px;color:var(--g600);line-height:1.7}}
  .card .contact{{font-size:11.5px;color:var(--noir);line-height:1.9;margin-top:6px}}
  .card .contact b{{color:var(--accent);font-weight:600}}
  .sec{{margin-top:14px}}
  .sec>.h{{background:var(--noir);color:#fff;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;padding:8px 14px 8px 20px;border-radius:7px 7px 0 0;position:relative}}
  .sec>.h::before{{content:"";position:absolute;left:0;top:6px;bottom:6px;width:5px;background:var(--accent);border-radius:3px}}
  .sec>.body{{border:1px solid var(--g200);border-top:none;border-radius:0 0 10px 10px;padding:14px 16px}}
  .grid4{{display:grid;grid-template-columns:repeat(4,1fr);gap:12px 18px}}
  .fld .k{{font-size:9px;letter-spacing:.06em;text-transform:uppercase;color:var(--g600);font-weight:600;margin-bottom:6px}}
  .fld .fill{{border-bottom:1px solid var(--g300);min-height:16px}}
  .fld .val{{font-size:13px;font-weight:700}}
  .filled{{font-size:12.5px;color:var(--noir);line-height:1.6;white-space:pre-wrap}}
  .row-line{{border-bottom:1px dotted var(--g300);height:20px}}
  .checks{{display:grid;grid-template-columns:1fr 1fr;gap:7px 14px;margin-top:2px}}
  .chk{{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--g700)}}
  .chk .box{{width:13px;height:13px;border:1.5px solid var(--g400);border-radius:3px;flex:none}}
  .chk .box.on{{background:var(--accent);border-color:var(--accent)}}
  .two{{display:grid;grid-template-columns:1fr 1fr;gap:14px}}
  .photos{{display:flex;flex-direction:column;align-items:center;gap:22px}}
  .photo{{width:112mm;max-width:100%;margin:0 auto}}
  .photo .cap{{text-align:center;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--g600);font-weight:700;margin-bottom:8px}}
  .photo .ph{{aspect-ratio:3/4;width:100%;border:1px dashed var(--g300);border-radius:8px;background:var(--g100);display:grid;place-items:center;color:var(--g400);overflow:hidden}}
  .photo .ph img{{width:100%;height:100%;object-fit:cover}}
  .photo .ph .t{{font-size:10px;letter-spacing:.1em;text-transform:uppercase}}
  .photo .desc{{width:100%;margin-top:10px}}
  .photo .desc .k{{font-size:8.5px;color:var(--g600);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px}}
  .photo .desc .l{{border-bottom:1px dotted var(--g300);height:14px}}
  table.mat{{width:100%;border-collapse:collapse;font-size:11.5px}}
  table.mat th{{background:var(--g100);text-align:left;font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:var(--g600);padding:8px 10px;border:1px solid var(--g200)}}
  table.mat td{{border:1px solid var(--g200);height:26px;padding:4px 10px}}
  .ribbon{{position:absolute;bottom:0;left:0;right:0;height:4px;background:linear-gradient(90deg,var(--accent) 0 30%,var(--noir) 30% 100%)}}
  /* Pagination : ne pas couper les blocs au milieu d'une page. */
  .sec{{break-inside:avoid;page-break-inside:avoid}}
  .sec-photos{{break-inside:auto;page-break-inside:auto}}
  .sec>.h{{break-after:avoid;page-break-after:avoid}}
  .photo{{break-inside:avoid;page-break-inside:avoid}}
  .card,.parties,.grid4,.two{{break-inside:avoid;page-break-inside:avoid}}
  table.mat tr,table.mat thead{{break-inside:avoid;page-break-inside:avoid}}
  @media print{{body{{background:#fff;padding:0}}.sheet{{box-shadow:none;width:auto}}@page{{size:A4;margin:0}}}}
</style>
</head>
<body>
<div class="sheet">
{header_html}
  <div class="strip"><div class="c"><div class="k">Émis le</div><div class="v mono">{_e(emitted)}</div></div></div>
  <main>
{parties_html}
{infos_html}
{travaux_html}
{photos_html}
{materiel_html}
  </main>
  <div class="ribbon"></div>
</div>
</body>
</html>"""
