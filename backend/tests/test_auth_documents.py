"""Auth, upload validation, ownership, download, delete, TTL cleanup."""
import time

import pdfplumber
import io
from conftest import FIXTURES, User


def test_register_login_me(client):
    email = "alice@example.com"
    r = client.post("/api/auth/register", json={"email": email, "password": "longenough1", "name": "Alice"})
    assert r.status_code == 201
    assert r.json()["token_type"] == "bearer" and r.json()["user"]["email"] == email
    assert client.post("/api/auth/register", json={"email": email, "password": "longenough1"}).status_code == 409
    bad = client.post("/api/auth/login", json={"email": email, "password": "wrong-password"})
    assert bad.status_code == 401 and bad.json()["code"] == "INVALID_CREDENTIALS"
    ok = client.post("/api/auth/login", json={"email": email.upper(), "password": "longenough1"})
    assert ok.status_code == 200
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {ok.json()['access_token']}"})
    assert me.status_code == 200 and me.json()["email"] == email


def test_register_validation(client):
    assert client.post("/api/auth/register", json={"email": "nope", "password": "longenough1"}).status_code == 422
    r = client.post("/api/auth/register", json={"email": "x@example.com", "password": "short"})
    assert r.status_code == 422 and r.json()["code"] == "VALIDATION_ERROR"


def test_endpoints_require_auth(client):
    for method, url in [("get", "/api/documents"), ("post", "/api/organize/merge"), ("get", "/api/auth/me"),
                        ("post", "/api/documents")]:
        r = getattr(client, method)(url)
        assert r.status_code == 401, url
    r = client.get("/api/documents", headers={"Authorization": "Bearer garbage"})
    assert r.status_code == 401 and r.json()["code"] == "INVALID_TOKEN"


def test_upload_download_roundtrip(user):
    doc = user.fx("multipage.pdf")
    assert doc["kind"] == "pdf" and doc["pages"] == 12 and doc["size"] > 0
    assert doc["download_url"] == f"/api/documents/{doc['id']}/download"
    data = user.download(doc)
    assert data == (FIXTURES / "multipage.pdf").read_bytes()
    r = user.client.get(f"/api/documents/{doc['id']}", headers=user.h)
    assert r.json()["id"] == doc["id"]
    listed = user.client.get("/api/documents", headers=user.h).json()
    assert [d["id"] for d in listed] == [doc["id"]]
    r = user.client.get(doc["download_url"], headers=user.h)
    assert "multipage.pdf" in r.headers["content-disposition"]
    info = user.client.get(f"/api/documents/{doc['id']}/info", headers=user.h).json()
    assert info["pages"] == 12 and info["encrypted"] is False and info["metadata"]["title"] == "Multipage fixture"


def test_storage_path_is_server_generated(user, store):
    doc = user.upload(FIXTURES / "table.pdf", name="../../etc/passwd.pdf")
    assert doc["filename"] == "passwd.pdf"
    d = store.get(user.id, doc["id"])
    assert d.path.parent.name == user.id and d.path.name == f"{doc['id']}.pdf"
    assert store.root in d.path.parents


def test_ownership_isolation(user, user_b):
    doc = user.fx("table.pdf")
    for method, url in [("get", doc["download_url"]), ("get", f"/api/documents/{doc['id']}"),
                        ("delete", f"/api/documents/{doc['id']}")]:
        r = getattr(user_b.client, method)(url, headers=user_b.h)
        assert r.status_code == 404, (method, r.text)
    # tools can't be used on someone else's document either
    r = user_b.client.post("/api/organize/rotate", headers=user_b.h, json={"document_id": doc["id"], "angle": 90})
    assert r.status_code == 404
    assert user_b.client.get("/api/documents", headers=user_b.h).json() == []
    # owner still has it
    assert user.client.get(doc["download_url"], headers=user.h).status_code == 200


def test_delete(user):
    doc = user.fx("table.pdf")
    assert user.client.delete(f"/api/documents/{doc['id']}", headers=user.h).status_code == 204
    assert user.client.get(doc["download_url"], headers=user.h).status_code == 404


def test_rejects_fake_pdf_by_magic_bytes(user):
    r = user.client.post("/api/documents", headers=user.h, files={"file": ("evil.pdf", b"this is just text, not a pdf")})
    assert r.status_code == 415 and r.json()["code"] == "UNSUPPORTED_FILE"
    r = user.client.post("/api/documents", headers=user.h, files={"file": ("a.docx", b"PK\x03\x04garbage")})
    assert r.status_code == 415
    r = user.client.post("/api/documents", headers=user.h, files={"file": ("a.exe", b"MZ\x90\x00binary")})
    assert r.status_code == 415
    r = user.client.post("/api/documents", headers=user.h, files={"file": ("empty.pdf", b"")})
    assert r.status_code == 400


def test_real_pdf_with_wrong_extension_is_detected_by_content(user):
    doc = user.upload(FIXTURES / "table.pdf", name="renamed.txt")
    assert doc["kind"] == "pdf"
    png = user.upload(FIXTURES / "sample.png", name="pic.pdf")
    assert png["kind"] == "png"  # not treated as a PDF just because of its name


def test_upload_kinds(user):
    for name, kind in [("sample.docx", "docx"), ("sample.xlsx", "xlsx"), ("sample.pptx", "pptx"),
                       ("sample.jpg", "jpg"), ("sample.png", "png")]:
        assert user.fx(name)["kind"] == kind
    assert user.upload("x.txt", content="héllo".encode())["kind"] == "txt"
    # a zip that is not an office document
    import zipfile
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("a.txt", "hi")
    user.upload("x.docx", content=buf.getvalue(), expect=415)


def test_upload_size_limit(client, monkeypatch):
    from app.core import config
    from app.main import create_app
    monkeypatch.setenv("MAX_UPLOAD_MB", "1")
    config.reset_settings_cache()
    try:
        small = create_app()
        from fastapi.testclient import TestClient
        with TestClient(small) as c:
            u = User(c)
            big = b"%PDF-1.4\n" + b"0" * (2 * 1024 * 1024)
            r = c.post("/api/documents", headers=u.h, files={"file": ("big.pdf", big)})
            assert r.status_code == 413 and r.json()["code"] == "FILE_TOO_LARGE"
    finally:
        monkeypatch.undo()
        config.reset_settings_cache()


def test_ttl_cleanup_deletes_expired_files(user, store):
    old = user.fx("table.pdf")
    new = user.fx("multipage.pdf")
    d_old = store.get(user.id, old["id"])
    path = d_old.path
    assert path.exists()
    # pretend we are 2 hours in the future for the old doc only: age the DB row
    import sqlite3
    c = sqlite3.connect(store.db_path)
    c.execute("UPDATE documents SET created_at=? WHERE id=?", (time.time() - 2 * 3600, old["id"]))
    c.commit(); c.close()
    removed = store.cleanup_expired()
    assert removed >= 1
    assert not path.exists()
    assert user.client.get(old["download_url"], headers=user.h).status_code == 404
    assert user.client.get(new["download_url"], headers=user.h).status_code == 200


def test_temp_dirs_are_cleaned_after_operations(user, store):
    doc = user.fx("multipage.pdf")
    user.post("/api/organize/rotate", {"document_id": doc["id"], "angle": 90})
    assert list(store.tmp_dir.iterdir()) == []


def test_download_expired_file_gone(user, store):
    doc = user.fx("table.pdf")
    store.get(user.id, doc["id"]).path.unlink()
    assert user.client.get(doc["download_url"], headers=user.h).status_code == 404


def test_pdf_uploaded_is_readable(user):
    doc = user.fx("table.pdf")
    with pdfplumber.open(io.BytesIO(user.download(doc))) as pdf:
        assert "Quarterly Sales Report" in pdf.pages[0].extract_text()
