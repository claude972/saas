"""Browser-use scraping runner for BTP OpenClaw Cockpit veille module.

Provides a thin wrapper around the ``browser_use`` library for scraping
public procurement (appels d'offres) listings when Perplexity is unavailable
or as a supplementary source.

The ``browser_use`` library is a heavy optional dependency (Playwright-based).
It is **never imported at module level**: all imports are deferred inside the
function body and surrounded by ``try/except`` so that:

* The API starts normally even if ``browser_use`` is not installed.
* ``BROWSER_USE_ENABLED=False`` (the default) keeps the feature silently
  disabled without any import cost or error.

Public API
----------
::

    available: bool = browser_use_available()
    offers: list[dict] = await find_tenders(keywords, regions, limit=10)

Each dict in the returned list follows the normalised shape expected by
``services.veille.run_veille``:
``{title, organization, summary, lots, location, region, deadline, url}``
"""

from __future__ import annotations

import logging

from config import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Availability check
# ---------------------------------------------------------------------------


def browser_use_available() -> bool:
    """Return True when browser-use scraping is enabled *and* importable.

    Two conditions must both be true:

    1. ``BROWSER_USE_ENABLED`` is ``True`` in the application settings.
    2. The ``browser_use`` package can actually be imported (i.e. it is
       installed in the current Python environment).

    This function never raises; it returns ``False`` on any error.
    """
    if not settings.BROWSER_USE_ENABLED:
        return False
    try:
        import importlib

        importlib.import_module("browser_use")
        return True
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Tender scraping
# ---------------------------------------------------------------------------


async def find_tenders(
    keywords: list[str],
    regions: list[str],
    limit: int = 10,
) -> list[dict]:
    """Scrape public BTP procurement listings via browser-use.

    Uses the ``browser_use`` library (Playwright-based) to navigate public
    procurement portals and extract open calls for tender (appels d'offres)
    matching the supplied *keywords* in the target *regions*.

    Args:
        keywords: Trade/work keywords to search for, e.g.
            ``["placo", "plâtrerie", "peinture"]``.
        regions: DOM region names to restrict the search, e.g.
            ``["Martinique", "Guadeloupe"]``.
        limit: Maximum number of results to return.  Defaults to ``10``.

    Returns:
        A list of normalised offer dicts, each containing:
        ``title``, ``organization``, ``summary``, ``lots``, ``location``,
        ``region``, ``deadline`` (ISO string or ``None``), ``url``.

        Returns an empty list when browser-use is unavailable, disabled,
        not installed, or when any error occurs during scraping.
    """
    if not settings.BROWSER_USE_ENABLED:
        return []

    try:
        # --- Lazy import: browser_use must NEVER be imported at top level ---
        import browser_use  # noqa: F401 — availability confirmed by import
        from browser_use import Agent as BrowserAgent
    except Exception as exc:
        logger.debug("browser_use not importable, skipping: %s", exc)
        return []

    keywords_str = ", ".join(keywords) if keywords else "BTP"
    regions_str = ", ".join(regions) if regions else "DOM"

    task = (
        f"Recherche des appels d'offres publics BTP en cours dans les régions: "
        f"{regions_str}. "
        f"Mots-clés recherchés: {keywords_str}. "
        f"Pour chaque offre trouvée, extrais un objet JSON avec les champs: "
        f"title (str), organization (str ou null), summary (str ou null), "
        f"lots (list ou null), location (str ou null), region (str), "
        f"deadline (date ISO 8601 ou null), url (str ou null). "
        f"Retourne un tableau JSON de {limit} offres maximum."
    )

    try:
        agent = BrowserAgent(task=task)
        result = await agent.run()

        # result may be a string containing JSON or an object with a
        # ``final_result`` / ``text`` attribute depending on browser_use version
        raw_text: str = ""
        if isinstance(result, str):
            raw_text = result
        elif hasattr(result, "final_result"):
            raw_text = str(result.final_result() or "")
        elif hasattr(result, "text"):
            raw_text = str(result.text or "")
        else:
            raw_text = str(result)

        offers = _parse_json_response(raw_text)
        return offers[:limit]

    except Exception as exc:
        logger.warning("browser_use scraping failed: %s", exc)
        return []


# ---------------------------------------------------------------------------
# JSON parsing helpers
# ---------------------------------------------------------------------------


def _parse_json_response(text: str) -> list[dict]:
    """Parse a JSON array from raw LLM/browser-use text output.

    Strips Markdown code fences (````json … `````) if present, then attempts
    ``json.loads``.  Returns an empty list on any parse error.

    Args:
        text: Raw text that may contain a JSON array, possibly wrapped in
            Markdown fences.

    Returns:
        Parsed list of dicts, or ``[]`` on failure.
    """
    import json
    import re

    if not text or not text.strip():
        return []

    # Strip ```json ... ``` or ``` ... ``` fences
    cleaned = re.sub(r"```(?:json)?\s*", "", text).replace("```", "").strip()

    # Attempt to extract the first [...] block if there is surrounding prose
    match = re.search(r"\[.*\]", cleaned, re.DOTALL)
    if match:
        cleaned = match.group(0)

    try:
        data = json.loads(cleaned)
    except Exception:
        return []

    if not isinstance(data, list):
        return []

    results: list[dict] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        # Valide le schéma URL pour éviter javascript:/data:/vbscript: (XSS
        # stocké) et restreindre les cibles de scraping (SSRF partiel).
        raw_url = item.get("url")
        safe_url: str | None = None
        if raw_url:
            url_str = str(raw_url).strip()
            lower_url = url_str.lower()
            if lower_url.startswith("http://") or lower_url.startswith("https://"):
                safe_url = url_str

        # Normalise to the expected shape; missing keys default to None
        results.append(
            {
                "title": item.get("title") or "",
                "organization": item.get("organization"),
                "summary": item.get("summary"),
                "lots": item.get("lots"),
                "location": item.get("location"),
                "region": item.get("region"),
                "deadline": item.get("deadline"),
                "url": safe_url,
            }
        )

    return results
