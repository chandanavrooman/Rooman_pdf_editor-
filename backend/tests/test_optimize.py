"""Compress, repair, flatten, OCR, deskew."""
import io

import fitz
import pdfplumber
import pikepdf
import pytest

from conftest import FIXTURES, needs_gs, needs_tesseract
import make_fixtures as mf


@needs_gs
@pytest.mark.parametrize("level", ["low", "medium", "high"])
def test_compress_large_pdf_is_really_smaller(user, level):
    d = user.fx("large.pdf")
    assert d["size"] > 5 * 1024 * 1024
    res = user.post("/api/optimize/compress", {"document_id": d["id"], "level": level})
    out = res["documents"][0]
    det = res["details"]
    assert det["before_bytes"] == d["size"] and det["after_bytes"] == out["size"]
    assert out["size"] < d["size"], f"{level}: {out['size']} !< {d['size']}"
    assert det["smaller"] is True and det["saved_percent"] > 0 and res["notice"] is None
    data = user.download(out)
    assert len(data) == out["size"]
    with pikepdf.open(io.BytesIO(data)) as pdf:   # still a valid 4 page PDF
        assert len(pdf.pages) == 4
    assert "Large fixture page 1" in fitz.open(stream=data, filetype="pdf")[0].get_text()


@needs_gs
def test_compress_levels_are_ordered(user):
    d = user.fx("large.pdf")
    sizes = {lv: user.post("/api/optimize/compress", {"document_id": d["id"], "level": lv})["details"]["after_bytes"]
             for lv in ("low", "medium", "high")}
    assert sizes["high"] < sizes["medium"] <= sizes["low"] < d["size"], sizes


@needs_gs
def test_compress_already_small_is_honest(user):
    d = user.fx("table.pdf")
    res = user.post("/api/optimize/compress", {"document_id": d["id"], "level": "high"})
    if not res["details"]["smaller"]:
        assert res["notice"] and res["details"]["after_bytes"] == res["details"]["before_bytes"]
        assert res["documents"][0]["size"] == d["size"]
    else:
        assert res["documents"][0]["size"] < d["size"]


def test_compress_invalid_level(user):
    d = user.fx("table.pdf")
    r = user.client.post("/api/optimize/compress", headers=user.h, json={"document_id": d["id"], "level": "extreme"})
    assert r.status_code == 422


def test_compress_clear_error_when_gs_missing(user, monkeypatch):
    monkeypatch.setenv("GS_PATH", "/nonexistent/gs")
    from app.core import config
    config.reset_settings_cache()
    try:
        d = user.fx("table.pdf")
        r = user.client.post("/api/optimize/compress", headers=user.h, json={"document_id": d["id"], "level": "low"})
        assert r.status_code == 503
        body = r.json()
        assert body["code"] == "EXTERNAL_TOOL_MISSING" and body["tool"] == "gs" and "Ghostscript" in body["detail"]
        caps = user.client.get("/api/system/capabilities").json()
        assert caps["programs"]["gs"]["available"] is False and caps["tools"]["compress"] is False
    finally:
        monkeypatch.undo()
        config.reset_settings_cache()


def test_repair_truncated_pdf(user, tmp_path):
    good = (FIXTURES / "multipage.pdf").read_bytes()
    broken = good[: int(len(good) * 0.8)]            # xref/trailer chopped off
    with pytest.raises(Exception):
        pikepdf.open(io.BytesIO(broken), attempt_recovery=False)
    d = user.upload("broken.pdf", content=broken)
    res = user.post("/api/optimize/repair", {"document_id": d["id"]})
    out = res["documents"][0]
    assert res["notice"] and "Repaired" in res["notice"]
    with pdfplumber.open(io.BytesIO(user.download(out))) as pdf:
        assert len(pdf.pages) >= 8
        assert "Chapter 1" in pdf.pages[0].extract_text()
    # and the repaired file works with other tools
    user.post("/api/organize/rotate", {"document_id": out["id"], "angle": 90})


def test_repair_garbage(user):
    d = user.upload("junk.pdf", content=b"%PDF-1.4\nnothing useful here at all\n")
    r = user.client.post("/api/optimize/repair", headers=user.h, json={"document_id": d["id"]})
    assert r.status_code == 422 and r.json()["code"] == "UNREPAIRABLE"


def test_repair_healthy_pdf(user):
    d = user.fx("table.pdf")
    res = user.post("/api/optimize/repair", {"document_id": d["id"]})
    assert "No structural problems" in res["notice"] and res["documents"][0]["pages"] == 1


def _form_pdf(path):
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 60), "Name:")
    w = fitz.Widget()
    w.field_type = fitz.PDF_WIDGET_TYPE_TEXT
    w.field_name = "name"
    w.field_value = "Ada Lovelace"
    w.rect = fitz.Rect(120, 45, 300, 70)
    page.add_widget(w)
    page.add_highlight_annot(fitz.Rect(72, 50, 110, 62))
    doc.save(path)


def test_flatten_forms_and_annotations(user, tmp_path):
    p = tmp_path / "form.pdf"
    _form_pdf(p)
    d = user.upload(p)
    res = user.post("/api/optimize/flatten", {"document_id": d["id"]})
    assert res["details"]["form_fields"] == 1
    data = user.download(res["documents"][0])
    out = fitz.open(stream=data, filetype="pdf")
    assert len(list(out[0].widgets())) == 0 and len(list(out[0].annots())) == 0
    assert "Ada Lovelace" in out[0].get_text()      # field value is now plain page content
    with pikepdf.open(io.BytesIO(data)) as pdf:
        assert "/AcroForm" not in pdf.Root or len(pdf.Root.AcroForm.get("/Fields", [])) == 0


@needs_tesseract
def test_ocr_makes_scanned_pdf_searchable(user):
    d = user.fx("scanned.pdf")
    with pdfplumber.open(io.BytesIO(user.download(d))) as pdf:
        assert not (pdf.pages[0].extract_text() or "").strip()     # truly image-only before
    res = user.post("/api/optimize/ocr", {"document_id": d["id"], "language": "eng"})
    out = res["documents"][0]
    assert out["pages"] == 2
    with pdfplumber.open(io.BytesIO(user.download(out))) as pdf:
        t0, t1 = pdf.pages[0].extract_text(), pdf.pages[1].extract_text()
        assert len(pdf.pages[0].images) >= 1               # original scan image kept
    for w in mf.SCANNED_WORDS:
        assert w in t0.upper()
    assert "SECOND" in t1.upper() and "4500" in t0


@needs_tesseract
def test_ocr_skips_pages_with_text_and_validates_language(user):
    d = user.fx("table.pdf")
    res = user.post("/api/optimize/ocr", {"document_id": d["id"]})
    with pdfplumber.open(io.BytesIO(user.download(res["documents"][0]))) as pdf:
        assert "Quarterly Sales Report" in pdf.pages[0].extract_text()
    r = user.client.post("/api/optimize/ocr", headers=user.h, json={"document_id": d["id"], "language": "xyz"})
    assert r.status_code == 422 and r.json()["code"] == "OCR_LANGUAGE_MISSING"
    r = user.client.post("/api/optimize/ocr", headers=user.h, json={"document_id": d["id"], "language": "eng; rm -rf"})
    assert r.status_code == 422


@needs_tesseract
def test_deskew_straightens_rotated_scan(user, tmp_path):
    import img2pdf
    from PIL import Image
    # a realistic 200 dpi text page, rotated by 4 degrees (like a crooked scan)
    from PIL import ImageDraw, ImageFont
    font = ImageFont.truetype(mf._font_path(), 50)
    img = Image.new("L", (1654, 2339), 255)
    d = ImageDraw.Draw(img)
    for i in range(25):
        d.text((150, 150 + i * 80), "The quick brown fox jumps over the lazy dog 12345", font=font, fill=0)
    skewed = img.rotate(4, expand=False, fillcolor=255)
    buf = io.BytesIO(); skewed.save(buf, "PNG")
    p = tmp_path / "skew.pdf"
    p.write_bytes(img2pdf.convert(buf.getvalue(), layout_fun=img2pdf.get_fixed_dpi_layout_fun((200, 200))))
    doc = user.upload(p)
    res = user.post("/api/optimize/deskew", {"document_id": doc["id"]})
    out = res["documents"][0]
    assert res["notice"]
    page = fitz.open(stream=user.download(out), filetype="pdf")[0]
    pix = page.get_pixmap(dpi=100, alpha=False)
    from PIL import Image as PI
    import numpy as np
    arr = np.array(PI.frombytes("RGB", (pix.width, pix.height), pix.samples).convert("L")) < 128

    def sharpness(a):  # row-projection variance: higher when text lines are horizontal
        return float(np.var(a.sum(axis=1)))

    before = fitz.open(stream=user.download(doc), filetype="pdf")[0].get_pixmap(dpi=100, alpha=False)
    b_arr = np.array(PI.frombytes("RGB", (before.width, before.height), before.samples).convert("L")) < 128
    assert sharpness(arr) > sharpness(b_arr) * 3, "deskewed page should have clearer horizontal text lines"


def test_compress_password_protected_is_a_clear_error(user):
    """Regression: Ghostscript output for a locked file used to be hidden behind 'could not be made smaller'."""
    d = user.upload(FIXTURES / "protected.pdf")
    r = user.client.post("/api/optimize/compress", headers=user.h, json={"document_id": d["id"], "level": "medium"})
    assert r.status_code == 422, r.text
    assert r.json()["code"] == "PASSWORD_REQUIRED"
    assert "Unlock" in r.json()["detail"]


@needs_gs
def test_compress_owner_password_only_still_works(user):
    """A file that opens without a password (owner password / restrictions only) can still be compressed."""
    d = user.upload(FIXTURES / "owner-only.pdf")
    res = user.post("/api/optimize/compress", {"document_id": d["id"], "level": "medium"})
    assert res["documents"][0]["pages"] == 1


@pytest.mark.parametrize("version,breaks", [((9, 55, 0), False), ((10, 0, 0), True), ((10, 1, 2), True), ((10, 2, 0), True), ((10, 2, 1), False), ((10, 5, 1), False), (None, False)])
def test_ghostscript_versions_that_break_skip_text(monkeypatch, version, breaks):
    """Debian 12 ships Ghostscript 10.0.0: ocrmypdf refuses --skip-text with it, so OCR must route around it."""
    from app.services import ocr as ocr_svc

    monkeypatch.setattr(ocr_svc, "gs_version", lambda: version)
    assert ocr_svc.gs_breaks_skip_text() is breaks
