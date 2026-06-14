"""Task routes.

Tasks are the units of work created by the orchestrator (the command router or a
manual agent run). This module exposes the contractual CRUD-without-delete
surface:

* ``GET    /tasks``       — list tasks (filterable, newest first).
* ``POST   /tasks``       — create a task.
* ``GET    /tasks/{id}``  — fetch a single task.
* ``PATCH  /tasks/{id}``  — partial update.

There is intentionally no delete endpoint (V1 keeps everything; status changes
only). Create and update are journaled through the audit logger.

All routes require an authenticated caller via :func:`get_current_user`.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.audit_logger import log_event
from core.security import get_current_user
from deps import get_db
from enums import TaskStatus
from models import Task
from schemas import TaskCreate, TaskRead, TaskUpdate

router = APIRouter()


async def _get_task_or_404(db: AsyncSession, task_id: uuid.UUID) -> Task:
    """Load a task by id or raise ``404``."""
    task = await db.get(Task, task_id)
    if task is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tache introuvable.",
        )
    return task


@router.get("", response_model=list[TaskRead])
@router.get("/", response_model=list[TaskRead], include_in_schema=False)
async def list_tasks(
    project_id: uuid.UUID | None = Query(default=None),
    status: TaskStatus | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
) -> list[Task]:
    """List tasks, newest first, optionally filtered by project and status."""
    stmt = select(Task)
    if project_id is not None:
        stmt = stmt.where(Task.project_id == project_id)
    if status is not None:
        stmt = stmt.where(Task.status == status.value)
    stmt = stmt.order_by(Task.created_at.desc()).limit(limit)

    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.post("", response_model=TaskRead, status_code=status.HTTP_201_CREATED)
@router.post(
    "/",
    response_model=TaskRead,
    status_code=status.HTTP_201_CREATED,
    include_in_schema=False,
)
async def create_task(
    payload: TaskCreate,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
) -> Task:
    """Create a task and journal the creation."""
    task = Task(**payload.model_dump())
    db.add(task)
    await db.commit()
    await db.refresh(task)

    await log_event(
        db,
        event_type="task.created",
        message=f"Tache creee : {task.title}",
        project_id=task.project_id,
        command_id=task.command_id,
        task_id=task.id,
        agent_id=task.agent_id,
        payload={"status": task.status},
    )
    return task


@router.get("/{task_id}", response_model=TaskRead)
async def get_task(
    task_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
) -> Task:
    """Fetch a single task by id, or raise ``404`` if it does not exist."""
    return await _get_task_or_404(db, task_id)


@router.patch("/{task_id}", response_model=TaskRead)
async def update_task(
    task_id: uuid.UUID,
    payload: TaskUpdate,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
) -> Task:
    """Partially update a task and journal the change.

    Enum fields (``status``) are persisted as their raw string ``.value`` to
    stay consistent with how the orchestrator writes them.
    """
    task = await _get_task_or_404(db, task_id)

    changes = payload.model_dump(exclude_unset=True)
    if "status" in changes and isinstance(changes["status"], TaskStatus):
        changes["status"] = changes["status"].value

    for field, value in changes.items():
        setattr(task, field, value)

    await db.commit()
    await db.refresh(task)

    await log_event(
        db,
        event_type="task.updated",
        message=f"Tache mise a jour : {task.title}",
        project_id=task.project_id,
        command_id=task.command_id,
        task_id=task.id,
        agent_id=task.agent_id,
        payload={"updated_fields": list(changes.keys())},
    )
    return task
