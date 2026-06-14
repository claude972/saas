"""Document routes.

Documents are generated artefacts (quotes, site reports, tender responses,
...). They are always created as *drafts* and never sent or deleted directly:
state transitions flow through the approval pipeline. This module exposes a
read-only listing/detail surface plus a creation endpoint.

All routes require an authenticated caller via :func:`get_current_user`.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.security import get_current_user
from deps import get_db
from enums import DocumentStatus
from models import Document
from schemas import DocumentCreate, DocumentRead

router = APIRouter()


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
