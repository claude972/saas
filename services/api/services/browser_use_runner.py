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

import asyncio
import logging

from config import settings

logger = logging.getLogger(__name__)

# Max navigation steps and wall-clock timeout (seconds) for a browser-use run.
_MAX_STEPS = 25
_DEFAULT_TIMEOUT_SECONDS = 120

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
# Browser-use agent factory (Claude LLM + headless, container-safe Chromium)
# ---------------------------------------------------------------------------


def _make_browser_agent(task: str, sensitive_data: dict | None = None):
    """Build a configured browser-use Agent, or return None if unavailable.

    Wires the Claude LLM (``settings.BROWSER_USE_MODEL``) and a headless,
    no-sandbox Chromium session (required when running as root inside a
    container). All ``browser_use`` imports are deferred here so the module
    never imports the heavy dependency at load time. Returns None (never
    raises) when browser-use is missing, the API key is absent, or any error
    occurs while constructing the agent.
    """
    try:
        from agents.llm import get_provider_key
        from browser_use import Agent as BrowserAgent
        from browser_use import ChatAnthropic

        api_key = get_provider_key("anthropic") or settings.ANTHROPIC_API_KEY
        if not api_key:
            logger.warning("browser_use: ANTHROPIC_API_KEY manquante — agent non créé.")
            return None

        llm = ChatAnthropic(model=settings.BROWSER_USE_MODEL, api_key=api_key)
        kwargs: dict = {"task": task, "llm": llm}

        # Headless + no-sandbox Chromium (mandatory in a root container).
        try:
            from browser_use import BrowserSession

            kwargs["browser_session"] = BrowserSession(
                headless=True,
                chromium_sandbox=False,
                args=["--disable-dev-shm-usage"],
            )
        except Exception:  # noqa: BLE001 — fall back to library defaults
            logger.debug("browser_use: BrowserSession indisponible, défauts utilisés.")

        if sensitive_data:
            kwargs["sensitive_data"] = sensitive_data

        return BrowserAgent(**kwargs)
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "browser_use: création de l'agent impossible (%s).", type(exc).__name__
        )
        return None


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
        agent = _make_browser_agent(task)
        if agent is None:
            return []
        result = await asyncio.wait_for(
            agent.run(max_steps=_MAX_STEPS), timeout=_DEFAULT_TIMEOUT_SECONDS
        )

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
# Portal-specific extraction (monitored sources)
# ---------------------------------------------------------------------------


def _is_ssrf_safe_url(url: str) -> bool:
    """Return True when *url* resolves to a routable (non-internal) host.

    Performs a synchronous DNS resolution and rejects any address in:
    * Loopback        : 127.0.0.0/8, ::1
    * Link-local      : 169.254.0.0/16, fe80::/10
    * Private RFC1918 : 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
    * ULA IPv6        : fc00::/7

    Returns False on any resolution error to fail closed.
    """
    import ipaddress
    import socket
    from urllib.parse import urlsplit

    try:
        host = urlsplit(url).hostname or ""
        if not host:
            return False
        # getaddrinfo returns all addresses; check every resolved IP.
        infos = socket.getaddrinfo(host, None)
    except Exception:
        # DNS failure, invalid host, etc. → reject.
        return False

    _BLOCKED_NETWORKS = [
        ipaddress.ip_network("127.0.0.0/8"),
        ipaddress.ip_network("::1/128"),
        ipaddress.ip_network("169.254.0.0/16"),
        ipaddress.ip_network("fe80::/10"),
        ipaddress.ip_network("10.0.0.0/8"),
        ipaddress.ip_network("172.16.0.0/12"),
        ipaddress.ip_network("192.168.0.0/16"),
        ipaddress.ip_network("fc00::/7"),
    ]

    for _family, _type, _proto, _canonname, sockaddr in infos:
        ip_str = sockaddr[0]
        try:
            ip = ipaddress.ip_address(ip_str)
        except ValueError:
            return False
        for net in _BLOCKED_NETWORKS:
            if ip in net:
                logger.warning(
                    "ssrf-guard: URL '%s' résout vers une adresse interne (%s) — rejetée.",
                    url,
                    ip_str,
                )
                return False
    return True


async def extract_from_portal(
    url: str,
    email: str | None,
    password: str | None,
    region_filters: list | None,
    sector_filters: list | None,
    limit: int = 10,
    timeout: int = 120,
) -> list[dict]:
    """Extract tender listings from a monitored portal via browser-use.

    Navigates to *url*, authenticates with *email*/*password* when provided,
    then scrapes calls for tender filtered by *region_filters* and
    *sector_filters*.

    The password is **never** logged, stored in any exception message, or
    included in any returned data structure.

    Args:
        url: Target portal URL (must be http/https).
        email: Login e-mail address, or ``None`` for anonymous access.
        password: Login password (write-only, never logged).
        region_filters: Optional list of region names to keep.
        sector_filters: Optional list of BTP sector keywords to keep.
        limit: Maximum number of results to return.  Defaults to ``10``.
        timeout: Maximum seconds to wait for the browser agent.

    Returns:
        A list of normalised offer dicts, each containing:
        ``title``, ``organization``, ``summary``, ``lots``, ``location``,
        ``region``, ``deadline`` (ISO string or ``None``), ``url``.

        Returns an empty list when browser-use is unavailable, disabled,
        not installed, or when any error occurs during extraction.
    """
    if not settings.BROWSER_USE_ENABLED:
        return []

    # Defense-in-depth: resolve hostname and reject internal/private addresses
    # before handing the URL to the browser agent (SSRF guard).
    if not _is_ssrf_safe_url(url):
        logger.warning(
            "extract_from_portal: URL rejetée par le SSRF guard — extraction annulée."
        )
        return []

    # Build the authentication instruction without embedding the password in
    # the log — the task string IS logged by some browser_use versions.
    if email and password:
        auth_instruction = (
            f"Connecte-toi avec l'e-mail '{email}' et le mot de passe fourni en variable."
        )
    elif email:
        auth_instruction = f"Connecte-toi avec l'e-mail '{email}' (sans mot de passe requis)."
    else:
        auth_instruction = "Accès anonyme, pas de connexion requise."

    regions_str = ", ".join(region_filters) if region_filters else ""
    sectors_str = ", ".join(sector_filters) if sector_filters else ""

    filter_instruction = ""
    if regions_str:
        filter_instruction += f" Filtre par régions: {regions_str}."
    if sectors_str:
        filter_instruction += f" Filtre par secteurs BTP: {sectors_str}."

    task = (
        f"Navigue vers l'URL: {url}. "
        f"{auth_instruction} "
        f"Accède à la section des appels d'offres ou marchés publics."
        f"{filter_instruction} "
        f"Pour chaque offre trouvée, extrais un objet JSON avec les champs: "
        f"title (str), organization (str ou null), summary (str ou null), "
        f"lots (list ou null), location (str ou null), region (str ou null), "
        f"deadline (date ISO 8601 ou null), url (str ou null). "
        f"Retourne un tableau JSON de {limit} offres maximum."
    )

    try:
        # The password is passed via browser-use's sensitive_data mechanism so
        # it never reaches the LLM in plaintext; the task references it only by
        # the placeholder key PORTAL_PASSWORD.
        sensitive_data = None
        agent_task = task
        if password:
            sensitive_data = {"PORTAL_PASSWORD": password}
            agent_task = task.replace(
                "le mot de passe fourni en variable",
                "le mot de passe: PORTAL_PASSWORD",
            )

        agent = _make_browser_agent(agent_task, sensitive_data=sensitive_data)
        if agent is None:
            return []
        result = await asyncio.wait_for(
            agent.run(max_steps=_MAX_STEPS), timeout=timeout
        )

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
        # Log the error class and a sanitised message.  Never include password.
        logger.warning(
            "browser_use portal extraction failed for %s (%s): %s",
            url,
            type(exc).__name__,
            # Use repr to avoid accidentally expanding objects that stringify
            # to credential-containing strings.
            repr(exc)[:200],
        )
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
