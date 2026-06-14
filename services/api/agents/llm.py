"""LLM access layer for OpenClaw agents — multi-provider router.

Supports three providers: anthropic, openai, google.
When a provider's API key is absent its adapter raises ``LLMUnavailable``.
``llm_available()`` returns True when at least one provider has a key.

Strict rules for the Anthropic opus-4-8 model: NEVER send temperature,
top_p, top_k, budget_tokens, or a thinking block. Only model, max_tokens,
system and messages are passed to ``messages.create``.
"""

from __future__ import annotations

import base64
import json
import os

# ---------------------------------------------------------------------------
# Module-level defaults (read once at import time, identical to the original
# behaviour for the Anthropic path).
# ---------------------------------------------------------------------------

MODEL = os.getenv("OPENCLAW_MODEL", "claude-opus-4-8")

_DEFAULT_MODELS: dict[str, str] = {
    "anthropic": MODEL,
    "openai": "gpt-4o",
    "google": "gemini-1.5-pro",
}

_DEFAULT_PROVIDER: str = os.getenv("DEFAULT_LLM_PROVIDER", "anthropic")

# Anthropic client (kept exactly as before).
_anthropic_key: str = os.getenv("ANTHROPIC_API_KEY", "")
_openai_key: str = os.getenv("OPENAI_API_KEY", "")
_google_key: str = os.getenv("GOOGLE_API_KEY", "")

try:
    from anthropic import AsyncAnthropic as _AsyncAnthropic

    _anthropic_client = _AsyncAnthropic() if _anthropic_key else None
except ImportError:
    _anthropic_client = None

try:
    from openai import AsyncOpenAI as _AsyncOpenAI

    _openai_client = _AsyncOpenAI(api_key=_openai_key) if _openai_key else None
except ImportError:
    _openai_client = None

try:
    import google.generativeai as _genai  # type: ignore

    if _google_key:
        _genai.configure(api_key=_google_key)
        _google_available = True
    else:
        _google_available = False
except ImportError:
    _genai = None  # type: ignore
    _google_available = False


# ---------------------------------------------------------------------------
# Public exception
# ---------------------------------------------------------------------------


class LLMUnavailable(Exception):
    """Raised when a requested provider is not configured (missing API key)."""


# ---------------------------------------------------------------------------
# Public capability helpers
# ---------------------------------------------------------------------------


def provider_available(provider: str) -> bool:
    """Return True when *provider* has a configured API key and client."""
    p = provider.lower()
    if p == "anthropic":
        return _anthropic_client is not None
    if p == "openai":
        return _openai_client is not None
    if p == "google":
        return _google_available
    return False


def available_providers() -> list[str]:
    """Return a list of provider names that have a configured API key."""
    return [p for p in ("anthropic", "openai", "google") if provider_available(p)]


def llm_available() -> bool:
    """Return True when at least one provider is configured."""
    return len(available_providers()) > 0


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


def _resolve_provider_model(
    provider: str | None,
    model: str | None,
) -> tuple[str, str]:
    """Resolve (provider, model), filling in defaults where None is passed."""
    resolved_provider = (provider or _DEFAULT_PROVIDER).lower()
    if resolved_provider not in ("anthropic", "openai", "google"):
        resolved_provider = "anthropic"
    resolved_model = model or _DEFAULT_MODELS[resolved_provider]
    return resolved_provider, resolved_model


# ---------------------------------------------------------------------------
# Provider adapters (private)
# ---------------------------------------------------------------------------


async def _complete_anthropic(
    system: str,
    user: str,
    images: list[tuple[str, str]] | None,
    max_tokens: int,
    model: str,
) -> str:
    """Call the Anthropic Messages API and return the raw text reply."""
    if _anthropic_client is None:
        raise LLMUnavailable("ANTHROPIC_API_KEY is not configured.")

    content: list[dict] = []
    for media_type, b64 in images or []:
        content.append(
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": media_type,
                    "data": b64,
                },
            }
        )
    content.append({"type": "text", "text": user})

    # Strict: only model, max_tokens, system, messages — no extra params.
    resp = await _anthropic_client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": content}],
    )

    return "".join(
        block.text
        for block in resp.content
        if getattr(block, "type", None) == "text"
    )


async def _complete_openai(
    system: str,
    user: str,
    images: list[tuple[str, str]] | None,
    max_tokens: int,
    model: str,
) -> str:
    """Call the OpenAI Chat Completions API and return the raw text reply."""
    if _openai_client is None:
        raise LLMUnavailable("OPENAI_API_KEY is not configured.")

    user_content: list[dict] = []
    for media_type, b64 in images or []:
        data_url = f"data:{media_type};base64,{b64}"
        user_content.append(
            {
                "type": "image_url",
                "image_url": {"url": data_url},
            }
        )
    user_content.append({"type": "text", "text": user})

    resp = await _openai_client.chat.completions.create(
        model=model,
        max_tokens=max_tokens,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user_content},
        ],
    )

    return resp.choices[0].message.content or ""


async def _complete_google(
    system: str,
    user: str,
    images: list[tuple[str, str]] | None,
    max_tokens: int,
    model: str,
) -> str:
    """Call the Google Generative AI API and return the raw text reply."""
    if not _google_available or _genai is None:
        raise LLMUnavailable("GOOGLE_API_KEY is not configured.")

    genai_model = _genai.GenerativeModel(
        model_name=model,
        system_instruction=system,
    )

    parts: list = []
    for media_type, b64 in images or []:
        image_bytes = base64.b64decode(b64)
        parts.append({"mime_type": media_type, "data": image_bytes})
    parts.append(user)

    generation_config = _genai.types.GenerationConfig(max_output_tokens=max_tokens)
    resp = await genai_model.generate_content_async(
        parts,
        generation_config=generation_config,
    )

    return resp.text or ""


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
    vision blocks before the text block. On a parse failure the raw text is
    returned as ``{"raw": text}`` so callers never crash.

    ``provider`` defaults to the ``DEFAULT_LLM_PROVIDER`` env var (anthropic).
    ``model`` defaults to the provider's default model.
    """
    resolved_provider, resolved_model = _resolve_provider_model(provider, model)

    if resolved_provider == "anthropic":
        text = await _complete_anthropic(system, user, images, max_tokens, resolved_model)
    elif resolved_provider == "openai":
        text = await _complete_openai(system, user, images, max_tokens, resolved_model)
    elif resolved_provider == "google":
        text = await _complete_google(system, user, images, max_tokens, resolved_model)
    else:
        raise LLMUnavailable(f"Unknown provider: {resolved_provider}")

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

    # Uses the default provider (same behaviour as before for Anthropic-only setups).
    result = await complete_json(system=system, user=user, max_tokens=256)
    intent = result.get("intent")
    if isinstance(intent, str) and intent in allowed:
        return intent
    return allowed[0]
