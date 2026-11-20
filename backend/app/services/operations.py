"""Document-level operations: the single orchestration layer used by the HTTP routers AND the MCP server.

Every method:
  * takes authenticated document IDs and resolves them through the store with the owner's user_id
    (so a user can only ever touch their own documents),
  * runs the pure service functions on server-generated paths inside a scratch dir,
  * registers outputs as NEW documents (inputs are never modified) and returns an OpResult.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Sequence

from ..core.errors import AppError, bad_request
from . import compress as compress_svc
from . import convert as convert_svc
from . import metadata as metadata_svc
from . import ocr as ocr_svc
from . import pdf_ops, protect as protect_svc, redact as redact_svc, repair as repair_svc
from . import tables as tables_svc
from . import watermark as watermark_svc
from .storage import Document, DocumentStore


@dataclass
class OpResult:
    documents: list[Document]
    notice: str | None = None
    details: dict = field(default_factory=dict)


def _stem(doc: Document) -> str:
    s = Path(doc.filename).stem
    return s or "document"


class Ops:
    def __init__(self, store: DocumentStore, user_id: str):
        self.store = store
        self.user_id = user_id

    # ---------------------------------------------------------------- helpers
    def doc(self, doc_id: str, *kinds: str) -> Document:
        d = self.store.get(self.user_id, doc_id)
        kinds = kinds or ("pdf",)
        if d.kind not in kinds:
            want = " or ".join(k.upper() for k in kinds)
            raise AppError(415, "WRONG_FILE_TYPE", f"This tool needs a {want} file, but '{d.filename}' is a {d.kind.upper()}")
        return d

    def _register(self, path: Path, filename: str, kind: str = "pdf") -> Document:
        pages = pdf_ops.page_count(path) if kind == "pdf" else None
        return self.store.adopt(self.user_id, path, filename, kind, pages)

    # ---------------------------------------------------------------- info
    def info(self, doc_id: str) -> dict:
        d = self.doc(doc_id, "pdf")
        meta = None
        try:
            meta = metadata_svc.get_metadata(d.path)
        except AppError as e:
            if e.code != "PASSWORD_REQUIRED":
                raise
        return {"document": d, "encrypted": meta is None, "metadata": meta}

    # ---------------------------------------------------------------- organize
    def merge(self, doc_ids: Sequence[str], filename: str | None = None) -> OpResult:
        docs = [self.doc(i) for i in doc_ids]
        with self.store.tempdir() as td:
            out = td / "out.pdf"
            pdf_ops.merge([d.path for d in docs], out)
            return OpResult([self._register(out, filename or "merged.pdf")])

    def split(self, doc_id: str, mode: str, *, ranges: str | None = None, every_n: int | None = None,
              max_size_mb: float | None = None, as_zip: bool = False) -> OpResult:
        d = self.doc(doc_id)
        with self.store.tempdir() as td:
            parts = pdf_ops.split(d.path, td / "parts", mode, ranges=ranges, every_n=every_n,
                                  max_size_mb=max_size_mb, stem=_stem(d))
            if as_zip:
                out = td / "out.zip"
                pdf_ops.zip_files([(p, name) for p, name, _ in parts], out)
                return OpResult([self._register(out, f"{_stem(d)}_split.zip", "zip")], details={"parts": len(parts)})
            docs = [self._register(p, name) for p, name, _ in parts]
            return OpResult(docs, details={"parts": len(docs)})

    def extract_pages(self, doc_id: str, pages: str) -> OpResult:
        d = self.doc(doc_id)
        with self.store.tempdir() as td:
            out = td / "out.pdf"
            n = pdf_ops.extract_pages(d.path, out, pages)
            return OpResult([self._register(out, f"{_stem(d)}_extracted.pdf")], details={"pages": n})

    def delete_pages(self, doc_id: str, pages: str) -> OpResult:
        d = self.doc(doc_id)
        with self.store.tempdir() as td:
            out = td / "out.pdf"
            n = pdf_ops.delete_pages(d.path, out, pages)
            return OpResult([self._register(out, f"{_stem(d)}_edited.pdf")], details={"remaining_pages": n})

    def reorder(self, doc_id: str, order: Sequence[int]) -> OpResult:
        d = self.doc(doc_id)
        with self.store.tempdir() as td:
            out = td / "out.pdf"
            pdf_ops.reorder_pages(d.path, out, list(order))
            return OpResult([self._register(out, f"{_stem(d)}_reordered.pdf")])

    def rotate(self, doc_id: str, angle: int, pages: str | None = None) -> OpResult:
        d = self.doc(doc_id)
        with self.store.tempdir() as td:
            out = td / "out.pdf"
            n = pdf_ops.rotate_pages(d.path, out, angle, pages)
            return OpResult([self._register(out, f"{_stem(d)}_rotated.pdf")], details={"rotated_pages": n})

    def crop(self, doc_id: str, top: float, right: float, bottom: float, left: float, pages: str | None = None) -> OpResult:
        d = self.doc(doc_id)
        with self.store.tempdir() as td:
            out = td / "out.pdf"
            n = pdf_ops.crop_pages(d.path, out, top, right, bottom, left, pages)
            return OpResult([self._register(out, f"{_stem(d)}_cropped.pdf")], details={"cropped_pages": n})

    # ---------------------------------------------------------------- optimize
    def compress(self, doc_id: str, level: str) -> OpResult:
        d = self.doc(doc_id)
        with self.store.tempdir() as td:
            out = td / "out.pdf"
            r = compress_svc.compress(d.path, out, level)
            notice = None if r.smaller else (
                "This file could not be made smaller at this level — it is already well optimised. "
                "The original size is returned unchanged.")
            return OpResult([self._register(out, f"{_stem(d)}_compressed.pdf")], notice,
                            {"before_bytes": r.before, "after_bytes": r.after, "saved_percent": r.saved_percent,
                             "smaller": r.smaller, "level": level})

    def repair(self, doc_id: str) -> OpResult:
        d = self.doc(doc_id)
        with self.store.tempdir() as td:
            out = td / "out.pdf"
            note = repair_svc.repair(d.path, out)
            return OpResult([self._register(out, f"{_stem(d)}_repaired.pdf")], note)

    def flatten(self, doc_id: str) -> OpResult:
        d = self.doc(doc_id)
        with self.store.tempdir() as td:
            out = td / "out.pdf"
            stats = repair_svc.flatten(d.path, out)
            return OpResult([self._register(out, f"{_stem(d)}_flattened.pdf")], details=stats)

    def ocr(self, doc_id: str, language: str = "eng", force: bool = False) -> OpResult:
        d = self.doc(doc_id)
        with self.store.tempdir() as td:
            out = td / "out.pdf"
            ocr_svc.ocr(d.path, out, language, force)
            return OpResult([self._register(out, f"{_stem(d)}_ocr.pdf")],
                            "Searchable text was added to pages that had none. Please proofread recognised text.")

    def deskew(self, doc_id: str, language: str = "eng") -> OpResult:
        d = self.doc(doc_id)
        with self.store.tempdir() as td:
            out = td / "out.pdf"
            ocr_svc.deskew(d.path, out, language)
            return OpResult([self._register(out, f"{_stem(d)}_deskewed.pdf")],
                            "Scanned pages were straightened (and made searchable). Pages with real text were left untouched.")

    # ---------------------------------------------------------------- security
    def protect(self, doc_id: str, user_password: str, owner_password: str | None = None, *,
                allow_print: bool = True, allow_copy: bool = True, allow_modify: bool = False) -> OpResult:
        d = self.doc(doc_id)
        with self.store.tempdir() as td:
            out = td / "out.pdf"
            protect_svc.protect(d.path, out, user_password, owner_password, allow_print=allow_print,
                                allow_copy=allow_copy, allow_modify=allow_modify)
            return OpResult([self._register(out, f"{_stem(d)}_protected.pdf")])

    def unlock(self, doc_id: str, password: str) -> OpResult:
        d = self.doc(doc_id)
        with self.store.tempdir() as td:
            out = td / "out.pdf"
            was = protect_svc.unlock(d.path, out, password)
            return OpResult([self._register(out, f"{_stem(d)}_unlocked.pdf")],
                            None if was else "This PDF was not password protected; a clean copy was returned.")

    def watermark(self, doc_id: str, *, text: str | None = None, image_doc_id: str | None = None,
                  opacity: float = 0.3, rotation: float = 45, font_size: float = 60, color: str = "#888888",
                  pages: str | None = None, layout: str = "center", image_scale: float = 0.5) -> OpResult:
        d = self.doc(doc_id)
        image = self.doc(image_doc_id, "png", "jpg").path.read_bytes() if image_doc_id else None
        with self.store.tempdir() as td:
            out = td / "out.pdf"
            n = watermark_svc.watermark(d.path, out, text=text, image=image, opacity=opacity, rotation=rotation,
                                        font_size=font_size, color=color, pages=pages, layout=layout,
                                        image_scale=image_scale)
            return OpResult([self._register(out, f"{_stem(d)}_watermarked.pdf")], details={"pages": n})

    def redact(self, doc_id: str, *, terms: list[str] | None = None, patterns: list[str] | None = None,
               areas: list[redact_svc.Area] | None = None, case_sensitive: bool = False,
               scrub_metadata: bool = True) -> OpResult:
        d = self.doc(doc_id)
        with self.store.tempdir() as td:
            out = td / "out.pdf"
            stats = redact_svc.redact(d.path, out, terms=terms, patterns=patterns, areas=areas,
                                      case_sensitive=case_sensitive, scrub_metadata=scrub_metadata)
            notice = None
            if stats["redactions"] == 0:
                notice = "Nothing matched, so no content was redacted."
            return OpResult([self._register(out, f"{_stem(d)}_redacted.pdf")], notice, stats)

    def get_metadata(self, doc_id: str) -> dict:
        return metadata_svc.get_metadata(self.doc(doc_id).path)

    def update_metadata(self, doc_id: str, changes: dict[str, str | None], clear_all: bool = False) -> OpResult:
        d = self.doc(doc_id)
        with self.store.tempdir() as td:
            out = td / "out.pdf"
            meta = metadata_svc.update_metadata(d.path, out, changes, clear_all=clear_all)
            return OpResult([self._register(out, f"{_stem(d)}_metadata.pdf")], details={"metadata": meta})

    # ---------------------------------------------------------------- convert / extract
    def pdf_to_word(self, doc_id: str) -> OpResult:
        d = self.doc(doc_id)
        with self.store.tempdir() as td:
            out = td / "out.docx"
            r = convert_svc.pdf_to_docx(d.path, out, td)
            return OpResult([self._register(out, f"{_stem(d)}.docx", "docx")], r.notice, r.details)

    def pdf_to_excel(self, doc_id: str, pages: str | None = None) -> OpResult:
        d = self.doc(doc_id)
        with self.store.tempdir() as td:
            out = td / "out.xlsx"
            n = tables_svc.pdf_to_xlsx(d.path, out, pages)
            return OpResult([self._register(out, f"{_stem(d)}.xlsx", "xlsx")], details={"tables": n})

    def pdf_to_powerpoint(self, doc_id: str, mode: str = "image") -> OpResult:
        d = self.doc(doc_id)
        with self.store.tempdir() as td:
            out = td / "out.pptx"
            r = convert_svc.pdf_to_pptx(d.path, out, td, mode)
            return OpResult([self._register(out, f"{_stem(d)}.pptx", "pptx")], r.notice, r.details)

    def pdf_to_images(self, doc_id: str, fmt: str = "png", dpi: int = 150, pages: str | None = None) -> OpResult:
        d = self.doc(doc_id)
        with self.store.tempdir() as td:
            out = td / "out.zip"
            n = convert_svc.pdf_to_images(d.path, out, td, fmt, dpi, pages)
            return OpResult([self._register(out, f"{_stem(d)}_{fmt}.zip", "zip")], details={"images": n})

    def pdf_to_text(self, doc_id: str, pages: str | None = None) -> OpResult:
        d = self.doc(doc_id)
        with self.store.tempdir() as td:
            out = td / "out.txt"
            n = convert_svc.pdf_to_text(d.path, out, pages)
            return OpResult([self._register(out, f"{_stem(d)}.txt", "txt")], details={"pages_with_text": n})

    def office_to_pdf(self, doc_id: str, ext: str) -> OpResult:
        d = self.doc(doc_id, ext)
        with self.store.tempdir() as td:
            out = td / "out.pdf"
            convert_svc.office_to_pdf(d.path, out, td, ext)
            return OpResult([self._register(out, f"{_stem(d)}.pdf")])

    def images_to_pdf(self, doc_ids: Sequence[str], page_size: str = "fit", margin_mm: float = 0,
                      orientation: str = "auto") -> OpResult:
        docs = [self.doc(i, "jpg", "png") for i in doc_ids]
        with self.store.tempdir() as td:
            out = td / "out.pdf"
            convert_svc.images_to_pdf([d.path for d in docs], out, page_size, margin_mm, orientation)
            name = f"{_stem(docs[0])}.pdf" if len(docs) == 1 else "images.pdf"
            return OpResult([self._register(out, name)])

    def text_to_pdf(self, *, doc_id: str | None = None, text: str | None = None, font_size: float = 11,
                    page_size: str = "a4") -> OpResult:
        if (doc_id is None) == (text is None):
            raise bad_request("INVALID_INPUT", "Provide either document_id (a .txt upload) or text")
        name = "text.pdf"
        if doc_id:
            d = self.doc(doc_id, "txt")
            text = convert_svc.decode_text(d.path.read_bytes())
            name = f"{_stem(d)}.pdf"
        with self.store.tempdir() as td:
            out = td / "out.pdf"
            convert_svc.text_to_pdf(text or "", out, font_size, page_size)
            return OpResult([self._register(out, name)])

    def html_to_pdf(self, html: str, page_size: str = "a4", orientation: str = "portrait") -> OpResult:
        with self.store.tempdir() as td:
            out = td / "out.pdf"
            convert_svc.html_to_pdf(html, out, td, page_size, orientation)
            return OpResult([self._register(out, "page.pdf")])

    # ---------------------------------------------------------------- read-only helpers (no new document)
    def extract_tables(self, doc_id: str, pages: str | None = None) -> list[dict]:
        return tables_svc.extract_tables(self.doc(doc_id).path, pages)

    def extract_text(self, doc_id: str, pages: str | None = None) -> str:
        d = self.doc(doc_id)
        doc = pdf_ops.open_fitz(d.path)
        try:
            idx = pdf_ops.parse_page_spec(pages, len(doc)) if pages else range(len(doc))
            return "\n\n".join(t for i in idx if (t := doc[i].get_text("text").strip()))
        finally:
            doc.close()

    def search(self, doc_id: str, query: str, limit: int = 50) -> list[dict]:
        """Case-insensitive text search; returns [{page, snippet}]."""
        d = self.doc(doc_id)
        doc = pdf_ops.open_fitz(d.path)
        hits: list[dict] = []
        try:
            q = query.lower()
            for pno, page in enumerate(doc, 1):
                text = " ".join(page.get_text("text").split())
                low = text.lower()
                start = 0
                while (i := low.find(q, start)) != -1 and len(hits) < limit:
                    hits.append({"page": pno, "snippet": text[max(0, i - 60): i + len(query) + 60]})
                    start = i + max(len(q), 1)
                if len(hits) >= limit:
                    break
        finally:
            doc.close()
        return hits
