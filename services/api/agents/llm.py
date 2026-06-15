"""LLM access layer for OpenClaw agents — PydanticAI engine.

Public API is unchanged from the previous hand-rolled router. Agents call
``complete_json(...)`` and fall back to a stub on ``LLMUnavailable`` or any
error; ``command_router`` calls ``classify_intent_llm``; ``routes/settings``
calls ``provider_available`` / ``available_providers``.

Four providers are supported for LLM completion: anthropic, openai, google,
deepseek. A provider is "available" when its API key (from ``config.settings``
or the DB-loaded hot-reload cache) is non-empty.  ``llm_available()`` returns
True when at least one of those four has a key.

A fifth entry "perplexity" is tracked in ``_PROVIDER_KEYS`` for hot-reload
purposes (get/set/clear_provider_key) but is NOT included in
``available_providers()`` / ``llm_available()`` so existing /health and
/settings/llm callers are unaffected.

Strict rule for the Anthropic opus-4-8 model: NEVER send temperature, top_p,
top_k or thinking — only the model, the system prompt, the user message and
``max_tokens`` are passed through.
"""

from __future__ import annotations

import base64
import json
import logging
import os

from pydantic_ai import Agent, BinaryContent

from config import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Module-level defaults (read once at import time).
# ---------------------------------------------------------------------------

MODEL = settings.OPENCLAW_MODEL

_DEFAULT_MODELS: dict[str, str] = {
    "anthropic": MODEL,
    "openai": "gpt-4o",
    "google": "gemini-1.5-pro",
    "deepseek": "deepseek-chat",
}

_DEFAULT_PROVIDER: str = settings.DEFAULT_LLM_PROVIDER

# Cockpit-wide default ("agent chef") — runtime override of the env default,
# editable from Réglages and loaded from the DB at startup. None => use env.
_RUNTIME_DEFAULT_PROVIDER: str | None = None
_RUNTIME_DEFAULT_MODEL: str | None = None

_PROVIDER_MODELS: dict[str, list[str]] = {
    "anthropic": ["claude-opus-4-8", "claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5"],
    "openai": ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "o1", "o1-mini"],
    "google": ["gemini-1.5-pro", "gemini-1.5-flash", "gemini-2.0-flash"],
    "deepseek": ["deepseek-chat", "deepseek-reasoner"],
}


def models_for(provider: str) -> list[str]:
    """Return the curated model list for *provider*, or [default_model] if unknown."""
    key = provider.lower()
    if key in _PROVIDER_MODELS:
        return _PROVIDER_MODELS[key]
    default = _DEFAULT_MODELS.get(key, "")
    return [default] if default else []

# PydanticAI model-string prefixes per provider. Gemini via API key uses the
# unified "google:" prefix (GoogleModel), which reads GOOGLE_API_KEY from the
# environment. The legacy "google-gla:" prefix still resolves but is deprecated
# in PydanticAI 1.x and removed in v2.0, so we use "google:" directly. DeepSeek
# is OpenAI-compatible and uses the built-in "deepseek:" prefix (DeepSeekProvider,
# base_url https://api.deepseek.com), which reads DEEPSEEK_API_KEY from the env.
_PROVIDER_PREFIX: dict[str, str] = {
    "anthropic": "anthropic",
    "openai": "openai",
    "google": "google",
    "deepseek": "deepseek",
}

# Provider API keys — mutable module-level cache seeded from settings at
# import time.  ``set_provider_key`` / ``clear_provider_key`` update both this
# dict and os.environ so that PydanticAI picks up changes immediately.
# "perplexity" is included here for hot-reload purposes only; it is NOT part
# of the LLM completion path (available_providers / llm_available).
_PROVIDER_KEYS: dict[str, str] = {
    "anthropic": settings.ANTHROPIC_API_KEY,
    "openai": settings.OPENAI_API_KEY,
    "google": settings.GOOGLE_API_KEY,
    "deepseek": settings.DEEPSEEK_API_KEY,
    "perplexity": settings.PERPLEXITY_API_KEY,
}

# Canonical environment variable names per provider.
_ENV_NAMES: dict[str, str] = {
    "anthropic": "ANTHROPIC_API_KEY",
    "openai": "OPENAI_API_KEY",
    "google": "GOOGLE_API_KEY",
    "deepseek": "DEEPSEEK_API_KEY",
    "perplexity": "PERPLEXITY_API_KEY",
}

# PydanticAI reads provider credentials from the environment. Export whatever
# config provides so the keys are visible to the underlying provider SDKs.
# (We never overwrite a value that is already present and non-empty.)
for _env_name, _key in (
    ("ANTHROPIC_API_KEY", _PROVIDER_KEYS["anthropic"]),
    ("OPENAI_API_KEY", _PROVIDER_KEYS["openai"]),
    ("GOOGLE_API_KEY", _PROVIDER_KEYS["google"]),
    ("DEEPSEEK_API_KEY", _PROVIDER_KEYS["deepseek"]),
    ("PERPLEXITY_API_KEY", _PROVIDER_KEYS["perplexity"]),
):
    if _key and not os.getenv(_env_name):
        os.environ[_env_name] = _key


# ---------------------------------------------------------------------------
# Public exception
# ---------------------------------------------------------------------------


class LLMUnavailable(Exception):
    """Raised when a requested provider is not configured (missing API key)."""


# ---------------------------------------------------------------------------
# Public capability helpers
# ---------------------------------------------------------------------------


def provider_available(provider: str) -> bool:
    """Return True when *provider* has a non-empty configured API key."""
    return bool(_PROVIDER_KEYS.get(provider.lower(), ""))


def available_providers() -> list[str]:
    """Return a list of provider names that have a configured API key."""
    return [
        p
        for p in ("anthropic", "openai", "google", "deepseek")
        if provider_available(p)
    ]


def llm_available() -> bool:
    """Return True when at least one provider is configured."""
    return len(available_providers()) > 0


# ---------------------------------------------------------------------------
# Hot-reload helpers (mutable key cache)
# ---------------------------------------------------------------------------


def get_provider_key(provider: str) -> str:
    """Return the current in-memory API key for *provider* (may be empty).

    Works for all five providers including "perplexity".
    """
    return _PROVIDER_KEYS.get(provider.lower(), "")


def set_provider_key(provider: str, key: str) -> None:
    """Update the in-memory cache AND os.environ for *provider*.

    The change takes effect immediately for PydanticAI and for any code that
    reads the key via ``get_provider_key``.  Silently ignores unknown providers.
    """
    p = provider.lower()
    env_name = _ENV_NAMES.get(p)
    if env_name is None:
        logger.warning("set_provider_key: unknown provider %r — ignored.", p)
        return
    _PROVIDER_KEYS[p] = key
    os.environ[env_name] = key


def clear_provider_key(provider: str) -> None:
    """Restore the original env-file value for *provider* in cache and os.environ.

    Used when a DB-stored secret is deleted: reverts to whatever ``settings``
    (the pydantic-settings object seeded at boot) originally provided.
    """
    p = provider.lower()
    env_name = _ENV_NAMES.get(p)
    if env_name is None:
        logger.warning("clear_provider_key: unknown provider %r — ignored.", p)
        return
    # Retrieve the original value from the settings object (always present,
    # defaults to "" when the env var was absent at boot).
    original = getattr(settings, env_name, "")
    _PROVIDER_KEYS[p] = original
    os.environ[env_name] = original


async def load_keys_from_db(session) -> None:
    """Load all ApiSecret rows and push their decrypted keys into the cache.

    Called once during lifespan startup.  DB values take precedence over env
    so that secrets managed from the cockpit survive restarts.

    Best-effort: a failure on one row is logged and skipped; the function
    never raises.  The password/key value is NEVER logged.
    """
    try:
        from sqlalchemy import select as _select

        from models import ApiSecret
        from services.crypto import decrypt_secret

        result = await session.execute(_select(ApiSecret))
        rows: list[ApiSecret] = list(result.scalars().all())
    except Exception as exc:
        logger.warning(
            "load_keys_from_db: could not query api_secrets (%s) — skip.",
            type(exc).__name__,
        )
        return

    for row in rows:
        try:
            plaintext = decrypt_secret(row.encrypted_key)
            if plaintext:
                set_provider_key(row.provider, plaintext)
        except Exception as exc:
            logger.warning(
                "load_keys_from_db: failed to load key for provider %r (%s) — skip.",
                row.provider,
                type(exc).__name__,
            )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _strip_json_fences(text: str) -> str:
    """Remove surrounding ```json ... ``` (or plain ```) fences if present."""
    stripped = text.strip()
    if stripped.startswith("```"):
        newline = stripped.find("\n")
        if newline != -1:
            stripped = stripped[newline + 1 :]
        else:
            stripped = stripped[3:]
        if stripped.rstrip().endswith("```"):
            stripped = stripped.rstrip()[:-3]
    return stripped.strip()


_PROVIDERS_TUPLE = ("anthropic", "openai", "google", "deepseek")


def set_default_provider_model(provider: str | None, model: str | None) -> None:
    """Override the cockpit-wide default provider/model (the "agent chef").

    Takes effect immediately: ``complete_json`` / ``classify_intent_llm`` use it
    whenever a caller passes no explicit provider/model. Pass None/empty to clear
    the override and fall back to the env default.
    """
    global _RUNTIME_DEFAULT_PROVIDER, _RUNTIME_DEFAULT_MODEL
    p = (provider or "").strip().lower() or None
    _RUNTIME_DEFAULT_PROVIDER = p if p in _PROVIDERS_TUPLE else None
    _RUNTIME_DEFAULT_MODEL = (model or "").strip() or None


def default_provider_model() -> tuple[str, str]:
    """Return the active default (provider, model) for the orchestrator/agents."""
    provider = (_RUNTIME_DEFAULT_PROVIDER or _DEFAULT_PROVIDER).lower()
    if provider not in _PROVIDERS_TUPLE:
        provider = "anthropic"
    model = (
        _RUNTIME_DEFAULT_MODEL
        or _DEFAULT_MODELS.get(provider)
        or _DEFAULT_MODELS["anthropic"]
    )
    return provider, model


def _resolve_provider_model(
    provider: str | None,
    model: str | None,
) -> tuple[str, str]:
    """Resolve (provider, model), filling in defaults where None is passed."""
    if provider is None and model is None:
        # No explicit choice → use the cockpit-wide default ("agent chef").
        return default_provider_model()
    resolved_provider = (provider or _RUNTIME_DEFAULT_PROVIDER or _DEFAULT_PROVIDER).lower()
    if resolved_provider not in _PROVIDERS_TUPLE:
        resolved_provider = "anthropic"
    resolved_model = model or _DEFAULT_MODELS[resolved_provider]
    return resolved_provider, resolved_model


def _model_string(provider: str, model: str) -> str:
    """Build the PydanticAI ``"<provider>:<model>"`` model identifier."""
    return f"{_PROVIDER_PREFIX[provider]}:{model}"


def _build_user_prompt(
    user: str,
    images: list[tuple[str, str]] | None,
) -> str | list:
    """Build the PydanticAI user prompt.

    With images, returns a list of ``[text, BinaryContent, ...]``; each image
    is a ``(media_type, base64_data)`` tuple decoded into raw bytes. Without
    images, returns the plain text string.
    """
    if not images:
        return user

    prompt: list = [user]
    for media_type, b64 in images:
        prompt.append(
            BinaryContent(data=base64.b64decode(b64), media_type=media_type)
        )
    return prompt


# ---------------------------------------------------------------------------
# Public API (backward-compatible)
# ---------------------------------------------------------------------------


async def complete_json(
    system: str,
    user: str,
    images: list[tuple[str, str]] | None = None,
    max_tokens: int = 8192,
    provider: str | None = None,
    model: str | None = None,
) -> dict:
    """Call the LLM and parse a JSON object from its reply.

    ``images`` is a list of ``(media_type, base64_data)`` tuples rendered as
    vision blocks before the text. On a parse failure the raw text is returned
    as ``{"raw": text}`` so callers never crash.

    ``provider`` defaults to the ``DEFAULT_LLM_PROVIDER`` env var (anthropic).
    ``model`` defaults to the provider's default model. Raises
    ``LLMUnavailable`` when the resolved provider has no API key.
    """
    resolved_provider, resolved_model = _resolve_provider_model(provider, model)

    if not provider_available(resolved_provider):
        raise LLMUnavailable(
            f"{resolved_provider.upper()}_API_KEY is not configured."
        )

    agent = Agent(
        _model_string(resolved_provider, resolved_model),
        system_prompt=system,
        # Strict: only max_tokens — no temperature / top_p / top_k / thinking.
        # ``model_settings`` is a TypedDict in PydanticAI; a plain dict is the
        # documented form and avoids import-path coupling across versions.
        model_settings={"max_tokens": max_tokens},
    )

    result = await agent.run(_build_user_prompt(user, images))
    text = result.output or ""

    cleaned = _strip_json_fences(text)
    try:
        return json.loads(cleaned)
    except (json.JSONDecodeError, ValueError):
        return {"raw": text}


async def classify_intent_llm(instruction: str, allowed: list[str]) -> str:
    """Classify a free-text instruction into one of the ``allowed`` intents.

    Forces a JSON reply ``{"intent": "<one of allowed>"}``. Falls back to
    ``allowed[0]`` when the model returns an unknown value. Raises
    ``LLMUnavailable`` when no provider is configured.
    """
    if not llm_available():
        raise LLMUnavailable("No LLM provider is configured.")

    allowed_list = ", ".join(allowed)
    system = (
        "Tu es un routeur d'intentions pour un cockpit BTP. "
        "Tu dois classer l'instruction de l'utilisateur dans EXACTEMENT une "
        "des intentions autorisees. Reponds UNIQUEMENT par un objet JSON de la "
        'forme {"intent": "<valeur>"} sans aucun texte supplementaire. '
        f"Intentions autorisees: {allowed_list}."
    )
    user = (
        f"Instruction: {instruction}\n\n"
        f"Choisis l'intention la plus appropriee parmi: {allowed_list}."
    )

    # Uses the default provider (same behaviour as before).
    result = await complete_json(system=system, user=user, max_tokens=256)
    intent = result.get("intent")
    if isinstance(intent, str) and intent in allowed:
        return intent
    return allowed[0]
