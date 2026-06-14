"""Log (audit trail) routes.

The ``logs`` table is the append-only journal of everything the cockpit does:
commands received, intents routed, tasks created, agents run, documents
generated, approvals requested, etc. This module exposes a read-only surface:

* ``GET /logs``               — list logs (filterable, newest first).
* ``GET /logs/{project_id}``  — logs scoped to a single project.

Logs are written by :mod:`core.audit_logger`, never created through the API,
so there is intentionally no POST endpoint here.

All routes require an authenticated caller via :func:`get_current_user`.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.security import get_current_user
from deps import get_db
from models import Log, Project
from schemas import LogRead

router = APIRouter()


@router.get("", response_model=list[LogRead])
@router.get("/", response_model=list[LogRead], include_in_schema=False)
async def list_logs(
    level: str | None = Query(default=None),
    event_type: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
) -> list[Log]:
    """List logs, newest first, optionally filtered by level and event type."""
    stmt = select(Log)
    if level is not None:
        stmt = stmt.where(Log.level == level)
    if event_type is not None:
        stmt = stmt.where(Log.event_type == event_type)
    stmt = stmt.order_by(Log.created_at.desc()).limit(limit)

    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.get("/{project_id}", response_model=list[LogRead])
async def list_project_logs(
    project_id: uuid.UUID,
    level: str | None = Query(default=None),
    event_type: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
) -> list[Log]:
    """List logs for a single project, newest first.

    Raises ``404`` if the project does not exist.
    """
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Projet introuvable.",
        )

    stmt = select(Log).where(Log.project_id == project_id)
    if level is not None:
        stmt = stmt.where(Log.level == level)
    if event_type is not None:
        stmt = stmt.where(Log.event_type == event_type)
    stmt = stmt.order_by(Log.created_at.desc()).limit(limit)

    result = await db.execute(stmt)
    return list(result.scalars().all())
