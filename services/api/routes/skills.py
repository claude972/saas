"""Skills API routes.

CRUD over the ``skills`` table. Skills are reusable instruction blocks that can
be attached to agents (via ``config["skills"]`` slugs) and injected into LLM
prompts at run time.

Soft-delete is implemented as ``PATCH /{id}`` with ``enabled=false``; the
dedicated ``DELETE /{id}`` endpoint flips that flag rather than removing the row
so that historical references (agent configs, audit logs) stay intact.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.security import get_current_user
from deps import get_db
from models import Skill
from schemas import SkillCreate, SkillRead, SkillUpdate

router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _get_skill_or_404(db: AsyncSession, skill_id: uuid.UUID) -> Skill:
    """Fetch a skill row by id or raise ``404``."""
    skill = await db.get(Skill, skill_id)
    if skill is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Skill introuvable.",
        )
    return skill


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------


@router.get("", response_model=list[SkillRead])
async def list_skills(
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
) -> list[Skill]:
    """List all skills, newest first."""
    result = await db.execute(select(Skill).order_by(Skill.created_at.desc()))
    return list(result.scalars().all())


@router.post("", response_model=SkillRead, status_code=status.HTTP_201_CREATED)
async def create_skill(
    payload: SkillCreate,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
) -> Skill:
    """Create a new skill.

    Returns ``409`` when a skill with the same slug already exists.
    """
    existing = await db.execute(select(Skill).where(Skill.slug == payload.slug))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Un skill avec le slug '{payload.slug}' existe deja.",
        )

    skill = Skill(**payload.model_dump())
    db.add(skill)
    await db.commit()
    await db.refresh(skill)
    return skill


@router.get("/{skill_id}", response_model=SkillRead)
async def get_skill(
    skill_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
) -> Skill:
    """Fetch a single skill by id."""
    return await _get_skill_or_404(db, skill_id)


@router.patch("/{skill_id}", response_model=SkillRead)
async def update_skill(
    skill_id: uuid.UUID,
    payload: SkillUpdate,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
) -> Skill:
    """Partially update a skill. Only provided fields are written."""
    skill = await _get_skill_or_404(db, skill_id)

    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(skill, field, value)

    await db.commit()
    await db.refresh(skill)
    return skill


@router.delete("/{skill_id}", response_model=SkillRead)
async def delete_skill(
    skill_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
) -> Skill:
    """Soft-delete a skill by setting ``enabled = False``.

    The row is never physically removed so that agent configs referencing this
    slug continue to resolve gracefully (returning empty instructions).
    """
    skill = await _get_skill_or_404(db, skill_id)
    skill.enabled = False
    await db.commit()
    await db.refresh(skill)
    return skill
