"""True redaction (content removed from the file) using PyMuPDF."""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

import fitz

from ..core.errors import bad_request
from .pdf_ops import open_fitz as _open


@dataclass
class Area:
    page: int  # 1-based
    x0: float
    y0: float
    x1: float
    y1: float  # PDF points, origin top-left of the displayed page


def redact(src: Path, out: Path, *, terms: list[str] | None = None, patterns: list[str] | None = None,
           areas: list[Area] | None = None, case_sensitive: bool = False, scrub_metadata: bool = True) -> dict:
    terms, patterns, areas = terms or [], patterns or [], areas or []
    if not (terms or patterns or areas):
        raise bad_request("NOTHING_TO_REDACT", "Provide text to search for, a pattern or areas to redact")
    compiled = []
    for p in patterns:
        try:
            compiled.append(re.compile(p, 0 if case_sensitive else re.IGNORECASE))
        except re.error as e:
            raise bad_request("INVALID_PATTERN", f"Invalid pattern '{p}': {e}") from None
    doc = _open(src)
    try:
        per_page: dict[int, int] = {}
        for pno, page in enumerate(doc, 1):
            rects: list[fitz.Rect] = []
            search_terms = list(terms)
            if compiled:
                text = page.get_text("text")
                for rx in compiled:
                    search_terms += [m.group(0) for m in rx.finditer(text) if m.group(0).strip()]
            for t in dict.fromkeys(search_terms):
                hits = page.search_for(t, quads=False)
                if case_sensitive:
                    hits = [h for h in hits if t in page.get_textbox(h)]
                rects += hits
            for a in areas:
                if a.page == pno:
                    rects.append(fitz.Rect(a.x0, a.y0, a.x1, a.y1) * page.derotation_matrix)
            for r in rects:
                page.add_redact_annot(r, fill=(0, 0, 0))
            if rects:
                page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_PIXELS, graphics=fitz.PDF_REDACT_LINE_ART_NONE)
                per_page[pno] = len(rects)
        for a in areas:
            if a.page < 1 or a.page > len(doc):
                raise bad_request("PAGE_OUT_OF_RANGE", f"Area refers to page {a.page}, document has {len(doc)}")
        if scrub_metadata:
            doc.set_metadata({})
            doc.del_xml_metadata()
        doc.save(out, garbage=4, clean=True, deflate=True)
        return {"redactions": sum(per_page.values()), "pages": sorted(per_page)}
    finally:
        doc.close()
