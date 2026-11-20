"""OCR / deskew with ocrmypdf (+ Tesseract). Runs as a subprocess with a timeout."""
from __future__ import annotations

import re
import shutil
from pathlib import Path

from ..core.errors import bad_request, unprocessable
from . import external

_LANG_RE = re.compile(r"^[a-z]{3}(_[A-Za-z]+)?(\+[a-z]{3}(_[A-Za-z]+)?)*$")


def gs_version() -> tuple[int, ...] | None:
    gs = external.find_tool("gs")
    if not gs:
        return None
    try:
        out = external.run([gs, "--version"], timeout=20, label="Ghostscript").stdout.decode().strip()
        return tuple(int(x) for x in re.findall(r"\d+", out)[:3])
    except Exception:  # noqa: BLE001 (an odd version string must never stop OCR)
        return None


def gs_breaks_skip_text() -> bool:
    """Ghostscript 10.0.0 - 10.2.0 corrupts PDFs that already have text, so ocrmypdf refuses --skip-text with it.
    Debian 12 ships exactly such a version (10.0.0)."""
    v = gs_version()
    return v is not None and (10, 0, 0) <= (v + (0, 0, 0))[:3] < (10, 2, 1)


def pages_without_text(src: Path) -> list[int]:
    """1-based pages that have no text layer (the pages OCR is for)."""
    import fitz

    with fitz.open(src) as doc:
        return [i + 1 for i, pg in enumerate(doc) if not pg.get_text().strip()]


def available_languages() -> list[str]:
    tess = external.find_tool("tesseract")
    if not tess:
        return []
    proc = external.run([tess, "--list-langs"], timeout=20, label="Tesseract")
    langs = proc.stdout.decode().splitlines()[1:]
    return [l.strip() for l in langs if l.strip() and l.strip() != "osd"]


def _run_ocrmypdf(src: Path, out: Path, language: str, *, deskew: bool, force: bool, rotate: bool = False) -> None:
    external.require_tool("tesseract")
    if not _LANG_RE.match(language or ""):
        raise bad_request("INVALID_LANGUAGE", "Language must be a Tesseract code such as eng or eng+deu")
    missing = [l for l in language.split("+") if l not in available_languages()]
    if missing:
        raise unprocessable(
            "OCR_LANGUAGE_MISSING",
            f"Tesseract language data not installed: {', '.join(missing)}. Installed: {', '.join(available_languages())}",
        )
    mode = "--force-ocr" if force else "--skip-text"
    only: list[int] | None = None
    if not force and gs_breaks_skip_text():
        # same result as --skip-text without asking Ghostscript to touch pages that have text: OCR exactly the pages without
        # text and let ocrmypdf copy every other page through unchanged
        only = pages_without_text(src)
        if not only:
            shutil.copyfile(src, out)
            return
        mode = "--force-ocr"
    args = external.python_module_args(
        "ocrmypdf", mode, "--output-type", "pdf", "--optimize", "0",
        "-l", language, "--jobs", "2", "--quiet",
    )
    if only is not None:
        args += ["--pages", ",".join(str(n) for n in only)]
    if deskew:
        args.append("--deskew")
    if rotate:
        args.append("--rotate-pages")
    args += [str(src), str(out)]
    proc = external.run(args, label="OCR (ocrmypdf)", timeout=max(600, external.get_settings().external_timeout_seconds))
    if proc.returncode == 8:
        raise unprocessable("PASSWORD_REQUIRED", "This PDF is password protected. Unlock it first.")
    if proc.returncode != 0 or not out.exists():
        raise external.fail("OCR (ocrmypdf)", proc, 422)


def ocr(src: Path, out: Path, language: str = "eng", force: bool = False) -> None:
    """Make a searchable PDF. Pages that already have text are kept untouched unless force=True."""
    _run_ocrmypdf(src, out, language, deskew=False, force=force, rotate=True)


def deskew(src: Path, out: Path, language: str = "eng") -> None:
    """Straighten scanned (image-only) pages; pages that already contain text are left alone.

    Deskewing needs OCR to run on the page, so the output is also searchable.
    """
    _run_ocrmypdf(src, out, language, deskew=True, force=False)
