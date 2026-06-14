"""Perplexity AI client for BTP tender (appel d'offres) discovery.

Searches for public BTP tender offers in French DOM territories by querying the
Perplexity ``/chat/completions`` endpoint with the ``sonar`` model (or whichever
model is configured via ``PERPLEXITY_MODEL``). The prompt asks for a JSON table
of currently open tenders; the response is parsed robustly.

Public API
----------
::

    if perplexity_available():
        offers = await search_tenders(keywords, regions, limit=10)

Each offer dict in the returned list has the shape::

    {
        "title": str,
        "organization": str | None,
        "summary": str | None,
        "lots": list | None,
        "location": str | None,
        "region": str | None,
        "deadline": str | None,   # ISO datetime string or null
        "url": str | None,
    }

Returns an empty list (never raises) when PERPLEXITY_API_KEY is not configured
or when an HTTP/parse error occurs so that the API boots cleanly without any
secret configured.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

import httpx

from config import settings

logger = logging.getLogger(__name__)

_API_URL = "https://api.perplexity.ai/chat/completions"
_REQUEST_TIMEOUT = 60.0  # seconds; Perplexity sonar can be slow on long prompts


# ---------------------------------------------------------------------------
# Capability helper
# ---------------------------------------------------------------------------


def perplexity_available() -> bool:
    """Return True when PERPLEXITY_API_KEY is configured (non-empty)."""
    return bool(settings.PERPLEXITY_API_KEY)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _build_prompt(
    keywords: list[str],
    regions: list[str],
    limit: int,
    template: str | None = None,
) -> str:
    """Build the user prompt sent to Perplexity.

    When *template* is provided (prompt personnalisé édité depuis le cockpit),
    les variables ``{keywords}``, ``{regions}`` et ``{limit}`` y sont
    substituées par ``str.replace`` (et non ``.format``) afin que le gabarit
    puisse contenir librement des accolades JSON. Sinon le prompt par défaut
    intégré ci-dessous est utilisé.
    """
    kw_str = ", ".join(keywords) if keywords else "tous corps d'état BTP"
    reg_str = ", ".join(regions) if regions else "DOM-TOM"
    if template and template.strip():
        return (
            template.replace("{keywords}", kw_str)
            .replace("{regions}", reg_str)
            .replace("{limit}", str(limit))
        )
    return (
        f"En t'appuyant sur le web, recherche des appels d'offres publics BTP "
        f"actuellement ouverts ou récemment publiés dans ces territoires : {reg_str}. "
        f"Cible en priorité ces corps d'état : {kw_str}. "
        f"Donne autant de résultats RÉELS que possible (vise {limit}). "
        f"Réponds UNIQUEMENT par un tableau JSON valide (aucun texte avant ni après, "
        f"sans balises markdown), chaque élément ayant les clés suivantes :\n"
        f'  "title"        : string — intitulé PRÉCIS du marché (OBLIGATOIRE ; '
        f"pas un libellé de rubrique ni un nom de site),\n"
        f'  "organization" : string ou null (maître d\'ouvrage / entité publique),\n'
        f'  "summary"      : string ou null (objet du marché),\n'
        f'  "lots"         : liste de strings ou null,\n'
        f'  "location"     : string ou null (commune ou adresse),\n'
        f'  "region"       : string ou null (territoire DOM),\n'
        f'  "deadline"     : string ISO 8601 ou null (date limite de remise),\n'
        f'  "url"          : string ou null (lien direct vers l\'avis).\n'
        f"Mets null pour toute information inconnue ; ne rejette JAMAIS une offre "
        f"pour une information manquante. Ne renvoie pas de tableau vide tant que "
        f"des marchés BTP publics existent dans ces territoires."
    )


def _strip_json_fences(text: str) -> str:
    """Remove surrounding ```json ... ``` or plain ``` fences if present."""
    stripped = text.strip()
    # Remove opening fence (```json, ```JSON, or plain ```)
    stripped = re.sub(r"^```[a-zA-Z]*\s*", "", stripped)
    # Remove closing fence
    stripped = re.sub(r"\s*```$", "", stripped.rstrip())
    return stripped.strip()


def _extract_json_array(text: str) -> list[dict]:
    """Extract the first JSON array found in *text*.

    Tries two strategies in order:
    1. Parse the whole (fence-stripped) text as JSON.
    2. Extract the first ``[...]`` block with a regex and parse that.

    Returns an empty list on any parse failure.
    """
    cleaned = _strip_json_fences(text)

    # Strategy 1: full parse
    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, list):
            return parsed
        if isinstance(parsed, dict):
            # Some models wrap the array: {"results": [...]}
            for value in parsed.values():
                if isinstance(value, list):
                    return value
    except (json.JSONDecodeError, ValueError):
        pass

    # Strategy 2: find the outermost [...] block
    match = re.search(r"\[.*\]", cleaned, flags=re.DOTALL)
    if match:
        try:
            parsed = json.loads(match.group())
            if isinstance(parsed, list):
                return parsed
        except (json.JSONDecodeError, ValueError):
            pass

    return []


def _normalize_offer(raw: Any) -> dict | None:
    """Normalize a raw offer dict from the model response.

    Returns None if *raw* is not a dict or has no usable title.
    """
    if not isinstance(raw, dict):
        return None

    title = str(raw.get("title") or "").strip()
    if not title:
        return None

    lots_raw = raw.get("lots")
    lots: list | None = None
    if isinstance(lots_raw, list):
        lots = [str(item).strip() for item in lots_raw if str(item).strip()] or None
    elif isinstance(lots_raw, str) and lots_raw.strip():
        lots = [lots_raw.strip()]

    raw_url = str(raw["url"]).strip() if raw.get("url") else None
    # Valide le schéma URL pour éviter javascript:/data:/vbscript: (XSS stocké).
    safe_url: str | None = None
    if raw_url:
        lower_url = raw_url.lower()
        if lower_url.startswith("http://") or lower_url.startswith("https://"):
            safe_url = raw_url

    return {
        "title": title,
        "organization": str(raw["organization"]).strip() if raw.get("organization") else None,
        "summary": str(raw["summary"]).strip() if raw.get("summary") else None,
        "lots": lots,
        "location": str(raw["location"]).strip() if raw.get("location") else None,
        "region": str(raw["region"]).strip() if raw.get("region") else None,
        "deadline": str(raw["deadline"]).strip() if raw.get("deadline") else None,
        "url": safe_url,
    }


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def search_tenders(
    keywords: list[str],
    regions: list[str],
    limit: int = 10,
    model: str | None = None,
    prompt_template: str | None = None,
) -> list[dict]:
    """Search for public BTP tender offers via the Perplexity chat API.

    Sends a single prompt that asks Perplexity to return a JSON array of open
    tender offers matching *keywords* in the given *regions*. The response is
    parsed robustly: JSON fences are stripped, and both full-parse and
    regex-extraction strategies are tried.

    Args:
        keywords: List of BTP trade keywords to filter on (e.g. ["placo",
            "électricité"]).
        regions: List of DOM region names to search in (e.g. ["Martinique",
            "Guadeloupe"]).
        limit: Maximum number of offers to request from the model. The actual
            count returned may be lower.

    Returns:
        List of normalized offer dicts. Each dict always contains the keys
        ``title``, ``organization``, ``summary``, ``lots``, ``location``,
        ``region``, ``deadline``, ``url`` (all nullable except ``title``).
        Returns ``[]`` when Perplexity is not configured or on any error.
    """
    if not perplexity_available():
        logger.debug("Perplexity non configuré (PERPLEXITY_API_KEY vide) — skip.")
        return []

    prompt = _build_prompt(keywords, regions, limit, prompt_template)

    payload = {
        "model": model or settings.PERPLEXITY_MODEL,
        "messages": [
            {
                "role": "system",
                "content": (
                    "Tu es un assistant spécialisé dans la veille des marchés publics "
                    "BTP français. Réponds TOUJOURS par un tableau JSON valide, sans "
                    "texte autour, sans balises markdown."
                ),
            },
            {
                "role": "user",
                "content": prompt,
            },
        ],
    }

    headers = {
        "Authorization": f"Bearer {settings.PERPLEXITY_API_KEY}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT) as client:
            response = await client.post(_API_URL, json=payload, headers=headers)
            response.raise_for_status()
    except httpx.TimeoutException:
        logger.warning("Perplexity: timeout après %.0fs — retourne [].", _REQUEST_TIMEOUT)
        return []
    except httpx.HTTPStatusError as exc:
        logger.warning(
            "Perplexity: erreur HTTP %s — %s",
            exc.response.status_code,
            exc.response.text[:200],
        )
        return []
    except Exception as exc:
        logger.warning("Perplexity: erreur réseau inattendue — %s", exc)
        return []

    try:
        data = response.json()
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, ValueError) as exc:
        logger.warning("Perplexity: réponse inattendue — %s", exc)
        return []

    raw_offers = _extract_json_array(content)
    if not raw_offers:
        logger.info("Perplexity: aucune offre trouvée dans la réponse.")
        return []

    offers: list[dict] = []
    for raw in raw_offers[:limit]:
        normalized = _normalize_offer(raw)
        if normalized:
            offers.append(normalized)

    logger.info("Perplexity: %d offre(s) extraite(s).", len(offers))
    return offers
