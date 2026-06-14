"""Registry of available OpenClaw sub-agents.

The registry maps an agent slug to its class and exposes instances to the
command router. The four concrete agent modules are created by other agents;
these imports are expected.

``build_agent(agent_row)`` is the preferred factory used by the command router:
it returns a hard-coded agent instance when the slug is known, or falls back to
a ConfigurableAgent built from the database row's config/provider/model for
custom (database-driven) agents.
"""

from .base import BaseAgent
from .configurable_agent import ConfigurableAgent
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

    def is_registered(self, slug: str) -> bool:
        """Return True when ``slug`` maps to a hard-coded agent class."""
        return slug in self._agents


registry = AgentRegistry()
registry.register(PhotoAnalysisAgent)
registry.register(QuoteAgent)
registry.register(SiteReportAgent)
registry.register(TenderAgent)


def build_agent(agent_row) -> BaseAgent:
    """Factory: return the right BaseAgent instance for a database agent row.

    If the row's slug matches a hard-coded registered class, instantiate that
    class. Otherwise build a ConfigurableAgent from the row's config dict,
    provider and model fields — covering custom (agent_type="custom") agents
    created from the UI as well as any future code-less agents.

    Args:
        agent_row: an ORM Agent instance (must expose .slug, .config,
                   .provider, .model).

    Returns:
        A ready-to-run BaseAgent instance.
    """
    slug: str = agent_row.slug or ""

    if registry.is_registered(slug):
        return registry.get(slug)

    config: dict = agent_row.config or {}
    provider: str = getattr(agent_row, "provider", None) or "anthropic"
    model: str | None = getattr(agent_row, "model", None) or None

    return ConfigurableAgent(config=config, provider=provider, model=model)
