"""OpenClaw command intake routes.

OpenClaw (the master agent) talks to the cockpit exclusively through this
surface. It never writes to the database or the filesystem directly: it submits
a natural-language *command*, which is persisted with status ``received`` and
then handed to :func:`core.command_router.process_command` for asynchronous
orchestration (intent classification, agent routing, task creation, document
generation, risk scoring, approvals and journaling).

Endpoints (mounted under the ``/openclaw`` prefix):

* ``POST /command``        — submit a command; returns immediately.
* ``GET  /commands``       — list recent commands (newest first).
* ``GET  /commands/{id}``  — fetch a single command.

All routes require an authenticated caller via :func:`get_current_user`.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.command_router import process_command
from core.security import get_current_user
from deps import get_db
from models import OpenClawCommand
from schemas import OpenClawCommandCreate, OpenClawCommandRead

router = APIRouter()


@router.post(
    "/command",
    response_model=OpenClawCommandRead,
    status_code=status.HTTP_201_CREATED,
)
async def submit_command(
    payload: OpenClawCommandCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
) -> OpenClawCommand:
    """Persist an OpenClaw command and schedule its orchestration.

    The command is stored with its default ``received`` status, then
    :func:`process_command` is queued as a background task so the caller gets an
    immediate acknowledgement while routing/execution happen out of band.
    """
    command = OpenClawCommand(**payload.model_dump())
    db.add(command)
    await db.commit()
    await db.refresh(command)

    background_tasks.add_task(process_command, command.id)
    return command


@router.get("/commands", response_model=list[OpenClawCommandRead])
async def list_commands(
    project_id: uuid.UUID | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
) -> list[OpenClawCommand]:
    """List commands, newest first, optionally filtered by project."""
    stmt = select(OpenClawCommand)
    if project_id is not None:
        stmt = stmt.where(OpenClawCommand.project_id == project_id)
    stmt = stmt.order_by(OpenClawCommand.created_at.desc()).limit(limit)

    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.get("/commands/{command_id}", response_model=OpenClawCommandRead)
async def get_command(
    command_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
) -> OpenClawCommand:
    """Fetch a single command by id, or raise ``404`` if it does not exist."""
    command = await db.get(OpenClawCommand, command_id)
    if command is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Commande OpenClaw introuvable.",
        )
    return command
