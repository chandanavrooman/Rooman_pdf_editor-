"""Conversion endpoints: every output is opened and its real content checked."""
import io
import re
import zipfile
import xml.etree.ElementTree as ET

import docx
import fitz
import openpyxl
import pdfplumber
import pytest
from pptx import Presentation

from conftest import FIXTURES, needs_chromium, needs_soffice, needs_tesseract
import make_fixtures as mf

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def docx_tables(data: bytes):
    """Return (document_xml, [table -> [row -> [cell text]]]) parsed from the .docx zip."""
    z = zipfile.ZipFile(io.BytesIO(data))
    xml = z.read("word/document.xml").decode("utf-8")
    root = ET.fromstring(xml)
    tables = []
    for tbl in root.iter(W + "tbl"):
        rows = []
        for tr in tbl.findall(W + "tr"):
            rows.append(["".join(t.text or "" for t in tc.iter(W + "t")).strip() for tc in tr.findall(W + "tc")])
        tables.append(rows)
    return xml, tables


def test_pdf_to_word_keeps_real_table(user):
    d = user.fx("table.pdf")
    res = user.post("/api/convert/pdf-to-word", {"document_id": d["id"]})
    out = res["documents"][0]
    assert out["kind"] == "docx" and out["filename"] == "table.docx"
    xml, tables = docx_tables(user.download(out))
    assert "<w:tbl>" in xml, "document.xml must contain a real Word table"
    assert len(tables) == 1
    expected = [mf.TABLE_HEADER] + mf.TABLE_ROWS
    assert len(tables[0]) == len(expected) == 6          # rows
    assert all(len(r) == 5 for r in tables[0])            # columns
    assert tables[0] == expected                          # every cell text
    # no filler text anywhere
    flat = " ".join(" ".join(r) for r in tables[0]) + re.sub(r"<[^>]+>", " ", xml)
    for filler in ("Page 1", "Converted Document", "--- Page", "Page 2"):
        assert filler not in flat
    assert mf.TABLE_HEADING in re.sub(r"<[^>]+>", "", xml)
    assert res["notice"] is None


def test_pdf_to_word_keeps_colors_and_alignment(user):
    d = user.fx("table.pdf")
    out = user.post("/api/convert/pdf-to-word", {"document_id": d["id"]})["documents"][0]
    xml, _ = docx_tables(user.download(out))
    fills = {f.lower() for f in re.findall(r'w:fill="([0-9a-fA-F]{6})"', xml)}
    # header colour #1f4e79 (pdf2docx rounds a channel by 1)
    assert any(abs(int(f[0:2], 16) - 0x1F) <= 1 and abs(int(f[2:4], 16) - 0x4E) <= 1 and abs(int(f[4:6], 16) - 0x79) <= 1
               for f in fills), fills
    assert 'w:color w:val="FFFFFF"' in xml            # white header text colour
    assert 'w:jc w:val="right"' in xml                # right-aligned numeric columns
    assert "Helvetica" in xml and "<w:b/>" in xml     # font name and bold kept


def test_pdf_to_word_entities_decoded(user):
    d = user.fx("entities.pdf")
    out = user.post("/api/convert/pdf-to-word", {"document_id": d["id"]})["documents"][0]
    data = user.download(out)
    text = "\n".join(p.text for p in docx.Document(io.BytesIO(data)).paragraphs)
    assert mf.ENTITY_TEXT in text
    raw = zipfile.ZipFile(io.BytesIO(data)).read("word/document.xml").decode()
    assert "&amp;amp;" not in raw and "&amp;lt;" not in raw
    assert "Page 1" not in raw


def test_pdf_to_word_multipage_no_filler(user):
    d = user.fx("multipage.pdf")
    out = user.post("/api/convert/pdf-to-word", {"document_id": d["id"]})["documents"][0]
    text = "\n".join(p.text for p in docx.Document(io.BytesIO(user.download(out))).paragraphs)
    assert "Chapter 12 heading" in text and "CH07X" in text
    assert "Page 1" not in text and "Converted Document" not in text


@needs_tesseract
def test_pdf_to_word_keeps_text_of_rotated_pages(user):
    """Regression (feature matrix): pdf2docx silently dropped all text on a page with /Rotate 90."""
    d = user.upload(FIXTURES / "mixed.pdf")
    res = user.post("/api/convert/pdf-to-word", {"document_id": d["id"]})
    xml, _ = docx_tables(user.download(res["documents"][0]))
    text = re.sub(r"<[^>]+>", "", xml)
    for i in range(1, 6):
        assert f"MIX0{i}" in text, f"page {i} text lost"
    assert res["details"]["turned_pages"] == [4]
    assert "turned" in res["notice"]


def test_pdf_to_word_landscape_stored_as_rotated_portrait(user, tmp_path):
    """The common real-world case: a portrait page whose content is drawn sideways and shown as landscape via /Rotate."""
    src = fitz.open()
    page = src.new_page(width=595, height=842)
    page.insert_text((100, 700), "Landscape via rotate LND01", fontsize=16, rotate=90)
    page.set_rotation(90)
    path = tmp_path / "landscape.pdf"
    src.save(path)
    d = user.upload(path)
    res = user.post("/api/convert/pdf-to-word", {"document_id": d["id"]})
    assert "LND01" in re.sub(r"<[^>]+>", "", docx_tables(user.download(res["documents"][0]))[0])
    assert res["details"]["turned_pages"] == []  # removing /Rotate was enough: text is horizontal as displayed


@needs_tesseract
def test_pdf_to_word_scanned_runs_ocr_first(user):
    d = user.fx("scanned.pdf")
    res = user.post("/api/convert/pdf-to-word", {"document_id": d["id"]})
    assert res["notice"] and "OCR" in res["notice"]
    assert res["details"]["scanned_pages"] == [1, 2]
    text = "\n".join(p.text for p in docx.Document(io.BytesIO(user.download(res["documents"][0]))).paragraphs)
    assert "INVOICE" in text.upper() and "TOTAL" in text.upper() and "4500" in text
    assert "Page 1" not in text


def test_pdf_to_excel_real_tables(user):
    d = user.fx("table.pdf")
    res = user.post("/api/convert/pdf-to-excel", {"document_id": d["id"]})
    wb = openpyxl.load_workbook(io.BytesIO(user.download(res["documents"][0])))
    assert wb.sheetnames == ["p1_t1"]
    rows = [[c.value for c in r] for r in wb["p1_t1"].iter_rows()]
    assert rows[0] == mf.TABLE_HEADER
    assert rows[1][:2] == ["Widget", "North"] and rows[1][2] == 120 and rows[1][4] == 300.0
    assert len(rows) == 6 and res["details"]["tables"] == 1


def test_pdf_to_excel_no_tables(user):
    d = user.fx("entities.pdf")
    r = user.client.post("/api/convert/pdf-to-excel", headers=user.h, json={"document_id": d["id"]})
    assert r.status_code == 422 and r.json()["code"] == "NO_TABLES_FOUND"


def test_tables_extract_json(user):
    d = user.fx("table.pdf")
    res = user.post("/api/tables/extract", {"document_id": d["id"]})
    assert len(res["tables"]) == 1
    t = res["tables"][0]
    assert t["page"] == 1 and t["rows"] == [mf.TABLE_HEADER] + mf.TABLE_ROWS


def test_pdf_to_powerpoint_image_and_editable(user):
    d = user.fx("table.pdf")
    for mode in ("image", "editable"):
        res = user.post("/api/convert/pdf-to-powerpoint", {"document_id": d["id"], "mode": mode})
        prs = Presentation(io.BytesIO(user.download(res["documents"][0])))
        assert len(prs.slides) == 1
        shapes = prs.slides[0].shapes
        assert any(s.shape_type == 13 for s in shapes)  # picture
        if mode == "editable":
            texts = " ".join(s.text_frame.text for s in shapes if s.has_text_frame)
            assert "Quarterly" in texts and "Widget" in texts
            assert res["notice"]
    # page aspect ratio kept
    assert prs.slide_width / prs.slide_height == pytest.approx(595.27 / 841.89, rel=0.01)


def test_pdf_to_images(user):
    d = user.fx("multipage.pdf")
    res = user.post("/api/convert/pdf-to-images", {"document_id": d["id"], "format": "jpg", "dpi": 72, "pages": "1-3"})
    z = zipfile.ZipFile(io.BytesIO(user.download(res["documents"][0])))
    assert z.namelist() == ["page-001.jpg", "page-002.jpg", "page-003.jpg"]
    assert z.read("page-001.jpg")[:3] == b"\xff\xd8\xff"
    res = user.post("/api/convert/pdf-to-images", {"document_id": d["id"], "format": "png", "pages": "2"})
    z = zipfile.ZipFile(io.BytesIO(user.download(res["documents"][0])))
    assert z.read(z.namelist()[0])[:4] == b"\x89PNG"


def test_pdf_to_text(user):
    d = user.fx("entities.pdf")
    out = user.post("/api/convert/pdf-to-text", {"document_id": d["id"]})["documents"][0]
    text = user.download(out).decode("utf-8")
    assert text == f"{mf.ENTITY_TEXT}\nSecond line plain\n"
    s = user.fx("scanned.pdf")
    r = user.client.post("/api/convert/pdf-to-text", headers=user.h, json={"document_id": s["id"]})
    assert r.status_code == 422 and r.json()["code"] == "NO_TEXT_FOUND"


def test_images_to_pdf(user):
    jpg, png = user.fx("sample.jpg"), user.fx("sample.png")
    res = user.post("/api/convert/images-to-pdf", {"document_ids": [jpg["id"], png["id"]], "page_size": "a4"})
    out = res["documents"][0]
    assert out["pages"] == 2
    with pdfplumber.open(io.BytesIO(user.download(out))) as pdf:
        assert pdf.pages[0].width == pytest.approx(841.89, abs=0.5)   # landscape images -> landscape A4
        assert len(pdf.pages[0].images) == 1
    portrait = user.post("/api/convert/images-to-pdf", {"document_ids": [jpg["id"]], "page_size": "a4", "orientation": "portrait"})
    with pdfplumber.open(io.BytesIO(user.download(portrait["documents"][0]))) as pdf:
        assert pdf.pages[0].width == pytest.approx(595.28, abs=0.5)
    fit = user.post("/api/convert/images-to-pdf", {"document_ids": [jpg["id"]]})["documents"][0]
    assert fit["pages"] == 1 and fit["filename"] == "sample.pdf"
    r = user.client.post("/api/convert/images-to-pdf", headers=user.h, json={"document_ids": [user.fx("table.pdf")["id"]]})
    assert r.status_code == 415


def test_images_to_pdf_transparent_png(user, tmp_path):
    from PIL import Image
    p = tmp_path / "t.png"
    Image.new("RGBA", (50, 50), (255, 0, 0, 100)).save(p)
    d = user.upload(p)
    out = user.post("/api/convert/images-to-pdf", {"document_ids": [d["id"]]})["documents"][0]
    assert out["pages"] == 1


def test_text_to_pdf_inline_and_upload(user):
    text = "Tom & Jerry <script> éñ — café\n\nSecond paragraph"
    out = user.post("/api/convert/text-to-pdf", {"text": text})["documents"][0]
    got = fitz.open(stream=user.download(out), filetype="pdf")[0].get_text()
    assert "Tom & Jerry <script>" in got and "café" in got and "&amp;" not in got
    d = user.upload("notes.txt", content=text.encode("utf-8"))
    out = user.post("/api/convert/text-to-pdf", {"document_id": d["id"]})["documents"][0]
    assert out["filename"] == "notes.pdf"
    assert "Second paragraph" in fitz.open(stream=user.download(out), filetype="pdf")[0].get_text()
    r = user.client.post("/api/convert/text-to-pdf", headers=user.h, json={})
    assert r.status_code == 400


@needs_soffice
def test_word_to_pdf(user):
    d = user.fx("sample.docx")
    out = user.post("/api/convert/word-to-pdf", {"document_id": d["id"]})["documents"][0]
    with pdfplumber.open(io.BytesIO(user.download(out))) as pdf:
        text = pdf.pages[0].extract_text()
        assert "Sample Word Document" in text and "R1C2" in text
        assert mf.ENTITY_TEXT in text
        assert pdf.pages[0].find_tables()


@needs_soffice
def test_excel_to_pdf(user):
    d = user.fx("sample.xlsx")
    out = user.post("/api/convert/excel-to-pdf", {"document_id": d["id"]})["documents"][0]
    with pdfplumber.open(io.BytesIO(user.download(out))) as pdf:
        text = pdf.pages[0].extract_text()
    assert "Apple" in text and "Pear" in text


@needs_soffice
def test_powerpoint_to_pdf(user):
    d = user.fx("sample.pptx")
    out = user.post("/api/convert/powerpoint-to-pdf", {"document_id": d["id"]})["documents"][0]
    with pdfplumber.open(io.BytesIO(user.download(out))) as pdf:
        assert "Sample Slide Title" in pdf.pages[0].extract_text()


def test_office_to_pdf_wrong_type(user):
    d = user.fx("sample.xlsx")
    r = user.client.post("/api/convert/word-to-pdf", headers=user.h, json={"document_id": d["id"]})
    assert r.status_code == 415


# ================================================================= HTML -> PDF (headless Chromium)
HTML = "/api/convert/html-to-pdf"


@needs_chromium
def test_html_to_pdf_renders_text_styles_and_data_images(user):
    html = ('<h1 style="color:#c00">Quarterly report</h1><p>Café — Tom &amp; Jerry</p>'
            '<table><tr><td>R1C1</td><td>R1C2</td></tr></table>'
            '<img alt="dot" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==">')
    out = user.post(HTML, {"html": html})["documents"][0]
    assert out["kind"] == "pdf" and out["pages"] == 1
    with pdfplumber.open(io.BytesIO(user.download(out))) as pdf:
        text = pdf.pages[0].extract_text()
        assert "Quarterly report" in text and "Tom & Jerry" in text and "R1C2" in text
        assert pdf.pages[0].images  # the data: image is drawn
        assert abs(pdf.pages[0].width - 595) < 3  # A4


@needs_chromium
def test_html_to_pdf_page_size_and_orientation(user):
    out = user.post(HTML, {"html": "<p>wide</p>", "page_size": "letter", "orientation": "landscape"})["documents"][0]
    with pdfplumber.open(io.BytesIO(user.download(out))) as pdf:
        assert abs(pdf.pages[0].width - 792) < 3 and abs(pdf.pages[0].height - 612) < 3


@needs_chromium
def test_html_to_pdf_cannot_read_local_files_run_scripts_or_use_the_network(user, tmp_path):
    """The HTML is untrusted: every way of reaching a local file, running script or calling out must come back empty."""
    secret = tmp_path / "secret.txt"
    secret.write_text("TOPSECRET-LOCAL-FILE-CONTENT", encoding="utf-8")
    uri = secret.as_uri()
    html = (f'<p>visible</p><iframe src="{uri}"></iframe><object data="{uri}"></object><embed src="{uri}">'
            f'<img src="{uri}"><link rel="stylesheet" href="{uri}">'
            f'<meta http-equiv="refresh" content="0;url={uri}"><base href="{uri}">'
            '<script>document.body.innerHTML="SCRIPT-RAN"</script>'
            '<img src="http://127.0.0.1:9/x.png"><div style="background:url(http://127.0.0.1:9/y.png)">styled</div>')
    out = user.post(HTML, {"html": html})["documents"][0]
    with pdfplumber.open(io.BytesIO(user.download(out))) as pdf:
        text = "".join(p.extract_text() or "" for p in pdf.pages)
    assert "visible" in text and "styled" in text
    assert "TOPSECRET" not in text and "SCRIPT-RAN" not in text


def test_html_to_pdf_validation_and_missing_browser(user, monkeypatch):
    from app.core.config import get_settings

    for body in [{}, {"html": ""}, {"html": "x", "page_size": "a0"}, {"html": "x", "orientation": "diagonal"}, {"html": "x", "extra": 1}]:
        assert user.client.post(HTML, headers=user.h, json=body).status_code in (400, 422), body
    monkeypatch.setattr(get_settings(), "chromium_path", "C:/definitely/not/here/chrome.exe")
    r = user.client.post(HTML, headers=user.h, json={"html": "<p>x</p>"})
    assert r.status_code == 503 and r.json()["error"]["code"] == "EXTERNAL_TOOL_MISSING" if "error" in r.json() else r.status_code == 503
