"""MCP registry (placeholder).

Will keep track of the configured MCP servers/clients available to the gateway.
Intentionally NOT implemented yet — see mcp_gateway/README.md.
"""

from __future__ import annotations

from .client import MCPClient


class MCPRegistry:
    """Placeholder registry of MCP clients.

    To be implemented later (register servers, resolve a client by name, etc.).
    """

    def __init__(self) -> None:
        self._clients: dict[str, MCPClient] = {}

    def register(self, client: MCPClient) -> None:
        raise NotImplementedError("MCPRegistry is a scaffold; not implemented yet.")

    def get(self, name: str) -> MCPClient:
        raise NotImplementedError("MCPRegistry is a scaffold; not implemented yet.")

    def list(self) -> list[MCPClient]:
        raise NotImplementedError("MCPRegistry is a scaffold; not implemented yet.")
