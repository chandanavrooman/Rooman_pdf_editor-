"""Pure PDF page operations on file paths (no HTTP, no document store).

Page numbers in public APIs are 1-based; page specs look like "1-3,5,8-10".
"""
from __future__ import annotations

import contextlib
import io
import re
import zipfile
from pathlib import Path
from typing import Iterator, Sequence

import fitz
import pikepdf

from ..core.errors import bad_request, unprocessable

PAGE_SPEC_RE = re.compile(r"^[0-9,\-\s]+$")


# ---------------------------------------------------------------- opening
@contextlib.contextmanager
def open_pdf(path: Path, password: str = "") -> Iterator[pikepdf.Pdf]:
    try:
        pdf = pikepdf.open(path, password=password)
    except pikepdf.PasswordError:
        raise unprocessable(
            "PASSWORD_REQUIRED" if not password else "INVALID_PASSWORD",
            "This PDF is password protected. Unlock it first." if not password else "Wrong password.",
        ) from None
    except pikepdf.PdfError as e:
        raise unprocessable("INVALID_PDF", f"Could not read this PDF (it may be damaged — try the Repair tool): {e}") from None
    try:
        yield pdf
    finally:
        pdf.close()


def open_fitz(path: Path, password: str = "") -> "fitz.Document":
    """Open with PyMuPDF; refuses password-protected files unless the password is given."""
    try:
        doc = fitz.open(path)
    except Exception as e:  # noqa: BLE001
        raise unprocessable("INVALID_PDF", f"Could not read this PDF (try the Repair tool): {e}") from None
    if doc.needs_pass and not doc.authenticate(password):
        doc.close()
        raise unprocessable(
            "PASSWORD_REQUIRED" if not password else "INVALID_PASSWORD",
            "This PDF is password protected. Unlock it first." if not password else "Wrong password.",
        )
    return doc


def page_count(path: Path) -> int | None:
    """Best-effort page count; None for encrypted or unreadable files."""
    try:
        with pikepdf.open(path) as pdf:
            return len(pdf.pages)
    except Exception:
        return None


# ---------------------------------------------------------------- page specs
def parse_page_spec(spec: str, total: int, *, allow_reverse: bool = False) -> list[int]:
    """'1-3,5' -> [0,1,2,4] (0-based, order preserved, duplicates removed, validated)."""
    if not isinstance(spec, str) or not spec.strip() or not PAGE_SPEC_RE.match(spec) or len(spec) > 500:
        raise bad_request("INVALID_PAGES", "Pages must look like 1-3,5,8-10")
    out: list[int] = []
    seen: set[int] = set()
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        m = re.fullmatch(r"(\d+)(?:\s*-\s*(\d+))?", part)
        if not m:
            raise bad_request("INVALID_PAGES", f"Invalid page range '{part}'")
        a = int(m.group(1))
        b = int(m.group(2)) if m.group(2) else a
        if a < 1 or b < 1 or a > total or b > total:
            raise bad_request("PAGE_OUT_OF_RANGE", f"Page range '{part}' is outside 1-{total}")
        if a > b:
            if not allow_reverse:
                raise bad_request("INVALID_PAGES", f"Range '{part}' is backwards")
            rng = range(a, b - 1, -1)
        else:
            rng = range(a, b + 1)
        for p in rng:
            if p - 1 not in seen:
                seen.add(p - 1)
                out.append(p - 1)
    if not out:
        raise bad_request("INVALID_PAGES", "No pages selected")
    return out


def parse_ranges(spec: str, total: int) -> list[list[int]]:
    """Each comma-separated part becomes one group of page indexes (used by split)."""
    groups = []
    for part in spec.split(","):
        if part.strip():
            groups.append(parse_page_spec(part, total))
    if not groups:
        raise bad_request("INVALID_PAGES", "No ranges given")
    return groups


def _subset(src: pikepdf.Pdf, indexes: Sequence[int]) -> pikepdf.Pdf:
    out = pikepdf.new()
    for i in indexes:
        out.pages.append(src.pages[i])
    return out


def _save(pdf: pikepdf.Pdf, path: Path) -> None:
    pdf.save(path, linearize=False, object_stream_mode=pikepdf.ObjectStreamMode.generate)


# ---------------------------------------------------------------- operations
def merge(paths: Sequence[Path], out: Path) -> int:
    if len(paths) < 2:
        raise bad_request("NEED_TWO_FILES", "Select at least two PDF files to merge")
    dest = pikepdf.new()
    try:
        for p in paths:
            with open_pdf(p) as src:
                dest.pages.extend(src.pages)
        _save(dest, out)
        return len(dest.pages)
    finally:
        dest.close()


def extract_pages(path: Path, out: Path, spec: str) -> int:
    with open_pdf(path) as src:
        idx = parse_page_spec(spec, len(src.pages))
        sub = _subset(src, idx)
        _save(sub, out)
        sub.close()
        return len(idx)


def delete_pages(path: Path, out: Path, spec: str) -> int:
    with open_pdf(path) as src:
        total = len(src.pages)
        drop = set(parse_page_spec(spec, total))
        keep = [i for i in range(total) if i not in drop]
        if not keep:
            raise bad_request("CANNOT_DELETE_ALL", "You cannot delete every page of the document")
        sub = _subset(src, keep)
        _save(sub, out)
        sub.close()
        return len(keep)


def reorder_pages(path: Path, out: Path, order: Sequence[int]) -> int:
    """`order` is the new sequence of 1-based page numbers; may omit pages (drops them) but not repeat."""
    with open_pdf(path) as src:
        total = len(src.pages)
        if not order or len(set(order)) != len(order):
            raise bad_request("INVALID_ORDER", "Page order must list each page at most once")
        if any(p < 1 or p > total for p in order):
            raise bad_request("PAGE_OUT_OF_RANGE", f"Pages must be within 1-{total}")
        sub = _subset(src, [p - 1 for p in order])
        _save(sub, out)
        sub.close()
        return len(order)


def rotate_pages(path: Path, out: Path, angle: int, spec: str | None = None) -> int:
    if angle not in (90, 180, 270, -90, -180, -270):
        raise bad_request("INVALID_ANGLE", "Angle must be 90, 180 or 270")
    with open_pdf(path) as pdf:
        total = len(pdf.pages)
        idx = parse_page_spec(spec, total) if spec else list(range(total))
        for i in idx:
            pdf.pages[i].rotate(angle, relative=True)
        _save(pdf, out)
        return len(idx)


def crop_pages(path: Path, out: Path, top: float, right: float, bottom: float, left: float,
               spec: str | None = None) -> int:
    """Crop margins (in PDF points) from the visible page area."""
    if min(top, right, bottom, left) < 0:
        raise bad_request("INVALID_MARGINS", "Margins cannot be negative")
    with open_pdf(path) as pdf:
        total = len(pdf.pages)
        idx = parse_page_spec(spec, total) if spec else list(range(total))
        for i in idx:
            page = pdf.pages[i]
            x0, y0, x1, y1 = [float(v) for v in (page.get("/CropBox") or page.MediaBox)]
            nx0, ny0, nx1, ny1 = x0 + left, y0 + bottom, x1 - right, y1 - top
            if nx1 - nx0 < 10 or ny1 - ny0 < 10:
                raise bad_request("INVALID_MARGINS", f"Margins leave no visible area on page {i + 1}")
            box = pikepdf.Array([nx0, ny0, nx1, ny1])
            page.CropBox = box
        _save(pdf, out)
        return len(idx)


# ---------------------------------------------------------------- split
def _bookmark_starts(path: Path) -> list[tuple[str, int]]:
    """(title, 0-based start page) for top-level bookmarks, sorted by page."""
    from pypdf import PdfReader

    reader = PdfReader(str(path))
    res: list[tuple[str, int]] = []
    for item in reader.outline:
        if isinstance(item, list):
            continue  # nested levels ignored: split on top-level only
        try:
            res.append((str(item.title), reader.get_destination_page_number(item)))
        except Exception:
            continue
    res.sort(key=lambda t: t[1])
    dedup: list[tuple[str, int]] = []
    for t, p in res:
        if not dedup or dedup[-1][1] != p:
            dedup.append((t, p))
    return dedup


def _slug(text: str) -> str:
    s = re.sub(r"[^\w\-]+", "_", text, flags=re.UNICODE).strip("_")
    return s[:40] or "part"


def split(path: Path, out_dir: Path, mode: str, *, ranges: str | None = None, every_n: int | None = None,
          max_size_mb: float | None = None, stem: str = "part") -> list[tuple[Path, str, int]]:
    """Split a PDF. Returns [(file, suggested_name, pages)]."""
    results: list[tuple[Path, str, int]] = []
    out_dir.mkdir(parents=True, exist_ok=True)
    with open_pdf(path) as src:
        total = len(src.pages)
        groups: list[tuple[str, list[int]]] = []
        if mode == "ranges":
            if not ranges:
                raise bad_request("INVALID_PAGES", "Provide page ranges, e.g. 1-3,4-6")
            for g in parse_ranges(ranges, total):
                label = f"{g[0] + 1}" if len(g) == 1 else f"{g[0] + 1}-{g[-1] + 1}"
                groups.append((f"pages_{label}", g))
        elif mode == "every_n":
            if not every_n or every_n < 1:
                raise bad_request("INVALID_N", "'every_n' must be at least 1")
            for start in range(0, total, every_n):
                g = list(range(start, min(start + every_n, total)))
                groups.append((f"pages_{g[0] + 1}-{g[-1] + 1}" if len(g) > 1 else f"page_{g[0] + 1}", g))
        elif mode == "bookmarks":
            marks = _bookmark_starts(path)
            if not marks:
                raise unprocessable("NO_BOOKMARKS", "This PDF has no bookmarks to split on")
            if marks[0][1] != 0:  # content before first bookmark
                marks.insert(0, ("front", 0))
            for i, (title, start) in enumerate(marks):
                end = marks[i + 1][1] if i + 1 < len(marks) else total
                groups.append((f"{i + 1:02d}_{_slug(title)}", list(range(start, end))))
        elif mode == "by_size":
            if not max_size_mb or max_size_mb <= 0:
                raise bad_request("INVALID_SIZE", "'max_size_mb' must be greater than 0")
            limit = int(max_size_mb * 1024 * 1024)
            cur: list[int] = []
            parts: list[list[int]] = []
            for i in range(total):
                trial = cur + [i]
                if cur and _size_of(src, trial) > limit:
                    parts.append(cur)
                    cur = [i]
                else:
                    cur = trial
            if cur:
                parts.append(cur)
            for n, g in enumerate(parts, 1):
                groups.append((f"part_{n:02d}", g))
        else:
            raise bad_request("INVALID_MODE", "mode must be ranges, every_n, by_size or bookmarks")

        if len(groups) > 500:
            raise bad_request("TOO_MANY_PARTS", "This split would create more than 500 files")
        for n, (label, g) in enumerate(groups, 1):
            sub = _subset(src, g)
            f = out_dir / f"{n:03d}.pdf"
            _save(sub, f)
            sub.close()
            results.append((f, f"{stem}_{label}.pdf", len(g)))
    return results


def _size_of(src: pikepdf.Pdf, indexes: Sequence[int]) -> int:
    buf = io.BytesIO()
    sub = _subset(src, indexes)
    sub.save(buf)
    sub.close()
    return buf.getbuffer().nbytes


def zip_files(files: Sequence[tuple[Path, str]], out: Path) -> None:
    """Zip (path, arcname) pairs; arcnames are sanitized and de-duplicated."""
    used: set[str] = set()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for p, name in files:
            name = re.sub(r"[^\w.\- ]+", "_", name.replace("\\", "/").split("/")[-1]) or "file"
            base, dot, ext = name.rpartition(".")
            cand, k = name, 1
            while cand in used:
                k += 1
                cand = f"{base}_{k}.{ext}" if dot else f"{name}_{k}"
            used.add(cand)
            z.write(p, cand)
