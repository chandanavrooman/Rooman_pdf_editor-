"""Repair damaged PDFs and flatten forms/annotations."""
from __future__ import annotations

from pathlib import Path

import fitz
import pikepdf

from ..core.errors import AppError, unprocessable
from .pdf_ops import open_fitz as _open


def repair(src: Path, out: Path) -> str:
    """Rebuild the structure of a damaged PDF. Returns a human-readable note on what happened."""
    problems: list[str] = []
    try:
        with pikepdf.open(src, attempt_recovery=True) as pdf:
            problems = list(pdf.get_warnings())  # xref/stream recovery messages
            try:
                problems += list(pdf.check_pdf_syntax())
            except Exception:  # noqa: BLE001
                pass
            pdf.save(out)
        n = pdf_pages(out)
        if n:
            return (f"Repaired: {len(problems)} structural problem(s) found and fixed; {n} pages recovered."
                    if problems else f"No structural problems found; file rewritten cleanly ({n} pages).")
    except pikepdf.PasswordError:
        raise unprocessable("PASSWORD_REQUIRED", "This PDF is password protected. Unlock it first.") from None
    except pikepdf.PdfError:
        pass
    # second attempt: MuPDF's recovery
    try:
        doc = fitz.open(src)
        if doc.needs_pass:
            raise unprocessable("PASSWORD_REQUIRED", "This PDF is password protected. Unlock it first.")
        if len(doc) == 0:
            raise ValueError("no pages")
        doc.save(out, garbage=4, clean=True, deflate=True)
        n = len(doc)
        doc.close()
        return f"Repaired with fallback recovery; {n} pages recovered."
    except AppError:
        raise
    except Exception:  # noqa: BLE001
        raise unprocessable("UNREPAIRABLE", "This file is too damaged to repair — no pages could be recovered.") from None


def pdf_pages(path: Path) -> int:
    try:
        with pikepdf.open(path) as pdf:
            return len(pdf.pages)
    except Exception:  # noqa: BLE001
        return 0


def flatten(src: Path, out: Path) -> dict:
    """Burn form fields and annotations into page content so they can no longer be edited."""
    doc = _open(src)
    try:
        widgets = sum(len(list(p.widgets())) for p in doc)
        annots = sum(len(list(p.annots())) for p in doc) - widgets
        doc.bake(annots=True, widgets=True)
        doc.save(out, garbage=3, deflate=True)
        return {"form_fields": widgets, "annotations": max(annots, 0)}
    finally:
        doc.close()
