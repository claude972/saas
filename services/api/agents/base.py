"""Base class for all OpenClaw sub-agents.

Each agent is a self-contained unit that receives a validated input dict,
calls the LLM (or returns a stub when no API key is configured), and always
returns a dict. Agents NEVER write to the database or filesystem directly;
the command router is the only authority that persists results.
"""

from abc import ABC, abstractmethod


class BaseAgent(ABC):
    """Abstract base for a business sub-agent.

    Subclasses override the class attributes and implement ``run``.
    """

    # Class-level metadata, overridden by each concrete agent.
    slug: str = "base_agent"
    name: str = "Base Agent"
    role: str = "base"
    description: str = "Abstract base agent."
    version: str = "1.0.0"
    risk_level: str = "low"
    requires_approval: bool = False

    @abstractmethod
    async def run(self, input_data: dict) -> dict:
        """Execute the agent and return a result dict.

        Implementations must always return a dict and must never raise on a
        missing LLM client (they fall back to a clearly marked stub instead).
        """
        raise NotImplementedError

    def validate_input(self, input_data: dict) -> bool:
        """Validate the incoming payload. Permissive by default."""
        return True

    def get_metadata(self) -> dict:
        """Return a serialisable description of this agent."""
        return {
            "slug": self.slug,
            "name": self.name,
            "role": self.role,
            "description": self.description,
            "agent_type": self.role,
            "version": self.version,
            "risk_level": self.risk_level,
            "requires_approval": self.requires_approval,
            "input_schema": {},
            "output_schema": {},
        }
