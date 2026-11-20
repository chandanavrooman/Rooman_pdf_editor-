"""Organize endpoints, using real PDFs and verifying real output content."""
import io
import zipfile

import pdfplumber
import pikepdf
import pytest


def texts(data: bytes) -> list[str]:
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        return [p.extract_text() or "" for p in pdf.pages]


def test_merge_keeps_order(user):
    a, b = user.fx("table.pdf"), user.fx("multipage.pdf")
    res = user.post("/api/organize/merge", {"document_ids": [b["id"], a["id"]], "filename": "both.pdf"})
    doc = res["documents"][0]
    assert doc["pages"] == 13 and doc["filename"] == "both.pdf" and doc["kind"] == "pdf"
    t = texts(user.download(doc))
    assert "Chapter 1" in t[0] and "Chapter 12" in t[11] and "Quarterly Sales Report" in t[12]


def test_merge_validation(user):
    a = user.fx("table.pdf")
    r = user.client.post("/api/organize/merge", headers=user.h, json={"document_ids": [a["id"]]})
    assert r.status_code == 422
    img = user.fx("sample.png")
    r = user.client.post("/api/organize/merge", headers=user.h, json={"document_ids": [a["id"], img["id"]]})
    assert r.status_code == 415 and r.json()["code"] == "WRONG_FILE_TYPE"
    r = user.client.post("/api/organize/merge", headers=user.h, json={"document_ids": [a["id"], "0" * 32]})
    assert r.status_code == 404
    r = user.client.post("/api/organize/merge", headers=user.h,
                         json={"document_ids": [a["id"], a["id"]], "extra": "x"})
    assert r.status_code == 422  # unknown fields rejected


def test_split_ranges(user):
    d = user.fx("multipage.pdf")
    res = user.post("/api/organize/split", {"document_id": d["id"], "mode": "ranges", "ranges": "1-3,5,8-12"})
    docs = res["documents"]
    assert [x["pages"] for x in docs] == [3, 1, 5]
    assert "Chapter 5" in texts(user.download(docs[1]))[0]


def test_split_every_n(user):
    d = user.fx("multipage.pdf")
    docs = user.post("/api/organize/split", {"document_id": d["id"], "mode": "every_n", "every_n": 5})["documents"]
    assert [x["pages"] for x in docs] == [5, 5, 2]


def test_split_by_bookmarks(user):
    d = user.fx("multipage.pdf")
    docs = user.post("/api/organize/split", {"document_id": d["id"], "mode": "bookmarks"})["documents"]
    assert len(docs) == 12 and all(x["pages"] == 1 for x in docs)
    assert "Chapter 7" in texts(user.download(docs[6]))[0]
    assert "Chapter_7" in docs[6]["filename"]


def test_split_bookmarks_none(user):
    d = user.fx("table.pdf")
    r = user.client.post("/api/organize/split", headers=user.h, json={"document_id": d["id"], "mode": "bookmarks"})
    assert r.status_code == 422 and r.json()["code"] == "NO_BOOKMARKS"


def test_split_by_size(user):
    d = user.fx("large.pdf")  # 4 pages, several MB per page
    docs = user.post("/api/organize/split", {"document_id": d["id"], "mode": "by_size", "max_size_mb": 2.5})["documents"]
    assert len(docs) >= 2
    assert sum(x["pages"] for x in docs) == 4
    # a part only exceeds the limit if a single page does
    for x in docs:
        assert x["size"] <= 2.5 * 1024 * 1024 * 1.05 or x["pages"] == 1


def test_split_zip(user):
    d = user.fx("multipage.pdf")
    res = user.post("/api/organize/split", {"document_id": d["id"], "mode": "every_n", "every_n": 6, "zip": True})
    assert len(res["documents"]) == 1 and res["documents"][0]["kind"] == "zip"
    z = zipfile.ZipFile(io.BytesIO(user.download(res["documents"][0])))
    assert len(z.namelist()) == 2 and all(n.endswith(".pdf") for n in z.namelist())


def test_extract_and_delete_pages(user):
    d = user.fx("multipage.pdf")
    ext = user.post("/api/organize/extract-pages", {"document_id": d["id"], "pages": "2,4-5"})["documents"][0]
    t = texts(user.download(ext))
    assert len(t) == 3 and "Chapter 2" in t[0] and "Chapter 4" in t[1] and "Chapter 5" in t[2]
    dele = user.post("/api/organize/delete-pages", {"document_id": d["id"], "pages": "1-10"})["documents"][0]
    t = texts(user.download(dele))
    assert len(t) == 2 and "Chapter 11" in t[0]
    r = user.client.post("/api/organize/delete-pages", headers=user.h, json={"document_id": d["id"], "pages": "1-12"})
    assert r.status_code == 400 and r.json()["code"] == "CANNOT_DELETE_ALL"
    r = user.client.post("/api/organize/extract-pages", headers=user.h, json={"document_id": d["id"], "pages": "13"})
    assert r.status_code == 400 and r.json()["code"] == "PAGE_OUT_OF_RANGE"
    r = user.client.post("/api/organize/extract-pages", headers=user.h, json={"document_id": d["id"], "pages": "abc"})
    assert r.status_code == 422


def test_rotate(user):
    d = user.fx("multipage.pdf")
    out = user.post("/api/organize/rotate", {"document_id": d["id"], "angle": 90, "pages": "1-2"})["documents"][0]
    with pikepdf.open(io.BytesIO(user.download(out))) as pdf:
        rot = [int(p.get("/Rotate", 0)) for p in pdf.pages]
    assert rot[:3] == [90, 90, 0]
    again = user.post("/api/organize/rotate", {"document_id": out["id"], "angle": 270})["documents"][0]
    with pikepdf.open(io.BytesIO(user.download(again))) as pdf:
        assert [int(p.get("/Rotate", 0)) % 360 for p in pdf.pages][:3] == [0, 0, 270]
    r = user.client.post("/api/organize/rotate", headers=user.h, json={"document_id": d["id"], "angle": 45})
    assert r.status_code == 422


def test_reorder(user):
    d = user.fx("multipage.pdf")
    out = user.post("/api/organize/reorder", {"document_id": d["id"], "order": [3, 1, 2]})["documents"][0]
    t = texts(user.download(out))
    assert out["pages"] == 3 and "Chapter 3" in t[0] and "Chapter 1" in t[1]
    r = user.client.post("/api/organize/reorder", headers=user.h, json={"document_id": d["id"], "order": [1, 1]})
    assert r.status_code == 400


def test_crop(user):
    d = user.fx("table.pdf")
    out = user.post("/api/organize/crop", {"document_id": d["id"], "top": 50, "left": 20, "right": 20, "bottom": 30})["documents"][0]
    with pikepdf.open(io.BytesIO(user.download(out))) as pdf, pikepdf.open(io.BytesIO(user.download(d))) as orig:
        w0, h0 = float(orig.pages[0].MediaBox[2]), float(orig.pages[0].MediaBox[3])
        box = [float(v) for v in pdf.pages[0].CropBox]
    assert box == pytest.approx([20, 30, w0 - 20, h0 - 50], abs=0.1)
    r = user.client.post("/api/organize/crop", headers=user.h, json={"document_id": d["id"], "top": 9000})
    assert r.status_code == 422


def test_original_is_never_modified(user):
    d = user.fx("multipage.pdf")
    before = user.download(d)
    user.post("/api/organize/rotate", {"document_id": d["id"], "angle": 90})
    user.post("/api/organize/delete-pages", {"document_id": d["id"], "pages": "1"})
    assert user.download(d) == before


def test_tools_reject_password_protected_pdf(user):
    d = user.fx("protected.pdf")
    assert d["pages"] is None  # cannot be counted without the password
    r = user.client.post("/api/organize/rotate", headers=user.h, json={"document_id": d["id"], "angle": 90})
    assert r.status_code == 422 and r.json()["code"] == "PASSWORD_REQUIRED"
