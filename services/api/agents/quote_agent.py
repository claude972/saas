"""Quote agent: drafts a construction quote (devis) from an instruction.

Handles the ``create_quote`` and ``create_quote_from_photo`` intents. The agent
acts as a careful BTP quantity surveyor (metreur): it produces a clear draft
quote, surfaces every assumption when information is missing, and never invents
measurements. The LLM call is wrapped so that a missing API key or any error
falls back to a coherent stub and the application stays functional.

The router is the only authority that persists the result; this agent merely
returns a draft document dict. Totals are always recomputed and validated here
so the figures stay consistent regardless of what the LLM returned.
"""

from .base import BaseAgent
from .llm import LLMUnavailable, complete_json

# Default French VAT rate for construction work.
DEFAULT_TVA_RATE = 0.20

SYSTEM_PROMPT = (
    "Tu es un metreur BTP experimente. Tu rediges des devis clairs et prudents "
    "a partir de l'instruction fournie. Regles strictes:\n"
    "- N'invente JAMAIS de mesures, de surfaces ni de quantites: si une "
    "information manque, fais une hypothese RAISONNABLE et rends-la visible "
    "dans le tableau 'hypotheses'.\n"
    "- Decompose le devis en lignes simples (label, quantite, unite, prix "
    "unitaire HT). Utilise des prix de marche prudents en euros.\n"
    "- Reste sobre: pas de marketing, uniquement le chiffrage.\n"
    "Reponds UNIQUEMENT par un objet JSON valide, sans texte autour, de la "
    "forme:\n"
    '{"title": "<titre du devis>", '
    '"lines": [{"label": "<libelle>", "qty": <nombre>, "unit": "<unite>", '
    '"unit_price_ht": <nombre>}], '
    '"hypotheses": ["<hypothese>", ...]}\n'
    "Les totaux seront recalcules cote serveur: ne renvoie pas de total."
)


def _to_float(value, default: float = 0.0) -> float:
    """Best-effort conversion to float, tolerant of strings and None."""
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _normalize_lines(raw_lines) -> list[dict]:
    """Coerce LLM line items into the strict output schema with computed totals.

    Each returned line has ``label``, ``qty``, ``unit``, ``unit_price_ht`` and a
    ``total_ht`` recomputed from ``qty * unit_price_ht`` (rounded to 2 decimals).
    """
    lines: list[dict] = []
    if not isinstance(raw_lines, list):
        return lines
    for item in raw_lines:
        if not isinstance(item, dict):
            continue
        qty = _to_float(item.get("qty"))
        unit_price_ht = _to_float(item.get("unit_price_ht"))
        total_ht = round(qty * unit_price_ht, 2)
        lines.append(
            {
                "label": str(item.get("label", "")).strip() or "Ligne sans libelle",
                "qty": qty,
                "unit": str(item.get("unit", "")).strip() or "u",
                "unit_price_ht": unit_price_ht,
                "total_ht": total_ht,
            }
        )
    return lines


def _build_content(lines: list[dict], hypotheses: list[str]) -> dict:
    """Assemble the quote content block with validated totals."""
    total_ht = round(sum(line["total_ht"] for line in lines), 2)
    total_tva = round(total_ht * DEFAULT_TVA_RATE, 2)
    total_ttc = round(total_ht + total_tva, 2)
    return {
        "lines": lines,
        "total_ht": total_ht,
        "tva_rate": DEFAULT_TVA_RATE,
        "total_tva": total_tva,
        "total_ttc": total_ttc,
        "hypotheses": hypotheses,
    }


class QuoteAgent(BaseAgent):
    """Drafts a construction quote (devis) from a free-text instruction."""

    slug = "quote_agent"
    name = "Agent Devis"
    role = "quote"
    description = (
        "Metreur BTP: redige un devis clair et prudent (brouillon) a partir "
        "de l'instruction, en rendant visibles les hypotheses."
    )
    version = "1.0.0"
    risk_level = "medium"
    requires_approval = True

    async def run(self, input_data: dict) -> dict:
        """Generate a draft quote document.

        ``input_data`` contains at least ``instruction`` and ``project_id``.
        Always returns a dict shaped as a draft ``quote`` document. On a missing
        LLM client or any error, returns a coherent stub (empty lines, zero
        totals) flagged with ``"stub": true``.
        """
        instruction = str(input_data.get("instruction", "")).strip()

        try:
            user = (
                f"Instruction du chef de chantier:\n{instruction}\n\n"
                "Redige le devis correspondant en respectant le format JSON "
                "demande. Liste tes hypotheses si des informations manquent."
            )
            result = await complete_json(system=SYSTEM_PROMPT, user=user)

            raw_hypotheses = result.get("hypotheses")
            hypotheses = (
                [str(h) for h in raw_hypotheses]
                if isinstance(raw_hypotheses, list)
                else []
            )
            lines = _normalize_lines(result.get("lines"))
            title = str(result.get("title", "")).strip() or "Devis (brouillon)"

            return {
                "document_type": "quote",
                "title": title,
                "status": "draft",
                "content": _build_content(lines, hypotheses),
            }
        except (LLMUnavailable, Exception):
            return self._stub(instruction)

    def _stub(self, instruction: str) -> dict:
        """Coherent fallback when the LLM is unavailable or errors out."""
        title = "Devis (brouillon - stub)"
        hypotheses = [
            "LLM indisponible: devis non chiffre, a completer manuellement.",
        ]
        if instruction:
            hypotheses.append(f"Instruction recue: {instruction}")
        content = _build_content([], hypotheses)
        return {
            "stub": True,
            "document_type": "quote",
            "title": title,
            "status": "draft",
            "content": content,
        }
