"""PDF compression with Ghostscript."""
from __future__ import annotations

import shutil
from dataclasses import dataclass
from pathlib import Path

from ..core.errors import bad_request
from . import external, pdf_ops

# level -> (PDFSETTINGS preset, colour/gray image DPI, JPEG quality hint)
LEVELS = {
    "low": ("/printer", 200),     # best quality, smallest saving
    "medium": ("/ebook", 150),    # balanced
    "high": ("/screen", 96),      # strongest compression
}


@dataclass
class CompressResult:
    before: int
    after: int
    smaller: bool

    @property
    def saved_percent(self) -> float:
        return round(100 * (self.before - self.after) / self.before, 1) if self.before else 0.0


def compress(src: Path, out: Path, level: str) -> CompressResult:
    if level not in LEVELS:
        raise bad_request("INVALID_LEVEL", "level must be low, medium or high")
    # Open with pikepdf first: a password-protected file must fail with a clear PASSWORD_REQUIRED error instead of
    # Ghostscript silently producing junk that the "not smaller → return the original" path would hide.
    with pdf_ops.open_pdf(src):
        pass
    gs = external.require_tool("gs")
    preset, dpi = LEVELS[level]
    args = [
        gs, "-sDEVICE=pdfwrite", "-dCompatibilityLevel=1.5", f"-dPDFSETTINGS={preset}",
        "-dNOPAUSE", "-dQUIET", "-dBATCH", "-dSAFER", "-dDetectDuplicateImages=true",
        "-dDownsampleColorImages=true", "-dColorImageDownsampleType=/Bicubic", f"-dColorImageResolution={dpi}",
        "-dDownsampleGrayImages=true", "-dGrayImageDownsampleType=/Bicubic", f"-dGrayImageResolution={dpi}",
        f"-sOutputFile={out}", str(src),
    ]
    proc = external.run(args, label="Ghostscript")
    if proc.returncode != 0 or not out.exists() or out.stat().st_size == 0:
        raise external.fail("Ghostscript", proc, 422)
    before, after = src.stat().st_size, out.stat().st_size
    if after >= before:
        # Honest result: compression did not help, so keep the original bytes.
        shutil.copyfile(src, out)
        return CompressResult(before, before, False)
    return CompressResult(before, after, True)
