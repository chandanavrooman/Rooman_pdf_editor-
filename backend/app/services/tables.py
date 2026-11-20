"""Table extraction with pdfplumber (JSON rows + XLSX export)."""
from __future__ import annotations

import re
from pathlib import Path

import pdfplumber
from openpyxl import Workbook
from openpyxl.styles import Font
from openpyxl.utils import get_column_letter

from ..core.errors import unprocessable
from .pdf_ops import parse_page_spec

_NUM = re.compile(r"^-?(0|[1-9]\d{0,14})(\.\d+)?$")


def _clean(cell: str | None) -> str:
    return re.sub(r"\s*\n\s*", " ", cell).strip() if cell else ""


def extract_tables(src: Path, pages: str | None = None, password: str = "") -> list[dict]:
    """[{page, index, rows:[[str]]}] — real tables detected on the original pages."""
    out: list[dict] = []
    with pdfplumber.open(src, password=password or None) as pdf:
        idx = parse_page_spec(pages, len(pdf.pages)) if pages else list(range(len(pdf.pages)))
        for i in idx:
            for t, table in enumerate(pdf.pages[i].extract_tables(), 1):
                rows = [[_clean(c) for c in row] for row in table if any((c or "").strip() for c in row)]
                if rows:
                    out.append({"page": i + 1, "index": t, "rows": rows})
    return out


def tables_to_xlsx(tables: list[dict], out: Path) -> None:
    if not tables:
        raise unprocessable("NO_TABLES_FOUND", "No tables were found in this PDF (scanned pages need OCR first)")
    wb = Workbook()
    wb.remove(wb.active)
    for n, t in enumerate(tables, 1):
        ws = wb.create_sheet(title=f"p{t['page']}_t{t['index']}"[:31])
        for r, row in enumerate(t["rows"], 1):
            for c, val in enumerate(row, 1):
                cell = ws.cell(row=r, column=c, value=float(val) if _NUM.match(val) and "." in val else (int(val) if _NUM.match(val) else val))
                if r == 1:
                    cell.font = Font(bold=True)
        for c in range(1, max(len(r) for r in t["rows"]) + 1):
            width = max(len(str(r[c - 1])) if c - 1 < len(r) else 0 for r in t["rows"])
            ws.column_dimensions[get_column_letter(c)].width = min(max(10, width + 2), 60)
    wb.save(out)


def pdf_to_xlsx(src: Path, out: Path, pages: str | None = None) -> int:
    tables = extract_tables(src, pages)
    tables_to_xlsx(tables, out)
    return len(tables)
