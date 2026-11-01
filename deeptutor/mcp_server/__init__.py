"""External Model Context Protocol server for DeepTutor.

This package is the protocol boundary for external hosts such as WorkBuddy.
DeepTutor's first-party app/web/SDK clients call application services directly
and must not route through MCP.
"""

from .server import create_mcp_server

__all__ = ["create_mcp_server"]
