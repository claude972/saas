"""Document routes.

Documents are generated artefacts (quotes, site reports, tender responses,
...). They are always created as *drafts* and never sent or deleted directly:
state transitions flow through the approval pipeline. This module exposes a
read-only listing/detail surface plus a creation endpoint.

All routes require an authenticated caller via :func:`get_current_user`.

Vague 4 additions
-----------------
* PATCH /documents/{id}   — partial update; recalculates quote totals; demotes
  approved/sent docs back to waiting_approval and raises an Approval via
  :mod:`core.approval_engine` when content changes.
* GET  /documents/{id}/export?format=pdf|docx|xlsx — binary download via
  :mod:`services.exporters`.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.approval_engine import create_approval
from core.audit_logger import log_event
from core.risk_engine import compute_risk
from core.security import get_current_user
from deps import get_db
from enums import DocumentStatus, RiskLevel
from models import CompanySettings, Document
from schemas import ApprovalRead, DocumentCreate, DocumentEmailInput, DocumentRead, DocumentUpdate
from services.exporters import ExportUnavailable, _s, export_document

router = APIRouter()

# ---------------------------------------------------------------------------
# Statuses that require re-approval when content is modified
# ---------------------------------------------------------------------------
_NEEDS_REAPPROVAL = {DocumentStatus.APPROVED.value, DocumentStatus.SENT.value}

# Default TVA rate used when none is stored in document content
_DEFAULT_TVA = 0.20


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _recalculate_quote_totals(content: dict) -> dict:
    """Return a copy of *content* with total_ht/total_tva/total_ttc recomputed.

    Each line item (under the ``lines`` or ``items`` key) contributes its
    explicit per-line ``total_ht`` when present — this is the source of truth
    written by the quote agent, the QuoteEditor and OpenClaw — and otherwise
    ``qty`` × unit price. The unit price is read from ``unit_price_ht`` (the
    canonical field) with ``unit_price``/``price``/``montant`` as aliases.
    The TVA rate defaults to 20 % when not present in the content dict.
    """
    tva_rate = float(content.get("tva_rate") or _DEFAULT_TVA)
    raw_lines = content.get("lines") or content.get("items") or []

    total_ht = 0.0
    for row in raw_lines:
        if not isinstance(row, dict):
            continue
        if row.get("total_ht") is not None:
            # Trust the per-line total (separators carry total_ht == 0).
            total_ht += float(row.get("total_ht") or 0)
            continue
        qty = float(row.get("qty") or row.get("quantity") or 1)
        unit_price = float(
            row.get("unit_price_ht")
            or row.get("unit_price")
            or row.get("price")
            or row.get("montant")
            or 0
        )
        total_ht += qty * unit_price

    total_tva = total_ht * tva_rate
    total_ttc = total_ht + total_tva

    result = dict(content)
    result["total_ht"] = round(total_ht, 2)
    result["total_tva"] = round(total_tva, 2)
    result["total_ttc"] = round(total_ttc, 2)
    return result


async def _load_company(db: AsyncSession) -> CompanySettings | None:
    """Fetch the singleton CompanySettings row (returns None if not yet seeded)."""
    result = await db.execute(select(CompanySettings).limit(1))
    return result.scalars().first()


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("", response_model=list[DocumentRead])
@router.get("/", response_model=list[DocumentRead], include_in_schema=False)
async def list_documents(
    project_id: uuid.UUID | None = Query(default=None),
    status: DocumentStatus | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
) -> list[Document]:
    """List documents, newest first, optionally filtered by project and status."""
    stmt = select(Document)
    if project_id is not None:
        stmt = stmt.where(Document.project_id == project_id)
    if status is not None:
        stmt = stmt.where(Document.status == status.value)
    stmt = stmt.order_by(Document.created_at.desc())

    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.post(
    "",
    response_model=DocumentRead,
    status_code=status.HTTP_201_CREATED,
)
@router.post(
    "/",
    response_model=DocumentRead,
    status_code=status.HTTP_201_CREATED,
    include_in_schema=False,
)
async def create_document(
    payload: DocumentCreate,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
) -> Document:
    """Create a document. Forced to ``draft`` regardless of the supplied status."""
    data = payload.model_dump()
    data["status"] = DocumentStatus.DRAFT.value

    document = Document(**data)
    db.add(document)
    await db.commit()
    await db.refresh(document)
    return document


@router.get("/{document_id}", response_model=DocumentRead)
async def get_document(
    document_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
) -> Document:
    """Fetch a single document by id, or raise ``404`` if it does not exist."""
    document = await db.get(Document, document_id)
    if document is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document introuvable.",
        )
    return document


@router.patch("/{document_id}", response_model=DocumentRead)
async def update_document(
    document_id: uuid.UUID,
    payload: DocumentUpdate,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
) -> Document:
    """Partially update a document.

    Rules
    -----
    * ``title`` and ``status`` are applied as-is.
    * ``content`` is applied and — when ``document_type`` is ``"quote"`` or
      ``"dpgf"`` — totals (``total_ht``, ``total_tva``, ``total_ttc``) are
      recomputed from the line items.
    * If the document was previously ``approved`` or ``sent`` and ``content`` is
      being changed, the document is demoted to ``waiting_approval`` and a new
      :class:`~models.Approval` is created so a human can re-validate.
    """
    document = await db.get(Document, document_id)
    if document is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document introuvable.",
        )

    update_data = payload.model_dump(exclude_unset=True)
    content_changed = "content" in update_data and update_data["content"] is not None

    # --- Apply title ---
    if "title" in update_data:
        document.title = update_data["title"]

    # --- Apply and optionally recalculate content ---
    if content_changed:
        new_content: dict = update_data["content"]
        if document.document_type in ("quote", "dpgf"):
            new_content = _recalculate_quote_totals(new_content)
        document.content = new_content

    # --- Apply explicit status override (only when content did NOT trigger a
    #     re-approval below) ---
    explicit_status = update_data.get("status")

    # --- Re-approval logic ---
    if content_changed and document.status in _NEEDS_REAPPROVAL:
        document.status = DocumentStatus.WAITING_APPROVAL.value

        risk = compute_risk(
            intent=None,
            document_type=document.document_type,
            action="update_validated_data",
        )

        await db.commit()
        await db.refresh(document)

        await create_approval(
            db,
            title=f"Révision du document : {document.title}",
            description=(
                "Le contenu d'un document précédemment validé a été modifié. "
                "Une nouvelle validation est requise."
            ),
            risk_level=risk,
            project_id=document.project_id,
            command_id=None,
            task_id=document.task_id,
            payload={"document_id": str(document.id), "document_type": document.document_type},
        )

        await log_event(
            db,
            event_type="document.reapproval_required",
            message=f"Document '{document.title}' modifié après validation — remis en attente d'approbation.",
            level="warning",
            project_id=document.project_id,
            task_id=document.task_id,
            payload={"document_id": str(document.id), "previous_status": document.status},
        )
    else:
        # No re-approval needed: apply explicit status if provided
        if explicit_status is not None:
            document.status = explicit_status

        await db.commit()
        await db.refresh(document)

    return document


@router.get("/{document_id}/export")
async def export_document_route(
    document_id: uuid.UUID,
    fmt: str = Query(default="pdf", alias="format", description="Format d'export: pdf, docx, xlsx, obat ou ced"),
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
) -> StreamingResponse:
    """Export a document as a binary file.

    Supported formats: ``pdf``, ``docx``, ``xlsx``, ``obat``.

    * ``obat`` — XLSX in OBAT import format (quotes/dpgf only).
    * ``pdf`` for quote/dpgf types — attempts a branded Chromium PDF first,
      falls back silently to the reportlab PDF if Chromium is unavailable.

    The company header and legal mentions are pulled from the
    :class:`~models.CompanySettings` singleton when available.
    """
    import io

    document = await db.get(Document, document_id)
    if document is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document introuvable.",
        )

    if fmt not in ("pdf", "docx", "xlsx", "obat", "ced", "suivisio", "brume"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Format non supporté: '{fmt}'. Valeurs acceptées: pdf, docx, xlsx, obat, ced, suivisio, brume.",
        )

    company = await _load_company(db)

    try:
        if fmt == "obat":
            from services.exporters import export_obat
            try:
                content_bytes, media_type, filename = export_obat(document, company)
            except ExportUnavailable:
                raise  # re-raise so the outer handler returns 501
            except Exception as obat_exc:
                # Malformed content or unexpected error: fall back to standard xlsx.
                try:
                    content_bytes, media_type, filename = export_document(document, company, "xlsx")
                except Exception:
                    raise HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                        detail=(
                            "Impossible de générer l'export Obat pour ce document "
                            f"({obat_exc.__class__.__name__}: {obat_exc})."
                        ),
                    )

        elif fmt in ("ced", "suivisio", "brume"):
            # Branded PDF variant (CED = vert, Suivisio/Brume = bleu). Devis/DPGF
            # only, requires the Chromium HTML renderer (no reportlab equivalent).
            brand_label = {"ced": "CED", "suivisio": "Suivisio", "brume": "Brume Caraïbes"}[fmt]
            file_suffix = {"ced": "CED", "suivisio": "SUIVISIO", "brume": "BRUME"}[fmt]
            doc_type = getattr(document, "document_type", None)
            if doc_type not in ("quote", "dpgf", "intervention"):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"L'export {brand_label} ne concerne que les devis et comptes rendus.",
                )
            from services.exporters import _filename_stem, _s
            from services.pdf_render import pdf_render_available, render_pdf_from_html

            if not pdf_render_available():
                raise HTTPException(
                    status_code=status.HTTP_501_NOT_IMPLEMENTED,
                    detail=f"Rendu PDF (Chromium) indisponible pour l'export {brand_label}.",
                )
            if doc_type == "intervention":
                from services.intervention_html import render_intervention_html
                html = render_intervention_html(document, company, brand=fmt)
            else:
                from services.devis_html import render_devis_html
                html = render_devis_html(document, company, brand=fmt)
            if "<tr" not in html:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"Impossible de générer l'export {brand_label} pour ce document (contenu vide).",
                )
            content_bytes = await render_pdf_from_html(html)
            media_type = "application/pdf"
            stem = _filename_stem(_s(getattr(document, "title", "document")) or "document")
            filename = f"{stem}-{file_suffix}.pdf"

        elif fmt == "pdf" and getattr(document, "document_type", None) in ("quote", "dpgf", "intervention"):
            # Attempt branded Chromium PDF; fall back to reportlab on any failure.
            content_bytes = None
            media_type = "application/pdf"
            doc_type = getattr(document, "document_type", None)
            from services.exporters import _filename_stem, _s
            stem = _filename_stem(_s(getattr(document, "title", "document")) or "document")
            filename = f"{stem}.pdf"
            try:
                from services.pdf_render import pdf_render_available, render_pdf_from_html
                if pdf_render_available():
                    if doc_type == "intervention":
                        from services.intervention_html import render_intervention_html
                        html = render_intervention_html(document, company)
                    else:
                        from services.devis_html import render_devis_html
                        html = render_devis_html(document, company)
                    # Guard: only ship the branded PDF if the body actually has
                    # rows; otherwise fall back to reportlab (never deliver an
                    # empty branded sheet on a template/data error).
                    if "<tr" in html:
                        content_bytes = await render_pdf_from_html(html)
            except Exception:
                content_bytes = None
            if content_bytes is None:
                # Fallback: reportlab
                content_bytes, media_type, filename = export_document(document, company, "pdf")

        else:
            content_bytes, media_type, filename = export_document(document, company, fmt)

    except ExportUnavailable as exc:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail=str(exc),
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        )

    return StreamingResponse(
        io.BytesIO(content_bytes),
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/{document_id}/email")
async def email_document_route(
    document_id: uuid.UUID,
    body: DocumentEmailInput,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
) -> dict:
    """Send the document's PDF to a recipient by email (direct send).

    Used for human-initiated sends from the cockpit. The PDF brand follows
    ``body.brand`` ("pdf"/"om2", "ced" or "suivisio").
    """
    document = await db.get(Document, document_id)
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document introuvable.")

    company = await _load_company(db)
    from services.email import EmailNotConfigured, send_document_email

    try:
        filename = await send_document_email(
            db, document, company,
            to=str(body.to), subject=body.subject, message=body.message, brand=body.brand,
        )
    except EmailNotConfigured as exc:
        raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail=str(exc))
    except Exception as exc:  # noqa: BLE001 — surface the SMTP failure to the caller
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Échec de l'envoi de l'email : {exc}",
        )

    return {"status": "sent", "to": str(body.to), "filename": filename}


@router.post("/{document_id}/email/request-approval", response_model=ApprovalRead)
async def request_email_approval_route(
    document_id: uuid.UUID,
    body: DocumentEmailInput,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    """Create a human approval to email the document (agent/MCP-initiated).

    The email is only sent once a human accepts the approval in the cockpit
    (see :func:`core.approval_engine.apply_decision`).
    """
    document = await db.get(Document, document_id)
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document introuvable.")

    title = _s(getattr(document, "title", "")) or "document"
    return await create_approval(
        db,
        title=f"Envoi par email à {body.to}",
        description=f"Envoyer le devis « {title} » à {body.to}.",
        risk_level=RiskLevel.MEDIUM,
        project_id=getattr(document, "project_id", None),
        command_id=None,
        task_id=getattr(document, "task_id", None),
        payload={
            "action": "send_document_email",
            "document_id": str(document_id),
            "to": str(body.to),
            "subject": body.subject,
            "message": body.message,
            "brand": body.brand,
        },
    )
