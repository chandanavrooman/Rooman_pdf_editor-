# Rooman PDF — Test report

**Date:** 2026-11-15 · **Scope:** every available tool in the app, run through the real UI on every relevant kind of document,
with each downloaded output verified (page counts, rotation, page sizes, text via pdf.js, .docx/.xlsx/.pptx/zip contents,
image signatures, file sizes) — not just "a file came back".

## Summary

| Suite | Command | Result |
|---|---|---|
| Feature × document matrix (real browser, full stack) | `npm run e2e:full` (includes `e2e/fullstack/matrix.spec.ts`) | **340 cells: 293 ✅ pass · 47 ⚠️ clear, expected error · 0 ❌ failing** |
| Full-stack e2e total (matrix + auth, server tools, AI, no-key) | `cd frontend && npm run e2e:full` | **372 passed** (14.7 min) |
| Backend + MCP + AI (pytest, real files) | `cd backend && .venv/bin/python -m pytest` | **206 passed, 1 skipped** (skip = live AI model, no key) |
| Frontend unit (vitest) | `cd frontend && npm test` | **115 passed** (12 files) |
| Lint / build | `npm run lint`, `npm run build` | clean |

⚠️ = the app correctly refuses with a clear message (e.g. "No tables were found in this PDF", deleting the only page,
a password-protected file, a file over the upload limit). These are the intended behaviour, listed with the exact message below.

**Not tested: the real AI model.** No `AI_API_KEY` is configured. Every AI cell runs against a scripted OpenAI-compatible
test double (`e2e/fullstack/fakeLlm.mjs`); everything after the model (SSE streaming, citations, MCP tool calls,
confirmations, PDF processing, downloads) is real. Whether a real model picks the right tools and cites pages correctly is unverified.

## Environment

macOS 26.0 · Python 3.13.3 · Node v26.8.2 · Playwright 1.65.1 (Chromium) · Ghostscript 10.08.0 · Tesseract 5.5.4 (eng only) ·
LibreOffice 25.2.3 · PyMuPDF 1.26.7 · pikepdf 10.18.1 · ocrmypdf 17.14.1

## Test documents (`tests/fixtures`, built by `make_fixtures.py`)

| Document | What makes it tricky |
|---|---|
| table.pdf | styled table (coloured header, 6×5) |
| multipage.pdf | 12 pages, bookmarks, unique text per page |
| scanned.pdf | image-only pages, no text layer |
| mixed.pdf | A4 / Letter / A4 landscape / small pages, a page with `/Rotate 90`, an embedded image, a link annotation |
| unicode.pdf | accented Latin, Greek, Cyrillic in an embedded TrueType font |
| forms.pdf | AcroForm: filled text field, checked checkbox, radio group, dropdown |
| images.pdf | photo-like pages (JPEG) |
| single.pdf | one page |
| large.pdf | 6.4 MB, high-resolution images (generated on demand, git-ignored) |
| protected.pdf | user password (AES-256) |
| owner-only.pdf | opens without a password but has an owner password and restrictions |
| corrupted.pdf | every cross-reference offset and `startxref` wrong |
| fake.pdf | a text file named .pdf |
| sample.docx / .xlsx / .pptx / .jpg / .png / .txt | inputs for the "to PDF" tools (.txt includes `& < >` and accents) |

## Matrix: tools × PDF documents

✅ pass · ⚠️ clear, expected error · ❌ failing · – not run for that document (heavy tools are run on `large` where it matters)

| Tool | table | multipage | scanned | mixed | unicode | forms | images | single | large |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| merge-pdf | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| split-pdf | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| extract-pages | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| rotate-pdf (all +90°) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| delete-pages | ⚠️ | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ | – |
| reorder-pages | ⚠️ | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ | – |
| crop-pdf (default margins) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | – |
| resize-pages (to Letter) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | – |
| n-up (4 per sheet) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | – |
| add-page-numbers (start 101) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | – |
| headers-footers ({page}/{pages}) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | – |
| bates-numbering (prefix BAT start 7) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | – |
| split-pdf (ranges 1-3,5,8-) | – | ✅ | – | – | – | – | – | – | – |
| split-pdf (by bookmarks) | – | ✅ | – | – | – | – | – | – | – |
| split-pdf (max 2 MB per file) | – | – | – | – | – | – | – | – | ✅ |
| pdf-to-word | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| pdf-to-excel | ✅ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | – |
| pdf-to-powerpoint (image) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | – |
| pdf-to-powerpoint (editable) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | – |
| pdf-to-png (150 dpi) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | – |
| pdf-to-text | ✅ | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | ✅ | – |
| pdf-to-jpg (150 dpi) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| compress-pdf (medium) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| compress-pdf (low) | – | – | – | – | – | – | ✅ | – | ✅ |
| compress-pdf (high) | – | – | – | – | – | – | ✅ | – | ✅ |
| repair-pdf | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | – |
| flatten-pdf | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | – |
| deskew-pdf | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | – |
| ocr-pdf (English) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| protect-pdf → unlock-pdf (round trip) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| watermark-pdf (text) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| watermark-pdf (image) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | – |
| metadata-pdf (edit title/author) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | – |
| extract-tables (no AI) | ✅ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | – |
| edit-pdf (all object types) | – | – | – | ✅ | ✅ | ✅ | – | – | – |
| sign-pdf (draw signature) | – | – | – | – | ✅ | – | – | – | – |
| sign-pdf (upload signature image) | – | – | – | ✅ | – | – | – | – | – |
| sign-pdf (typed signature) | – | – | – | – | – | ✅ | – | – | – |
| edit-pdf (add form fields) | – | – | – | ✅ | – | – | – | – | – |
| fill-form (fill existing fields) | – | – | – | – | – | ✅ | – | – | – |
| summarize-pdf (scripted model (test double)) | ✅ | ✅ | – | – | ✅ | – | – | – | – |
| ask-pdf (scripted model (test double)) | ✅ | ✅ | – | – | ✅ | – | – | – | – |
| translate-pdf (scripted model (test double)) | ✅ | ✅ | – | – | ✅ | – | – | – | – |
| explain-pdf (scripted model (test double)) | ✅ | ✅ | – | – | ✅ | – | – | – | – |
| chat-pdf (question with citations (test double)) | ✅ | ✅ | – | – | ✅ | – | – | – | – |
| chain (6 tools) (rotate→crop→compress→split→edit→protect) | – | ✅ | – | – | – | – | – | – | – |

## Other inputs, chat → MCP tools, negative cases

| Tool | Input | Variant | Result | Details |
|---|---|---|---|---|
| word-to-pdf | sample.docx |  | ✅ pass |  |
| excel-to-pdf | sample.xlsx |  | ✅ pass |  |
| powerpoint-to-pdf | sample.pptx |  | ✅ pass |  |
| jpg-to-pdf | sample.jpg |  | ✅ pass |  |
| png-to-pdf | sample.png |  | ✅ pass |  |
| jpg-to-pdf | sample.jpg + sample.png |  | ✅ pass |  |
| text-to-pdf | sample.txt |  | ✅ pass |  |
| repair-pdf | corrupted | broken xref | ✅ pass |  |
| compare-pdf | table vs single | real diff + scripted summary | ✅ pass |  |
| compare-pdf | multipage vs single | real diff + scripted summary | ✅ pass |  |
| compare-pdf | unicode vs single | real diff + scripted summary | ✅ pass |  |
| chat:merge_pdfs | multipage | via MCP (test double model) | ✅ pass |  |
| chat:split_pdf | multipage | via MCP (test double model) | ✅ pass |  |
| chat:compress_pdf | images | via MCP (test double model) | ✅ pass |  |
| chat:rotate_pdf | multipage | via MCP (test double model) | ✅ pass |  |
| chat:delete_pages | multipage | via MCP (test double model) | ✅ pass |  |
| chat:extract_pages | multipage | via MCP (test double model) | ✅ pass |  |
| chat:extract_text | unicode | via MCP (test double model) | ✅ pass |  |
| chat:extract_tables | table | via MCP (test double model) | ✅ pass |  |
| chat:convert_pdf | table | via MCP (test double model) | ✅ pass |  |
| chat:add_watermark | mixed | via MCP (test double model) | ✅ pass |  |
| chat:protect_pdf | single | via MCP (test double model) | ✅ pass |  |
| chat:get_document_info | mixed | via MCP (test double model) | ✅ pass |  |
| chat:search_document | multipage | via MCP (test double model) | ✅ pass |  |
| rotate-pdf | protected | password-protected | ⚠️ clear error (expected) | This PDF is password-protected. Unlock it first with the Unlock PDF tool. |
| extract-pages | protected | password-protected | ⚠️ clear error (expected) | This PDF is password-protected. Unlock it first with the Unlock PDF tool. |
| n-up | protected | password-protected | ⚠️ clear error (expected) | This PDF is password-protected. Unlock it first with the Unlock PDF tool. |
| add-page-numbers | protected | password-protected | ⚠️ clear error (expected) | This PDF is password-protected. Unlock it first with the Unlock PDF tool. |
| merge-pdf | protected + single | password-protected | ⚠️ clear error (expected) | This PDF is password-protected. Unlock it first with the Unlock PDF tool. |
| edit-pdf | protected | password-protected | ⚠️ clear error (expected) | Could not display this PDF: This PDF is password protected. Unlock it first with the Unlock PDF tool. |
| compress-pdf | protected | password-protected (UI + API) | ⚠️ clear error (expected) | UI: Run disabled + "unlock it first"; API 422 PASSWORD_REQUIRED: This PDF is password protected. Unlock it first. |
| pdf-to-word | protected | password-protected (UI + API) | ⚠️ clear error (expected) | UI: Run disabled + "unlock it first"; API 422 PASSWORD_REQUIRED: This PDF is password protected. Unlock it first. |
| watermark-pdf | protected | password-protected (UI + API) | ⚠️ clear error (expected) | UI: Run disabled + "unlock it first"; API 422 PASSWORD_REQUIRED: This PDF is password protected. Unlock it first. |
| ocr-pdf | protected | password-protected (UI + API) | ⚠️ clear error (expected) | UI: Run disabled + "unlock it first"; API 422 PASSWORD_REQUIRED: This PDF is password protected. Unlock it first. |
| pdf-to-text | protected | password-protected (UI + API) | ⚠️ clear error (expected) | UI: Run disabled + "unlock it first"; API 422 PASSWORD_REQUIRED: This PDF is password protected. Unlock it first. |
| metadata-pdf | protected | password-protected (UI + API) | ⚠️ clear error (expected) | UI: Run disabled + "unlock it first"; API 422 PASSWORD_REQUIRED: This PDF is password protected. Unlock it first. |
| unlock-pdf | protected | correct password | ✅ pass |  |
| unlock-pdf | protected | wrong password | ⚠️ clear error (expected) | Wrong password. |
| rotate-pdf | owner-only | owner password only | ⚠️ clear error (expected) | The PDF is password-protected or has editing restrictions. Unlock it first with the Unlock PDF tool. |
| compress-pdf | owner-only | owner password only | ✅ pass |  |
| unlock-pdf | owner-only | no password needed | ✅ pass |  |
| rotate-pdf | corrupted | broken xref | ✅ pass | browser tools read this damaged file directly (pdf-lib recovers objects without the xref) |
| compress-pdf | corrupted | broken xref | ✅ pass |  |
| pdf-to-word | corrupted | broken xref | ✅ pass |  |
| rotate-pdf | fake.pdf | not a PDF | ⚠️ clear error (expected) | "fake.pdf" is not a valid PDF (missing %PDF header). |
| compress-pdf | fake.pdf | not a PDF | ⚠️ clear error (expected) | "fake.pdf" is not a valid PDF (missing %PDF header). |
| edit | fake.pdf | not a PDF | ⚠️ clear error (expected) | "fake.pdf" is not a valid PDF (missing %PDF header). |
| api: POST /api/documents | fake.pdf | server magic-byte check | ⚠️ clear error (expected) | 415 UNSUPPORTED_FILE: Unsupported or corrupted file. Upload a PDF, Word, Excel, PowerPoint, JPG, PNG or TXT file. |
| word-to-pdf | sample.xlsx | wrong extension | ⚠️ clear error (expected) | "sample.xlsx" is not a supported .docx Word file. |
| word-to-pdf | png renamed .docx | content does not match | ⚠️ clear error (expected) | This tool needs a DOCX file, but 'picture.docx' is a PNG |
| compress-pdf | large (6.4 MB) vs 5 MB limit | upload limit | ⚠️ clear error (expected) | This file is 6.4 MB — larger than the server's 5 MB upload limit. Split it into smaller parts first (Split PDF runs in your browser). · API through proxy: 413 T |
| extract-pages | multipage | invalid ranges | ⚠️ clear error (expected) | out-of-range / malformed / empty selections are refused before running |
| delete-pages | multipage | delete every page | ⚠️ clear error (expected) | You cannot delete every page — at least one page must remain. |
| split-pdf | multipage | malformed ranges | ⚠️ clear error (expected) | malformed / out-of-range split ranges are refused before running |
| watermark-pdf | multipage | pages out of range | ⚠️ clear error (expected) | Page range '99' is outside 1-12 |
| pdf-to-text | multipage | pages out of range | ⚠️ clear error (expected) | Page range '50' is outside 1-12 |

Total cells:340 — ✅ 293 pass · ⚠️ 47 clear expected error · ❌ 0 failing · ⏭ 0 skipped

## Bugs found by the matrix and fixed

All fixes have regression tests.

1. **PDF → Word lost all text on rotated / sideways pages** (content loss). pdf2docx only keeps horizontal text, so a page with
   `/Rotate` (or text running sideways) came out empty. Pages are now normalised first (rotation baked in with PyMuPDF
   `remove_rotation`, sideways text turned horizontal) and the user gets a notice naming any turned pages.
   Fix: `backend/app/services/convert.py` (`_upright_copy`). Tests: `backend/tests/test_convert.py::test_pdf_to_word_keeps_text_of_rotated_pages`,
   `::test_pdf_to_word_landscape_stored_as_rotated_portrait`.
2. **Password-protected PDFs in browser tools gave the wrong advice.** pdf-lib's `EncryptedPDFError` fails `instanceof`
   (ES5 build), so locked files got "could not be read … Try the Repair PDF tool"; Rotate/Extract/etc. just greyed out with no
   explanation. Now the file row says "This PDF is password-protected. Unlock it first with the Unlock PDF tool", Run is
   blocked (except on Unlock PDF), and owner-password-only files get "password-protected or has editing restrictions".
   Fix: `frontend/src/lib/pdfOps/common.ts` (`isEncryptedPdfError`), `frontend/src/components/ToolShell.tsx`, `frontend/src/editor/export.ts`.
   Tests: `frontend/src/lib/pdfOps/ops.test.ts` (real encrypted fixtures), matrix negative cases.
   (The old unit test named "rejects an encrypted file" actually used garbage bytes — renamed.)
3. **Compress on a password-protected PDF "succeeded"** with "already well optimised — original returned", hiding that the file
   was locked. The service now opens the file first and returns `422 PASSWORD_REQUIRED`.
   Fix: `backend/app/services/compress.py`. Tests: `backend/tests/test_optimize.py::test_compress_password_protected_is_a_clear_error`,
   `::test_compress_owner_password_only_still_works`.
4. **Uploading a file over the size limit showed "The server had a problem (HTTP 502)".** The backend answered 413 before
   reading the body, so the proxy saw a reset connection. Now (a) server tools flag the file before anything is sent
   ("This file is 6.4 MB — larger than the server's 5 MB upload limit…", limit taken from `/api/system/capabilities`), the
   upload client refuses it too, and (b) the backend drains the body (bounded) and returns a JSON 413 that arrives intact
   through the proxy. Fix: `frontend/src/lib/apiClient.ts`, `frontend/src/components/ToolShell.tsx`, `backend/app/core/limits.py`.
   Test: matrix "upload limit" cell (UI + a real request through the Vite proxy).
5. **AI answers showed clickable citation chips for pages that don't exist** (e.g. "p. 2" in a 1-page PDF). Citations are now
   only chips when the page exists in the cited document; others render as plain text.
   Fix: `frontend/src/ai/Markdown.tsx`, `ChatPage.tsx`, `AiTools.tsx`. Test: `frontend/src/ai/ai.test.ts`.

## Known limitations (working as designed, documented honestly)

- **Real AI model untested** (no key) — see above.
- **Owner-password-only** files must go through Unlock PDF (no password needed) before browser tools can change them; server tools work directly.
- PDF→Word on fully scanned files produces OCR'd plain text (layout not kept; the notice says so).
- Pages with sideways text are turned upright in the Word output (notice names them).
- OCR language data: English only on this machine.
- Delete-all-pages is refused when you press Run (clear message), not by disabling the button beforehand.

## How to run

```bash
cd backend && .venv/bin/python -m pytest                     # backend, MCP, AI (real files)
cd frontend && npm test && npm run lint && npm run build    # unit, lint, build
cd frontend && npm run e2e:full                             # full stack incl. the matrix (starts its own servers)

# only the matrix, with the table above regenerated from the results:
cd frontend && PLAYWRIGHT_JSON_OUTPUT_NAME=e2e/.tmp/matrix.json \
  npx playwright test -c playwright.fullstack.config.ts e2e/fullstack/matrix.spec.ts --reporter=list,json
node e2e/fullstack/matrixReport.mjs e2e/.tmp/matrix.json --grid
```

<details><summary>Every matrix cell with details (340 rows)</summary>

| Tool | Document | Variant | Result | Details |
|---|---|---|---|---|
| merge-pdf | table |  | ✅ pass |  |
| split-pdf | table | range 1 | ✅ pass |  |
| extract-pages | table |  | ✅ pass |  |
| rotate-pdf | table | all +90° | ✅ pass |  |
| merge-pdf | multipage |  | ✅ pass |  |
| split-pdf | multipage | every 1 page | ✅ pass |  |
| extract-pages | multipage |  | ✅ pass |  |
| rotate-pdf | multipage | all +90° | ✅ pass |  |
| merge-pdf | scanned |  | ✅ pass |  |
| split-pdf | scanned | every 1 page | ✅ pass |  |
| extract-pages | scanned |  | ✅ pass |  |
| rotate-pdf | scanned | all +90° | ✅ pass |  |
| merge-pdf | mixed |  | ✅ pass |  |
| split-pdf | mixed | every 1 page | ✅ pass |  |
| extract-pages | mixed |  | ✅ pass |  |
| rotate-pdf | mixed | all +90° | ✅ pass |  |
| merge-pdf | unicode |  | ✅ pass |  |
| split-pdf | unicode | every 1 page | ✅ pass |  |
| extract-pages | unicode |  | ✅ pass |  |
| rotate-pdf | unicode | all +90° | ✅ pass |  |
| merge-pdf | forms |  | ✅ pass |  |
| split-pdf | forms | range 1 | ✅ pass |  |
| extract-pages | forms |  | ✅ pass |  |
| rotate-pdf | forms | all +90° | ✅ pass |  |
| merge-pdf | images |  | ✅ pass |  |
| split-pdf | images | every 1 page | ✅ pass |  |
| extract-pages | images |  | ✅ pass |  |
| rotate-pdf | images | all +90° | ✅ pass |  |
| merge-pdf | single |  | ✅ pass |  |
| split-pdf | single | range 1 | ✅ pass |  |
| extract-pages | single |  | ✅ pass |  |
| rotate-pdf | single | all +90° | ✅ pass |  |
| merge-pdf | large |  | ✅ pass |  |
| split-pdf | large | every 1 page | ✅ pass |  |
| extract-pages | large |  | ✅ pass |  |
| rotate-pdf | large | all +90° | ✅ pass |  |
| delete-pages | table | only page | ⚠️ clear error (expected) | You cannot delete every page — at least one page must remain. |
| reorder-pages | table | single page | ⚠️ clear error (expected) | single page: nothing to reorder (Run stays disabled) |
| crop-pdf | table | default margins | ✅ pass |  |
| resize-pages | table | to Letter | ✅ pass |  |
| n-up | table | 4 per sheet | ✅ pass |  |
| add-page-numbers | table | start 101 | ✅ pass |  |
| headers-footers | table | {page}/{pages} | ✅ pass |  |
| bates-numbering | table | prefix BAT start 7 | ✅ pass |  |
| delete-pages | multipage | page 1 | ✅ pass |  |
| reorder-pages | multipage | move page 2 first | ✅ pass |  |
| crop-pdf | multipage | default margins | ✅ pass |  |
| resize-pages | multipage | to Letter | ✅ pass |  |
| n-up | multipage | 4 per sheet | ✅ pass |  |
| add-page-numbers | multipage | start 101 | ✅ pass |  |
| headers-footers | multipage | {page}/{pages} | ✅ pass |  |
| bates-numbering | multipage | prefix BAT start 7 | ✅ pass |  |
| delete-pages | scanned | page 1 | ✅ pass |  |
| reorder-pages | scanned | move page 2 first | ✅ pass |  |
| crop-pdf | scanned | default margins | ✅ pass |  |
| resize-pages | scanned | to Letter | ✅ pass |  |
| n-up | scanned | 4 per sheet | ✅ pass |  |
| add-page-numbers | scanned | start 101 | ✅ pass |  |
| headers-footers | scanned | {page}/{pages} | ✅ pass |  |
| bates-numbering | scanned | prefix BAT start 7 | ✅ pass |  |
| delete-pages | mixed | page 1 | ✅ pass |  |
| reorder-pages | mixed | move page 2 first | ✅ pass |  |
| crop-pdf | mixed | default margins | ✅ pass |  |
| resize-pages | mixed | to Letter | ✅ pass |  |
| n-up | mixed | 4 per sheet | ✅ pass |  |
| add-page-numbers | mixed | start 101 | ✅ pass |  |
| headers-footers | mixed | {page}/{pages} | ✅ pass |  |
| bates-numbering | mixed | prefix BAT start 7 | ✅ pass |  |
| delete-pages | unicode | page 1 | ✅ pass |  |
| reorder-pages | unicode | move page 2 first | ✅ pass |  |
| crop-pdf | unicode | default margins | ✅ pass |  |
| resize-pages | unicode | to Letter | ✅ pass |  |
| n-up | unicode | 4 per sheet | ✅ pass |  |
| add-page-numbers | unicode | start 101 | ✅ pass |  |
| headers-footers | unicode | {page}/{pages} | ✅ pass |  |
| bates-numbering | unicode | prefix BAT start 7 | ✅ pass |  |
| delete-pages | forms | only page | ⚠️ clear error (expected) | You cannot delete every page — at least one page must remain. |
| reorder-pages | forms | single page | ⚠️ clear error (expected) | single page: nothing to reorder (Run stays disabled) |
| crop-pdf | forms | default margins | ✅ pass |  |
| resize-pages | forms | to Letter | ✅ pass |  |
| n-up | forms | 4 per sheet | ✅ pass |  |
| add-page-numbers | forms | start 101 | ✅ pass |  |
| headers-footers | forms | {page}/{pages} | ✅ pass |  |
| bates-numbering | forms | prefix BAT start 7 | ✅ pass |  |
| delete-pages | images | page 1 | ✅ pass |  |
| reorder-pages | images | move page 2 first | ✅ pass |  |
| crop-pdf | images | default margins | ✅ pass |  |
| resize-pages | images | to Letter | ✅ pass |  |
| n-up | images | 4 per sheet | ✅ pass |  |
| add-page-numbers | images | start 101 | ✅ pass |  |
| headers-footers | images | {page}/{pages} | ✅ pass |  |
| bates-numbering | images | prefix BAT start 7 | ✅ pass |  |
| delete-pages | single | only page | ⚠️ clear error (expected) | You cannot delete every page — at least one page must remain. |
| reorder-pages | single | single page | ⚠️ clear error (expected) | single page: nothing to reorder (Run stays disabled) |
| crop-pdf | single | default margins | ✅ pass |  |
| resize-pages | single | to Letter | ✅ pass |  |
| n-up | single | 4 per sheet | ✅ pass |  |
| add-page-numbers | single | start 101 | ✅ pass |  |
| headers-footers | single | {page}/{pages} | ✅ pass |  |
| bates-numbering | single | prefix BAT start 7 | ✅ pass |  |
| split-pdf | multipage | ranges 1-3,5,8- | ✅ pass |  |
| split-pdf | multipage | by bookmarks | ✅ pass |  |
| split-pdf | large | max 2 MB per file | ✅ pass |  |
| pdf-to-word | table |  | ✅ pass |  |
| pdf-to-word | multipage |  | ✅ pass |  |
| pdf-to-word | scanned |  | ✅ pass | notice: This PDF is a scan, so it was run through OCR and the recognised text was placed in the Word file. Layout, tables and images are not preserved and recognition errors are possible — please proofread. |
| pdf-to-word | mixed |  | ✅ pass |  |
| pdf-to-word | unicode |  | ✅ pass |  |
| pdf-to-word | forms |  | ✅ pass |  |
| pdf-to-word | images |  | ✅ pass |  |
| pdf-to-word | single |  | ✅ pass |  |
| pdf-to-word | large |  | ✅ pass |  |
| pdf-to-excel | table |  | ✅ pass |  |
| pdf-to-powerpoint | table | image | ✅ pass |  |
| pdf-to-powerpoint | table | editable | ✅ pass |  |
| pdf-to-png | table | 150 dpi | ✅ pass |  |
| pdf-to-text | table |  | ✅ pass |  |
| pdf-to-excel | multipage |  | ⚠️ clear error (expected) | No tables were found in this PDF (scanned pages need OCR first) |
| pdf-to-powerpoint | multipage | image | ✅ pass |  |
| pdf-to-powerpoint | multipage | editable | ✅ pass |  |
| pdf-to-png | multipage | 150 dpi | ✅ pass |  |
| pdf-to-text | multipage |  | ✅ pass |  |
| pdf-to-excel | scanned |  | ⚠️ clear error (expected) | No tables were found in this PDF (scanned pages need OCR first) |
| pdf-to-powerpoint | scanned | image | ✅ pass |  |
| pdf-to-powerpoint | scanned | editable | ✅ pass |  |
| pdf-to-png | scanned | 150 dpi | ✅ pass |  |
| pdf-to-text | scanned |  | ⚠️ clear error (expected) | This PDF has no text layer (it looks scanned). Run OCR first, then convert to text. |
| pdf-to-excel | mixed |  | ⚠️ clear error (expected) | No tables were found in this PDF (scanned pages need OCR first) |
| pdf-to-powerpoint | mixed | image | ✅ pass |  |
| pdf-to-powerpoint | mixed | editable | ✅ pass |  |
| pdf-to-png | mixed | 150 dpi | ✅ pass |  |
| pdf-to-text | mixed |  | ✅ pass |  |
| pdf-to-excel | unicode |  | ⚠️ clear error (expected) | No tables were found in this PDF (scanned pages need OCR first) |
| pdf-to-powerpoint | unicode | image | ✅ pass |  |
| pdf-to-powerpoint | unicode | editable | ✅ pass |  |
| pdf-to-png | unicode | 150 dpi | ✅ pass |  |
| pdf-to-text | unicode |  | ✅ pass |  |
| pdf-to-excel | forms |  | ⚠️ clear error (expected) | No tables were found in this PDF (scanned pages need OCR first) |
| pdf-to-powerpoint | forms | image | ✅ pass |  |
| pdf-to-powerpoint | forms | editable | ✅ pass |  |
| pdf-to-png | forms | 150 dpi | ✅ pass |  |
| pdf-to-text | forms |  | ✅ pass |  |
| pdf-to-excel | images |  | ⚠️ clear error (expected) | No tables were found in this PDF (scanned pages need OCR first) |
| pdf-to-powerpoint | images | image | ✅ pass |  |
| pdf-to-powerpoint | images | editable | ✅ pass |  |
| pdf-to-png | images | 150 dpi | ✅ pass |  |
| pdf-to-text | images |  | ✅ pass |  |
| pdf-to-excel | single |  | ⚠️ clear error (expected) | No tables were found in this PDF (scanned pages need OCR first) |
| pdf-to-powerpoint | single | image | ✅ pass |  |
| pdf-to-powerpoint | single | editable | ✅ pass |  |
| pdf-to-png | single | 150 dpi | ✅ pass |  |
| pdf-to-text | single |  | ✅ pass |  |
| pdf-to-jpg | table | 150 dpi | ✅ pass |  |
| pdf-to-jpg | multipage | 150 dpi | ✅ pass |  |
| pdf-to-jpg | scanned | 150 dpi | ✅ pass |  |
| pdf-to-jpg | mixed | 150 dpi | ✅ pass |  |
| pdf-to-jpg | unicode | 150 dpi | ✅ pass |  |
| pdf-to-jpg | forms | 150 dpi | ✅ pass |  |
| pdf-to-jpg | images | 150 dpi | ✅ pass |  |
| pdf-to-jpg | single | 150 dpi | ✅ pass |  |
| pdf-to-jpg | large | 150 dpi | ✅ pass |  |
| word-to-pdf | sample.docx |  | ✅ pass |  |
| excel-to-pdf | sample.xlsx |  | ✅ pass |  |
| powerpoint-to-pdf | sample.pptx |  | ✅ pass |  |
| jpg-to-pdf | sample.jpg |  | ✅ pass |  |
| png-to-pdf | sample.png |  | ✅ pass |  |
| jpg-to-pdf | sample.jpg + sample.png |  | ✅ pass |  |
| text-to-pdf | sample.txt |  | ✅ pass |  |
| compress-pdf | table | medium | ✅ pass | 2225 → 2225 bytes; UI: Before: 2.2 KB → After: 2.2 KB · the file could not be made smaller, so you get the original back This file could not be made smaller at this level — it is already well optimised. The original size is returned unchanged. |
| compress-pdf | multipage | medium | ✅ pass | 11289 → 9050 bytes; UI: Before: 11 KB → After: 8.8 KB · saved 19.8% |
| compress-pdf | scanned | medium | ✅ pass | 52304 → 52304 bytes; UI: Before: 51 KB → After: 51 KB · the file could not be made smaller, so you get the original back This file could not be made smaller at this level — it is already well optimised. The original size is returned unchanged. |
| compress-pdf | mixed | medium | ✅ pass | 7535 → 7535 bytes; UI: Before: 7.4 KB → After: 7.4 KB · the file could not be made smaller, so you get the original back This file could not be made smaller at this level — it is already well optimised. The original size is returned unchanged. |
| compress-pdf | unicode | medium | ✅ pass | 13550 → 9499 bytes; UI: Before: 13 KB → After: 9.3 KB · saved 29.9% |
| compress-pdf | forms | medium | ✅ pass | 11512 → 4249 bytes; UI: Before: 11 KB → After: 4.1 KB · saved 63.1% |
| compress-pdf | images | low | ✅ pass | 440981 → 361761 bytes; UI: Before: 431 KB → After: 353 KB · saved 18.0% |
| compress-pdf | images | medium | ✅ pass | 440981 → 354697 bytes; UI: Before: 431 KB → After: 346 KB · saved 19.6% |
| compress-pdf | images | high | ✅ pass | 440981 → 56563 bytes; UI: Before: 431 KB → After: 55 KB · saved 87.2% |
| compress-pdf | single | medium | ✅ pass | 1381 → 1381 bytes; UI: Before: 1.3 KB → After: 1.3 KB · the file could not be made smaller, so you get the original back This file could not be made smaller at this level — it is already well optimised. The original size is returned unchanged. |
| compress-pdf | large | low | ✅ pass | 6660888 → 5337545 bytes; UI: Before: 6.35 MB → After: 5.09 MB · saved 19.9% |
| compress-pdf | large | medium | ✅ pass | 6660888 → 5330571 bytes; UI: Before: 6.35 MB → After: 5.08 MB · saved 20.0% |
| compress-pdf | large | high | ✅ pass | 6660888 → 137386 bytes; UI: Before: 6.35 MB → After: 134 KB · saved 97.9% |
| repair-pdf | table |  | ✅ pass |  |
| flatten-pdf | table |  | ✅ pass |  |
| deskew-pdf | table |  | ✅ pass |  |
| repair-pdf | multipage |  | ✅ pass |  |
| flatten-pdf | multipage |  | ✅ pass |  |
| deskew-pdf | multipage |  | ✅ pass |  |
| repair-pdf | scanned |  | ✅ pass |  |
| flatten-pdf | scanned |  | ✅ pass |  |
| deskew-pdf | scanned |  | ✅ pass |  |
| repair-pdf | mixed |  | ✅ pass |  |
| flatten-pdf | mixed |  | ✅ pass |  |
| deskew-pdf | mixed |  | ✅ pass |  |
| repair-pdf | unicode |  | ✅ pass |  |
| flatten-pdf | unicode |  | ✅ pass |  |
| deskew-pdf | unicode |  | ✅ pass |  |
| repair-pdf | forms |  | ✅ pass |  |
| flatten-pdf | forms |  | ✅ pass |  |
| deskew-pdf | forms |  | ✅ pass |  |
| repair-pdf | images |  | ✅ pass |  |
| flatten-pdf | images |  | ✅ pass |  |
| deskew-pdf | images |  | ✅ pass |  |
| repair-pdf | single |  | ✅ pass |  |
| flatten-pdf | single |  | ✅ pass |  |
| deskew-pdf | single |  | ✅ pass |  |
| ocr-pdf | table | English | ✅ pass |  |
| ocr-pdf | multipage | English | ✅ pass |  |
| ocr-pdf | scanned | English | ✅ pass |  |
| ocr-pdf | mixed | English | ✅ pass |  |
| ocr-pdf | unicode | English | ✅ pass |  |
| ocr-pdf | forms | English | ✅ pass |  |
| ocr-pdf | images | English | ✅ pass |  |
| ocr-pdf | single | English | ✅ pass |  |
| ocr-pdf | large | English | ✅ pass |  |
| repair-pdf | corrupted | broken xref | ✅ pass |  |
| protect-pdf → unlock-pdf | table | round trip | ✅ pass |  |
| watermark-pdf | table | text | ✅ pass |  |
| protect-pdf → unlock-pdf | multipage | round trip | ✅ pass |  |
| watermark-pdf | multipage | text | ✅ pass |  |
| protect-pdf → unlock-pdf | scanned | round trip | ✅ pass |  |
| watermark-pdf | scanned | text | ✅ pass |  |
| protect-pdf → unlock-pdf | mixed | round trip | ✅ pass |  |
| watermark-pdf | mixed | text | ✅ pass |  |
| protect-pdf → unlock-pdf | unicode | round trip | ✅ pass |  |
| watermark-pdf | unicode | text | ✅ pass |  |
| protect-pdf → unlock-pdf | forms | round trip | ✅ pass |  |
| watermark-pdf | forms | text | ✅ pass |  |
| protect-pdf → unlock-pdf | images | round trip | ✅ pass |  |
| watermark-pdf | images | text | ✅ pass |  |
| protect-pdf → unlock-pdf | single | round trip | ✅ pass |  |
| watermark-pdf | single | text | ✅ pass |  |
| protect-pdf → unlock-pdf | large | round trip | ✅ pass |  |
| watermark-pdf | large | text | ✅ pass |  |
| watermark-pdf | table | image | ✅ pass |  |
| metadata-pdf | table | edit title/author | ✅ pass |  |
| extract-tables | table | no AI | ✅ pass | 1 table(s) extracted. |
| watermark-pdf | multipage | image | ✅ pass |  |
| metadata-pdf | multipage | edit title/author | ✅ pass |  |
| extract-tables | multipage | no AI | ⚠️ clear error (expected) | No tables were found in this PDF (scanned pages need OCR first) |
| watermark-pdf | scanned | image | ✅ pass |  |
| metadata-pdf | scanned | edit title/author | ✅ pass |  |
| extract-tables | scanned | no AI | ⚠️ clear error (expected) | No tables were found in this PDF (scanned pages need OCR first) |
| watermark-pdf | mixed | image | ✅ pass |  |
| metadata-pdf | mixed | edit title/author | ✅ pass |  |
| extract-tables | mixed | no AI | ⚠️ clear error (expected) | No tables were found in this PDF (scanned pages need OCR first) |
| watermark-pdf | unicode | image | ✅ pass |  |
| metadata-pdf | unicode | edit title/author | ✅ pass |  |
| extract-tables | unicode | no AI | ⚠️ clear error (expected) | No tables were found in this PDF (scanned pages need OCR first) |
| watermark-pdf | forms | image | ✅ pass |  |
| metadata-pdf | forms | edit title/author | ✅ pass |  |
| extract-tables | forms | no AI | ⚠️ clear error (expected) | No tables were found in this PDF (scanned pages need OCR first) |
| watermark-pdf | images | image | ✅ pass |  |
| metadata-pdf | images | edit title/author | ✅ pass |  |
| extract-tables | images | no AI | ⚠️ clear error (expected) | No tables were found in this PDF (scanned pages need OCR first) |
| watermark-pdf | single | image | ✅ pass |  |
| metadata-pdf | single | edit title/author | ✅ pass |  |
| extract-tables | single | no AI | ⚠️ clear error (expected) | No tables were found in this PDF (scanned pages need OCR first) |
| edit-pdf | mixed | all object types | ✅ pass |  |
| edit-pdf | unicode | all object types | ✅ pass |  |
| edit-pdf | forms | all object types | ✅ pass |  |
| sign-pdf | unicode | draw signature | ✅ pass |  |
| sign-pdf | mixed | upload signature image | ✅ pass |  |
| sign-pdf | forms | typed signature | ✅ pass |  |
| edit-pdf | mixed | add form fields | ✅ pass |  |
| fill-form | forms | fill existing fields | ✅ pass |  |
| summarize-pdf | table | scripted model (test double) | ✅ pass |  |
| ask-pdf | table | scripted model (test double) | ✅ pass |  |
| translate-pdf | table | scripted model (test double) | ✅ pass |  |
| explain-pdf | table | scripted model (test double) | ✅ pass |  |
| compare-pdf | table vs single | real diff + scripted summary | ✅ pass |  |
| chat-pdf | table | question with citations (test double) | ✅ pass |  |
| summarize-pdf | multipage | scripted model (test double) | ✅ pass |  |
| ask-pdf | multipage | scripted model (test double) | ✅ pass |  |
| translate-pdf | multipage | scripted model (test double) | ✅ pass |  |
| explain-pdf | multipage | scripted model (test double) | ✅ pass |  |
| compare-pdf | multipage vs single | real diff + scripted summary | ✅ pass |  |
| chat-pdf | multipage | question with citations (test double) | ✅ pass |  |
| summarize-pdf | unicode | scripted model (test double) | ✅ pass |  |
| ask-pdf | unicode | scripted model (test double) | ✅ pass |  |
| translate-pdf | unicode | scripted model (test double) | ✅ pass |  |
| explain-pdf | unicode | scripted model (test double) | ✅ pass |  |
| compare-pdf | unicode vs single | real diff + scripted summary | ✅ pass |  |
| chat-pdf | unicode | question with citations (test double) | ✅ pass |  |
| chat:merge_pdfs | multipage | via MCP (test double model) | ✅ pass |  |
| chat:split_pdf | multipage | via MCP (test double model) | ✅ pass |  |
| chat:compress_pdf | images | via MCP (test double model) | ✅ pass |  |
| chat:rotate_pdf | multipage | via MCP (test double model) | ✅ pass |  |
| chat:delete_pages | multipage | via MCP (test double model) | ✅ pass |  |
| chat:extract_pages | multipage | via MCP (test double model) | ✅ pass |  |
| chat:extract_text | unicode | via MCP (test double model) | ✅ pass |  |
| chat:extract_tables | table | via MCP (test double model) | ✅ pass |  |
| chat:convert_pdf | table | via MCP (test double model) | ✅ pass |  |
| chat:add_watermark | mixed | via MCP (test double model) | ✅ pass |  |
| chat:protect_pdf | single | via MCP (test double model) | ✅ pass |  |
| chat:get_document_info | mixed | via MCP (test double model) | ✅ pass |  |
| chat:search_document | multipage | via MCP (test double model) | ✅ pass |  |
| rotate-pdf | protected | password-protected | ⚠️ clear error (expected) | This PDF is password-protected. Unlock it first with the Unlock PDF tool. |
| extract-pages | protected | password-protected | ⚠️ clear error (expected) | This PDF is password-protected. Unlock it first with the Unlock PDF tool. |
| n-up | protected | password-protected | ⚠️ clear error (expected) | This PDF is password-protected. Unlock it first with the Unlock PDF tool. |
| add-page-numbers | protected | password-protected | ⚠️ clear error (expected) | This PDF is password-protected. Unlock it first with the Unlock PDF tool. |
| merge-pdf | protected + single | password-protected | ⚠️ clear error (expected) | This PDF is password-protected. Unlock it first with the Unlock PDF tool. |
| edit-pdf | protected | password-protected | ⚠️ clear error (expected) | Could not display this PDF: This PDF is password protected. Unlock it first with the Unlock PDF tool. |
| compress-pdf | protected | password-protected (UI + API) | ⚠️ clear error (expected) | UI: Run disabled + "unlock it first"; API 422 PASSWORD_REQUIRED: This PDF is password protected. Unlock it first. |
| pdf-to-word | protected | password-protected (UI + API) | ⚠️ clear error (expected) | UI: Run disabled + "unlock it first"; API 422 PASSWORD_REQUIRED: This PDF is password protected. Unlock it first. |
| watermark-pdf | protected | password-protected (UI + API) | ⚠️ clear error (expected) | UI: Run disabled + "unlock it first"; API 422 PASSWORD_REQUIRED: This PDF is password protected. Unlock it first. |
| ocr-pdf | protected | password-protected (UI + API) | ⚠️ clear error (expected) | UI: Run disabled + "unlock it first"; API 422 PASSWORD_REQUIRED: This PDF is password protected. Unlock it first. |
| pdf-to-text | protected | password-protected (UI + API) | ⚠️ clear error (expected) | UI: Run disabled + "unlock it first"; API 422 PASSWORD_REQUIRED: This PDF is password protected. Unlock it first. |
| metadata-pdf | protected | password-protected (UI + API) | ⚠️ clear error (expected) | UI: Run disabled + "unlock it first"; API 422 PASSWORD_REQUIRED: This PDF is password protected. Unlock it first. |
| unlock-pdf | protected | correct password | ✅ pass |  |
| unlock-pdf | protected | wrong password | ⚠️ clear error (expected) | Wrong password. |
| rotate-pdf | owner-only | owner password only | ⚠️ clear error (expected) | The PDF is password-protected or has editing restrictions. Unlock it first with the Unlock PDF tool. |
| compress-pdf | owner-only | owner password only | ✅ pass |  |
| unlock-pdf | owner-only | no password needed | ✅ pass |  |
| rotate-pdf | corrupted | broken xref | ✅ pass | browser tools read this damaged file directly (pdf-lib recovers objects without the xref) |
| compress-pdf | corrupted | broken xref | ✅ pass |  |
| pdf-to-word | corrupted | broken xref | ✅ pass |  |
| rotate-pdf | fake.pdf | not a PDF | ⚠️ clear error (expected) | "fake.pdf" is not a valid PDF (missing %PDF header). |
| compress-pdf | fake.pdf | not a PDF | ⚠️ clear error (expected) | "fake.pdf" is not a valid PDF (missing %PDF header). |
| edit | fake.pdf | not a PDF | ⚠️ clear error (expected) | "fake.pdf" is not a valid PDF (missing %PDF header). |
| api: POST /api/documents | fake.pdf | server magic-byte check | ⚠️ clear error (expected) | 415 UNSUPPORTED_FILE: Unsupported or corrupted file. Upload a PDF, Word, Excel, PowerPoint, JPG, PNG or TXT file. |
| word-to-pdf | sample.xlsx | wrong extension | ⚠️ clear error (expected) | "sample.xlsx" is not a supported .docx Word file. |
| word-to-pdf | png renamed .docx | content does not match | ⚠️ clear error (expected) | This tool needs a DOCX file, but 'picture.docx' is a PNG |
| compress-pdf | large (6.4 MB) vs 5 MB limit | upload limit | ⚠️ clear error (expected) | This file is 6.4 MB — larger than the server's 5 MB upload limit. Split it into smaller parts first (Split PDF runs in your browser). · API through proxy: 413 T |
| extract-pages | multipage | invalid ranges | ⚠️ clear error (expected) | out-of-range / malformed / empty selections are refused before running |
| delete-pages | multipage | delete every page | ⚠️ clear error (expected) | You cannot delete every page — at least one page must remain. |
| split-pdf | multipage | malformed ranges | ⚠️ clear error (expected) | malformed / out-of-range split ranges are refused before running |
| watermark-pdf | multipage | pages out of range | ⚠️ clear error (expected) | Page range '99' is outside 1-12 |
| pdf-to-text | multipage | pages out of range | ⚠️ clear error (expected) | Page range '50' is outside 1-12 |
| chain (6 tools) | multipage | rotate→crop→compress→split→edit→protect | ✅ pass |  |

Total cells: 340 — ✅ 293 pass · ⚠️ 47 clear expected error · ❌ 0 failing · ⏭ 0 skipped

</details>
