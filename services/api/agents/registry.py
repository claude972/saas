"""Registry of available OpenClaw sub-agents.

The registry maps an agent slug to its class and exposes instances to the
command router. The four concrete agent modules are created by other agents;
these imports are expected.
"""

from .base import BaseAgent
from .photo_analysis_agent import PhotoAnalysisAgent
from .quote_agent import QuoteAgent
from .site_report_agent import SiteReportAgent
from .tender_agent import TenderAgent


class AgentRegistry:
    """Holds the agent classes keyed by their slug."""

    def __init__(self) -> None:
        self._agents: dict[str, type[BaseAgent]] = {}

    def register(self, cls: type[BaseAgent]) -> None:
        """Register an agent class under its ``slug``."""
        self._agents[cls.slug] = cls

    def get(self, slug: str) -> BaseAgent:
        """Return a new instance of the agent with the given slug."""
        cls = self._agents.get(slug)
        if cls is None:
            raise ValueError(f"Unknown agent slug: {slug}")
        return cls()

    def list(self) -> list[dict]:
        """Return the metadata of every registered agent."""
        return [cls().get_metadata() for cls in self._agents.values()]


registry = AgentRegistry()
registry.register(PhotoAnalysisAgent)
registry.register(QuoteAgent)
registry.register(SiteReportAgent)
registry.register(TenderAgent)
