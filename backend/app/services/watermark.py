"""Text / image watermarks with PyMuPDF."""
from __future__ import annotations

import io
from pathlib import Path

import fitz  # PyMuPDF
from PIL import Image

from ..core.errors import bad_request, unprocessable
from .pdf_ops import open_fitz as _open, parse_page_spec


def _rgb(hex_color: str) -> tuple[float, float, float]:
    h = hex_color.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))  # type: ignore[return-value]


def watermark(src: Path, out: Path, *, text: str | None = None, image: bytes | None = None,
              opacity: float = 0.3, rotation: float = 45, font_size: float = 60, color: str = "#888888",
              pages: str | None = None, layout: str = "center", image_scale: float = 0.5) -> int:
    if not text and not image:
        raise bad_request("WATERMARK_EMPTY", "Provide watermark text or an image")
    doc = _open(src)
    try:
        idx = parse_page_spec(pages, len(doc)) if pages else list(range(len(doc)))
        img_png = _prepare_image(image, opacity, rotation) if image else None
        for i in idx:
            page = doc[i]
            # work in the page's visible, unrotated coordinate space
            rect = page.rect
            centers = _positions(rect, layout, text_size=(font_size * 0.6 * len(text or ""), font_size))
            for cx, cy in centers:
                if text:
                    _stamp_text(page, text, cx, cy, font_size, color, opacity, rotation)
                else:
                    w = rect.width * image_scale
                    ar = img_png[1]
                    h = w / ar
                    page.insert_image(fitz.Rect(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2),
                                      stream=img_png[0], overlay=True)
        doc.save(out, garbage=3, deflate=True)
        return len(idx)
    finally:
        doc.close()


def _positions(rect: fitz.Rect, layout: str, text_size: tuple[float, float]) -> list[tuple[float, float]]:
    if layout == "center":
        return [(rect.width / 2, rect.height / 2)]
    if layout == "tile":
        step_x = max(text_size[0] * 1.6, 150)
        step_y = max(text_size[1] * 4, 160)
        pts = []
        y = step_y / 2
        row = 0
        while y < rect.height + step_y / 2:
            x = step_x / 2 + (step_x / 2 if row % 2 else 0) - step_x / 2
            while x < rect.width + step_x / 2:
                pts.append((x, y))
                x += step_x
            y += step_y
            row += 1
        return pts
    raise bad_request("INVALID_LAYOUT", "layout must be center or tile")


def _stamp_text(page: fitz.Page, text: str, cx: float, cy: float, size: float, color: str,
                opacity: float, rotation: float) -> None:
    # insert into unrotated page space, then rotate around the anchor point
    font = fitz.Font("helv")
    width = font.text_length(text, fontsize=size)
    origin = fitz.Point(cx - width / 2, cy + size * 0.3)
    pivot = fitz.Point(cx, cy)
    morph = (pivot, fitz.Matrix(-rotation)) if rotation else None
    if page.rotation:
        # derotate so the watermark appears upright on the displayed page
        origin = origin * page.derotation_matrix
        pivot = pivot * page.derotation_matrix
        morph = (pivot, fitz.Matrix(-(rotation - page.rotation)))
    page.insert_text(origin, text, fontsize=size, fontname="helv", color=_rgb(color),
                     fill_opacity=opacity, stroke_opacity=opacity, morph=morph, overlay=True)


def _prepare_image(data: bytes, opacity: float, rotation: float) -> tuple[bytes, float]:
    try:
        img = Image.open(io.BytesIO(data)).convert("RGBA")
    except Exception:  # noqa: BLE001
        raise unprocessable("INVALID_IMAGE", "Watermark image could not be read") from None
    alpha = img.getchannel("A").point(lambda a: int(a * max(0.0, min(1.0, opacity))))
    img.putalpha(alpha)
    if rotation:
        img = img.rotate(rotation, expand=True, resample=Image.BICUBIC)
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue(), img.width / img.height

