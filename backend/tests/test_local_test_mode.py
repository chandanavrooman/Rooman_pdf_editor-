"""LOCAL_TEST_MODE: sign-in is skipped for local testing, but only with ENV=development."""
import pytest
from fastapi.testclient import TestClient

from app.core import config
from test_system import _fresh_app


@pytest.fixture(autouse=True)
def _restore(monkeypatch):
    yield
    monkeypatch.undo()
    config.reset_settings_cache()


def test_local_session_issues_working_token(monkeypatch):
    c = TestClient(_fresh_app(monkeypatch, ENV="development", LOCAL_TEST_MODE="true"))
    assert c.get("/api/system/capabilities").json()["local_test_mode"] is True
    r = c.post("/api/auth/local-session")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["user"]["email"] == "local-test@rooman.local"
    h = {"Authorization": f"Bearer {body['access_token']}"}
    assert c.get("/api/auth/me", headers=h).json()["email"] == "local-test@rooman.local"
    # the same local user every time (documents stay visible across sessions)
    again = c.post("/api/auth/local-session").json()
    assert again["user"]["id"] == body["user"]["id"]
    # a server tool really works with that session
    from conftest import FIXTURES
    up = c.post("/api/documents", headers=h,
                files={"file": ("multipage.pdf", (FIXTURES / "multipage.pdf").read_bytes(), "application/pdf")})
    assert up.status_code == 201, up.text
    rot = c.post("/api/organize/rotate", headers=h, json={"document_id": up.json()["id"], "angle": 90})
    assert rot.status_code == 200, rot.text
    # the local account cannot be signed into with a password
    bad = c.post("/api/auth/login", json={"email": "local-test@rooman.local", "password": "anything-at-all"})
    assert bad.status_code == 401


def test_local_session_disabled_by_default(monkeypatch):
    c = TestClient(_fresh_app(monkeypatch, ENV="development", LOCAL_TEST_MODE="false"))
    assert c.get("/api/system/capabilities").json()["local_test_mode"] is False
    assert c.post("/api/auth/local-session").status_code == 404
    assert c.get("/api/auth/me").status_code == 401  # sign-in still required


def test_local_test_mode_refused_outside_development(monkeypatch):
    with pytest.raises(RuntimeError, match="LOCAL_TEST_MODE"):
        _fresh_app(monkeypatch, ENV="production", JWT_SECRET="x" * 40, LOCAL_TEST_MODE="true")
    with pytest.raises(RuntimeError, match="LOCAL_TEST_MODE"):
        _fresh_app(monkeypatch, ENV="test", LOCAL_TEST_MODE="true")


def test_empty_storage_dir_uses_default(monkeypatch):
    monkeypatch.setenv("STORAGE_DIR", "")
    config.reset_settings_cache()
    assert config.get_settings().storage_dir == config.BACKEND_DIR / "storage"
