"""Envoi de documents (devis) par email via SMTP.

Le PDF est rendu à la volée (variante OM²/CED/Suivisio) puis attaché à un
message MIME envoyé via SMTP. Le SMTP bloquant de la stdlib tourne dans un
thread pour ne pas figer la boucle asyncio.

Configuration : voir ``config.Settings`` (SMTP_HOST, SMTP_PORT, …). Si le SMTP
n'est pas configuré, :func:`send_document_email` lève ``EmailNotConfigured``.
"""

from __future__ import annotations

import asyncio
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr
from typing import TYPE_CHECKING, Any

from config import settings
from core.audit_logger import log_event
from services.exporters import _filename_stem, _s, export_document

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


class EmailNotConfigured(RuntimeError):
    """Raised when an email send is attempted while SMTP is not configured."""


# Brand → suffixe de fichier pour les variantes brandées du devis.
_BRAND_SUFFIX = {"ced": "-CED", "suivisio": "-SUIVISIO"}


async def render_document_pdf(document: Any, company: Any, brand: str = "pdf") -> tuple[bytes, str]:
    """Render a document to PDF bytes for the given brand.

    ``brand`` : ``"pdf"``/``"om2"`` (devis OM² rouge), ``"ced"`` (vert) ou
    ``"suivisio"`` (bleu). Pour un devis/DPGF on tente le rendu Chromium brandé ;
    sinon (ou si Chromium indisponible) on retombe sur l'export PDF reportlab.

    Returns ``(pdf_bytes, filename)``.
    """
    stem = _filename_stem(_s(getattr(document, "title", "document")) or "document")
    doc_type = getattr(document, "document_type", None)

    if doc_type in ("quote", "dpgf"):
        from services.devis_html import render_devis_html
        from services.pdf_render import pdf_render_available, render_pdf_from_html

        render_brand = "om2" if brand in ("pdf", "om2") else brand
        if pdf_render_available():
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
    if not settings.smtp_configured:
        raise EmailNotConfigured(
            "SMTP non configuré : renseignez SMTP_HOST, SMTP_FROM/SMTP_USER (et identifiants)."
        )

    pdf_bytes, filename = await render_document_pdf(document, company, brand)

    sender = settings.SMTP_FROM or settings.SMTP_USER
    msg = EmailMessage()
    msg["From"] = formataddr((settings.SMTP_FROM_NAME, sender)) if settings.SMTP_FROM_NAME else sender
    msg["To"] = to
    msg["Subject"] = subject or f"Devis — {_s(getattr(document, 'title', '')) or 'document'}"
    msg.set_content(message or "Bonjour,\n\nVeuillez trouver ci-joint votre devis.\n\nCordialement,")
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
