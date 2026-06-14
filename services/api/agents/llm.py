"""LLM access layer for OpenClaw agents.

Wraps the Anthropic AsyncAnthropic client. When ANTHROPIC_API_KEY is absent
there is no client and callers must handle ``LLMUnavailable`` by returning a
stub so the application stays functional.

Strict rules for the opus-4-8 model: NEVER send temperature, top_p, top_k,
budget_tokens, or a thinking block. Only model, max_tokens, system and
messages are passed to ``messages.create``.
"""

import base64
import json
import os

from anthropic import AsyncAnthropic

MODEL = os.getenv("OPENCLAW_MODEL", "claude-opus-4-8")

_key = os.getenv("ANTHROPIC_API_KEY")
_client = AsyncAnthropic() if _key else None


class LLMUnavailable(Exception):
    """Raised when no Anthropic client is configured (missing API key)."""


def llm_available() -> bool:
    """Return True when an Anthropic client is configured."""
    return _client is not None


def _strip_json_fences(text: str) -> str:
    """Remove surrounding ```json ... ``` (or plain ```) fences if present."""
    stripped = text.strip()
    if stripped.startswith("```"):
        # Drop the opening fence line (``` or ```json).
        newline = stripped.find("\n")
        if newline != -1:
            stripped = stripped[newline + 1 :]
        else:
            stripped = stripped[3:]
        # Drop the closing fence.
        if stripped.rstrip().endswith("```"):
            stripped = stripped.rstrip()[:-3]
    return stripped.strip()


async def complete_json(
    system: str,
    user: str,
    images: list[tuple[str, str]] | None = None,
    max_tokens: int = 8192,
) -> dict:
    """Call the LLM and parse a JSON object from its reply.

    ``images`` is a list of ``(media_type, base64_data)`` tuples rendered as
    vision blocks before the text block. On a parse failure the raw text is
    returned as ``{"raw": text}`` so callers never crash.
    """
    if _client is None:
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

    resp = await _client.messages.create(
        model=MODEL,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": content}],
    )

    text = "".join(
        block.text for block in resp.content if getattr(block, "type", None) == "text"
    )

    cleaned = _strip_json_fences(text)
    try:
        return json.loads(cleaned)
    except (json.JSONDecodeError, ValueError):
        return {"raw": text}


async def classify_intent_llm(instruction: str, allowed: list[str]) -> str:
    """Classify a free-text instruction into one of the ``allowed`` intents.

    Forces a JSON reply ``{"intent": "<one of allowed>"}``. Falls back to
    ``allowed[0]`` when the model returns an unknown value. Raises
    ``LLMUnavailable`` when no client is configured.
    """
    if _client is None:
        raise LLMUnavailable("ANTHROPIC_API_KEY is not configured.")

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

    result = await complete_json(system=system, user=user, max_tokens=256)
    intent = result.get("intent")
    if isinstance(intent, str) and intent in allowed:
        return intent
    return allowed[0]
