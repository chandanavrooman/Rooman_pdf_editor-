#!/usr/bin/env bash
# Start the backend in development mode on http://localhost:8000
set -euo pipefail
cd "$(dirname "$0")"
[ -d .venv ] || { /opt/homebrew/bin/python3.13 -m venv .venv 2>/dev/null || python3 -m venv .venv; .venv/bin/pip install -r requirements.txt; }
exec .venv/bin/uvicorn app.main:app --reload --port "${PORT:-8000}"
