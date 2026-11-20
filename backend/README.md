# Rooman PDF — backend

FastAPI service for the server-side PDF tools (Phase 3). Python 3.11+ (developed on 3.13).

```bash
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp ../.env.example ../.env        # set JWT_SECRET (required when ENV=production)
./run_dev.sh                      # = .venv/bin/uvicorn app.main:app --reload --port 8000
```
Interactive docs: <http://localhost:8000/docs> (only when `ENV=development`).
Tests: `.venv/bin/python -m pytest` (from `backend/`; fixtures are in `../tests/fixtures`, `large.pdf` is generated on demand).

External programs (install on the server; each tool reports `503 EXTERNAL_TOOL_MISSING` if absent — see `GET /api/system/capabilities`):
`gs` Ghostscript (Compress) · `soffice` LibreOffice (Word/Excel/PowerPoint → PDF) · `tesseract` (OCR, Deskew, scanned PDF → Word).
macOS: `brew install ghostscript tesseract && brew install --cask libreoffice`.

## Layout
```
app/main.py            app factory, middleware (CORS, body-size limit, rate limit), cleanup task
app/core/              config (pydantic-settings), security (argon2, JWT), deps, limits (magic bytes), errors, ratelimit
app/routers/           auth, documents, organize, convert, optimize, security_tools, tables, system
app/schemas/           Pydantic v2 request/response models (requests forbid unknown fields)
app/services/          pdf_ops, compress, convert, ocr, protect, watermark, redact, repair, metadata, tables,
                       external (tool detection + safe subprocess), storage (users + documents), operations (Ops)
```
`services/operations.py::Ops(store, user_id)` is the document-level API shared by the routers and the MCP server:
every method takes **document IDs**, resolves them for that user only, and returns an `OpResult(documents, notice, details)`.

## Conventions
* All error bodies: `{"detail": "<human message>", "code": "<MACHINE_CODE>", ...}`. Validation errors: 422 `VALIDATION_ERROR` with `errors[]`.
* Auth: `Authorization: Bearer <token>` from `/api/auth/login|register`. Files are fetched with the same header
  (use `fetch` → Blob in the browser; `download_url` is relative, e.g. `/api/documents/<id>/download`).
* Documents are stored at `STORAGE_DIR/files/<user_id>/<uuid>.<ext>` (server-generated), deleted after `FILE_TTL_MINUTES`.
  Another user's (or an unknown) ID is always `404`.
* Page specs are 1-based strings like `1-3,5,8-10`. Tools never modify the input: they create a new document.
* Every tool response is `ToolResult`: `{"documents":[DocumentInfo], "notice": str|null, "details": {...}}`.
  `DocumentInfo` = `{id, filename, kind, mime, size, pages|null, download_url, created_at, expires_at}`.
  **Show `notice` to the user when present** (OCR fallback, "could not be made smaller", "nothing matched", …).

## Endpoints
All under `/api`. "doc" = `document_id` (32-hex). All except `health`, `system/capabilities`, `auth/register|login` require auth.

| Method & path | Body | Result / notes |
|---|---|---|
| GET `/health` | – | `{status:"ok"}` |
| GET `/system/capabilities` | – | `{programs:{gs,soffice,tesseract:{available,install,label}}, tools:{compress,ocr,deskew,word_to_pdf,…:bool}, ocr_languages:[], limits:{max_upload_mb,file_ttl_minutes}, ai_configured:bool}` |
| POST `/auth/register` | `{email, password(≥8), name?}` | 201 `{access_token, token_type, expires_in, user:{id,email,name}}`; 409 `EMAIL_EXISTS` |
| POST `/auth/login` | `{email, password}` | same as register; 401 `INVALID_CREDENTIALS` |
| GET `/auth/me` | – | `{id,email,name}` |
| POST `/documents` | multipart `file` | 201 `DocumentInfo`. Accepts PDF, DOCX, XLSX, PPTX, JPG, PNG, TXT — type detected from **content** (415 `UNSUPPORTED_FILE`), 413 `FILE_TOO_LARGE` |
| GET `/documents` | – | `[DocumentInfo]` (yours) |
| GET `/documents/{id}` | – | `DocumentInfo` |
| GET `/documents/{id}/download` | – | file bytes with Content-Disposition |
| GET `/documents/{id}/info` | – | `{document_id, pages, encrypted, metadata}` |
| DELETE `/documents/{id}` | – | 204 |
| POST `/organize/merge` | `{document_ids[2..50], filename?}` | 1 PDF |
| POST `/organize/split` | `{document_id, mode: ranges\|every_n\|by_size\|bookmarks, ranges?, every_n?, max_size_mb?, zip?}` | N PDFs (or 1 ZIP when `zip`); `details.parts` |
| POST `/organize/extract-pages` · `/delete-pages` | `{document_id, pages}` | 1 PDF |
| POST `/organize/reorder` | `{document_id, order:[1-based pages]}` | 1 PDF |
| POST `/organize/rotate` | `{document_id, angle:90\|180\|270, pages?}` | 1 PDF |
| POST `/organize/crop` | `{document_id, top,right,bottom,left (pt), pages?}` | 1 PDF |
| POST `/optimize/compress` | `{document_id, level: low\|medium\|high}` | 1 PDF; `details:{before_bytes, after_bytes, saved_percent, smaller}`; if not smaller, original bytes + `notice`. 503 without Ghostscript |
| POST `/optimize/repair` | `{document_id}` | 1 PDF; `notice` says what was fixed |
| POST `/optimize/flatten` | `{document_id}` | 1 PDF; `details:{form_fields, annotations}` |
| POST `/optimize/ocr` | `{document_id, language="eng", force=false}` | searchable PDF (pages that already have text are kept) |
| POST `/optimize/deskew` | `{document_id, language="eng"}` | straightened scanned pages (also searchable) |
| POST `/security/protect` | `{document_id, user_password, owner_password?, allow_print, allow_copy, allow_modify}` | AES-256 PDF |
| POST `/security/unlock` | `{document_id, password}` | 422 `INVALID_PASSWORD` / `PASSWORD_REQUIRED` |
| POST `/security/watermark` | `{document_id, text? \| image_document_id?, opacity, rotation, font_size, color, pages?, layout: center\|tile, image_scale}` | 1 PDF |
| POST `/security/redact` | `{document_id, terms[], patterns[] (regex), areas[{page,x0,y0,x1,y1}] (pt, top-left origin), case_sensitive, scrub_metadata}` | 1 PDF, content truly removed; `details:{redactions,pages}` |
| GET `/security/metadata/{id}` | – | `{title,author,subject,keywords,creator,producer,created,modified,pages,pdf_version,encrypted}` |
| POST `/security/metadata` | `{document_id, title?, author?, subject?, keywords?, creator?, producer?, clear_all?}` (`""` removes a field) | 1 PDF; `details.metadata` |
| POST `/convert/pdf-to-word` | `{document_id}` | DOCX; scans → OCR text document + `notice` (see below) |
| POST `/convert/pdf-to-excel` | `{document_id, pages?}` | XLSX, one sheet per table; 422 `NO_TABLES_FOUND` |
| POST `/convert/pdf-to-powerpoint` | `{document_id, mode: image\|editable}` | PPTX |
| POST `/convert/pdf-to-images` | `{document_id, format: png\|jpg, dpi, pages?}` | ZIP |
| POST `/convert/pdf-to-text` | `{document_id, pages?}` | TXT; 422 `NO_TEXT_FOUND` for scans |
| POST `/convert/word-to-pdf` · `/excel-to-pdf` · `/powerpoint-to-pdf` | `{document_id}` | PDF (LibreOffice); 415 if the file kind is wrong |
| POST `/convert/images-to-pdf` | `{document_ids[], page_size: fit\|a4\|letter, margin_mm, orientation}` | 1 PDF |
| POST `/convert/text-to-pdf` | `{document_id? (TXT upload) \| text?, font_size, page_size}` | 1 PDF |
| POST `/tables/extract` | `{document_id, pages?}` | `{tables:[{page,index,rows:[[str]]}]}` |

Common error codes: `NOT_AUTHENTICATED`/`INVALID_TOKEN` 401 · `NOT_FOUND` 404 · `WRONG_FILE_TYPE` 415 · `PASSWORD_REQUIRED`/`INVALID_PASSWORD`/`INVALID_PDF` 422 ·
`INVALID_PAGES`/`PAGE_OUT_OF_RANGE` 400 · `EXTERNAL_TOOL_MISSING` 503 (`tool` field) · `EXTERNAL_TOOL_TIMEOUT` 504 · `RATE_LIMITED` 429 (+`Retry-After`).

## Behaviour notes
* **PDF → Word**: text PDFs go through pdf2docx (real Word tables, colours, fonts, alignment; no added titles or page markers).
  If *every* page is a scan: OCR runs first and a plain-text Word file is built from the recognised text (layout not preserved) with a `notice`;
  without Tesseract the pages are embedded as images with a `notice`. Mixed documents keep scanned pages as images (`notice`).
  If pdf2docx fails on a file, a plain-text Word file is produced with a `notice`.
* **PDF → PowerPoint**: `image` = each original page rendered full-bleed (exact, not editable); `editable` = page graphics as background with the
  text removed + real text boxes (fonts matched by name).
* **Redaction** uses PyMuPDF `apply_redactions`: matched text, and image pixels under the boxes, are removed from the file (verified by tests); metadata is scrubbed by default.
* Not provided server-side (browser-only in the frontend): resize, N-up, page numbers, headers/footers, Bates numbering, rendering viewer.
* In-process work (pdf2docx, PyMuPDF, pikepdf) has no hard timeout; external programs (Ghostscript, LibreOffice, ocrmypdf) always do.
* Rate limiting and the cleanup task are in-process (single worker). Run behind one uvicorn worker, or move the limiter to a shared store when scaling out.

---

# AI assistant (Phase 4) and MCP tools (Phase 5)

Everything lives under `app/ai/` (`llm.py` OpenAI-compatible client, `textindex.py` extraction + chunking + BM25, `features.py`,
`agent.py` MCP client + tool-calling loop, `streaming.py` SSE) and `app/routers/ai.py`. The MCP server is in `../mcp-server/`.

* The model endpoint is `AI_ENDPOINT` (default `https://api.groq.com/openai/v1`), model `AI_MODEL` (default `qwen/qwen3.8-27b` — set whatever
  your provider calls its model; an unknown id surfaces as `AI_MODEL_NOT_FOUND`), key `AI_API_KEY` (server only).
* **Privacy:** extracted document *text* is sent to `AI_ENDPOINT` for chat/ask/summarize/explain/translate/compare-narrative/AI table cleanup.
  The UI should say so. Text extraction, retrieval, diff, tables→Excel and all PDF tools work without a key and never leave the server.
* Retrieval: page-aware chunks (≈1200 chars, 150 overlap, never crossing a page) + in-house BM25, cached per document; the model receives
  the best chunks within a ~6000-token budget (small documents are sent whole). Summaries of big documents are map-reduced
  (≤60 sections, 3 in parallel, `progress` events). Scanned PDFs (no text layer) → `422 NO_TEXT_LAYER` ("run OCR first").
* Prompt-injection hygiene: document text is always inside `<document_excerpts>` / `<document_text>` tags that the system prompt declares untrusted;
  clients cannot send `system`/`tool` messages; the model only ever names **document IDs**, which are checked against the caller's ownership
  *before* any tool runs (never file paths); `<think>…</think>` output of reasoning models is stripped from the stream.

## Endpoints (all authenticated, Pydantic-validated, extra fields rejected; LLM ones need `AI_API_KEY`)
| Method & path | Body | Result |
|---|---|---|
| GET `/api/ai/status` | – | `{configured, model, tools_available, message}` — never the key |
| POST `/api/ai/chat` | `{messages:[{role:"user"\|"assistant",content}] (≤40, last = user), document_ids?:[≤5], use_tools?:true}` **or** `{confirm:{action_id, approve}}` | **SSE** (below) |
| POST `/api/ai/ask` | `{document_ids:[1..5], question, history?:[…], stream?:true}` | SSE `meta, token*, citation*, done` (or JSON when `stream:false`) |
| POST `/api/ai/summarize` | `{document_id, length?: short\|medium\|long, pages?, language?, stream?}` | SSE `meta, progress*, token*, citation*, done` |
| POST `/api/ai/explain` | `{document_id, page? and/or selection?, question?, language?, stream?}` | SSE `meta, token*, citation*, done` |
| POST `/api/ai/translate` | `{document_id, target_language, pages?, create_document?: none\|docx\|txt, stream?}` (≤100 pages) | SSE `meta, (page, token*)*, done{documents}` |
| POST `/api/ai/compare` | `{document_id_a, document_id_b, narrative?:true, stream?}` | SSE `diff, token*, done` — `narrative:false` needs **no key** |
| POST `/api/ai/extract-tables` | `{document_id, pages?, clean_with_ai?:false}` | JSON `ToolResult` with an `.xlsx` document; `details:{tables, ai_cleaned, preview}` — works with no key unless `clean_with_ai` |

`stream:false` (not for `chat`) returns one JSON object instead of SSE: `{text, citations, documents?, diff?, status}`; errors then use the normal HTTP status + `{detail, code}`.

### Errors
Raised **before** a stream starts (so you get a real HTTP status and `{detail, code}`): `AI_KEY_MISSING` 503 · `NOT_FOUND` 404 (unknown/foreign document id) ·
`NO_TEXT_LAYER` 422 · `VALIDATION_ERROR` 422 · `PAGE_OUT_OF_RANGE` 422 · `TOO_MANY_PAGES` 422 · `AI_ACTION_NOT_FOUND` 404 (confirmation expired/used/not yours) · `RATE_LIMITED` 429.
Raised **during** a stream (delivered as the final `error` event, HTTP status stays 200): `AI_KEY_INVALID` (provider answered 401/403 — show "the server's AI key is invalid; ask the administrator",
do **not** log the user out) · `AI_RATE_LIMITED` · `AI_MODEL_NOT_FOUND` · `AI_UPSTREAM_ERROR` (timeout, unreachable, 5xx) · `MCP_URL_NOT_ALLOWED` · `MCP_UNAVAILABLE` · `AI_INTERNAL_ERROR`.

## SSE protocol
`POST` + `Authorization` header ⇒ use `fetch()` and read `response.body` (not `EventSource`). Frames: `event: <name>\ndata: <json>\n\n`; `: ping` comment lines every 15 s are keep-alives.
**A stream ends with exactly one `done` or one `error`.** Abort the fetch to cancel (the server stops the model call).

| event | data |
|---|---|
| `meta` | chat: `{model, tools_enabled, tools_error\|null, tools:[names], resumed, documents:[{id,label,filename}]}` · ask: `{documents, model}` · summarize: `{model, pages, characters, strategy:"single"\|"map-reduce"}` · translate: `{model, pages, target_language}` |
| `token` | `{text}` — append to the answer (already free of `<think>`) |
| `citation` | `{document_id, label:"D1", page, snippet}` — only pages the model really was shown; emitted after the text, also repeated in `done.citations`. Text carries markers like `[p. 3]` / `[D2 p. 4]` |
| `tool_call` | `{id, name, arguments}` — the model decided to call a tool |
| `tool_result` | `{id, name, ok, message, documents:[{id,filename,kind,size,pages,download_url}], notice, details, verification:{ok,checks[],problems[]}, data?, declined?}` — `ok:false` for validation failures, tool errors, failed verification and declined actions |
| `confirmation_required` | `{action_id, tool, arguments, destructive:true, message, expires_at (epoch s), expires_in}` — show Confirm/Cancel; the stream then ends with `done{status:"awaiting_confirmation", action_id}` |
| `progress` | `{stage:"map", done, total}` (summarize of large documents) |
| `notice` | `{message}` (e.g. very large document truncated) |
| `page` | `{page, index, total}` — translate: which page the following tokens belong to |
| `diff` | compare: `{identical, mode, pages_a, pages_b, similarity, summary:{added_lines,removed_lines,changed_blocks,total_changes}, changes:[{type:"added"\|"removed"\|"changed", a_pages, b_pages, a_text, b_text}], truncated, document_a, document_b}` |
| `done` | `{status:"complete"\|"awaiting_confirmation"\|"max_iterations", citations[], documents[] (every document created in this run, with `download_url`), action_id?, identical?}` |
| `error` | `{code, message, status}` |

### Chat with tools: the confirmation flow
1. `POST /api/ai/chat {messages, document_ids}`. Pass the ids of attached documents **and of documents created earlier** (take them from `done.documents`) so the assistant can refer to them.
2. Safe tools (merge, split, compress, rotate, extract pages/text/tables, convert, watermark, info, search) run immediately: `tool_call` → `tool_result` → … → `token`s → `done`.
3. A **destructive** tool (`delete_pages`, `protect_pdf`, `redact_pdf` — any MCP tool with `destructiveHint=true`) is *not* run. The stream sends `confirmation_required` then `done{status:"awaiting_confirmation"}`.
4. The UI shows `message`/`arguments` and the user decides; then `POST /api/ai/chat {"confirm": {"action_id": "...", "approve": true|false}}` (no `messages`). The server resumes the **same** run (a new SSE stream, `meta.resumed=true`): approved → the tool runs and the loop continues; declined → `tool_result{declined:true}` and the model acknowledges.
   Confirmations are one-shot, tied to the user, expire after `PENDING_ACTION_TTL_SECONDS` (`404 AI_ACTION_NOT_FOUND`) and live in server memory (lost on restart). The model cannot confirm anything itself.
5. Every produced document is re-verified (exists, size, page count, expected page count) before `tool_result.ok` is `true`. Download with `GET <download_url>` + `Authorization`.
If the MCP server is unreachable the chat still works as plain document Q&A (`meta.tools_enabled:false`, reason in `tools_error`).
The loop is capped at `AGENT_MAX_ITERATIONS` model calls (`done.status:"max_iterations"`).

## MCP server (`../mcp-server/`)
* `rooman-pdf-mcp` — official MCP Python SDK (`mcp==1.30.0`, `FastMCP`), **Streamable HTTP** at `http://127.0.0.1:8001/mcp` (stateless, JSON responses).
  The SDK is pinned `<2` because mcp 2.x renamed `FastMCP` to `MCPServer`.
* Accepts only our backend: `Authorization: Bearer <MCP_SHARED_SECRET>` (constant-time compare; 401 missing / 403 wrong) **and** `X-Rooman-User-Token`
  (short-lived JWT signed with the secret, minted per chat request). Each tool call re-verifies that token and runs the real `Ops(store, user_id)` service layer, so
  a user can only touch their own documents. The server refuses to start when `MCP_SHARED_SECRET` is missing or < 32 chars.
* Tools (one file each in `mcp-server/tools/`, auto-discovered — add a file with `register(mcp)` and it exists): `merge_pdfs, split_pdf, compress_pdf, rotate_pdf,
  delete_pages*, extract_pages, extract_text, extract_tables, convert_pdf, add_watermark, protect_pdf*, get_document_info, search_document` + `redact_pdf*` (`*` = destructive ⇒ needs confirmation).
  All take document IDs, validate with Pydantic types, return `{ok, documents:[{id,filename,kind,size,pages,download_url}], notice, details, data}`.
* The agent only connects to `MCP_URL` and only if it is loopback or listed in `MCP_ALLOWED_URLS`. Adding any **external** MCP server needs an explicit decision; private documents are never sent to a server that is not allow-listed.

Run (two processes): `./run_dev.sh` (backend :8000) and `../mcp-server/run.sh` (MCP :8001), both need `MCP_SHARED_SECRET` in the repo-root `.env`.
Tests: `.venv/bin/python -m pytest` — `test_mcp_server.py`, `test_ai_core.py`, `test_ai_endpoints.py`, `test_agent.py` (scripted model), `test_ai_live.py` (skipped without a real key).
