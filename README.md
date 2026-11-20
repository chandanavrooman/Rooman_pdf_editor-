# Rooman PDF

A PDF toolkit and editor: organize, edit, convert, optimize, secure, sign — plus an AI assistant that can chat with a document and run PDF tools through MCP.

Feature and workflow reference: Sejda / Smallpdf (functionality only — no branding, copy or code reused).
Every tool follows one flow: **upload → options → process (progress) → result (Download, "Edit again", related tools)**.

## Where files are processed

| Runs in your browser (file never leaves the device) | Uploads the file to the server |
|---|---|
| Merge, Split, Extract, Delete, Rotate, Reorder, Crop, Resize, N-up, Page numbers, Headers/footers, Bates; the Editor (text, shapes, highlight, draw, images, links, signature, form fields & filling); Sign | Compress, PDF→Word/Excel/PowerPoint/JPG/PNG/text, Word/Excel/PowerPoint/JPG/PNG/text→PDF, OCR, Repair, Flatten, Deskew, Protect, Unlock, Watermark, Metadata, and all AI features |

Every tool card and tool page says which kind it is. Server files are stored per user under server-generated paths and deleted after `FILE_TTL_MINUTES`.
AI features send extracted document text to the configured `AI_ENDPOINT` provider.

## Architecture

```
frontend/    React + TS + Vite + Tailwind. pdf.js renders original pages; pdf-lib edits in the browser.
backend/     FastAPI (Python 3.11+). app/{routers,services,schemas,core,ai}. JWT auth, document store, tool services.
mcp-server/  rooman-pdf-mcp: FastMCP over Streamable HTTP (:8001/mcp). One file per tool in tools/ (auto-discovered).
tests/       Shared fixtures (tests/fixtures, built by make_fixtures.py).
```

- Browser → `/api/*` (Vite proxies to :8000 in dev) with a Bearer JWT.
- Backend service layer (`backend/app/services/operations.py`, class `Ops`) does all PDF work; routers and MCP tools both call it, so behaviour is identical.
- Chat: the backend acts as MCP client + tool-calling agent loop → `mcp-server` (shared secret + short-lived signed user token) → `Ops`. Destructive tools (`delete_pages`, `protect_pdf`, `redact_pdf`) require explicit user confirmation. Only our own MCP server is allowed (`MCP_ALLOWED_URLS`); private documents are never sent to external MCP servers.
- Add an MCP tool: drop one file in `mcp-server/tools/`.

## Requirements

- Node 20+ and npm, Python 3.11+
- External programs (a tool returns a clear `EXTERNAL_TOOL_MISSING` error when its program is absent; `GET /api/system/capabilities` reports what is found):
  - **Ghostscript** (`gs`) — Compress
  - **Tesseract** (`tesseract`, with language data) — OCR, Deskew, scanned PDF→Word
  - **LibreOffice** (`soffice`) — Word/Excel/PowerPoint→PDF
  - macOS: `brew install ghostscript tesseract && brew install --cask libreoffice`
  - Debian/Ubuntu: `sudo apt install ghostscript tesseract-ocr libreoffice`
- Optional: `AI_API_KEY` for the AI features (default provider Groq, `AI_ENDPOINT`/`AI_MODEL` configurable).

## Quick start (everything)

```bash
./scripts/start.sh
```

First run creates `.env` from `.env.example` (with generated `JWT_SECRET` and `MCP_SHARED_SECRET`), the Python venv, and installs npm packages. Then open http://localhost:5173.
Set `AI_API_KEY` in `.env` to enable AI.

## Local test mode (skip sign-in)

For testing on your own machine, set `LOCAL_TEST_MODE=true` in `.env` (with `ENV=development`) and restart.
Server tools then work without registering: the app gets a session for one fixed local user (`local-test@rooman.local`) and shows a
"Local test mode" badge in the header. Only the sign-in step is skipped — files are still stored per user and deleted after
`FILE_TTL_MINUTES`. The backend refuses to start if `LOCAL_TEST_MODE=true` with any other `ENV`, so it cannot be left on in production.

## Enabling the AI features

The AI code (chat, summarize, Q&A with citations, translate, explain, tool-calling chat) is complete but needs an
OpenAI-compatible provider. Set in `.env`, then restart:

```
AI_ENDPOINT=...   # e.g. https://api.groq.com/openai/v1, https://api.openai.com/v1, http://localhost:11434/v1 (Ollama)
AI_MODEL=...      # a model the provider actually lists; it must support tool calling for the tool-using chat
AI_API_KEY=...    # server only; for Ollama any placeholder value
```

Extract tables to Excel and Compare work without a key. With a cloud provider, extracted document text is sent to that provider;
a local provider (Ollama) keeps it on the machine. After adding a key, `cd backend && .venv/bin/python -m pytest tests/test_ai_live.py`
runs a live check against the real model.

## Run each part manually

```bash
# backend (:8000; OpenAPI at /docs when ENV=development)
cd backend && ./run_dev.sh
#   or: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/uvicorn app.main:app --reload --port 8000

# MCP server (:8001/mcp) — needs MCP_SHARED_SECRET (>= 32 chars) in .env
cd mcp-server && ./run.sh

# frontend (:5173)
cd frontend && npm install && npm run dev
```

## Tests

```bash
# backend + MCP + AI (real files, real processing; needs gs, tesseract, soffice for those tests)
cd backend && .venv/bin/python -m pytest

# frontend unit tests, lint, build
cd frontend && npm test && npm run lint && npm run build

# browser e2e, no backend needed (first time: npx playwright install chromium)
cd frontend && npm run e2e

# full-stack e2e: real backend + MCP + Vite, scripted fake model in place of a real LLM
cd frontend && npm run e2e:full
```

Test fixtures are regenerated with `python tests/fixtures/make_fixtures.py` (from the backend venv).

The AI model call itself is only exercised against a scripted OpenAI-compatible test double unless a real key is provided: `backend/tests/test_ai_live.py` runs one live check when `AI_API_KEY` is in `.env` or `ROOMAN_LIVE_AI_KEY` is set.

## Configuration

All variables are documented in [.env.example](.env.example). Secrets live only in `.env` (git-ignored) and on the server — never in frontend code or logs.

## Licensing

See [LICENSES.md](LICENSES.md) for AGPL/GPL components (PyMuPDF, pdf2docx, Ghostscript, …) that the company must approve.

## Status

See [PROGRESS.md](PROGRESS.md) for what works, what was tested, and what is not done.
