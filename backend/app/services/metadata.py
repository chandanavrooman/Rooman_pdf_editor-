"""Read / edit PDF document metadata (Info dictionary + synced XMP)."""
from __future__ import annotations

import warnings
from pathlib import Path

import pikepdf

from .pdf_ops import open_pdf

FIELDS = {
    "title": "/Title", "author": "/Author", "subject": "/Subject", "keywords": "/Keywords",
    "creator": "/Creator", "producer": "/Producer",
}
DATE_FIELDS = {"created": "/CreationDate", "modified": "/ModDate"}


def get_metadata(src: Path, password: str = "") -> dict:
    with open_pdf(src, password) as pdf:
        info = pdf.docinfo
        out: dict = {k: (str(info[v]) if v in info else None) for k, v in {**FIELDS, **DATE_FIELDS}.items()}
        out["pages"] = len(pdf.pages)
        out["pdf_version"] = pdf.pdf_version
        out["encrypted"] = pdf.is_encrypted
        return out


def update_metadata(src: Path, out: Path, changes: dict[str, str | None], *, clear_all: bool = False) -> dict:
    """`changes[field]`: str sets, '' removes, missing/None leaves untouched."""
    with open_pdf(src) as pdf:
        if clear_all:
            for k in list(pdf.docinfo.keys()):
                del pdf.docinfo[k]
            if "/Metadata" in pdf.Root:
                del pdf.Root["/Metadata"]
        for field, value in changes.items():
            key = FIELDS.get(field)
            if key is None or value is None:
                continue
            if value == "":
                if key in pdf.docinfo:
                    del pdf.docinfo[key]
            else:
                pdf.docinfo[key] = pikepdf.String(value)
        if not clear_all:
            with warnings.catch_warnings():  # keys without an XMP equivalent (e.g. /Trapped) are simply skipped
                warnings.simplefilter("ignore")
                with pdf.open_metadata(set_pikepdf_as_editor=False) as meta:
                    meta.load_from_docinfo(pdf.docinfo, delete_missing=True)
        pdf.save(out)
    return get_metadata(out)
