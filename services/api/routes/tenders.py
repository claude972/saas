"""Routes pour les appels d'offres BTP (veille AO).

Les offres sont détectées automatiquement par la veille ou saisies manuellement.
Ce module expose le CRUD complet ainsi qu'un endpoint d'analyse LLM qui génère
un :class:`~models.Document` de type ``analyse_ao``.

Toutes les routes requièrent un utilisateur authentifié via :func:`get_current_user`.

Routes statiques (``/new``) déclarées **avant** le paramètre ``/{tender_id}``
pour éviter tout conflit de résolution FastAPI.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.audit_logger import log_event
from core.security import get_current_user
from deps import get_db
from enums import DocumentStatus
from models import Document, Skill, TenderOffer
from schemas import (
    DocumentRead,
    TenderAnalyzeRequest,
    TenderOfferCreate,
    TenderOfferRead,
    TenderOfferUpdate,
)

router = APIRouter()


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _dedup_key(url: str | None, title: str) -> str:
    """Calcule une clé de déduplication stable identique à ``services.veille._dedup_key``.

    Délègue à la fonction canonique définie dans ``services.veille`` afin que
    les offres créées manuellement et celles découvertes par la veille
    automatique partagent exactement le même format de clé, garantissant ainsi
    une déduplication inter-sources correcte.

    Args:
        url:   URL de l'offre (peut être None).
        title: Titre de l'offre (requis).

    Returns:
        Hash MD5 hexadécimal de 32 caractères calculé sur ``url|title``
        (minuscules, espaces normalisés).
    """
    # Import ici pour éviter les imports circulaires au démarrage.
    from services.veille import _dedup_key as _veille_dedup_key  # noqa: PLC0415

    return _veille_dedup_key({"url": url, "title": title})


async def _collect_skills_text(db: AsyncSession) -> str:
    """Agrège les instructions de toutes les skills actives en un bloc texte.

    Retourne une chaîne vide si aucune skill n'est configurée.
    """
    result = await db.execute(
        select(Skill).where(Skill.enabled.is_(True)).order_by(Skill.name)
    )
    skills = result.scalars().all()
    if not skills:
        return ""
    parts = []
    for skill in skills:
        if skill.instructions:
            parts.append(f"[Compétence : {skill.name}]\n{skill.instructions}")
    return "\n\n".join(parts)


async def _get_offer_or_404(db: AsyncSession, tender_id: uuid.UUID) -> TenderOffer:
    """Charge une offre par son id ou lève une ``HTTPException`` 404."""
    offer = await db.get(TenderOffer, tender_id)
    if offer is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Appel d'offres introuvable.",
        )
    return offer


# ---------------------------------------------------------------------------
# Routes statiques — déclarées AVANT /{tender_id}
# ---------------------------------------------------------------------------


@router.get("", response_model=list[TenderOfferRead])
@router.get("/", response_model=list[TenderOfferRead], include_in_schema=False)
async def list_tenders(
    status: str | None = Query(default=None, description="Filtrer par statut (new, seen, analyzing, responded, ignored)"),
    region: str | None = Query(default=None, description="Filtrer par région DOM"),
    sector: str | None = Query(default=None, description="Filtrer par secteur BTP (slug)"),
    source: str | None = Query(default=None, description="Filtrer par source (perplexity, browser_use, official, manual)"),
    limit: int = Query(default=100, ge=1, le=500, description="Nombre maximum d'offres à retourner"),
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
) -> list[TenderOffer]:
    """Liste les appels d'offres, du plus récent au plus ancien.

    Filtres optionnels : ``status``, ``region`` (SQL), ``sector`` (Python post-fetch sur ``sectors``), ``source``.
    """
    stmt = select(TenderOffer)
    if status is not None:
        stmt = stmt.where(TenderOffer.status == status)
    if region is not None:
        stmt = stmt.where(TenderOffer.region == region)
    if source is not None:
        stmt = stmt.where(TenderOffer.source == source)
    stmt = stmt.order_by(TenderOffer.created_at.desc()).limit(limit)

    result = await db.execute(stmt)
    offers = list(result.scalars().all())

    if sector is not None:
        offers = [o for o in offers if isinstance(o.sectors, list) and sector in o.sectors]

    return offers


@router.get("/new", response_model=list[TenderOfferRead])
async def list_new_tenders(
    region: str | None = Query(default=None, description="Filtrer par région DOM"),
    sector: str | None = Query(default=None, description="Filtrer par secteur BTP (slug)"),
    limit: int = Query(default=50, ge=1, le=500, description="Nombre maximum d'offres à retourner"),
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
) -> list[TenderOffer]:
    """Retourne uniquement les offres au statut ``new``, les plus récentes d'abord.

    Utilisé par OpenClaw (via MCP ``list_new_offers``) pour tirer les nouvelles
    opportunités sans avoir à filtrer côté client.

    Filtres optionnels : ``region`` (SQL) et ``sector`` (Python post-fetch sur ``sectors``).
    """
    stmt = select(TenderOffer).where(TenderOffer.status == "new")
    if region is not None:
        stmt = stmt.where(TenderOffer.region == region)
    stmt = stmt.order_by(TenderOffer.created_at.desc()).limit(limit)

    result = await db.execute(stmt)
    offers = list(result.scalars().all())

    if sector is not None:
        offers = [o for o in offers if isinstance(o.sectors, list) and sector in o.sectors]

    return offers


@router.post("", response_model=TenderOfferRead, status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=TenderOfferRead, status_code=status.HTTP_201_CREATED, include_in_schema=False)
async def create_tender(
    payload: TenderOfferCreate,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
) -> TenderOffer:
    """Crée une offre manuellement.

    Calcule automatiquement la ``dedup_key`` à partir de l'URL (si fournie)
    ou du titre, et rejette la requête avec ``409`` si un doublon existe déjà.
    """
    data = payload.model_dump()
    computed_key = _dedup_key(data.get("url"), data["title"])
    data["dedup_key"] = computed_key

    # Check for duplicate before inserting.
    existing = await db.execute(
        select(TenderOffer).where(TenderOffer.dedup_key == computed_key)
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Un appel d'offres identique existe déjà (dedup_key en doublon).",
        )

    offer = TenderOffer(**data)
    db.add(offer)
    await db.commit()
    await db.refresh(offer)
    return offer


# ---------------------------------------------------------------------------
# Routes paramétrées — déclarées APRÈS les routes statiques
# ---------------------------------------------------------------------------


@router.get("/{tender_id}", response_model=TenderOfferRead)
async def get_tender(
    tender_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
) -> TenderOffer:
    """Retourne un appel d'offres par son identifiant, ou ``404`` s'il est introuvable."""
    return await _get_offer_or_404(db, tender_id)


@router.patch("/{tender_id}", response_model=TenderOfferRead)
async def update_tender(
    tender_id: uuid.UUID,
    payload: TenderOfferUpdate,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
) -> TenderOffer:
    """Met à jour partiellement un appel d'offres.

    Seuls les champs présents dans le payload sont modifiés.
    """
    offer = await _get_offer_or_404(db, tender_id)

    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(offer, field, value)

    await db.commit()
    await db.refresh(offer)
    return offer


@router.delete("/{tender_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tender(
    tender_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
) -> None:
    """Supprime définitivement un appel d'offres.

    Retourne ``204 No Content`` en cas de succès, ``404`` si l'offre est introuvable.
    """
    offer = await _get_offer_or_404(db, tender_id)
    await db.delete(offer)
    await db.commit()


@router.post("/{tender_id}/analyze", response_model=DocumentRead)
async def analyze_tender(
    tender_id: uuid.UUID,
    payload: TenderAnalyzeRequest,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
) -> Document:
    """Lance l'analyse LLM d'un appel d'offres et produit un Document ``analyse_ao``.

    Étapes
    ------
    1. Charge l'offre (``404`` si introuvable).
    2. Collecte les instructions des skills actives pour enrichir le contexte LLM.
    3. Appelle :func:`services.ao_analysis.analyze_offer` avec les données de l'offre
       et les paramètres du payload (``instruction``, ``provider``, ``model``).
    4. Crée un :class:`~models.Document` de type ``analyse_ao`` au statut ``draft``
       dont le ``content`` est le dict renvoyé par l'analyse.
    5. Lie l'offre à ce document (``offer.document_id``) et passe son statut
       à ``responded``.
    6. Enregistre un événement d'audit.
    7. Retourne le ``DocumentRead`` du document créé.
    """
    offer = await _get_offer_or_404(db, tender_id)

    # Collect skills context for the LLM prompt.
    skills_text = await _collect_skills_text(db)

    # Delegate to the analysis service (never raises — returns stub on error).
    from services.ao_analysis import analyze_offer  # deferred import, safe

    analysis_content = await analyze_offer(
        title=offer.title,
        summary=offer.summary,
        lots=offer.lots,
        url=offer.url,
        instruction=payload.instruction,
        provider=payload.provider,
        model=payload.model,
        skills_text=skills_text,
        mode=payload.mode,
    )

    # Persist the analysis as a Document.
    doc_title = f"Analyse AO — {offer.title[:200]}"
    document = Document(
        document_type="analyse_ao",
        title=doc_title,
        content=analysis_content,
        status=DocumentStatus.DRAFT.value,
        project_id=None,
        task_id=None,
    )
    db.add(document)
    await db.flush()  # populate document.id before linking

    # Link offer to document and promote its status.
    offer.document_id = document.id
    offer.status = "responded"

    await db.commit()
    await db.refresh(document)
    await db.refresh(offer)

    # Audit trail.
    await log_event(
        db,
        event_type="tender.analyzed",
        message=f"Analyse AO générée pour l'offre '{offer.title[:100]}'.",
        level="info",
        payload={
            "tender_id": str(tender_id),
            "document_id": str(document.id),
            "stub": analysis_content.get("stub", False),
        },
    )

    return document
