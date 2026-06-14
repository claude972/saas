"""Settings API routes.

Two concerns:

* ``/settings/company`` — GET + PATCH for the CompanySettings singleton row.
  The row is created on first GET if it does not exist yet (upsert-on-read).
* ``/settings/llm``    — GET a read-only snapshot of the current LLM
  configuration: which providers are available and what their default models
  are.

All endpoints require a valid JWT (``get_current_user``).
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import APIRouter, Depends

from agents.llm import _DEFAULT_MODELS, _DEFAULT_PROVIDER, provider_available
from core.security import get_current_user
from deps import get_db
from models import CompanySettings
from schemas import CompanySettingsRead, CompanySettingsUpdate

router = APIRouter()

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_PROVIDERS = ("anthropic", "openai", "google", "deepseek")


async def _get_or_create_company(db: AsyncSession) -> CompanySettings:
    """Return the singleton CompanySettings row, creating it if absent."""
    result = await db.execute(select(CompanySettings).limit(1))
    row = result.scalar_one_or_none()
    if row is None:
        row = CompanySettings()
        db.add(row)
        await db.commit()
        await db.refresh(row)
    return row


# ---------------------------------------------------------------------------
# Company settings
# ---------------------------------------------------------------------------

@router.get("/company", response_model=CompanySettingsRead)
async def get_company_settings(
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
) -> CompanySettings:
    """Retourne les paramètres société (crée la ligne si absente)."""
    return await _get_or_create_company(db)


@router.patch("/company", response_model=CompanySettingsRead)
async def update_company_settings(
    payload: CompanySettingsUpdate,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
) -> CompanySettings:
    """Met à jour les paramètres société. Seuls les champs fournis sont écrits."""
    row = await _get_or_create_company(db)

    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(row, field, value)

    await db.commit()
    await db.refresh(row)
    return row


# ---------------------------------------------------------------------------
# LLM settings (read-only)
# ---------------------------------------------------------------------------

@router.get("/llm")
async def get_llm_settings(
    _user: dict = Depends(get_current_user),
) -> dict:
    """Retourne la configuration LLM active : fournisseur par défaut et disponibilité de chaque fournisseur."""
    providers = [
        {
            "name": name,
            "available": provider_available(name),
            "default_model": _DEFAULT_MODELS.get(name, ""),
        }
        for name in _PROVIDERS
    ]
    return {
        "default_provider": _DEFAULT_PROVIDER,
        "providers": providers,
    }
