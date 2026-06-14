"""MCP client (placeholder).

Will hold a connection to an MCP server and expose calls to its tools.
Intentionally NOT implemented yet — see mcp_gateway/README.md.
"""

from __future__ import annotations


class MCPClient:
    """Placeholder client for a single MCP server.

    To be implemented later. The backend stays the authority: an agent/skill
    asks the gateway to call an external tool, the gateway uses this client.
    """

    def __init__(self, name: str, url: str) -> None:
        self.name = name
        self.url = url

    async def list_tools(self) -> list:
        raise NotImplementedError("MCPClient is a scaffold; not implemented yet.")

    async def call_tool(self, tool: str, arguments: dict) -> dict:
        raise NotImplementedError("MCPClient is a scaffold; not implemented yet.")
