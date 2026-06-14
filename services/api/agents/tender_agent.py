"""Tender agent: analyses a tender package (DCE / appel d'offres).

Handles the ``analyze_tender`` intent. The agent acts as a careful BTP bid
manager (responsable d'appels d'offres): it reads the tender brief, extracts the
documents the buyer requires (pieces demandees), the award criteria, the
deadlines and the points that need close attention. The LLM call is wrapped so
that a missing API key or any error falls back to a coherent stub and the
application stays functional.

The router is the only authority that persists the result; this agent merely
returns a draft document dict. This work is risk_level medium and always
requires human validation before anything leaves the cockpit.
"""

from .base import BaseAgent
from .llm import LLMUnavailable, complete_json

SYSTEM_PROMPT = (
    "Tu es un responsable d'appels d'offres BTP experimente. Tu analyses un "
    "dossier de consultation des entreprises (DCE) ou un appel d'offres a "
    "partir de l'instruction fournie. Regles strictes:\n"
    "- N'invente JAMAIS d'exigences: si une information manque, signale-le dans "
    "'points_vigilance' plutot que de la deviner.\n"
    "- Extrais la liste des pieces a remettre (ex: acte d'engagement, memoire "
    "technique, attestations, references), les criteres de selection et leur "
    "ponderation si elle est indiquee, les delais cles, et les points de "
    "vigilance (clauses penalisantes, exigences techniques fortes, risques).\n"
    "- Reste sobre et factuel: pas de marketing, uniquement l'analyse.\n"
    "Reponds UNIQUEMENT par un objet JSON valide, sans texte autour, de la "
    "forme:\n"
    '{"title": "<titre de l\'analyse>", '
    '"pieces_demandees": ["<piece>", ...], '
    '"criteres": ["<critere>", ...], '
    '"delais": "<synthese des delais>", '
    '"points_vigilance": ["<point>", ...]}'
)


def _str_list(value) -> list[str]:
    """Coerce an arbitrary value into a clean list of strings."""
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


class TenderAgent(BaseAgent):
    """Analyses a tender package (DCE / appel d'offres) into a draft response."""

    slug = "tender_agent"
    name = "Agent Appels d'Offres"
    role = "tender"
    description = (
        "Responsable d'appels d'offres BTP: analyse un DCE (brouillon), extrait "
        "les pieces demandees, les criteres, les delais et les points de "
        "vigilance."
    )
    version = "1.0.0"
    risk_level = "medium"
    requires_approval = True

    async def run(self, input_data: dict) -> dict:
        """Generate a draft tender-response analysis document.

        ``input_data`` contains at least ``instruction`` and ``project_id``.
        Always returns a dict shaped as a draft ``tender_response`` document. On
        a missing LLM client or any error, returns a coherent stub (empty lists)
        flagged with ``"stub": true``.
        """
        instruction = str(input_data.get("instruction", "")).strip()

        try:
            user = (
                f"Instruction / contenu de l'appel d'offres:\n{instruction}\n\n"
                "Analyse ce dossier en respectant le format JSON demande. "
                "Liste les pieces a remettre, les criteres, les delais et les "
                "points de vigilance."
            )
            result = await complete_json(system=SYSTEM_PROMPT, user=user)

            title = (
                str(result.get("title", "")).strip()
                or "Analyse appel d'offres (brouillon)"
            )
            delais = str(result.get("delais", "")).strip() or "Non precise"

            return {
                "document_type": "tender_response",
                "title": title,
                "status": "draft",
                "content": {
                    "pieces_demandees": _str_list(result.get("pieces_demandees")),
                    "criteres": _str_list(result.get("criteres")),
                    "delais": delais,
                    "points_vigilance": _str_list(result.get("points_vigilance")),
                },
            }
        except (LLMUnavailable, Exception):
            return self._stub(instruction)

    def _stub(self, instruction: str) -> dict:
        """Coherent fallback when the LLM is unavailable or errors out."""
        points_vigilance = [
            "LLM indisponible: analyse non realisee, a completer manuellement.",
        ]
        if instruction:
            points_vigilance.append(f"Instruction recue: {instruction}")
        return {
            "stub": True,
            "document_type": "tender_response",
            "title": "Analyse appel d'offres (brouillon - stub)",
            "status": "draft",
            "content": {
                "pieces_demandees": [],
                "criteres": [],
                "delais": "Non precise",
                "points_vigilance": points_vigilance,
            },
        }
