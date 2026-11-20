#!/usr/bin/env bash
# Start the rooman-pdf-mcp server (Streamable HTTP) on http://127.0.0.1:8001/mcp
# Uses the backend virtualenv (the server imports the backend service layer). Needs MCP_SHARED_SECRET (>= 32 chars) in ../.env.
set -euo pipefail
cd "$(dirname "$0")"
PY=../backend/.venv/bin/python
[ -x "$PY" ] || { echo "Create the backend venv first: cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt" >&2; exit 1; }
exec "$PY" -m rooman_pdf_mcp
