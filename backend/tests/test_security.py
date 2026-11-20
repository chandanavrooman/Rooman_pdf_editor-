"""Protect / unlock, watermark, redact, metadata."""
import io

import fitz
import pdfplumber
import pikepdf
import pytest

from conftest import FIXTURES
import make_fixtures as mf


def test_protect_unlock_roundtrip(user):
    d = user.fx("multipage.pdf")
    res = user.post("/api/security/protect", {"document_id": d["id"], "user_password": "s3cret!", "allow_copy": False})
    prot = res["documents"][0]
    data = user.download(prot)
    with pytest.raises(pikepdf.PasswordError):
        pikepdf.open(io.BytesIO(data))
    with pytest.raises(pikepdf.PasswordError):
        pikepdf.open(io.BytesIO(data), password="wrong")
    with pikepdf.open(io.BytesIO(data), password="s3cret!") as pdf:
        assert len(pdf.pages) == 12
        assert pdf.is_encrypted and pdf.encryption.R == 6
        assert not pdf.allow.extract and pdf.allow.print_highres
    assert prot["pages"] is None
    # already-protected can't be protected again, other tools ask for the password
    r = user.client.post("/api/security/protect", headers=user.h, json={"document_id": prot["id"], "user_password": "x"})
    assert r.status_code == 422 and r.json()["code"] == "ALREADY_ENCRYPTED"
    r = user.client.post("/api/organize/rotate", headers=user.h, json={"document_id": prot["id"], "angle": 90})
    assert r.json()["code"] == "PASSWORD_REQUIRED"
    # wrong password -> clear error; right password -> original content back
    r = user.client.post("/api/security/unlock", headers=user.h, json={"document_id": prot["id"], "password": "nope"})
    assert r.status_code == 422 and r.json()["code"] == "INVALID_PASSWORD"
    r = user.client.post("/api/security/unlock", headers=user.h, json={"document_id": prot["id"]})
    assert r.status_code == 422 and r.json()["code"] == "PASSWORD_REQUIRED"
    un = user.post("/api/security/unlock", {"document_id": prot["id"], "password": "s3cret!"})["documents"][0]
    assert un["pages"] == 12
    with pdfplumber.open(io.BytesIO(user.download(un))) as pdf:
        assert "Chapter 3" in pdf.pages[2].extract_text()


def test_unlock_fixture_protected_pdf(user):
    d = user.fx("protected.pdf")
    un = user.post("/api/security/unlock", {"document_id": d["id"], "password": mf.PROTECTED_PASSWORD})["documents"][0]
    with pdfplumber.open(io.BytesIO(user.download(un))) as pdf:
        assert mf.PROTECTED_TEXT in pdf.pages[0].extract_text()
    with pikepdf.open(io.BytesIO(user.download(un))) as pdf:
        assert not pdf.is_encrypted


def test_unlock_unencrypted_gives_notice(user):
    d = user.fx("table.pdf")
    res = user.post("/api/security/unlock", {"document_id": d["id"]})
    assert "not password protected" in res["notice"]


def test_watermark_text(user):
    d = user.fx("multipage.pdf")
    res = user.post("/api/security/watermark", {"document_id": d["id"], "text": "CONFIDENTIAL", "pages": "1-2",
                                                "opacity": 0.4, "rotation": 30})
    out = res["documents"][0]
    doc = fitz.open(stream=user.download(out), filetype="pdf")
    assert "CONFIDENTIAL" in doc[0].get_text() and "CONFIDENTIAL" in doc[1].get_text()
    assert "CONFIDENTIAL" not in doc[2].get_text()
    assert "Chapter 1 heading" in doc[0].get_text()      # original content intact
    # opacity applied via an ExtGState alpha
    with pikepdf.open(io.BytesIO(user.download(out))) as pdf:
        gs = pdf.pages[0].Resources.get("/ExtGState", {})
        assert any(abs(float(v.get("/ca", 1)) - 0.4) < 0.01 for v in gs.values())


def test_watermark_tile_and_rotated_page(user):
    d = user.fx("table.pdf")
    rot = user.post("/api/organize/rotate", {"document_id": d["id"], "angle": 90})["documents"][0]
    out = user.post("/api/security/watermark", {"document_id": rot["id"], "text": "DRAFT", "layout": "tile",
                                                "font_size": 30})["documents"][0]
    page = fitz.open(stream=user.download(out), filetype="pdf")[0]
    assert page.get_text().count("DRAFT") >= 4 and page.rotation == 90


def test_watermark_image(user, tmp_path):
    d = user.fx("multipage.pdf")
    img = user.fx("sample.png")
    out = user.post("/api/security/watermark", {"document_id": d["id"], "image_document_id": img["id"],
                                                "opacity": 0.5, "pages": "1"})["documents"][0]
    doc = fitz.open(stream=user.download(out), filetype="pdf")
    assert len(doc[0].get_images()) == 1 and len(doc[1].get_images()) == 0
    r = user.client.post("/api/security/watermark", headers=user.h,
                         json={"document_id": d["id"], "image_document_id": d["id"]})
    assert r.status_code == 415
    r = user.client.post("/api/security/watermark", headers=user.h, json={"document_id": d["id"]})
    assert r.status_code == 400 and r.json()["code"] == "WATERMARK_EMPTY"
    r = user.client.post("/api/security/watermark", headers=user.h,
                         json={"document_id": d["id"], "text": "x", "image_document_id": img["id"]})
    assert r.status_code == 422


def test_redact_removes_text_for_real(user):
    d = user.fx("table.pdf")
    before = pdfplumber.open(io.BytesIO(user.download(d))).pages[0].extract_text()
    assert "Thingamajig" in before and "1499.85" in before
    res = user.post("/api/security/redact", {"document_id": d["id"], "terms": ["Thingamajig", "1499.85"]})
    assert res["details"]["redactions"] == 2
    data = user.download(res["documents"][0])
    after = pdfplumber.open(io.BytesIO(data)).pages[0].extract_text()
    assert "Thingamajig" not in after and "1499.85" not in after
    assert "Widget" in after and "Quarterly Sales Report" in after      # rest untouched
    # not merely covered: the strings are gone from the raw bytes and from every extraction path
    assert "Thingamajig" not in fitz.open(stream=data, filetype="pdf")[0].get_text()
    with pikepdf.open(io.BytesIO(data)) as pdf:
        content = b"".join(p.Contents.read_bytes() if not isinstance(p.Contents, pikepdf.Array)
                           else b"".join(c.read_bytes() for c in p.Contents) for p in pdf.pages)
    assert b"Thingamajig" not in content
    # and a black box was drawn
    pix = fitz.open(stream=data, filetype="pdf")[0].get_pixmap(dpi=72)
    assert any(pix.pixel(x, y) == (0, 0, 0) for x in range(0, pix.width, 3) for y in range(0, pix.height, 3))


def test_redact_regex_and_area(user):
    d = user.fx("table.pdf")
    res = user.post("/api/security/redact", {"document_id": d["id"], "patterns": [r"\d+\.\d{2}\b"],
                                             "areas": [{"page": 1, "x0": 50, "y0": 40, "x1": 400, "y1": 90}]})
    data = user.download(res["documents"][0])
    text = fitz.open(stream=data, filetype="pdf")[0].get_text()
    assert "300.00" not in text and "1499.85" not in text and "10.25" not in text
    assert "Quarterly Sales Report" not in text                   # area covered the heading
    assert "Widget" in text


def test_redact_nothing_matches_and_errors(user):
    d = user.fx("table.pdf")
    res = user.post("/api/security/redact", {"document_id": d["id"], "terms": ["zzzzqqq"]})
    assert res["details"]["redactions"] == 0 and "Nothing matched" in res["notice"]
    r = user.client.post("/api/security/redact", headers=user.h, json={"document_id": d["id"]})
    assert r.status_code == 400 and r.json()["code"] == "NOTHING_TO_REDACT"
    r = user.client.post("/api/security/redact", headers=user.h, json={"document_id": d["id"], "patterns": ["(unclosed"]})
    assert r.status_code == 400 and r.json()["code"] == "INVALID_PATTERN"
    r = user.client.post("/api/security/redact", headers=user.h,
                         json={"document_id": d["id"], "areas": [{"page": 9, "x0": 0, "y0": 0, "x1": 5, "y1": 5}]})
    assert r.status_code == 400


def test_metadata_roundtrip(user):
    d = user.fx("table.pdf")
    got = user.client.get(f"/api/security/metadata/{d['id']}", headers=user.h).json()
    assert got["title"] == "Sales table" and got["pages"] == 1 and got["encrypted"] is False
    res = user.post("/api/security/metadata", {"document_id": d["id"], "title": "New title &amp; <b>", "author": "Ada",
                                               "keywords": "a,b", "subject": ""})
    out = res["documents"][0]
    meta = user.client.get(f"/api/security/metadata/{out['id']}", headers=user.h).json()
    assert meta["title"] == "New title &amp; <b>" and meta["author"] == "Ada" and meta["keywords"] == "a,b"
    assert meta["subject"] is None
    with pikepdf.open(io.BytesIO(user.download(out))) as pdf:
        with pdf.open_metadata() as xmp:
            assert xmp["dc:title"] == "New title &amp; <b>"
    cleared = user.post("/api/security/metadata", {"document_id": out["id"], "clear_all": True})["documents"][0]
    m2 = user.client.get(f"/api/security/metadata/{cleared['id']}", headers=user.h).json()
    assert m2["title"] is None and m2["author"] is None
