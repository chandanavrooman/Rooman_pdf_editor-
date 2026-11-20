"""rooman-pdf-mcp: MCP server (Streamable HTTP) exposing the Rooman PDF service layer as tools.

It imports the backend's service layer (`app.services.operations.Ops`) directly, so tools perform the SAME real
operations as the HTTP API and share the same DocumentStore (storage dir + SQLite DB) and per-user ownership checks.
"""
from __future__ import annotations

import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[2] / "backend"
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

__version__ = "0.1.0"
