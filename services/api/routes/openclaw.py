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
* ``POST /heartbeat``      — MCP heartbeat (no auth); upserts openclaw_last_seen.
* ``GET  /status``         — connectivity status (auth required).

All command routes require an authenticated caller via :func:`get_current_user`.
``/heartbeat`` is intentionally unauthenticated so the MCP server can call it
without managing a session token in the background task.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from core.command_router import process_command
from core.security import get_current_user
from deps import get_db
from models import OpenClawCommand, SystemState
from schemas import OpenClawCommandCreate, OpenClawCommandRead, OpenClawStatus

router = APIRouter()

_HEARTBEAT_KEY = "openclaw_last_seen"
_CONNECTED_THRESHOLD_SECONDS = 60


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


# ---------------------------------------------------------------------------
# Vague 6 — heartbeat & status
# ---------------------------------------------------------------------------

@router.post("/heartbeat", status_code=status.HTTP_204_NO_CONTENT)
async def heartbeat(db: AsyncSession = Depends(get_db)) -> None:
    """Enregistre l'horodatage du dernier contact OpenClaw (sans authentification).

    Le serveur MCP appelle cet endpoint toutes les 30 secondes depuis une tâche
    asyncio en arrière-plan. L'absence d'authentification est intentionnelle :
    il n'y a aucune donnée sensible ici, et imposer un token compliquerait la
    tâche de fond sans bénéfice de sécurité.

    La ligne ``system_state`` avec ``key='openclaw_last_seen'`` est créée si
    elle n'existe pas encore (``ON CONFLICT DO UPDATE``).
    """
    now_iso = datetime.now(tz=timezone.utc).isoformat()

    stmt = (
        pg_insert(SystemState)
        .values(
            key=_HEARTBEAT_KEY,
            value={"ts": now_iso},
            updated_at=datetime.now(tz=timezone.utc),
        )
        .on_conflict_do_update(
            index_elements=["key"],
            set_={
                "value": {"ts": now_iso},
                "updated_at": datetime.now(tz=timezone.utc),
            },
        )
    )
    await db.execute(stmt)
    await db.commit()


@router.get("/status", response_model=OpenClawStatus)
async def openclaw_status(
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
) -> OpenClawStatus:
    """Retourne l'état de connectivité d'OpenClaw.

    ``connected`` vaut ``True`` si un heartbeat a été reçu dans les
    :data:`_CONNECTED_THRESHOLD_SECONDS` dernières secondes.

    ``model_info`` expose le fournisseur LLM par défaut configuré sur le serveur
    (champ ``default_provider``).
    """
    row: SystemState | None = await db.get(SystemState, _HEARTBEAT_KEY)

    last_seen: datetime | None = None
    connected = False

    if row is not None:
        ts_raw = (row.value or {}).get("ts")
        if ts_raw:
            try:
                last_seen = datetime.fromisoformat(ts_raw)
                # Ensure timezone-aware for arithmetic.
                if last_seen.tzinfo is None:
                    last_seen = last_seen.replace(tzinfo=timezone.utc)
                age = (datetime.now(tz=timezone.utc) - last_seen).total_seconds()
                connected = age < _CONNECTED_THRESHOLD_SECONDS
            except ValueError:
                # Malformed timestamp stored in DB — treat as disconnected.
                last_seen = None

    return OpenClawStatus(
        connected=connected,
        last_seen=last_seen,
        model_info={"default_provider": settings.DEFAULT_LLM_PROVIDER},
    )
