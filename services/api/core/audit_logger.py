"""Append-only audit trail.

Every meaningful step of the orchestration (command received, routing, task
created, agent run, document generated, approval requested, completion or
failure) is recorded as a ``Log`` row. This module exposes a single helper that
inserts one row and commits it.
"""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from models import Log


async def log_event(
    db: AsyncSession,
    *,
    event_type: str,
    message: str,
    level: str = "info",
    project_id: uuid.UUID | None = None,
    command_id: uuid.UUID | None = None,
    task_id: uuid.UUID | None = None,
    agent_id: uuid.UUID | None = None,
    payload: dict | None = None,
) -> Log:
    """Insert a single audit log row and commit it.

    Returns the persisted ``Log`` instance.
    """
    entry = Log(
        level=level,
        event_type=event_type,
        message=message,
        project_id=project_id,
        command_id=command_id,
        task_id=task_id,
        agent_id=agent_id,
        payload=payload,
    )
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    return entry
