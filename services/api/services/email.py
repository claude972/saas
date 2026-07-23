"""Envoi de documents (devis) par email via SMTP.

Le PDF est rendu à la volée (variante OM²/CED/Suivisio) puis attaché à un
message MIME envoyé via SMTP. Le SMTP bloquant de la stdlib tourne dans un
thread pour ne pas figer la boucle asyncio.

Configuration : voir ``config.Settings`` (SMTP_HOST, SMTP_PORT, …). Si le SMTP
n'est pas configuré, :func:`send_document_email` lève ``EmailNotConfigured``.
"""

from __future__ import annotations

import asyncio
import base64
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr
from typing import TYPE_CHECKING, Any

import httpx

from config import settings
from core.audit_logger import log_event
from services.exporters import _filename_stem, _s, export_document

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


class EmailNotConfigured(RuntimeError):
    """Raised when an email send is attempted while SMTP is not configured."""


# Brand → suffixe de fichier pour les variantes brandées du devis.
_BRAND_SUFFIX = {"ced": "-CED", "suivisio": "-SUIVISIO", "brume": "-BRUME"}

# Brand → nom d'expéditeur affiché (l'adresse reste SMTP_FROM).
_BRAND_SENDER = {
    "pdf": "OM2", "om2": "OM2", "ced": "CED",
    "suivisio": "Suivisio", "brume": "Brume Caraïbes",
}


async def render_document_pdf(document: Any, company: Any, brand: str = "pdf") -> tuple[bytes, str]:
    """Render a document to PDF bytes for the given brand.

    ``brand`` : ``"pdf"``/``"om2"`` (devis OM² rouge), ``"ced"`` (vert) ou
    ``"suivisio"`` (bleu). Pour un devis/DPGF on tente le rendu Chromium brandé ;
    sinon (ou si Chromium indisponible) on retombe sur l'export PDF reportlab.

    Returns ``(pdf_bytes, filename)``.
    """
    stem = _filename_stem(_s(getattr(document, "title", "document")) or "document")
    doc_type = getattr(document, "document_type", None)

    if doc_type in ("quote", "dpgf", "intervention"):
        from services.pdf_render import pdf_render_available, render_pdf_from_html

        render_brand = "om2" if brand in ("pdf", "om2") else brand
        if pdf_render_available():
            if doc_type == "intervention":
                from services.intervention_html import render_intervention_html
                html = render_intervention_html(document, company, brand=render_brand)
            else:
                from services.devis_html import render_devis_html
                html = render_devis_html(document, company, brand=render_brand)
            if "<tr" in html:
                pdf = await render_pdf_from_html(html)
                suffix = _BRAND_SUFFIX.get(render_brand, "")
                return pdf, f"{stem}{suffix}.pdf"

    # Fallback : PDF reportlab générique.
    content_bytes, _media_type, filename = export_document(document, company, "pdf")
    return content_bytes, filename


def _send_sync(msg: EmailMessage) -> None:
    """Blocking SMTP send (run via ``asyncio.to_thread``)."""
    host, port = settings.SMTP_HOST, settings.SMTP_PORT
    context = ssl.create_default_context()
    if not settings.SMTP_VERIFY_CERT:
        # Hébergement mutualisé : le certificat (ex. *.lwspanel.com) ne matche
        # pas le nom d'hôte. On chiffre toujours, mais sans vérifier le cert.
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
    if port == 465:
        with smtplib.SMTP_SSL(host, port, context=context, timeout=30) as server:
            if settings.SMTP_USER:
                server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            server.send_message(msg)
    else:
        with smtplib.SMTP(host, port, timeout=30) as server:
            if settings.SMTP_USE_TLS:
                server.starttls(context=context)
            if settings.SMTP_USER:
                server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            server.send_message(msg)


async def _send_brevo(
    *,
    sender_email: str,
    sender_name: str,
    to: str,
    subject: str,
    text: str,
    pdf_bytes: bytes,
    filename: str,
) -> None:
    """Send via the Brevo transactional API (HTTPS 443 — works on Railway)."""
    sender: dict[str, str] = {"email": sender_email}
    if sender_name:
        sender["name"] = sender_name
    payload = {
        "sender": sender,
        "to": [{"email": to}],
        "subject": subject,
        "textContent": text,
        "attachment": [
            {"name": filename, "content": base64.b64encode(pdf_bytes).decode("ascii")}
        ],
    }
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            "https://api.brevo.com/v3/smtp/email",
            headers={
                "api-key": settings.BREVO_API_KEY,
                "content-type": "application/json",
                "accept": "application/json",
            },
            json=payload,
        )
    if resp.status_code >= 300:
        raise RuntimeError(f"Brevo API {resp.status_code}: {resp.text[:300]}")


async def _send_via_relay(
    *,
    sender_email: str,
    sender_name: str,
    to: str,
    subject: str,
    text: str,
    pdf_bytes: bytes,
    filename: str,
) -> None:
    """Send via the self-hosted HTTPS relay (VPS) that performs the SMTP send."""
    payload = {
        "to": to,
        "subject": subject,
        "text": text,
        "from_email": sender_email,
        "from_name": sender_name or "",
        "filename": filename,
        "pdf_base64": base64.b64encode(pdf_bytes).decode("ascii"),
    }
    url = settings.MAIL_RELAY_URL.rstrip("/") + "/send"
    async with httpx.AsyncClient(timeout=40) as client:
        resp = await client.post(
            url, headers={"X-Relay-Secret": settings.MAIL_RELAY_SECRET}, json=payload
        )
    if resp.status_code >= 300:
        raise RuntimeError(f"Relais {resp.status_code}: {resp.text[:300]}")


async def send_document_email(
    db: "AsyncSession",
    document: Any,
    company: Any,
    *,
    to: str,
    subject: str,
    message: str = "",
    brand: str = "pdf",
) -> str:
    """Render the document PDF and email it as an attachment.

    Raises :class:`EmailNotConfigured` if SMTP is not set up. On success,
    journalises a ``document.emailed`` event and returns the attachment filename.
    """
    if not settings.email_configured:
        raise EmailNotConfigured(
            "Envoi email non configuré : renseignez le fournisseur (EMAIL_PROVIDER) et ses "
            "identifiants (BREVO_API_KEY pour Brevo, ou SMTP_* pour SMTP) + une adresse expéditeur."
        )

    pdf_bytes, filename = await render_document_pdf(document, company, brand)

    sender = settings.SMTP_FROM or settings.SMTP_USER
    # Nom d'expéditeur selon la variante (OM2/CED/Suivisio), sinon réglage global.
    sender_name = _BRAND_SENDER.get(brand, settings.SMTP_FROM_NAME)
    subj = subject or f"Devis — {_s(getattr(document, 'title', '')) or 'document'}"
    text = message or "Bonjour,\n\nVeuillez trouver ci-joint votre devis.\n\nCordialement,"

    if settings.EMAIL_PROVIDER == "brevo":
        await _send_brevo(
            sender_email=sender, sender_name=sender_name, to=to,
            subject=subj, text=text, pdf_bytes=pdf_bytes, filename=filename,
        )
    elif settings.EMAIL_PROVIDER == "relay":
        await _send_via_relay(
            sender_email=sender, sender_name=sender_name, to=to,
            subject=subj, text=text, pdf_bytes=pdf_bytes, filename=filename,
        )
    else:
        msg = EmailMessage()
        msg["From"] = formataddr((sender_name, sender)) if sender_name else sender
        msg["To"] = to
        msg["Subject"] = subj
        msg.set_content(text)
        msg.add_attachment(pdf_bytes, maintype="application", subtype="pdf", filename=filename)
        await asyncio.to_thread(_send_sync, msg)

    await log_event(
        db,
        event_type="document.emailed",
        message=f"Document « {_s(getattr(document, 'title', '')) or filename} » envoyé par email à {to}",
        level="info",
        payload={
            "document_id": str(getattr(document, "id", "")),
            "to": to,
            "brand": brand,
            "filename": filename,
        },
    )
    return filename
