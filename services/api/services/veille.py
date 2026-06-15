"""Service de veille automatique des appels d'offres BTP.

Ce module orchestre la détection de nouveaux marchés publics en agrégeant les
résultats de plusieurs sources (Perplexity, browser-use) selon la configuration
singleton ``VeilleConfig``.

Fonctions publiques
-------------------
* :func:`get_or_create_config` — charge ou initialise la configuration singleton.
* :func:`compute_next_run`     — calcule la prochaine échéance en sautant la
  fenêtre horaire silencieuse.
* :func:`run_veille`           — exécute une passe de veille complète (collecte,
  déduplication, insertion, mise à jour du config, audit).

Constantes de configuration par défaut (conformes au contrat partagé)
----------------------------------------------------------------------
``DEFAULTS_KEYWORDS``, ``DEFAULTS_REGIONS``, ``DEFAULTS_SOURCES``.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from core.audit_logger import log_event
from models import MonitoredSource, TenderOffer, VeilleConfig
from services.sectors import classify_sectors

logger = logging.getLogger("openclaw.veille")

# ---------------------------------------------------------------------------
# Valeurs par défaut (contrat partagé)
# ---------------------------------------------------------------------------

DEFAULTS_KEYWORDS: list[str] = [
    "placo",
    "plâtrerie",
    "électricité",
    "peinture",
    "carrelage",
    "sol souple",
    "menuiserie",
    "plomberie",
    "maçonnerie",
    "gros œuvre",
    "second œuvre",
    "rénovation",
    "BTP",
]

DEFAULTS_REGIONS: list[str] = [
    "Martinique",
    "Guadeloupe",
    "Guyane",
    "La Réunion",
    "Mayotte",
    "Saint-Martin",
]

DEFAULTS_SOURCES: list[str] = ["perplexity"]


# ---------------------------------------------------------------------------
# Helpers internes
# ---------------------------------------------------------------------------


def _dedup_key(offer: dict) -> str:
    """Retourne une clé de déduplication stable pour une offre brute.

    La clé est un hash MD5 hexadécimal construit sur ``url|title`` (en
    minuscules, sans espaces superflus).  Si les deux champs sont vides on
    renvoie quand même un hash de la chaîne vide pour éviter toute exception.
    """
    url = (offer.get("url") or "").strip().lower()
    title = (offer.get("title") or "").strip().lower()
    raw = f"{url}|{title}"
    return hashlib.md5(raw.encode("utf-8")).hexdigest()  # noqa: S324


def _config_tz(config: VeilleConfig) -> ZoneInfo | timezone:
    """Retourne le fuseau IANA configuré, ou UTC en secours si invalide."""
    name = getattr(config, "timezone", None) or "America/Martinique"
    try:
        return ZoneInfo(name)
    except Exception:  # noqa: BLE001 — ZoneInfoNotFoundError, etc.
        logger.warning("veille: fuseau '%s' invalide — repli sur UTC.", name)
        return timezone.utc


def is_quiet(config: VeilleConfig, now: datetime) -> bool:
    """Retourne True si *now* tombe dans la fenêtre horaire silencieuse.

    L'heure est évaluée dans le fuseau ``config.timezone`` (défaut
    ``America/Martinique``), et non en UTC : régler 22h→6h fait taire la veille
    la nuit *locale*. Si ``quiet_start`` ou ``quiet_end`` est absent la fenêtre
    est inactive. C'est l'unique implémentation (importée par le scheduler et la
    route ``/tick``).
    """
    if config.quiet_start is None or config.quiet_end is None:
        return False
    aware = now if now.tzinfo is not None else now.replace(tzinfo=timezone.utc)
    hour = aware.astimezone(_config_tz(config)).hour
    qs: int = config.quiet_start
    qe: int = config.quiet_end
    if qs <= qe:
        # Fenêtre dans la même journée (qs == qe => fenêtre vide).
        return qs <= hour < qe
    # Fenêtre à cheval sur minuit, ex: quiet_start=22 quiet_end=6.
    return hour >= qs or hour < qe


# ---------------------------------------------------------------------------
# API publique
# ---------------------------------------------------------------------------


async def get_or_create_config(db: AsyncSession) -> VeilleConfig:
    """Charge la configuration singleton ou la crée avec les valeurs par défaut.

    Il ne doit exister qu'une seule ligne dans ``veille_config``; la lecture
    utilise ``LIMIT 1``.  Si la table est vide une nouvelle ligne est insérée
    avec les mots-clés, régions et sources par défaut.

    Args:
        db: session SQLAlchemy async active.

    Returns:
        L'instance ``VeilleConfig`` persistée.
    """
    result = await db.execute(select(VeilleConfig).limit(1))
    config = result.scalar_one_or_none()

    if config is None:
        config = VeilleConfig(
            enabled=False,
            interval_minutes=180,
            timezone="America/Martinique",
            keywords=list(DEFAULTS_KEYWORDS),
            regions=list(DEFAULTS_REGIONS),
            sources=list(DEFAULTS_SOURCES),
            perplexity_model="sonar",
        )
        db.add(config)
        await db.commit()
        await db.refresh(config)
        logger.info("veille_config: ligne singleton créée avec les valeurs par défaut.")

    return config


def compute_next_run(config: VeilleConfig, from_dt: datetime) -> datetime:
    """Calcule la prochaine date d'exécution de la veille.

    Ajoute ``config.interval_minutes`` à *from_dt*, puis avance d'un quart
    d'heure à la fois tant que le résultat tombe dans la fenêtre silencieuse
    (``quiet_start`` à ``quiet_end``).

    Args:
        config: configuration singleton de la veille.
        from_dt: instant de départ (timezone-aware recommandé).

    Returns:
        Datetime timezone-aware (UTC si *from_dt* est naïf) de la prochaine
        exécution autorisée.
    """
    interval = timedelta(minutes=max(1, config.interval_minutes))
    next_dt = from_dt + interval

    # Si pas de fenêtre silencieuse configurée on retourne directement.
    if config.quiet_start is None or config.quiet_end is None:
        return next_dt

    # Avance par tranches de 15 minutes jusqu'à sortir de la fenêtre.
    step = timedelta(minutes=15)
    max_iterations = 200  # garde-fou: 200 × 15 min = 50 heures
    for _ in range(max_iterations):
        if not is_quiet(config, next_dt):
            break
        next_dt += step

    return next_dt


async def run_veille(db: AsyncSession) -> dict:
    """Exécute une passe de veille complète et retourne un résumé.

    Étapes :
    1. Charge la configuration singleton (crée si absente).
    2. Agrège les résultats de Perplexity et/ou browser-use selon
       ``config.sources`` et la disponibilité de chaque service.
    3. Déduplique les offres collectées contre les ``TenderOffer`` existants
       via leur ``dedup_key``.
    4. Insère les nouvelles offres avec status ``"new"``.
    5. Met à jour ``last_run_at``, ``last_count``, ``last_status``,
       ``last_error`` et ``next_run_at`` sur le config.
    6. Émet un événement d'audit.

    Toutes les erreurs internes sont capturées : la fonction ne lève jamais
    d'exception afin de ne pas bloquer le scheduler.

    Args:
        db: session SQLAlchemy async active.

    Returns:
        Dictionnaire ``{"count": int, "new_ids": list[str]}``.
    """
    new_ids: list[str] = []
    error_msg: str | None = None
    collected: list[dict] = []

    try:
        config = await get_or_create_config(db)

        keywords: list[str] = config.keywords or DEFAULTS_KEYWORDS
        regions: list[str] = config.regions or DEFAULTS_REGIONS
        sources: list[str] = config.sources or DEFAULTS_SOURCES

        # --- Collecte Perplexity ---
        if "perplexity" in sources:
            try:
                from services.perplexity import perplexity_available, search_tenders

                if perplexity_available():
                    perplexity_results = await search_tenders(
                        keywords=keywords,
                        regions=regions,
                        limit=20,
                        model=config.perplexity_model,
                        prompt_template=config.search_prompt,
                    )
                    for item in perplexity_results:
                        item.setdefault("source", "perplexity")
                    collected.extend(perplexity_results)
                    logger.info(
                        "veille: Perplexity a retourné %d offres.", len(perplexity_results)
                    )
                else:
                    logger.debug("veille: Perplexity non disponible (PERPLEXITY_API_KEY absent).")
            except Exception:  # noqa: BLE001
                logger.warning("veille: erreur lors de l'appel Perplexity.", exc_info=True)

        # --- Collecte browser-use ---
        if "browser_use" in sources:
            try:
                from services.browser_use_runner import (
                    browser_use_available,
                    find_tenders,
                )

                if browser_use_available():
                    browser_results = await find_tenders(
                        keywords=keywords,
                        regions=regions,
                        limit=10,
                    )
                    for item in browser_results:
                        item.setdefault("source", "browser_use")
                    collected.extend(browser_results)
                    logger.info(
                        "veille: browser-use a retourné %d offres.", len(browser_results)
                    )
                else:
                    logger.debug("veille: browser-use non disponible.")
            except Exception:  # noqa: BLE001
                logger.warning("veille: erreur lors de l'appel browser-use.", exc_info=True)

        # --- Collecte sources surveillées (portails avec login) ---
        try:
            from services.browser_use_runner import (
                browser_use_available,
                extract_from_portal,
            )

            now_for_sources = datetime.now(tz=timezone.utc)

            # Charge les sources activées dont l'extraction est due.
            sources_result = await db.execute(
                select(MonitoredSource).where(MonitoredSource.enabled.is_(True))
            )
            all_sources: list[MonitoredSource] = list(sources_result.scalars().all())

            due_sources = [
                src
                for src in all_sources
                if (
                    src.last_extract_at is None
                    or (now_for_sources - src.last_extract_at).total_seconds()
                    >= src.extract_interval_minutes * 60
                )
            ]

            if due_sources:
                if browser_use_available():
                    semaphore = asyncio.Semaphore(max(1, settings.MAX_CONCURRENT_PORTALS))

                    # --- Typage du résultat d'extraction par portail ---
                    # Tuple: (src_id, status, count, error_msg, offers)
                    # INVARIANT: _extract_one ne fait AUCUN await sur `db` et ne
                    # mute AUCUN objet ORM.  Toutes les mutations src.last_* sont
                    # appliquées séquentiellement APRÈS asyncio.gather, dans la
                    # coroutine principale, pour éviter le partage concurrent
                    # d'une AsyncSession (non task-safe sous asyncpg).
                    async def _extract_one(
                        src: MonitoredSource,
                    ) -> tuple[str, str, int, str | None, list[dict]]:
                        """Extrait les offres d'un portail surveillé.

                        Déchiffre le mot de passe en mémoire locale uniquement.
                        Ne lève jamais, ne logue jamais le mot de passe.
                        Ne touche PAS à la session SQLAlchemy (db) — les
                        mutations ORM sont effectuées par l'appelant après gather.

                        Returns:
                            (src_id, status, count, error_msg, offers)
                        """
                        from services.crypto import decrypt_secret

                        src_id = str(src.id)
                        async with semaphore:
                            try:
                                # Déchiffrement local — jamais loggé ni propagé.
                                plain_password: str | None = None
                                if src.encrypted_password:
                                    plain_password = decrypt_secret(src.encrypted_password) or None

                                portal_offers = await extract_from_portal(
                                    url=src.url,
                                    email=src.login_email,
                                    password=plain_password,
                                    region_filters=src.region_filters,
                                    sector_filters=src.sector_filters,
                                    limit=10,
                                    timeout=120,
                                )
                                plain_password = None  # effacement immédiat

                                for item in portal_offers:
                                    item.setdefault("source", "portal")

                                portal_count = len(portal_offers)
                                logger.info(
                                    "veille: portail '%s' a retourné %d offre(s).",
                                    src.label,
                                    portal_count,
                                )
                                return (src_id, "ok", portal_count, None, portal_offers)

                            except Exception:  # noqa: BLE001
                                logger.warning(
                                    "veille: erreur lors de l'extraction du portail '%s'.",
                                    src.label,
                                    exc_info=True,
                                )
                                return (
                                    src_id,
                                    "error",
                                    0,
                                    "Erreur d'extraction — détail dans les logs.",
                                    [],
                                )

                    # Exécution concurrente — aucun await sur `db` à l'intérieur.
                    portal_results = await asyncio.gather(
                        *[_extract_one(src) for src in due_sources]
                    )

                    # Reconstruction d'un index src_id -> objet ORM pour les mises
                    # à jour séquentielles (une seule itération sur due_sources).
                    src_by_id = {str(src.id): src for src in due_sources}
                    now_portal = datetime.now(tz=timezone.utc)

                    # Application séquentielle des mutations ORM — aucun await
                    # concurrent sur db, donc aucun risque de collision de session.
                    for src_id, status, count, err_msg, offers in portal_results:
                        src_obj = src_by_id.get(src_id)
                        if src_obj is not None:
                            src_obj.last_extract_at = now_portal
                            src_obj.last_status = status
                            src_obj.last_count = count
                            src_obj.last_error = err_msg
                            db.add(src_obj)
                        collected.extend(offers)

                else:
                    # browser-use non disponible : on note juste dans les logs.
                    logger.debug(
                        "veille: %d source(s) due(s) mais browser-use non disponible.",
                        len(due_sources),
                    )

        except ImportError:
            # extract_from_portal non encore disponible (déploiement partiel).
            logger.debug("veille: extract_from_portal non disponible, sources ignorées.")
        except Exception:  # noqa: BLE001
            logger.warning("veille: erreur lors du traitement des sources surveillées.", exc_info=True)

        # --- Déduplication ---
        if collected:
            # Calcule les clés des offres collectées
            candidate_keys = [_dedup_key(o) for o in collected]

            # Charge les clés déjà présentes en base
            existing_result = await db.execute(
                select(TenderOffer.dedup_key).where(
                    TenderOffer.dedup_key.in_(candidate_keys)
                )
            )
            existing_keys: set[str] = {row[0] for row in existing_result.fetchall()}

            # Insère uniquement les nouvelles offres ; collecte les objets insérés
            # pour construire new_ids sans requête post-flush (P1 : évite le
            # faux-positif sur des offres déjà existantes au statut « new »).
            inserted: list[TenderOffer] = []
            for offer_data, key in zip(collected, candidate_keys, strict=True):
                if key in existing_keys:
                    continue

                title = (offer_data.get("title") or "").strip()
                if not title:
                    # On refuse les offres sans titre
                    continue

                # Parse deadline (str ISO ou None)
                deadline_raw = offer_data.get("deadline")
                deadline_dt: datetime | None = None
                if deadline_raw:
                    try:
                        deadline_dt = datetime.fromisoformat(str(deadline_raw).rstrip("Z"))
                        if deadline_dt.tzinfo is None:
                            deadline_dt = deadline_dt.replace(tzinfo=timezone.utc)
                    except (ValueError, TypeError):
                        deadline_dt = None

                summary_val = offer_data.get("summary") or None
                keywords_val = offer_data.get("keywords_matched") or None
                sectors_val = classify_sectors(
                    title + " " + (summary_val or ""),
                    keywords_val if isinstance(keywords_val, list) else None,
                )

                new_offer = TenderOffer(
                    title=title[:512],
                    source=str(offer_data.get("source") or "perplexity")[:50],
                    organization=(str(offer_data.get("organization") or "")[:512] or None),
                    summary=summary_val,
                    lots=(offer_data.get("lots") or None),
                    location=(str(offer_data.get("location") or "")[:255] or None),
                    region=(str(offer_data.get("region") or "")[:100] or None),
                    deadline=deadline_dt,
                    url=(str(offer_data.get("url") or "")[:1024] or None),
                    status="new",
                    keywords_matched=keywords_val,
                    sectors=sectors_val,
                    raw=offer_data if isinstance(offer_data, dict) else None,
                    dedup_key=key,
                )
                db.add(new_offer)
                inserted.append(new_offer)
                existing_keys.add(key)  # évite les doublons dans le même batch

            await db.flush()

            # Les UUIDs sont peuplés après flush — pas besoin de re-requêter.
            new_ids = [str(o.id) for o in inserted]

        # --- Mise à jour du config singleton ---
        now_utc = datetime.now(tz=timezone.utc)
        config.last_run_at = now_utc
        config.last_count = len(new_ids)
        config.last_status = "ok"
        config.last_error = None
        config.next_run_at = compute_next_run(config, now_utc)
        db.add(config)
        await db.commit()

        # --- Audit ---
        try:
            await log_event(
                db,
                event_type="veille.run_complete",
                message=(
                    f"Veille terminée : {len(new_ids)} nouvelle(s) offre(s) insérée(s) "
                    f"sur {len(collected)} collectée(s)."
                ),
                level="info",
                payload={
                    "count": len(new_ids),
                    "collected": len(collected),
                    "new_ids": new_ids,
                    "sources": sources,
                },
            )
        except Exception:  # noqa: BLE001
            logger.warning("veille: impossible d'écrire l'événement d'audit.", exc_info=True)

    except Exception as exc:  # noqa: BLE001
        # On NE stocke PAS str(exc) tel quel dans config.last_error : les
        # exceptions httpx/asyncpg embarquent souvent l'URL appelée ou le DSN
        # de la base (hôte/port), or last_error est renvoyé au client via
        # VeilleConfigRead et affiché dans l'UI. On n'expose que la catégorie ;
        # le détail complet (traceback) reste dans les logs serveur ci-dessous.
        error_type = type(exc).__name__
        logger.exception("veille: erreur inattendue lors de run_veille.")

        # Tente de mettre à jour le statut d'erreur sur le config.
        # On rollback d'abord : si l'exception est survenue au milieu d'une
        # transaction (p. ex. pendant db.flush()), la session SQLAlchemy est
        # en état « rollback pending » et toute nouvelle requête lèverait
        # PendingRollbackError / InvalidRequestError, avalée silencieusement
        # par le except interne — l'utilisateur verrait un statut 'ok' figé.
        try:
            await db.rollback()
        except Exception:  # noqa: BLE001
            logger.warning("veille: impossible de rollback la session avant écriture de l'erreur.", exc_info=True)

        # Tente de mettre à jour le statut d'erreur sur le config
        try:
            result = await db.execute(select(VeilleConfig).limit(1))
            config_err = result.scalar_one_or_none()
            if config_err is not None:
                now_utc = datetime.now(tz=timezone.utc)
                config_err.last_run_at = now_utc
                config_err.last_status = "error"
                config_err.last_error = (
                    f"{error_type} — détail technique dans les logs serveur."
                )
                config_err.next_run_at = compute_next_run(config_err, now_utc)
                db.add(config_err)
                await db.commit()
        except Exception:  # noqa: BLE001
            logger.warning(
                "veille: impossible de mettre à jour le statut d'erreur sur VeilleConfig.",
                exc_info=True,
            )

    return {"count": len(new_ids), "new_ids": new_ids}
