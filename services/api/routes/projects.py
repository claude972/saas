"""Project (chantier / affaire) routes.

CRUD-without-delete for BTP projects:

* ``GET    /projects``       — list every project (most recent first).
* ``POST   /projects``       — create a new project.
* ``GET    /projects/{id}``  — fetch a single project.
* ``PATCH  /projects/{id}``  — partial update.

There is intentionally no delete endpoint (V1 keeps everything; soft status
changes only). Create and update are journaled through the audit logger.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.audit_logger import log_event
from core.security import get_current_user
from deps import get_db
from models import Project
from schemas import ProjectCreate, ProjectRead, ProjectUpdate

router = APIRouter()


async def _get_project_or_404(db: AsyncSession, project_id: uuid.UUID) -> Project:
    """Load a project by id or raise ``404``."""
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalars().first()
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Projet introuvable.",
        )
    return project


@router.get("", response_model=list[ProjectRead])
async def list_projects(
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
) -> list[Project]:
    """Return every project, most recently created first."""
    result = await db.execute(
        select(Project).order_by(Project.created_at.desc())
    )
    return list(result.scalars().all())


@router.post("", response_model=ProjectRead, status_code=status.HTTP_201_CREATED)
async def create_project(
    payload: ProjectCreate,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
) -> Project:
    """Create a new project and journal the creation."""
    project = Project(**payload.model_dump())
    db.add(project)
    await db.commit()
    await db.refresh(project)

    await log_event(
        db,
        event_type="project.created",
        message=f"Projet cree : {project.name}",
        project_id=project.id,
        payload={"name": project.name, "status": project.status},
    )
    return project


@router.get("/{project_id}", response_model=ProjectRead)
async def get_project(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
) -> Project:
    """Fetch a single project by id."""
    return await _get_project_or_404(db, project_id)


@router.patch("/{project_id}", response_model=ProjectRead)
async def update_project(
    project_id: uuid.UUID,
    payload: ProjectUpdate,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
) -> Project:
    """Partially update a project and journal the change."""
    project = await _get_project_or_404(db, project_id)

    changes = payload.model_dump(exclude_unset=True)
    for field, value in changes.items():
        setattr(project, field, value)

    await db.commit()
    await db.refresh(project)

    await log_event(
        db,
        event_type="project.updated",
        message=f"Projet mis a jour : {project.name}",
        project_id=project.id,
        payload={"updated_fields": list(changes.keys())},
    )
    return project
