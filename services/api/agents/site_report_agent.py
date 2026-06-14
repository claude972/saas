"""Site report sub-agent for the OpenClaw BTP cockpit.

Handles the ``create_site_report`` intent. From a free-text instruction (and an
optional project context) it asks the LLM to draft a structured site-visit
report (compte-rendu de visite de chantier). Produces a ``site_report``
document in draft. When no API key is configured (LLMUnavailable) or anything
fails, it returns a clearly marked stub respecting the same format so the app
stays functional. This module is importable on its own.
"""

from .base import BaseAgent
from .llm import LLMUnavailable, complete_json

SYSTEM_PROMPT = (
    "Tu es un conducteur de travaux du BTP qui redige des comptes-rendus de "
    "visite de chantier. A partir de l'instruction fournie, redige un "
    "compte-rendu structure, factuel et professionnel. N'invente RIEN : si une "
    "information n'est pas fournie, laisse le champ correspondant vide plutot "
    "que de la deduire. "
    "Reponds UNIQUEMENT par un objet JSON valide de la forme : "
    '{"date": "<date de la visite ou chaine vide>", '
    '"present": ["<personne ou role>", ...], '
    '"constats": ["<constat factuel>", ...], '
    '"actions": ["<action a mener>", ...], '
    '"reserves": ["<reserve emise>", ...]} '
    "sans aucun texte supplementaire."
)


class SiteReportAgent(BaseAgent):
    """Draft a structured site-visit report (compte-rendu de chantier)."""

    slug = "site_report_agent"
    name = "Agent Compte-Rendu de Chantier"
    role = "site_report"
    description = (
        "Redige un compte-rendu de visite de chantier structure "
        "(date, presents, constats, actions, reserves) en brouillon."
    )
    version = "1.0.0"
    risk_level = "low"
    requires_approval = False

    async def run(self, input_data: dict) -> dict:
        """Run the report drafting for the ``create_site_report`` intent."""
        instruction = input_data.get("instruction", "")
        project_id = input_data.get("project_id")
        provider: str | None = input_data.get("provider") or None
        model: str | None = input_data.get("model") or None
        skills_text: str = str(input_data.get("skills_text") or "").strip()

        system = f"{skills_text}\n\n{SYSTEM_PROMPT}" if skills_text else SYSTEM_PROMPT

        user = (
            "Redige un compte-rendu de visite de chantier a partir des "
            "elements suivants.\n"
            f"Instruction : {instruction or 'aucune'}\n"
            f"Projet concerne (id) : {project_id or 'non precise'}"
        )

        try:
            result = await complete_json(
                system=system,
                user=user,
                provider=provider,
                model=model,
            )
        except (LLMUnavailable, Exception):  # noqa: BLE001 - stay functional
            return self._stub(instruction)

        content = {
            "date": result.get("date", ""),
            "present": result.get("present", []),
            "constats": result.get("constats", []),
            "actions": result.get("actions", []),
            "reserves": result.get("reserves", []),
        }
        return {
            "document_type": "site_report",
            "title": "Compte-rendu de visite de chantier",
            "status": "draft",
            "content": content,
        }

    def _stub(self, instruction: str) -> dict:
        """Return a clearly marked stub respecting the expected format."""
        return {
            "stub": True,
            "document_type": "site_report",
            "title": "Compte-rendu de visite de chantier (stub)",
            "status": "draft",
            "content": {
                "date": "",
                "present": [],
                "constats": [
                    "Redaction indisponible (LLM non configure). "
                    f"Instruction recue : {instruction or 'aucune'}."
                ],
                "actions": [],
                "reserves": [
                    "Resultat genere en mode stub : aucun compte-rendu reel redige."
                ],
            },
        }
