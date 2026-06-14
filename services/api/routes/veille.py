"""Veille (tender-watch) configuration and trigger routes.

Expose la configuration singleton de la veille automatique et deux endpoints
d'action :

* ``GET  /veille/config``  — lit (ou initialise) la config singleton.
* ``PUT  /veille/config``  — met à jour la config et recalcule ``next_run_at``.
* ``POST /veille/run``     — déclenche immédiatement une passe de veille.
* ``POST /veille/tick``    — vérifie si une passe est due et la lance si besoin
  (appelé périodiquement par un cron externe ou le scheduler intégré).

Tous les endpoints sauf ``/tick`` nécessitent un appelant authentifié via
:func:`get_current_user`.  ``/tick`` est conçu pour être appelé en interne
(scheduler, cron) sans token ; il peut être sécurisé côté infrastructure.
"""

from __future__ import annotations

import hmac
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from core.security import get_current_user
from deps import get_db
from schemas import VeilleConfigRead, VeilleConfigUpdate

logger = logging.getLogger("openclaw.routes.veille")

router = APIRouter()


# ---------------------------------------------------------------------------
# GET /config
# ---------------------------------------------------------------------------


@router.get("/config", response_model=VeilleConfigRead)
async def get_veille_config(
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
) -> VeilleConfigRead:
    """Retourne la configuration courante de la veille AO.

    Si aucune config n'existe encore en base, une ligne est créée avec les
    valeurs par défaut du contrat (keywords DOM, régions DOM, source
    Perplexity) avant d'être retournée.
    """
    from services.veille import get_or_create_config  # deferred: module created separately

    config = await get_or_create_config(db)
    return config  # type: ignore[return-value]


# ---------------------------------------------------------------------------
# PUT /config
# ---------------------------------------------------------------------------


@router.put("/config", response_model=VeilleConfigRead)
async def update_veille_config(
    payload: VeilleConfigUpdate,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
) -> VeilleConfigRead:
    """Met à jour la configuration de la veille AO et recalcule ``next_run_at``.

    Seuls les champs fournis dans le corps sont modifiés (partial update).
    Après application, ``next_run_at`` est recalculé à partir de maintenant
    via :func:`services.veille.compute_next_run`.

    Retourne la config mise à jour.
    """
    from services.veille import compute_next_run, get_or_create_config  # deferred

    config = await get_or_create_config(db)

    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(config, field, value)

    # Recalculate next_run_at based on the (possibly updated) interval.
    now = datetime.now(tz=timezone.utc)
    config.next_run_at = compute_next_run(config, now)

    await db.commit()
    await db.refresh(config)

    logger.info(
        "Veille config updated — enabled=%s interval=%dmin next_run_at=%s.",
        config.enabled,
        config.interval_minutes,
        config.next_run_at,
    )

    return config  # type: ignore[return-value]


# ---------------------------------------------------------------------------
# POST /run
# ---------------------------------------------------------------------------


@router.post("/run", status_code=status.HTTP_200_OK)
async def run_veille_now(
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
) -> dict:
    """Déclenche immédiatement une passe de veille, indépendamment du planning.

    Agrège les sources configurées (Perplexity, browser-use…), déduplique
    et insère les nouvelles offres en base avec ``status="new"``.

    Retourne ``{"count": n, "new_ids": ["<uuid>", ...]}``.
    """
    from services.veille import run_veille  # deferred

    result = await run_veille(db)
    logger.info(
        "Veille run triggered manually — %d new offer(s).",
        result.get("count", 0),
    )
    return result


# ---------------------------------------------------------------------------
# POST /tick
# ---------------------------------------------------------------------------


def _verify_tick_secret(x_veille_token: str | None) -> None:
    """Vérifie le secret partagé du cron en comparaison à temps constant.

    Lève ``HTTPException 401`` si le secret n'est pas configuré (empêche
    l'utilisation en production sans configuration explicite) ou si le header
    ``X-Veille-Token`` est absent ou incorrect.

    La comparaison utilise ``hmac.compare_digest`` pour résister aux attaques
    temporelles.
    """
    configured = settings.VEILLE_TICK_SECRET
    if not configured:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="VEILLE_TICK_SECRET n'est pas configuré — endpoint /tick désactivé.",
        )
    if x_veille_token is None or not hmac.compare_digest(
        configured.encode(), x_veille_token.encode()
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token invalide ou absent (header X-Veille-Token requis).",
        )


@router.post("/tick", status_code=status.HTTP_200_OK)
async def tick_veille(
    x_veille_token: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Vérifie si la veille est due et la lance le cas échéant.

    Cet endpoint est conçu pour être appelé par un cron externe.  Il est
    protégé par un secret partagé transmis via le header ``X-Veille-Token``
    (comparaison à temps constant contre ``VEILLE_TICK_SECRET`` en variable
    d'environnement).  L'endpoint est refusé (``401``) si le secret n'est pas
    configuré ou si le token est absent/incorrect.

    Règles d'exécution :
    * ``enabled`` doit être ``True``.
    * L'heure courante doit être >= ``next_run_at`` (ou ``next_run_at`` null).
    * L'heure courante doit être hors de la fenêtre quiet (``quiet_start`` /
      ``quiet_end``).

    Retourne ``{"ran": bool, "count": int}``.
    """
    _verify_tick_secret(x_veille_token)

    from services.veille import get_or_create_config, is_quiet, run_veille  # deferred

    config = await get_or_create_config(db)

    if not config.enabled:
        return {"ran": False, "count": 0}

    now = datetime.now(tz=timezone.utc)

    if is_quiet(config, now):
        logger.debug(
            "Tick: inside quiet window (%s-%s); skipping.",
            config.quiet_start,
            config.quiet_end,
        )
        return {"ran": False, "count": 0}

    next_run = config.next_run_at
    if next_run is not None:
        # Normalise to aware datetime for comparison.
        if next_run.tzinfo is None:
            next_run = next_run.replace(tzinfo=timezone.utc)
        if now < next_run:
            return {"ran": False, "count": 0}

    result = await run_veille(db)
    logger.info(
        "Tick: veille ran — %d new offer(s).",
        result.get("count", 0),
    )
    return {"ran": True, "count": result.get("count", 0)}
