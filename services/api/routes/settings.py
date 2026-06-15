"""Settings API routes.

Three concerns:

* ``/settings/company`` — GET + PATCH for the CompanySettings singleton row.
  The row is created on first GET if it does not exist yet (upsert-on-read).
* ``/settings/llm``    — GET a read-only snapshot of the current LLM
  configuration: which providers are available and what their default models
  are.
* ``/settings/secrets`` — GET / PATCH / DELETE for encrypted provider API
  keys stored in the DB.  Keys are NEVER returned to the client; only a
  short hint and metadata are exposed.

All endpoints require a valid JWT (``get_current_user``).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import agents.llm as _llm
from agents.llm import _DEFAULT_MODELS, _DEFAULT_PROVIDER, models_for, provider_available
from core.audit_logger import log_event
from core.security import get_current_user
from deps import get_db
from models import ApiSecret, CompanySettings
from schemas import (
    ApiSecretRead,
    ApiSecretUpdate,
    CompanySettingsRead,
    CompanySettingsUpdate,
    LLMDefaultUpdate,
)
from services.crypto import encrypt_secret

router = APIRouter()

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_PROVIDERS = ("anthropic", "openai", "google", "deepseek")

# All five providers surfaced in the secrets UI.
_SECRET_PROVIDERS = ("anthropic", "openai", "google", "deepseek", "perplexity")


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

def _llm_config_payload() -> dict:
    """Build the /settings/llm response: active default + per-provider info."""
    default_provider, default_model = _llm.default_provider_model()
    providers = [
        {
            "name": name,
            "available": provider_available(name),
            "default_model": _DEFAULT_MODELS.get(name, ""),
            "models": models_for(name),
        }
        for name in _PROVIDERS
    ]
    return {
        "default_provider": default_provider,
        "default_model": default_model,
        "providers": providers,
    }


@router.get("/llm")
async def get_llm_settings(
    _user: dict = Depends(get_current_user),
) -> dict:
    """Config LLM active : fournisseur + modèle par défaut (agent chef) et disponibilité de chaque fournisseur."""
    return _llm_config_payload()


@router.patch("/llm")
async def update_llm_default(
    payload: LLMDefaultUpdate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    """Définit le modèle/fournisseur par défaut du cockpit (l'« agent chef »).

    Persiste le choix dans ``CompanySettings`` et l'applique immédiatement au
    moteur LLM (hot-reload, sans redémarrage). Champs vides => retour au défaut
    d'environnement.
    """
    company = await _get_or_create_company(db)
    company.default_llm_provider = (payload.default_provider or "").strip() or None
    company.default_llm_model = (payload.default_model or "").strip() or None
    await db.commit()
    await db.refresh(company)

    _llm.set_default_provider_model(
        company.default_llm_provider, company.default_llm_model
    )

    await log_event(
        db,
        event_type="llm_default.updated",
        message="Modèle par défaut (agent chef) mis à jour.",
        payload={
            "provider": company.default_llm_provider,
            "model": company.default_llm_model,
            "updated_by": user["email"],
        },
    )

    return _llm_config_payload()


# ---------------------------------------------------------------------------
# API secrets (encrypted at rest — WRITE-ONLY, key never returned)
# ---------------------------------------------------------------------------


@router.get("/secrets", response_model=list[ApiSecretRead])
async def list_api_secrets(
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
) -> list[ApiSecretRead]:
    """Retourne le statut des clés API pour les 5 fournisseurs.

    La clé brute n'est JAMAIS renvoyée.  ``configured`` reflète la valeur
    actuellement active dans le cache mémoire (env OU DB après hot-reload).
    """
    result = await db.execute(select(ApiSecret))
    rows: dict[str, ApiSecret] = {r.provider: r for r in result.scalars().all()}

    out: list[ApiSecretRead] = []
    for provider in _SECRET_PROVIDERS:
        row = rows.get(provider)
        configured = bool(_llm.get_provider_key(provider))
        out.append(
            ApiSecretRead(
                provider=provider,
                configured=configured,
                key_hint=row.key_hint if row else None,
                updated_by=row.updated_by if row else None,
                updated_at=row.updated_at if row else None,
            )
        )
    return out


@router.patch("/secrets", response_model=ApiSecretRead)
async def upsert_api_secret(
    payload: ApiSecretUpdate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> ApiSecretRead:
    """Chiffre et stocke (ou met à jour) la clé API du fournisseur.

    Déclenche un hot-reload immédiat via ``set_provider_key`` — le moteur LLM
    peut utiliser la nouvelle clé sans redémarrage.  La valeur brute n'est
    JAMAIS journalisée.
    """
    provider = payload.provider
    raw_key = payload.api_key
    updated_by = user["email"]

    encrypted = encrypt_secret(raw_key)
    # 4 derniers caractères comme indice lisible dans l'UI.
    key_hint = raw_key[-4:] if len(raw_key) >= 4 else raw_key

    result = await db.execute(select(ApiSecret).where(ApiSecret.provider == provider))
    row = result.scalar_one_or_none()

    if row is None:
        row = ApiSecret(
            provider=provider,
            encrypted_key=encrypted,
            key_hint=key_hint,
            updated_by=updated_by,
        )
        db.add(row)
    else:
        row.encrypted_key = encrypted
        row.key_hint = key_hint
        row.updated_by = updated_by

    await db.commit()
    await db.refresh(row)

    # Hot-reload — effet immédiat sur PydanticAI et les services dépendants.
    _llm.set_provider_key(provider, raw_key)

    # Audit sans la valeur de la clé.
    await log_event(
        db,
        event_type="api_secret.updated",
        message=f"Clé API mise à jour pour le fournisseur {provider!r}.",
        payload={"provider": provider, "updated_by": updated_by},
    )

    return ApiSecretRead(
        provider=row.provider,
        configured=True,
        key_hint=row.key_hint,
        updated_by=row.updated_by,
        updated_at=row.updated_at,
    )


@router.delete("/secrets/{provider}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_api_secret(
    provider: str,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> None:
    """Supprime la clé stockée pour ce fournisseur et réinitialise le cache.

    Si aucune ligne n'existe, retourne quand même 204 (idempotent).
    """
    if provider not in _SECRET_PROVIDERS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"provider doit être parmi : {', '.join(_SECRET_PROVIDERS)}",
        )

    result = await db.execute(select(ApiSecret).where(ApiSecret.provider == provider))
    row = result.scalar_one_or_none()

    if row is not None:
        await db.delete(row)
        await db.commit()

    # Remet la valeur d'origine (env) dans le cache mémoire.
    _llm.clear_provider_key(provider)

    await log_event(
        db,
        event_type="api_secret.deleted",
        message=f"Clé API supprimée pour le fournisseur {provider!r}.",
        payload={"provider": provider, "deleted_by": user["email"]},
    )
