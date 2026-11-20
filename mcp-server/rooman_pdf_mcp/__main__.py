"""python -m rooman_pdf_mcp  — start the MCP server (Streamable HTTP, default http://127.0.0.1:8001/mcp)."""
from __future__ import annotations

import sys

import uvicorn

from app.ai.mcp_auth import McpAuthError
from app.core.config import get_settings

from .server import create_app


def main() -> None:
    s = get_settings()
    try:
        app = create_app()
    except McpAuthError as e:
        sys.exit(f"rooman-pdf-mcp refuses to start: {e}")
    uvicorn.run(app, host=s.mcp_host, port=s.mcp_port, log_level="warning")


if __name__ == "__main__":
    main()
