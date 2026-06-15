"""Routes pour les sources surveillées (portails AO avec extraction browser-use).

Ce module gère le CRUD complet des :class:`~models.MonitoredSource` ainsi que
les endpoints d'action :

* ``GET  /sources``           — liste toutes les sources.
* ``GET  /sources/status``    — état browser-use (disponibilité + activation).
* ``POST /sources``           — crée une source (chiffre le mot de passe).
* ``GET  /sources/{id}``      — détail d'une source.
* ``PATCH /sources/{id}``     — mise à jour partielle (rechiffre le MDP si fourni).
* ``DELETE /sources/{id}``    — suppression, 204.
* ``POST /sources/{id}/test`` — teste la connexion browser-use au portail.
* ``POST /sources/{id}/extract`` — déclenche l'extraction immédiate.

Règles de sécurité (non-négociables) :
- ``login_password`` est WRITE-ONLY : jamais renvoyé au client.
- ``encrypted_password`` n'est JAMAIS loggé ni tracé.
- ``has_password`` = bool(encrypted_password) est l'unique indicateur exposé.

Toutes les routes requièrent un utilisateur authentifié via :func:`get_current_user`.

Routes statiques (``/status``) déclarées **avant** le paramètre ``/{source_id}``
pour éviter tout conflit de résolution FastAPI.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.audit_logger import log_event
from core.security import get_current_user
from deps import get_db
from models import MonitoredSource
from schemas import MonitoredSourceCreate, MonitoredSourceRead, MonitoredSourceUpdate
from services.crypto import decrypt_secret, encrypt_secret

logger = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


async def _get_source_or_404(db: AsyncSession, source_id: uuid.UUID) -> MonitoredSource:
    """Charge une source par son id ou lève une ``HTTPException`` 404."""
    source = await db.get(MonitoredSource, source_id)
    if source is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Source surveillée introuvable.",
        )
    return source


def _to_read(source: MonitoredSource) -> MonitoredSourceRead:
    """Convertit un objet ORM en schéma Read (sans mot de passe).

    ``has_password`` reflète la présence d'un mot de passe chiffré ;
    ``encrypted_password`` n'est jamais inclus dans la réponse.
    """
    return MonitoredSourceRead(
        id=source.id,
        label=source.label,
        url=source.url,
        login_email=source.login_email,
        has_password=bool(source.encrypted_password),
        region_filters=source.region_filters,
        sector_filters=source.sector_filters,
        enabled=source.enabled,
        extract_interval_minutes=source.extract_interval_minutes,
        last_extract_at=source.last_extract_at,
        last_status=source.last_status,
        last_error=source.last_error,
        last_count=source.last_count,
        created_at=source.created_at,
        updated_at=source.updated_at,
    )


# ---------------------------------------------------------------------------
# Routes statiques — déclarées AVANT /{source_id}
# ---------------------------------------------------------------------------


@router.get("", response_model=list[MonitoredSourceRead])
@router.get("/", response_model=list[MonitoredSourceRead], include_in_schema=False)
async def list_sources(
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
) -> list[MonitoredSourceRead]:
    """Liste toutes les sources surveillées, les plus récentes d'abord."""
    result = await db.execute(
        select(MonitoredSource).order_by(MonitoredSource.created_at.desc())
    )
    sources = result.scalars().all()
    return [_to_read(s) for s in sources]


@router.get("/status")
async def get_sources_status(
    _user: dict = Depends(get_current_user),
) -> dict:
    """Retourne la disponibilité de browser-use et le flag d'activation.

    Réponse : ``{"browser_use_available": bool, "enabled": bool}``

    Si ``browser_use_available`` est ``False``, les sources sont enregistrées
    mais l'extraction est impossible jusqu'à l'installation de browser-use et
    l'activation via ``BROWSER_USE_ENABLED=true``.
    """
    from services.browser_use_runner import browser_use_available  # deferred

    from config import settings

    return {
        "browser_use_available": browser_use_available(),
        "enabled": settings.BROWSER_USE_ENABLED,
    }


@router.post("", response_model=MonitoredSourceRead, status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=MonitoredSourceRead, status_code=status.HTTP_201_CREATED, include_in_schema=False)
async def create_source(
    payload: MonitoredSourceCreate,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
) -> MonitoredSourceRead:
    """Crée une source surveillée.

    Le ``login_password``, s'il est fourni, est chiffré via Fernet avant
    persistance.  La valeur en clair n'est ni stockée ni loggée.
    """
    data = payload.model_dump(exclude={"login_password"})

    plaintext_password: str | None = payload.login_password
    if plaintext_password:
        data["encrypted_password"] = encrypt_secret(plaintext_password)
    else:
        data["encrypted_password"] = None

    source = MonitoredSource(**data)
    db.add(source)
    await db.commit()
    await db.refresh(source)

    await log_event(
        db,
        event_type="monitored_source.created",
        message=f"Source '{source.label}' créée.",
        level="info",
        payload={"source_id": str(source.id), "label": source.label, "url": source.url},
    )

    return _to_read(source)


# ---------------------------------------------------------------------------
# Routes paramétrées — déclarées APRÈS les routes statiques
# ---------------------------------------------------------------------------


@router.get("/{source_id}", response_model=MonitoredSourceRead)
async def get_source(
    source_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
) -> MonitoredSourceRead:
    """Retourne une source surveillée par son identifiant, ou ``404``."""
    source = await _get_source_or_404(db, source_id)
    return _to_read(source)


@router.patch("/{source_id}", response_model=MonitoredSourceRead)
async def update_source(
    source_id: uuid.UUID,
    payload: MonitoredSourceUpdate,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
) -> MonitoredSourceRead:
    """Met à jour partiellement une source surveillée.

    ``login_password`` est re-chiffré uniquement si fourni et non-vide.
    La valeur en clair n'est ni stockée ni loggée.
    """
    source = await _get_source_or_404(db, source_id)

    data = payload.model_dump(exclude_unset=True, exclude={"login_password"})
    for field, value in data.items():
        setattr(source, field, value)

    # Re-chiffre le mot de passe uniquement si fourni non-vide dans ce PATCH.
    new_password: str | None = (
        payload.login_password
        if "login_password" in payload.model_fields_set
        else None
    )
    if new_password:
        source.encrypted_password = encrypt_secret(new_password)

    await db.commit()
    await db.refresh(source)
    return _to_read(source)


@router.delete("/{source_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_source(
    source_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
) -> None:
    """Supprime définitivement une source surveillée.

    Retourne ``204 No Content`` en cas de succès, ``404`` si introuvable.
    """
    source = await _get_source_or_404(db, source_id)

    label = source.label
    source_id_str = str(source.id)

    await db.delete(source)
    await db.commit()

    await log_event(
        db,
        event_type="monitored_source.deleted",
        message=f"Source '{label}' supprimée.",
        level="info",
        payload={"source_id": source_id_str, "label": label},
    )


@router.post("/{source_id}/test")
async def test_source(
    source_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
) -> dict:
    """Teste la connexion au portail via browser-use.

    Si browser-use n'est pas disponible ou activé, retourne une réponse 200
    explicative sans lever d'erreur.  Le mot de passe n'est jamais loggé.
    """
    from services.browser_use_runner import browser_use_available, extract_from_portal  # deferred

    source = await _get_source_or_404(db, source_id)

    if not browser_use_available():
        return {
            "ok": False,
            "message": (
                "browser-use non activé "
                "(installer browser-use + playwright chromium et BROWSER_USE_ENABLED=true)"
            ),
        }

    # Déchiffre le mot de passe en mémoire uniquement — jamais loggé.
    plaintext_password: str | None = None
    if source.encrypted_password:
        plaintext_password = decrypt_secret(source.encrypted_password) or None

    try:
        offers = await extract_from_portal(
            url=source.url,
            email=source.login_email,
            password=plaintext_password,
            region_filters=source.region_filters,
            sector_filters=source.sector_filters,
            limit=3,
            timeout=60,
        )
        return {
            "ok": True,
            "message": f"Test réussi : {len(offers)} offre(s) extraite(s).",
            "count": len(offers),
        }
    except Exception as exc:
        logger.warning("test_source %s failed: %s", source_id, type(exc).__name__)
        return {"ok": False, "message": "Erreur lors du test de connexion au portail."}


@router.post("/{source_id}/extract")
async def extract_source(
    source_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
) -> dict:
    """Déclenche l'extraction immédiate pour une source surveillée.

    Met à jour ``last_extract_at``, ``last_status``, ``last_count`` et
    ``last_error`` sur la source après l'extraction.
    Le mot de passe n'est jamais loggé.

    Retourne ``{"count": int}`` indiquant le nombre d'offres extraites.
    """
    from services.browser_use_runner import browser_use_available, extract_from_portal  # deferred

    source = await _get_source_or_404(db, source_id)

    if not browser_use_available():
        # Mise à jour du statut même en cas d'indisponibilité.
        source.last_extract_at = datetime.now(timezone.utc)
        source.last_status = "unavailable"
        source.last_error = "browser-use non disponible"
        source.last_count = 0
        await db.commit()
        return {"count": 0, "message": "browser-use non disponible."}

    # Déchiffre le mot de passe en mémoire uniquement — jamais loggé.
    plaintext_password: str | None = None
    if source.encrypted_password:
        plaintext_password = decrypt_secret(source.encrypted_password) or None

    now = datetime.now(timezone.utc)
    try:
        offers = await extract_from_portal(
            url=source.url,
            email=source.login_email,
            password=plaintext_password,
            region_filters=source.region_filters,
            sector_filters=source.sector_filters,
            limit=50,
            timeout=120,
        )
        count = len(offers)
        source.last_extract_at = now
        source.last_status = "ok"
        source.last_count = count
        source.last_error = None
        await db.commit()

        await log_event(
            db,
            event_type="monitored_source.extracted",
            message=f"Extraction source '{source.label}' : {count} offre(s).",
            level="info",
            payload={"source_id": str(source_id), "label": source.label, "count": count},
        )

        return {"count": count}

    except Exception as exc:
        logger.warning(
            "extract_source %s failed: %s", source_id, type(exc).__name__
        )
        source.last_extract_at = now
        source.last_status = "error"
        source.last_error = type(exc).__name__
        source.last_count = 0
        await db.commit()
        return {"count": 0, "message": "Erreur lors de l'extraction."}
