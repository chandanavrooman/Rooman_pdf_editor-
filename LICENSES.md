# Third-party licenses that need a company decision

Rooman PDF prefers permissive libraries. The components below are **AGPL / GPL / LGPL (copyleft)**.
Verified from package metadata (`pip show`, `brew info`) on the versions pinned in
`backend/requirements.txt`. Please have legal review before distributing or offering the service to third parties.

## AGPL-3.0 (network copyleft — the strongest obligations)

| Component | Version | Used for | Where | Notes |
|---|---|---|---|---|
| **PyMuPDF** (MuPDF, Artifex) | 1.26.7 | True redaction (removes content), flatten forms/annotations, text/watermark stamping, page rendering to PNG/JPG and for PPTX slides, plain-text extraction, text→PDF, repair fallback; also required by `pdf2docx` | `backend/app/services/{redact,watermark,repair,convert,pdf_ops}.py` | Dual-licensed: AGPL-3.0 **or** commercial Artifex licence. Offering the backend as a network service to users generally requires publishing the corresponding source under AGPL, or buying the commercial licence. |
| **Ghostscript** | 10.08 (system program, not bundled) | PDF compression (low/medium/high) | `backend/app/services/compress.py` | AGPL-3.0; Artifex sells commercial licences. It is invoked as a separate process (argument list, no shell). Without it the Compress tool returns a clear "not installed" error. |

## Depends on an AGPL library

| Component | Version | License (own metadata) | Used for | Notes |
|---|---|---|---|---|
| **pdf2docx** | 0.5.13 | MIT | Layout-preserving PDF → Word | Imports PyMuPDF at runtime, so a deployment using it is subject to the PyMuPDF AGPL/commercial terms above. |

## LGPL-3.0 (weak copyleft — fine when used unmodified as a library, but check static-linking/bundling)

| Component | Version | Used for |
|---|---|---|
| **img2pdf** | 0.6.3 | Lossless JPG/PNG → PDF |
| **fpdf2** (transitive, via ocrmypdf) | — | Building the invisible OCR text layer |

## Permissive / weak-copyleft (listed for completeness)

| Component | License | Used for |
|---|---|---|
| Tesseract OCR (system program) | Apache-2.0 | OCR engine |
| LibreOffice (system program) | MPL-2.0 / LGPL | Word/Excel/PowerPoint → PDF (headless, separate process) |
| ocrmypdf | MPL-2.0 | OCR pipeline, deskew |
| pikepdf (QPDF) | MPL-2.0 (QPDF: Apache-2.0) | Merge/split/rotate/crop, encryption, repair, metadata |
| pypdf | BSD-3-Clause | Bookmark (outline) reading for split-by-bookmarks |
| pdfplumber / pdfminer.six | MIT | Table and text extraction |
| python-docx, python-pptx, openpyxl | MIT | Word / PowerPoint / Excel output |
| reportlab | BSD | Test fixture generation only |
| Pillow | MIT-CMU (HPND) | Image handling, watermark images |
| FastAPI, Starlette, Pydantic, PyJWT, argon2-cffi, uvicorn | MIT / BSD | Web API, validation, auth |
| mcp (official MCP Python SDK) 1.30.0 | MIT | MCP server (`FastMCP`, Streamable HTTP) and the backend's MCP client |
| jsonschema | MIT | Validating model-produced tool arguments against each tool's schema |
| httpx-sse | MIT | Dependency of the MCP SDK |
| sse-starlette | BSD-3-Clause | Dependency of the MCP SDK |
| httpx | BSD-3-Clause | Streaming client for the OpenAI-compatible model endpoint |
| opencv-python-headless, numpy, fonttools | Apache-2.0 / BSD / MIT | Dependencies of pdf2docx |

## Options to avoid the AGPL

* Buy the Artifex commercial licence (covers MuPDF/PyMuPDF and Ghostscript).
* Or replace: redact/flatten/stamp/render with pikepdf + pypdfium2 (BSD/Apache) + custom content-stream editing; compression with
  pikepdf image recompression; PDF→Word with a different converter. These would be separate engineering efforts.

## Phase 4/5 notes

* No new AGPL/GPL dependency was added for the AI assistant or the MCP server. Retrieval (BM25, chunking) is implemented in-house; the model is reached over plain HTTPS.
* The MCP tools call the existing service layer, so the AGPL components above (PyMuPDF, Ghostscript, and pdf2docx through PyMuPDF) are used by the MCP server exactly as by the HTTP API.
* The AI model/provider (default: Groq-hosted `qwen/qwen3.8-27b`) has its own terms of service and data-handling policy; document text is sent to it. Review before production use.

## Frontend fonts (OFL-1.1, permissive)
- Noto Sans (bundled, `frontend/src/assets/fonts`) — Unicode text in the editor export.
- @fontsource/dancing-script, @fontsource/caveat, @fontsource/homemade-apple — typed signatures.
