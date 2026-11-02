"""Backwards-compatible `python -m deeptutor.mcp_server` entry point.

The canonical command is `deeptutor mcp serve` (see `deeptutor_cli/mcp.py`),
which supports both stdio and streamable HTTP transports.
"""

from __future__ import annotations

from deeptutor_cli.mcp import app, main

__all__ = ["app", "main"]

if __name__ == "__main__":  # pragma: no cover
    main()
