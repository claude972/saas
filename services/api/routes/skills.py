"""Skills API routes.

CRUD over the ``skills`` table. Skills are reusable instruction blocks that can
be attached to agents (via ``config["skills"]`` slugs) and injected into LLM
prompts at run time.

Soft-delete is implemented as ``PATCH /{id}`` with ``enabled=false``; the
dedicated ``DELETE /{id}`` endpoint flips that flag rather than removing the row
so that historical references (agent configs, audit logs) stay intact.
"""

from __future__ import annotations

import io
import re
import uuid
import zipfile

import yaml
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
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


def _slugify(text: str) -> str:
    """Return a URL-safe lowercase slug from *text*."""
    text = text.lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_]+", "-", text)
    text = re.sub(r"-{2,}", "-", text)
    return text.strip("-")


def _parse_skill_md(raw: bytes) -> tuple[str, str | None, str | None]:
    """Parse a SKILL.md byte payload.

    Returns ``(name, description, body)`` where *body* is the markdown content
    that follows the closing ``---`` of the YAML frontmatter.  Raises
    ``ValueError`` with a human-readable message on malformed input.
    """
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ValueError("Le fichier SKILL.md n'est pas encodé en UTF-8.") from exc

    # Expect frontmatter delimited by leading/trailing "---"
    pattern = re.compile(r"^---\s*\n(.*?)\n---\s*\n?(.*)", re.DOTALL)
    match = pattern.match(text)
    if not match:
        raise ValueError(
            "SKILL.md invalide : frontmatter YAML introuvable (attendu entre deux lignes '---')."
        )

    frontmatter_raw, body = match.group(1), match.group(2)

    try:
        meta = yaml.safe_load(frontmatter_raw) or {}
    except yaml.YAMLError as exc:
        raise ValueError(f"Frontmatter YAML invalide : {exc}") from exc

    if not isinstance(meta, dict):
        raise ValueError("Le frontmatter YAML doit être un dictionnaire clé/valeur.")

    name: str | None = meta.get("name")
    if not name:
        raise ValueError("Le frontmatter YAML doit contenir un champ 'name'.")

    description: str | None = meta.get("description")
    if description is not None:
        description = str(description).strip() or None

    return str(name).strip(), description, body.strip() or None


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
# Import
# ---------------------------------------------------------------------------


@router.post("/import", response_model=SkillRead, status_code=status.HTTP_200_OK)
async def import_skill(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
) -> Skill:
    """Import a skill from a ``.skill`` ZIP or a raw ``SKILL.md`` file.

    - If the upload is a ZIP, the first ``SKILL.md`` found (in any sub-folder)
      is extracted and parsed.
    - Otherwise the raw bytes are treated as a ``SKILL.md`` file directly.

    The skill is **upserted** by slug: if a skill with the same slug already
    exists its ``description``, ``instructions``, and ``anthropic_skill_id``
    fields are updated in place; otherwise a new row is inserted.

    Returns ``400`` for any parse or format error.
    """
    raw = await file.read()

    try:
        if zipfile.is_zipfile(io.BytesIO(raw)):
            with zipfile.ZipFile(io.BytesIO(raw)) as zf:
                skill_entries = [
                    n for n in zf.namelist()
                    if n.upper().endswith("SKILL.MD") and not n.startswith("__MACOSX")
                ]
                if not skill_entries:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Archive ZIP invalide : aucun fichier SKILL.md trouvé.",
                    )
                skill_bytes = zf.read(skill_entries[0])
        else:
            skill_bytes = raw

        name, description, instructions = _parse_skill_md(skill_bytes)
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    slug = _slugify(name)

    result = await db.execute(select(Skill).where(Skill.slug == slug))
    existing = result.scalar_one_or_none()

    if existing is not None:
        existing.name = name
        existing.description = description
        existing.instructions = instructions
        existing.anthropic_skill_id = name
        existing.source = "anthropic"
        existing.enabled = True
        await db.commit()
        await db.refresh(existing)
        return existing

    skill = Skill(
        name=name,
        slug=slug,
        description=description,
        source="anthropic",
        instructions=instructions,
        anthropic_skill_id=name,
        enabled=True,
    )
    db.add(skill)
    await db.commit()
    await db.refresh(skill)
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
