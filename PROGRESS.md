# Rooman PDF — Progress

## Overall status (final verification run)

| Suite | Result |
|---|---|
| Backend + MCP + AI (`cd backend && .venv/bin/python -m pytest`) | 198 passed, 1 skipped (live AI model test: no API key) |
| Frontend unit (`npm test`) | 109 passed |
| Browser e2e, no backend (`npm run e2e`) | 28 passed |
| Full-stack e2e (`npm run e2e:full`, real backend + MCP + Vite) | 31 passed |
| `npm run lint`, `npm run build` | clean |

**UNTESTED: the real LLM call.** No `AI_API_KEY` was available. Chat/tool-calling/summarize etc. were exercised only against a scripted OpenAI-compatible test double (tests are labelled "scripted model (test double)"). Whether `qwen/qwen3.8-27b` exists at the provider, and how a real model chooses tools/cites pages, is unverified.

**Known gaps:** no text-selection layer in the viewer; fixed-width editor text boxes may reflow slightly vs. export; CJK/Arabic/Indic text cannot be added in the editor (no font bundled); server tools accept only .docx/.xlsx/.pptx (no legacy formats); Resize/N-up/page numbers/headers/Bates are browser-only; single-worker assumption for rate limiter, pending confirmations and cleanup; pdf2docx/PyMuPDF/pikepdf run in-process without a hard timeout; OCR language data: English only; `npm audit` reports moderate vulnerabilities (not reviewed). See each phase below for details.

Updated after every phase: what works, what was tested, what is missing.

## Phase 1 — Frontend foundation and browser-side page tools

**Status: done (for the scope below).**

### What works (all real, browser-side, tested)
- Vite + React 19 + TypeScript + Tailwind v4, react-router; pdf.js (worker bundled locally, no CDN) + pdf-lib. Light/dark theme (persisted, follows OS), responsive, keyboard/aria accessible.
- Landing page: drag-and-drop upload (PDF magic bytes validated, not just extension), "what do you want to do?" suggestions, searchable + filterable tool directory (43 tools in the registry: 12 available, 31 planned). Each card says "Runs in your browser" or "Uploads file to server"; unbuilt tools say "Not available yet" and open an honest not-available page.
- Shared PDF viewer (`PdfViewer`): lazy canvas rendering of the ORIGINAL pages, thumbnails sidebar, zoom in/out/fit, rotate view, page navigation, overlay slot for the editor. Reachable via "Preview" in every tool.
- One tool flow (`ToolShell`): upload → options → processing (progress bar, aria-live, cancel) → result (Download, "Edit again", before/after size, related tools that carry the result file over).
- Organize tools: Merge (reorder), Split (ranges / every N / bookmarks / max size, zip output), Extract, Delete, Rotate (all or per page), Reorder (drag + buttons), Crop (visual frame + mm inputs), Resize (A3–Tabloid/custom, fit/fill), N-up (2/4/6/9), Page numbers, Headers/footers ({page} {pages} {date} {filename}), Bates numbering (continuous across files).
- FileStore never hands out its buffer: `getBytes(id)` returns a fresh copy; pdf.js/pdf-lib always get copies.

### Tests run
- `npm test` (Vitest): 5 files, 44 tests passing — range parser, FileStore (copies, simulated detach, real pdf.js reuse), every page operation on real generated PDFs (text verified through pdf.js), rotated-page geometry, bookmarks via real pdf.js outline, size-limit split verified by real sizes, registry integrity, and rotate → extract → page-numbers chain on one stored file.
- `npm run lint` clean, `npm run build` passes (`tsc -b` + vite).
- `npm run e2e` (Playwright / Chromium, real dev server): 16 tests passing — landing/search/dark mode persistence, non-PDF rejection, Merge (reorder, download), Split (ranges → zip, every N), Rotate, Extract (thumbnail ⇄ range sync), Delete, Reorder, Page numbers, Crop/Resize/N-up/Headers/Bates, the viewer (zoom, rotate, page jump, real glyph pixels), and a 3-tool chain on one file with "Edit again" — no console/page errors, no "detached ArrayBuffer".

### Not done / limitations
- Browser-side PDF→JPG/PNG, PDF→text, JPG/PNG→PDF, text→PDF are registered but `planned` (not built yet).
- Edit PDF, Sign, form filling: Phase 2. All server tools and AI tools: later phases (registry entries are `planned`).
- Resize and N-up re-draw pages as embedded page objects, so links/form fields on those pages are not carried over (documented in the UI). Built-in fonts (headers/footers/page numbers/Bates) support Latin text only; other characters give a clear error.
- No text layer (text selection) in the viewer yet.

## Phase 3 — FastAPI backend and server-side tools

**Status: done for the scope below (Phase 3 = backend foundation + server tools; AI chat is Phase 4, MCP is Phase 5).**

### What works (real processing, tested with real files)
- FastAPI app (`backend/app/{core,routers,services,schemas}`), Pydantic v2 validation on every endpoint (unknown fields rejected), pydantic-settings config via `.env` (all variables documented in `.env.example`), OpenAPI/Swagger only when `ENV=development`, CORS only for `CORS_ORIGINS`, in-process rate limiter (general + stricter on auth), request-body size cap, JWT auth (argon2 password hashes, SQLite users).
- Documents: upload with content (magic-byte) sniffing for PDF/DOCX/XLSX/PPTX/JPG/PNG/TXT (a text file named `.pdf` is rejected; Office zips are structure-checked), size limit, server-generated storage paths `files/<user>/<uuid>.<ext>`, owner-only download/delete (other users get 404), automatic TTL cleanup (background task + `cleanup_expired()`), temp dirs removed after every operation.
- External programs are detected (`gs`, `soffice`, `tesseract`), run with argument lists + timeouts, and return `503 EXTERNAL_TOOL_MISSING` with install instructions when absent; `GET /api/system/capabilities` reports availability.
- Tools: merge, split (ranges / every N / max size / bookmarks, optional zip), extract, delete, reorder, rotate, crop; compress low/medium/high (Ghostscript, before/after sizes, honest notice if not smaller); PDF→Word (pdf2docx: real tables, colours, fonts, alignment; scans → OCR + plain text with notice), PDF→Excel (pdfplumber, one sheet per table), PDF→PowerPoint (image or editable mode), PDF→PNG/JPG (zip), PDF→text, Word/Excel/PowerPoint→PDF (LibreOffice headless, isolated profile, 1 retry), JPG/PNG→PDF, text→PDF; OCR, deskew (ocrmypdf + Tesseract), repair, flatten, protect/unlock (AES-256), watermark (text/image, opacity, rotation, tile), true redaction (text/regex/areas), metadata read/edit; table extraction JSON.
- `services/operations.py::Ops` — document-ID-based service API (ownership enforced) reused by routers and the MCP server; also exposes `extract_text`, `search`, `extract_tables`.
- Fixtures (`tests/fixtures/make_fixtures.py`): styled table PDF (5×6), 12-page PDF with bookmarks, image-only scanned PDF, password-protected PDF, entities PDF, DOCX/XLSX/PPTX/JPG/PNG; `large.pdf` (6.6 MB) generated on demand and git-ignored.

### Tests run — `cd backend && .venv/bin/python -m pytest` → **85 passed, 0 skipped** (≈40 s, real Ghostscript 10.08, Tesseract 5.5.4 (eng), LibreOffice 26.8.3)
- PDF→Word on `table.pdf`: unzipped `word/document.xml` has a real `<w:tbl>` with 6 rows × 5 columns and identical cell text; header shading/white text/right alignment/Helvetica+bold kept; no "Page 1" / "Converted Document"; entity text (`R&D <team> & AT&T`) round-trips without double escaping.
- Compression of the 6.6 MB `large.pdf`: all three levels smaller, ordered high < medium ≤ low < original (live run: high 6.66 MB → 0.14 MB).
- Redaction verified gone via pdfplumber, PyMuPDF, and raw content stream bytes; OCR on scanned PDF then pdfplumber finds the words; deskew measurably straightens a 4° skewed scan; repair of a truncated PDF; flatten removes widgets/annotations; protect/unlock round-trip incl. wrong password; ownership isolation; TTL cleanup; upload limits; rate limits; CORS; docs only in dev; shell-free subprocess + timeout.
- Live smoke test with a real `uvicorn` process (register → upload → compress) passed.

### Not done / limitations
- Resize, N-up, page numbers, headers/footers, Bates numbering are browser-only (not on the server).
- pdf2docx/PyMuPDF/pikepdf run in-process (no hard timeout); a mixed scanned+text PDF keeps its scanned pages as images in Word; scanned→Word loses layout (plain OCR text).
- Rate limiter and cleanup task are single-process; no password reset/email verification; no per-user quotas.
- PyMuPDF, Ghostscript (AGPL) and LGPL libs need a company decision — see `LICENSES.md`.
- (AI chat and MCP were completed afterwards — see Phase 4 and Phase 5 below.)

## Phase 4 — AI assistant (backend)

### What works
- `app/ai/`: OpenAI-compatible streaming client (httpx) configured by `AI_ENDPOINT` / `AI_MODEL` / `AI_API_KEY` (defaults `https://api.groq.com/openai/v1`, `qwen/qwen3.8-27b`), key server-side only (never logged, scrubbed from provider errors, never returned; `GET /api/ai/status` only says `configured`).
- Structured errors: `AI_KEY_MISSING` (503, before any streaming), `AI_KEY_INVALID` (provider 401/403), `AI_RATE_LIMITED`, `AI_MODEL_NOT_FOUND`, `AI_UPSTREAM_ERROR`; `NO_TEXT_LAYER` for scanned PDFs.
- Page-tracked text extraction, page-aware chunking with overlap, in-house BM25 with a per-document cache, token-budgeted retrieval (large PDFs work), map-reduce summarisation with progress events.
- Endpoints: `/api/ai/chat` (SSE), `/ask`, `/summarize`, `/explain`, `/translate` (optional .docx/.txt document), `/compare` (real line-level diff attributed to pages + optional AI narrative), `/extract-tables` (pdfplumber → Excel; optional AI cleanup that is validated and rejected if it loses data). Citations `[p. N]` are parsed into structured `citation` events and only pages the model was actually shown are kept.
- Prompt-injection hygiene (document text only inside delimited untrusted-data tags, clients cannot send system/tool messages, model can only name document IDs that are ownership-checked), `<think>` blocks stripped from streams, stricter AI rate limit (`AI_RATE_LIMIT`). Full SSE/HTTP contract for the chat UI: `backend/README.md`.

### Tested
- `tests/test_ai_core.py` (18, no model): extraction by page, chunking/overlap, BM25 ranking, scanned-PDF error, **400-page PDF: index build 0.74 s, query < 1 ms, token budget respected, needle page found**, delimiter-escape of hostile text, think-stripping across chunk boundaries, citation verification, real diff on real PDFs, rate limiter.
- `tests/test_ai_endpoints.py` (42): auth, ownership 404s, strict validation, `AI_KEY_MISSING` for every LLM endpoint, compare/extract-tables **without a key**, ask/summarize (single + map-reduce on 400 pages)/explain/translate (docx + txt created and re-read)/compare/table-cleanup with a scripted model, provider error mapping (401/403/429/500/404-model, unreachable), key never present in responses.

### NOT tested / missing
- **The real model call is UNTESTED** (no API key in this environment). `tests/test_ai_live.py` runs one live smoke test automatically when `AI_API_KEY` is in `.env` (or `ROOMAN_LIVE_AI_KEY`); here it is skipped. The default model id `qwen/qwen3.8-27b` was kept as specified — if the provider does not know it the API answers `AI_MODEL_NOT_FOUND` naming `AI_MODEL`; set the correct id in `.env`.
- Tests marked "scripted model (test double)" use a local fake OpenAI-compatible server: they prove OUR code (prompting, retrieval, SSE, citations, tool loop, error mapping), not model quality. Whether a real Qwen model picks the right tool/arguments, follows the citation format or handles the tool schemas is unverified.
- Pending confirmations are kept in server memory (single worker; lost on restart → `AI_ACTION_NOT_FOUND`). Translation is sequential per page (up to 100 pages/request). No frontend chat UI yet.

## Phase 5 — MCP server and tool-calling agent

### What works
- `mcp-server/` (`rooman-pdf-mcp`): official MCP Python SDK `mcp==1.30.0` (`FastMCP`; pinned `<2`, because mcp 2.x renamed FastMCP to MCPServer), Streamable HTTP at `:8001/mcp`; `./run.sh` or `python -m rooman_pdf_mcp`. Uses the backend virtualenv and imports `app.services.operations.Ops` directly (same storage + DB).
- Accepts only our backend: `Authorization: Bearer MCP_SHARED_SECRET` (constant-time) + per-request signed user token (JWT, audience-bound, short-lived); refuses to start without a ≥32-char secret; every tool call re-verifies the user token and runs as that user (ownership enforced by `Ops`).
- Tools (one file each in `mcp-server/tools/`, auto-discovered): `merge_pdfs, split_pdf, compress_pdf, rotate_pdf, delete_pages, extract_pages, extract_text, extract_tables, convert_pdf, add_watermark, protect_pdf, get_document_info, search_document` (+ extra `redact_pdf`). Pydantic-typed parameters, document IDs only, annotations (`delete_pages`, `protect_pdf`, `redact_pdf` are `destructiveHint=true`).
- Backend agent (`app/ai/agent.py`): official MCP client → tool list → OpenAI function schemas → loop (max `AGENT_MAX_ITERATIONS`): jsonschema validation of arguments, ownership check of every document ID, human confirmation for destructive tools (separate authenticated request, one-shot, per-user, expiring), execution, independent verification of the result (exists, size, page count, expected page count), multi-step chaining via output document IDs, final answer with download links. `MCP_ALLOWED_URLS` allowlist (default: loopback only); no external MCP servers; chat degrades to plain Q&A if MCP is down.

### Tested — `cd backend && .venv/bin/python -m pytest` → **198 passed, 1 skipped** (≈75 s; the skip is the live model test)
- `tests/test_mcp_server.py` (28): a REAL server on a real port + REAL MCP client over Streamable HTTP, real fixtures: every one of the 13 required tools (+ redact) with output verified (page counts, rotation, extracted text, watermark found by PyMuPDF, encrypted file needs the password, Excel cells, docx `<w:tbl>`, ZIP of PNGs, compression really smaller), Pydantic rejections, 401/403 for missing/wrong secret and 5 kinds of bad user token, user B cannot touch user A's documents (every tool), auto-discovery with a dropped-in temp tool file, subprocess start refusing without a secret, subprocess serving real requests.
- `tests/test_agent.py` (25, **scripted model (test double)**): chat → tool call → real MCP → real PDF output → download link; multi-step "extract pages 1-3, then rotate" and "extract pages 1-3, then compress" (second step consumes the first step's output id); destructive action waits (nothing created), is executed only after confirmation, declined never runs, one-shot, other user's confirmation refused, expiry; password masked in the confirmation; clarification flow; missing/invalid parameters bounced to the model without calling the tool; invented/foreign/path-like document IDs rejected; tool failures reported; unknown tool name; iteration cap; verification catching wrong page counts/missing documents; MCP down / wrong secret / non-allow-listed URL; injection text stays inside data delimiters.

### NOT tested / missing
- No real model drove the loop (see above): tool-selection quality of the real model is unverified. No frontend chat UI yet (contract in `backend/README.md`).
- MCP sessions are stateless (a new MCP connection per chat request). Pending confirmations and the AI/auth rate limiters are in-process (single worker).
- `compress` multi-step test needs Ghostscript (present here); on a machine without it that test is skipped with an explicit "UNTESTED" reason.


## Phase 2 — PDF editor (browser-side)

**Status: done for the scope below.** Routes: `/edit` (Edit PDF), `/fill-form`, `/sign-pdf`.

### What works (real, tested in Chromium + node)
- Original pages are rendered by pdf.js from the original file; every edit lives on an overlay layer in page space (points, top-left origin, `/Rotate` and crop-box aware, zoom independent). Thumbnails, zoom, page navigation come from the shared `PdfViewer`.
- Tools: select/move/resize (handles, line end-points, arrow-key nudge, Delete, Ctrl+D/C/V, bring front/back), text (click or drag a width; in-place editing; Helvetica/Times/Courier, size, colour, bold/italic, alignment), whiteout, rectangle, ellipse, line, arrow, highlight / underline / strike-through (text-aware: snap to the text lines the drag touches, rectangle fallback on empty areas), freehand draw (smoothed), images (PNG/JPG, webp/gif converted), links (URL or page; real Link annotations), signature (draw / type with bundled OFL handwriting fonts / upload; placed and resized; optionally remembered in localStorage), form-field creation (text, checkbox, radio group, dropdown — real AcroForm fields), form filling of the PDF's existing fields (inputs over the widgets; flatten option).
- Undo/redo (Ctrl/Cmd+Z, Shift+Z / Y; drags and property edits collapse into one step), unsaved-changes guard (beforeunload + confirm on in-app links), keyboard-focusable object stand-ins, light/dark, narrow-screen toolbar wrap.
- Export (`src/editor/export.ts`) applies the edits to the ORIGINAL bytes with pdf-lib: original content streams are kept byte-for-byte (pdf-lib wraps them in `q … Q`), edits are appended; highlight/underline/strike are real annotations with appearance streams and QuadPoints; links are real annotations. Unicode text (Latin-ext, Greek, Cyrillic, Vietnamese…) is embedded with a bundled Noto Sans (OFL); characters it cannot draw (CJK, Arabic…) give a clear error instead of a broken file.
- Result page is the shared one (Download, "Edit again" returns to the editor with all edits and form values still there, related tools carry the file over). `edit-pdf` was added to the related tools of the page tools so the chain Rotate → Edit → Sign works.

### Tests run
- `npm test`: 7 files, 79 tests passing (35 new for the editor): geometry vs real pdf.js viewport for /Rotate 0/90/180/270 with an offset crop box; every object type exported on real PDFs and verified by pdf.js extraction and PIXEL comparison (page identical outside the edit boxes; whiteout really hides text; filled shapes/images have the right colour); original content streams unchanged; Highlight/Underline/StrikeOut annotations (QuadPoints + AP); link URI and rectangle; rotated/cropped pages; Unicode embedding and the unsupported-character error; wrapping; form detection with widget rectangles, filling (text/checkbox/radio/dropdown read back), flatten, creating fields, name-clash handling; undo/redo reducer, history cap, hit-testing, resize math, smoothing.
- `npm run e2e`: 28 tests passing (16 from Phase 1 + 12 new): full edit flow (text, rectangle move/resize/undo/redo, whiteout, highlight, draw, image, typed signature, link) → export → verified with pdf-lib/pdf.js/pixels → "Edit again" keeps all 8 objects; keyboard + unsaved-changes dialog; mark tools; Unicode export in the browser; CJK error; invalid link; drawn signature (placed, resized, remembered); form filling on a real AcroForm (+ flatten); creating fields; Rotate(180°) → Edit → Sign on one uploaded file with no "detached ArrayBuffer" error and the rotation/text/signature all in the final file; light/dark/mobile screenshots (`frontend/e2e/screenshots/editor-*.png`).
- `npm run lint`, `npm run build` clean.

### Not done / limitations
- The view-rotate buttons are hidden in the editor (edit pages as stored; the page's own /Rotate is fully supported).
- Fields created in the editor are empty placeholders (default value only); they are fillable in the exported PDF, not inside the editor. Radio-button option values of existing groups are matched to widgets by order.
- Existing form widgets are drawn as inputs, so button / signature widgets are not visible in the editor (they are untouched in the output). pdf.js text selection layer: none.
- Text wrapping in fixed-width text boxes may reflow by a word versus the screen (browser vs PDF font metrics); auto-width boxes never wrap. CJK / Arabic / Indic text cannot be added (no bundled font).
- Visual signature only (an image) — not a certificate-based digital signature.
- Large chunk: the editor chunk is ~790 kB (pdf-lib + fontkit), lazy-loaded only on the editor routes; bundled fonts add ~2.5 MB of static assets (Noto Sans OFL, `src/assets/fonts/OFL-NotoSans.txt`) loaded only when Unicode text is exported. `@fontsource/{dancing-script,caveat,homemade-apple}` (OFL) are used for typed signatures. Add these to LICENSES.md (no AGPL/GPL added by this phase).

## Phase 3/4/5 frontend integration — server tools, auth, AI chat

**Works (tested in a real browser against the real backend, MCP server and Vite):**
- **Auth:** sign-in / create-account dialog, JWT kept in memory + `sessionStorage` (survives reload, cleared when the tab closes; tradeoff documented in `src/lib/auth.ts`), Bearer header on every call, a 401 signs the user out and reopens the dialog, user menu + sign out. Server tools show "Sign in to use server tools" and disable Run until signed in.
- **Server notice:** every server tool shows "uploads your file to our server … deleted automatically after N minutes" (N read from `/api/system/capabilities`); browser tools say "Your files stay on this device" and never call the backend (tested: zero `/api` requests).
- **Missing programs:** capabilities drive a blocking "X is not installed on the server — install: …" message; a 503 `EXTERNAL_TOOL_MISSING` from the API shows the backend's install hint.
- **Server tool pages (all through the one ToolShell flow, real upload progress, result page, Download, Edit again, related tools; PDF results go into the FileStore so they chain into browser tools):** Compress (low/medium/high, before/after + saved %, honest "could not be made smaller"), PDF→Word (shows the scanned/OCR `notice`), PDF→Excel, PDF→PowerPoint (image/editable), PDF→JPG, PDF→PNG, PDF→text, Word/Excel/PowerPoint→PDF (.docx/.xlsx/.pptx only — the backend accepts no legacy formats), JPG/PNG→PDF, Text→PDF, OCR, Repair, Flatten, Deskew, Protect, Unlock, Watermark (text/image), Metadata (view + edit). The old "planned" browser versions of PDF→JPG/PNG/text and image/text→PDF were replaced by the server versions (honest `runsIn: 'server'`).
- **AI:** `/ai-chat` (upload → chat) with fetch-based SSE streaming, safe markdown (no `dangerouslySetInnerHTML`), clickable `[p. N]` chips that scroll the side PDF viewer, tool-call cards with verification, confirm/cancel UI for destructive actions, authenticated download links; Summarize, Ask questions, Explain, Translate (+ .docx/.txt), Compare (real server diff view; AI narrative optional), Extract tables → Excel (works without a key). Clear UI errors for `AI_KEY_MISSING`, `AI_KEY_INVALID`, rate limit, model-not-found; a privacy notice says extracted text goes to the configured AI provider.

**Tests (real output):**
- `npm test`: **109 passed** (11 files) — includes SSE parser (every possible split point, 1-byte chunks, CRLF, a UTF-8 character split across chunks, error events, `streamSse` over a stubbed fetch), api-client error mapping + 401 handling, auth store, markdown/citation parsing, chat + feature stream reducers. Writing the CRLF test found and fixed a real parser bug (a chunk ending between `\r` and `\n`).
- `npm run e2e:full` (new, `playwright.fullstack.config.ts`; starts real uvicorn backends, the real MCP server, a scripted-model double and two Vite servers): **30 passed** (main project 26 + no-key project 4). Highlights: Compress `large.pdf` 6,660,888 → 137,386 bytes with the sizes shown in the UI; PDF→Word on `table.pdf` has a real `<w:tbl>` with 6 rows × 5 columns and no "Page 1"/"Converted Document"; PDF→Excel cells; Word→PDF via LibreOffice (text verified with pdf.js); OCR of `scanned.pdf` makes INVOICE/TOTAL/AMOUNT searchable; Protect → Unlock round trip incl. wrong password; Metadata edit; watermark; images→PDF; browser Merge → server Compress on the same file with no detached-buffer error; register/login/logout/401 flow; the missing-program message.
- AI e2e tests are all labelled **"scripted model (test double)"**: chat with citation click, "extract pages 1-3, then compress it" through two real MCP tools producing a downloadable 3-page smaller PDF, destructive `delete_pages` confirm and cancel, Summarize, Ask, Translate→docx, Explain, Compare. A separate backend started **without** `AI_API_KEY` proves the `AI_KEY_MISSING` UI error and that Extract-tables and Compare (narrative off) work without a key.
- `npm run e2e` (browser-only specs, no backend): the two assertions that assumed "Compress is planned" were updated (all 45 tools are now available); all other Phase 1/2 specs unchanged.
- `npm run lint`, `npm run build`: clean.

**Untested / partial / missing:**
- **The real AI model is still untested** (no `AI_API_KEY` here): everything is verified against the scripted double, so citation format and tool choice by a real Qwen model are unproven.
- The "program missing" message is tested with a simulated capabilities response (the three programs are installed on this machine), the 503 mapping itself is a unit test.
- Chat accepts one PDF (the Ask page accepts up to 5); no conversation persistence (history lives in the tab). Pending confirmations live in server memory (backend limitation).
- Server tools for Resize, N-up, page numbers, headers/footers and Bates do not exist (browser-only by design).

## Local test mode (added 2026-11-15)

- `LOCAL_TEST_MODE=true` (only with `ENV=development`): server tools work without sign-in via `POST /api/auth/local-session`
  (fixed local user, normal JWT, so ownership checks, per-user storage and MCP user tokens are unchanged). Returns 404 when off;
  the backend refuses to start with the flag on outside development. Header shows a "Local test mode" badge.
- Browser-only tool pages still make no backend calls (the capabilities/session request happens only on server-tool and AI pages).
- Tested: backend `tests/test_local_test_mode.py` (3: working token + real tool call, off by default → 404, refused outside development);
  frontend `src/lib/localSession.test.ts` (3); full-stack e2e pins `LOCAL_TEST_MODE=false` so real sign-in stays covered;
  manual browser run against the live app: Compress and PDF→Word with no sign-in, results downloaded.
- AI: still unconfigured (no provider chosen yet). See README "Enabling the AI features".

## Sign-in / sign-up pages (added 2026-11-15)

- Full pages at `/login` and `/signup` (plus the existing in-tool sign-in dialog, now sharing one `AuthForm` component).
  Header "Sign in" opens `/login?next=<current page>` and returns there after success; only same-app paths are accepted as `next`
  (no open redirect). Show/hide password toggle, duplicate-email and wrong-password errors, "already signed in" state.
- Tested: full-stack e2e `auth.spec.ts` (new page-flow test + existing dialog test) and screenshots in light, dark and 390px width.
- `.env` for demos: `LOCAL_TEST_MODE=false` so sign-in is shown.
