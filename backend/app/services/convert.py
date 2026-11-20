"""Format conversion: PDF <-> Word / Excel / PowerPoint / images / text.

Rules: original pages are always rendered from the original file; no filler titles or page markers
are ever added to outputs; text is taken as real Unicode text (no leftover HTML/XML escapes).
"""
from __future__ import annotations

import html
import io
import logging
import re
import shutil
from dataclasses import dataclass, field
from pathlib import Path

import fitz
import img2pdf
from PIL import Image

from ..core.errors import bad_request, unprocessable
from . import external, ocr as ocr_service, pdf_ops
from .pdf_ops import open_fitz, parse_page_spec

log = logging.getLogger(__name__)

MAX_PIXELS = 60_000_000


@dataclass
class ConvertResult:
    notice: str | None = None
    details: dict = field(default_factory=dict)


# ------------------------------------------------------------------ helpers
def scanned_pages(src: Path) -> list[int]:
    """1-based numbers of pages that have no text layer but do contain images (i.e. scans)."""
    doc = open_fitz(src)
    try:
        res = []
        for i, page in enumerate(doc, 1):
            if not page.get_text("text").strip() and page.get_images(full=False):
                res.append(i)
        return res
    finally:
        doc.close()


def _clean_text(s: str) -> str:
    # remove control chars that are illegal in XML/Word, keep \n and \t
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f￾￿]", "", s)


# ------------------------------------------------------------------ PDF -> Word
def pdf_to_docx(src: Path, out: Path, work: Path) -> ConvertResult:
    notes: list[str] = []
    total = _page_total(src)
    scanned = scanned_pages(src)
    all_scanned = bool(scanned) and len(scanned) == total
    if all_scanned:
        # A scan has no text or tables for pdf2docx to work with: run OCR, then build a text document
        # from the recognised text (layout is not preserved).
        if not external.find_tool("tesseract"):
            notes.append(
                "This PDF is a scan and Tesseract OCR is not installed on the server, so there is no text to convert. "
                "The pages were placed in the Word file as images instead.")
            _image_docx(src, out)
            return ConvertResult(" ".join(notes), {"scanned_pages": scanned, "mode": "images"})
        ocr_pdf = work / "ocr.pdf"
        ocr_service.ocr(src, ocr_pdf, "eng")
        _plain_text_docx(ocr_pdf, out)
        notes.append("This PDF is a scan, so it was run through OCR and the recognised text was placed in the Word file. "
                     "Layout, tables and images are not preserved and recognition errors are possible — please proofread.")
        return ConvertResult(" ".join(notes), {"scanned_pages": scanned, "mode": "ocr-text"})
    if scanned:
        notes.append(f"{len(scanned)} scanned page(s) have no text layer, so they stay as images in the Word file "
                     "(run the OCR tool first if you need that text).")
    upright, turned = _upright_copy(src, work)
    if turned:
        notes.append(f"{len(turned)} page(s) with sideways text (page {', '.join(map(str, turned))}) were turned so the text "
                     "is horizontal and editable in Word.")
    try:
        _run_pdf2docx(upright, out)
    except Exception as e:  # noqa: BLE001
        log.warning("pdf2docx failed (%s); falling back to plain text", e)
        _plain_text_docx(src, out)
        notes.append("Layout-preserving conversion failed for this file; a plain-text Word document was produced "
                     "instead (tables, images and layout are not preserved).")
    return ConvertResult(" ".join(notes) or None, {"scanned_pages": scanned, "mode": "layout", "turned_pages": turned})


# pdf2docx only keeps horizontal text: text on pages with /Rotate, or text that runs sideways on the page, was silently
# dropped (content loss). Pages are normalised first. Maps the dominant text direction to the turn that makes it horizontal.
_TURN_FOR_DIR = {(0, 1): 270, (-1, 0): 180, (0, -1): 90}


def _dominant_text_dir(page: "fitz.Page") -> tuple[int, int]:
    weight: dict[tuple[int, int], int] = {}
    for block in page.get_text("dict")["blocks"]:
        if block.get("type") != 0:
            continue
        for line in block["lines"]:
            d = (round(line["dir"][0]), round(line["dir"][1]))
            weight[d] = weight.get(d, 0) + sum(len(sp["text"].strip()) for sp in line["spans"])
    return max(weight, key=weight.get) if weight else (1, 0)


def _upright_copy(src: Path, work: Path) -> tuple[Path, list[int]]:
    """Copy of `src` where every page has /Rotate 0 and horizontal text (content transformed, nothing re-typeset).

    Returns (path to convert, 1-based numbers of pages whose text had to be turned). The original file is untouched;
    when nothing needs changing `src` itself is returned.
    """
    doc = open_fitz(src)
    try:
        changed = False
        turned: list[int] = []
        for pno, page in enumerate(doc, 1):
            if page.rotation:
                page.remove_rotation()  # keeps the page looking exactly as displayed
                changed = True
            turn = _TURN_FOR_DIR.get(_dominant_text_dir(page))
            if turn:
                page.set_rotation(turn)
                page.remove_rotation()
                changed = True
                turned.append(pno)
        if not changed:
            return src, []
        dst = work / "upright.pdf"
        doc.save(dst, garbage=1)
        return dst, turned
    finally:
        doc.close()


def _page_total(src: Path) -> int:
    doc = open_fitz(src)
    try:
        return len(doc)
    finally:
        doc.close()


def _image_docx(src: Path, out: Path) -> None:
    import docx
    from docx.shared import Inches

    doc = open_fitz(src)
    d = docx.Document()
    try:
        for i, page in enumerate(doc):
            if i:
                d.add_page_break()
            img = out.with_suffix(f".p{i}.png")
            page.get_pixmap(dpi=150, alpha=False).save(img)
            d.add_picture(str(img), width=Inches(6.2))
            img.unlink()
    finally:
        doc.close()
    d.save(out)


def _run_pdf2docx(src: Path, out: Path) -> None:
    from pdf2docx import Converter

    logging.getLogger("pdf2docx").setLevel(logging.ERROR)
    cv = Converter(str(src))
    try:
        cv.convert(str(out))
    finally:
        cv.close()
    if not out.exists() or out.stat().st_size == 0:
        raise RuntimeError("pdf2docx produced no output")


def _plain_text_docx(src: Path, out: Path) -> None:
    import docx

    doc = fitz.open(src)
    d = docx.Document()
    try:
        first = True
        for page in doc:
            if not first:
                d.add_page_break()
            first = False
            for block in page.get_text("blocks"):
                if block[6] == 0 and block[4].strip():
                    d.add_paragraph(_clean_text(block[4].strip()))
    finally:
        doc.close()
    d.save(out)


# ------------------------------------------------------------------ PDF -> PowerPoint
def pdf_to_pptx(src: Path, out: Path, work: Path, mode: str = "image", dpi: int = 150) -> ConvertResult:
    """mode='image': each original page rendered full-bleed (pixel-faithful, not editable).
    mode='editable': page background (graphics/images, text removed) + real text boxes per line."""
    from pptx import Presentation
    from pptx.dml.color import RGBColor
    from pptx.util import Emu, Pt

    if mode not in ("image", "editable"):
        raise bad_request("INVALID_MODE", "mode must be image or editable")
    dpi = max(72, min(int(dpi), 220))
    doc = open_fitz(src)
    try:
        prs = Presentation()
        first = doc[0].rect
        scale = min(1.0, 56 * 72 / max(first.width, first.height))  # PowerPoint max slide = 56in
        prs.slide_width, prs.slide_height = Emu(int(first.width * 12700 * scale)), Emu(int(first.height * 12700 * scale))
        blank = prs.slide_layouts[6]
        for pno, page in enumerate(doc, 1):
            slide = prs.slides.add_slide(blank)
            sw, sh = prs.slide_width, prs.slide_height
            if mode == "image":
                pix = page.get_pixmap(dpi=dpi, alpha=False)
                img = work / f"p{pno}.jpg"
                pix.save(img, jpg_quality=88)
                slide.shapes.add_picture(str(img), 0, 0, sw, sh)
                img.unlink(missing_ok=True)
                continue
            # editable: background without text, then text boxes
            tmp = fitz.open(src)
            try:
                bg_page = tmp[pno - 1]
                data = bg_page.get_text("dict")
                lines = [(b, l) for b in data["blocks"] if b["type"] == 0 for l in b["lines"]]
                for _, l in lines:
                    bg_page.add_redact_annot(fitz.Rect(l["bbox"]))
                bg_page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE, graphics=fitz.PDF_REDACT_LINE_ART_NONE,
                                         text=fitz.PDF_REDACT_TEXT_REMOVE)
                pix = bg_page.get_pixmap(dpi=dpi, alpha=False)
                img = work / f"p{pno}.jpg"
                pix.save(img, jpg_quality=88)
                slide.shapes.add_picture(str(img), 0, 0, sw, sh)
                img.unlink(missing_ok=True)
            finally:
                tmp.close()
            k = sw / page.rect.width
            for _, l in lines:
                spans = [s for s in l["spans"] if s["text"].strip()]
                if not spans:
                    continue
                x0, y0, x1, y1 = l["bbox"]
                tb = slide.shapes.add_textbox(Emu(int(x0 * k)), Emu(int(y0 * k)), Emu(int((x1 - x0) * k * 1.05) + 1), Emu(int((y1 - y0) * k)))
                tf = tb.text_frame
                tf.word_wrap = False
                tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
                p = tf.paragraphs[0]
                for s in l["spans"]:
                    r = p.add_run()
                    r.text = _clean_text(s["text"])
                    r.font.size = Pt(max(1, s["size"] * k / 12700))
                    r.font.name = re.sub(r"^[A-Z]{6}\+", "", s["font"]).split("-")[0].split(",")[0] or "Arial"
                    r.font.bold = bool(s["flags"] & 16)
                    r.font.italic = bool(s["flags"] & 2)
                    c = s["color"]
                    r.font.color.rgb = RGBColor((c >> 16) & 255, (c >> 8) & 255, c & 255)
        prs.save(out)
        notice = None
        if mode == "editable":
            notice = ("Editable mode: text is real text boxes over a background image of the page's graphics; fonts are "
                      "matched by name, so layout may shift slightly if a font is missing.")
        return ConvertResult(notice, {"slides": len(doc)})
    finally:
        doc.close()


# ------------------------------------------------------------------ PDF -> images / text
def pdf_to_images(src: Path, out_zip: Path, work: Path, fmt: str = "png", dpi: int = 150,
                  pages: str | None = None) -> int:
    fmt = fmt.lower()
    if fmt not in ("png", "jpg"):
        raise bad_request("INVALID_FORMAT", "format must be png or jpg")
    dpi = max(36, min(int(dpi), 400))
    doc = open_fitz(src)
    try:
        idx = parse_page_spec(pages, len(doc)) if pages else list(range(len(doc)))
        files = []
        for i in idx:
            page = doc[i]
            if page.rect.width * page.rect.height * (dpi / 72) ** 2 > MAX_PIXELS:
                raise bad_request("TOO_LARGE", f"Page {i + 1} is too large to render at {dpi} dpi; lower the resolution")
            pix = page.get_pixmap(dpi=dpi, alpha=False)
            f = work / f"page-{i + 1:03d}.{fmt}"
            pix.save(f, jpg_quality=90) if fmt == "jpg" else pix.save(f)
            files.append((f, f.name))
        pdf_ops.zip_files(files, out_zip)
        return len(files)
    finally:
        doc.close()


def pdf_to_text(src: Path, out: Path, pages: str | None = None) -> int:
    doc = open_fitz(src)
    try:
        idx = parse_page_spec(pages, len(doc)) if pages else list(range(len(doc)))
        parts = [_clean_text(doc[i].get_text("text")).strip() for i in idx]
    finally:
        doc.close()
    parts = [p for p in parts if p]
    if not parts:
        raise unprocessable("NO_TEXT_FOUND", "This PDF has no text layer (it looks scanned). Run OCR first, then convert to text.")
    # bytes, not write_text: the file must have plain LF line ends on Windows too (text mode would turn them into CRLF)
    out.write_bytes(("\n\n".join(parts) + "\n").encode("utf-8"))
    return len(parts)


# ------------------------------------------------------------------ Office -> PDF
def office_to_pdf(src: Path, out: Path, work: Path, ext: str) -> None:
    if ext not in ("docx", "xlsx", "pptx"):
        raise bad_request("UNSUPPORTED_TYPE", "Only Word, Excel and PowerPoint files are supported")
    soffice = external.require_tool("soffice")
    indir, outdir, profile = work / "in", work / "out", work / "profile"
    for d in (indir, outdir, profile):
        d.mkdir()
    local = indir / f"input.{ext}"
    shutil.copyfile(src, local)
    args = [
        soffice, f"-env:UserInstallation={profile.as_uri()}", "--headless", "--norestore", "--nolockcheck",
        "--nodefault", "--nofirststartwizard", "--convert-to", "pdf", "--outdir", str(outdir), str(local),
    ]
    result = outdir / "input.pdf"
    for attempt in (1, 2):  # LibreOffice occasionally fails on a cold start; one retry is cheap
        proc = external.run(args, label="LibreOffice", timeout=max(240, external.get_settings().external_timeout_seconds),
                            env=external.tool_env({"HOME": str(work)}))
        if result.exists() and result.stat().st_size > 0:
            break
    if proc.returncode != 0 or not result.exists() or result.stat().st_size == 0:
        raise external.fail("LibreOffice", proc, 422)
    shutil.move(str(result), out)


# ------------------------------------------------------------------ images / text -> PDF
def _normalise_image(data: bytes) -> bytes:
    """Flatten transparency (img2pdf refuses alpha) — otherwise bytes are passed through untouched."""
    im = Image.open(io.BytesIO(data))
    if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
        im = im.convert("RGBA")
        bg = Image.new("RGB", im.size, (255, 255, 255))
        bg.paste(im, mask=im.getchannel("A"))
        buf = io.BytesIO()
        bg.save(buf, "PNG")
        return buf.getvalue()
    return data


PAGE_SIZES_MM = {"a4": (210, 297), "letter": (215.9, 279.4)}


def images_to_pdf(paths: list[Path], out: Path, page_size: str = "fit", margin_mm: float = 0,
                  orientation: str = "auto") -> int:
    if not paths:
        raise bad_request("NO_IMAGES", "Select at least one image")
    data = [_normalise_image(p.read_bytes()) for p in paths]
    kwargs = {}
    if page_size != "fit":
        if page_size not in PAGE_SIZES_MM:
            raise bad_request("INVALID_PAGE_SIZE", "page_size must be fit, a4 or letter")
        w, h = (img2pdf.mm_to_pt(v) for v in PAGE_SIZES_MM[page_size])

        def layout(imgwidthpx, imgheightpx, ndpi):
            landscape = imgwidthpx > imgheightpx if orientation == "auto" else orientation == "landscape"
            size = (h, w) if landscape else (w, h)
            return img2pdf.get_layout_fun(size, border=(img2pdf.mm_to_pt(margin_mm),) * 2,
                                          fit=img2pdf.FitMode.into)(imgwidthpx, imgheightpx, ndpi)

        kwargs["layout_fun"] = layout
    try:
        out.write_bytes(img2pdf.convert(data, **kwargs))
    except Exception as e:  # noqa: BLE001
        raise unprocessable("INVALID_IMAGE", f"Could not convert image: {e}") from None
    return len(data)


def decode_text(data: bytes) -> str:
    for enc in ("utf-8-sig", "utf-16"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("cp1252", errors="replace")


def text_to_pdf(text: str, out: Path, font_size: float = 11, page_size: str = "a4") -> int:
    """Paginated PDF from plain text. Text is HTML-escaped, so '&', '<' and '>' appear exactly as typed."""
    text = _clean_text(text).replace("\r\n", "\n").replace("\r", "\n").replace("\t", "    ")
    if not text.strip():
        raise bad_request("EMPTY_TEXT", "There is no text to convert")
    paras = "".join(
        f'<p style="margin:0;white-space:pre-wrap">{html.escape(line) if line else "<br/>"}</p>' for line in text.split("\n")
    )
    css = f"body{{font-family:sans-serif;font-size:{font_size}pt;line-height:1.35}}"
    story = fitz.Story(html=f"<html><body>{paras}</body></html>", user_css=css)
    media = fitz.paper_rect(page_size)
    where = media + (54, 54, -54, -54)
    writer = fitz.DocumentWriter(str(out))
    pages, more = 0, 1
    while more:
        dev = writer.begin_page(media)
        more, _ = story.place(where)
        story.draw(dev)
        writer.end_page()
        pages += 1
    writer.close()
    return pages


# ------------------------------------------------------------------ HTML -> PDF (headless Chromium)
# The HTML is untrusted. Three layers keep it from reaching anything: (1) a Content-Security-Policy placed BEFORE the user's markup
# (no scripts, no frames, no file:// or http(s) sub-resources; only inline styles and data: images and fonts), (2) meta-refresh / <base>
# tags are removed, (3) the browser is started with every network connection pointed at a dead proxy.
_CSP = ("<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data:; "
        "style-src 'unsafe-inline'; font-src data:\">")
_STRIP = re.compile(r"<meta\b[^>]*http-equiv\s*=\s*[\"']?\s*(?:refresh|content-security-policy)[^>]*>|<base\b[^>]*>", re.I)


def wrap_html(src: str, page_size: str = "a4", orientation: str = "portrait") -> str:
    size = {"a4": "A4", "letter": "Letter"}[page_size] + (" landscape" if orientation == "landscape" else "")
    body = _STRIP.sub("", _clean_text(src))
    return (f"<!doctype html><html><head><meta charset=\"utf-8\">{_CSP}"
            f"<style>@page{{size:{size};margin:15mm}}</style></head><body>{body}</body></html>")


def html_to_pdf(src: str, out: Path, work: Path, page_size: str = "a4", orientation: str = "portrait") -> None:
    if not src.strip():
        raise bad_request("EMPTY_HTML", "There is no HTML to convert")
    browser = external.require_tool("chromium")
    page = work / "page.html"
    page.write_text(wrap_html(src, page_size, orientation), encoding="utf-8")
    profile = work / "profile"
    profile.mkdir()
    result = work / "result.pdf"
    args = [
        browser, "--headless", "--disable-gpu", "--disable-extensions", "--disable-background-networking", "--no-first-run",
        "--no-pdf-header-footer", "--print-to-pdf-no-header", "--disable-dev-shm-usage",
        "--proxy-server=socks5://127.0.0.1:1", f"--user-data-dir={profile}", f"--print-to-pdf={result}",
    ]
    if external.get_settings().chromium_no_sandbox:
        args.append("--no-sandbox")
    args.append(page.as_uri())
    proc = external.run(args, label="Chromium", timeout=max(90, external.get_settings().external_timeout_seconds),
                        env=external.tool_env({"HOME": str(work)}))
    if not result.exists() or result.stat().st_size == 0 or result.read_bytes()[:5] != b"%PDF-":
        raise external.fail("Chromium", proc, 422)
    shutil.move(str(result), out)
