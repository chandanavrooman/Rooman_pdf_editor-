#!/usr/bin/env bash
# Start everything: backend (:8000), MCP server (:8001/mcp), frontend (:5173).
# First run: creates .env from .env.example with generated secrets, creates the
# Python venv and installs npm dependencies. Ctrl+C stops all three.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PYTHON="${PYTHON:-}"
if [ -z "$PYTHON" ]; then
  for c in python3.13 python3.12 python3.11 python3; do
    if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(sys.version_info < (3, 11))'; then PYTHON="$c"; break; fi
  done
fi
[ -n "$PYTHON" ] || { echo "Python 3.11+ is required." >&2; exit 1; }

gen() { "$PYTHON" -c 'import secrets; print(secrets.token_urlsafe(48))'; }
setvar() { # setvar KEY VALUE  (only when the key is empty/missing in .env)
  local k="$1" v="$2"
  if grep -qE "^${k}=.+" .env; then return; fi
  if grep -qE "^${k}=" .env; then
    "$PYTHON" - "$k" "$v" <<'PY'
import sys, re, pathlib
k, v = sys.argv[1:3]
p = pathlib.Path(".env"); s = p.read_text()
p.write_text(re.sub(rf"^{k}=.*$", f"{k}={v}", s, flags=re.M))
PY
  else echo "${k}=${v}" >> .env; fi
}

if [ ! -f .env ]; then cp .env.example .env; echo "Created .env from .env.example"; fi
setvar JWT_SECRET "$(gen)"
setvar MCP_SHARED_SECRET "$(gen)"

if [ ! -x backend/.venv/bin/python ]; then
  echo "Creating backend virtualenv…"
  "$PYTHON" -m venv backend/.venv
  backend/.venv/bin/pip install --quiet -r backend/requirements.txt
fi
[ -d frontend/node_modules ] || (cd frontend && npm install)

for tool in gs tesseract soffice; do
  command -v "$tool" >/dev/null 2>&1 || { [ "$tool" = soffice ] && [ -x /Applications/LibreOffice.app/Contents/MacOS/soffice ]; } || echo "NOTE: '$tool' not found — the tools that need it will return a clear 'not installed' error (see README)."
done
grep -qE '^AI_API_KEY=.+' .env || echo "NOTE: AI_API_KEY is empty — AI chat will show a 'key missing' error; everything else works."

pids=()
cleanup() { echo; echo "Stopping…"; for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done; wait 2>/dev/null || true; }
trap cleanup EXIT INT TERM

(cd backend && exec .venv/bin/uvicorn app.main:app --reload --port 8000) & pids+=($!)
(cd mcp-server && exec ./run.sh) & pids+=($!)
(cd frontend && exec npm run dev -- --host 127.0.0.1) & pids+=($!)

echo
echo "Rooman PDF:  http://localhost:5173   (API http://localhost:8000, OpenAPI /docs, MCP http://127.0.0.1:8001/mcp)"
wait
