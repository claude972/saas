"""Configurable agent: a database-driven agent built from a config dict.

Used for agents with agent_type="custom" created from the UI or for any agent
row whose slug is not registered as a hard-coded class. The system_prompt,
document_type, provider and model are all taken from the database row config
at construction time.

The command router calls build_agent(row) from registry.py which returns an
instance of this class when no hard-coded class matches the slug.
"""

from .base import BaseAgent
from .llm import LLMUnavailable, complete_json


class ConfigurableAgent(BaseAgent):
    """A runtime-configurable agent driven entirely by a database row config.

    Constructor parameters (all taken from the agent row):
    - system_prompt: the system prompt injected into every LLM call
    - document_type: the document_type set on the returned draft (e.g. "quote")
    - provider: LLM provider to use (e.g. "anthropic", "openai", "google")
    - model: explicit model name; None means the provider's default is used
    """

    # Class-level defaults overridden at instance level via __init__.
    slug = "configurable_agent"
    name = "Agent Configurable"
    role = "custom"
    description = "Agent pilote par la configuration de la base de donnees."
    version = "1.0.0"
    risk_level = "low"
    requires_approval = False

    def __init__(
        self,
        config: dict,
        provider: str = "anthropic",
        model: str | None = None,
    ) -> None:
        """Build a ConfigurableAgent from the database row data.

        Args:
            config: the agent.config JSON dict (may contain system_prompt,
                    document_type, skills, etc.)
            provider: LLM provider slug ("anthropic" | "openai" | "google")
            model: explicit model name; None defers to the provider default
        """
        self._system_prompt: str = str(config.get("system_prompt", "")).strip()
        self._document_type: str = str(config.get("document_type", "document")).strip()
        self._provider: str = provider or "anthropic"
        self._model: str | None = model or None

    async def run(self, input_data: dict) -> dict:
        """Execute the configurable agent.

        Reads provider/model/skills_text from input_data so that the command
        router can override the defaults stored on the agent row. Falls back to
        the constructor values when those keys are absent.

        Always returns a dict shaped as a draft document. On LLMUnavailable or
        any error, returns a clearly marked stub so the app stays functional.
        """
        instruction: str = str(input_data.get("instruction", "")).strip()
        provider: str = str(input_data.get("provider") or self._provider)
        model: str | None = input_data.get("model") or self._model
        skills_text: str = str(input_data.get("skills_text") or "").strip()

        # Build the effective system prompt: prepend skills when provided.
        system = self._system_prompt
        if skills_text:
            system = f"{skills_text}\n\n{system}" if system else skills_text

        if not system:
            system = (
                "Tu es un assistant BTP. Reponds a l'instruction de l'utilisateur "
                "en JSON valide de la forme {\"result\": \"<ta reponse>\"}."
            )

        user = instruction or "Aucune instruction fournie."

        try:
            result = await complete_json(
                system=system,
                user=user,
                provider=provider,
                model=model,
            )
        except (LLMUnavailable, Exception):  # noqa: BLE001 - stay functional
            return self._stub(instruction)

        return {
            "document_type": self._document_type,
            "title": str(result.get("title", "")).strip() or "Document (brouillon)",
            "status": "draft",
            "content": result,
        }

    def _stub(self, instruction: str) -> dict:
        """Return a clearly marked stub when the LLM is unavailable."""
        return {
            "stub": True,
            "document_type": self._document_type,
            "title": "Document (brouillon - stub)",
            "status": "draft",
            "content": {
                "result": (
                    "LLM indisponible: document non genere, a completer manuellement. "
                    f"Instruction recue: {instruction or 'aucune'}."
                )
            },
        }
