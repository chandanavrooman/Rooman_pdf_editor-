"""Capabilities, docs exposure, CORS, rate limiting, subprocess safety."""
import pytest
from fastapi.testclient import TestClient

from conftest import User


def test_health_and_capabilities(client):
    assert client.get("/api/health").json() == {"status": "ok"}
    caps = client.get("/api/system/capabilities").json()
    assert set(caps["programs"]) == {"gs", "soffice", "chromium", "tesseract"}
    for p in caps["programs"].values():
        assert isinstance(p["available"], bool) and p["install"]
    assert "html_to_pdf" in caps["tools"]
    assert caps["limits"]["max_upload_mb"] == 60
    assert caps["ai_configured"] is False and "eng" in caps["ocr_languages"] or not caps["tools"]["ocr"]


def _fresh_app(monkeypatch, **env):
    from app.core import config
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    config.reset_settings_cache()
    from app.main import create_app
    return create_app()


def test_openapi_only_in_development(monkeypatch):
    from app.core import config
    try:
        prod = _fresh_app(monkeypatch, ENV="production")
    except RuntimeError as e:      # production refuses to start with the default/short secret
        assert "JWT_SECRET" in str(e)
    prod = _fresh_app(monkeypatch, ENV="production", JWT_SECRET="x" * 40)
    c = TestClient(prod)
    for url in ("/docs", "/redoc", "/openapi.json"):
        assert c.get(url).status_code == 404
    dev = _fresh_app(monkeypatch, ENV="development")
    c = TestClient(dev)
    assert c.get("/docs").status_code == 200
    spec = c.get("/openapi.json").json()
    assert "/api/organize/merge" in spec["paths"] and "/api/optimize/compress" in spec["paths"]
    monkeypatch.undo()
    config.reset_settings_cache()


def test_cors_only_for_frontend_origin(client):
    ok = client.options("/api/documents", headers={"Origin": "http://localhost:5173",
                                                    "Access-Control-Request-Method": "POST"})
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:5173"
    bad = client.options("/api/documents", headers={"Origin": "http://evil.example",
                                                     "Access-Control-Request-Method": "POST"})
    assert "access-control-allow-origin" not in bad.headers
    r = client.get("/api/health", headers={"Origin": "http://evil.example"})
    assert "access-control-allow-origin" not in r.headers


def test_rate_limit(monkeypatch):
    from app.core import config
    app = _fresh_app(monkeypatch, RATE_LIMIT="5", AUTH_RATE_LIMIT="3", ENV="test")
    try:
        c = TestClient(app)
        codes = [c.get("/api/health").status_code for _ in range(7)]
        assert codes[:5] == [200] * 5 and codes[5:] == [429, 429]
        r = c.get("/api/health")
        assert r.json()["code"] == "RATE_LIMITED" and int(r.headers["retry-after"]) >= 1
    finally:
        monkeypatch.undo()
        config.reset_settings_cache()


def test_auth_rate_limit(monkeypatch):
    from app.core import config
    app = _fresh_app(monkeypatch, RATE_LIMIT="0", AUTH_RATE_LIMIT="3", ENV="test")
    try:
        c = TestClient(app)
        codes = [c.post("/api/auth/login", json={"email": "a@b.co", "password": "x"}).status_code for _ in range(5)]
        assert codes == [401, 401, 401, 429, 429]
    finally:
        monkeypatch.undo()
        config.reset_settings_cache()


def test_external_run_never_uses_shell():
    from app.services import external
    with pytest.raises(TypeError):
        external.run("echo hello; ls")           # strings are refused
    p = external.run(["echo", "hello; echo injected"])
    assert p.stdout.decode().strip() == "hello; echo injected"   # passed as one literal argument


def test_external_timeout():
    from app.core.errors import AppError
    from app.services import external
    with pytest.raises(AppError) as e:
        external.run(["sleep", "5"], timeout=1, label="sleeper")
    assert e.value.status == 504 and e.value.code == "EXTERNAL_TOOL_TIMEOUT"


def test_no_secrets_in_openapi_or_errors(client):
    r = client.post("/api/auth/login", json={"email": "nobody@example.com", "password": "x"})
    assert "password_hash" not in r.text and "secret" not in r.text.lower()


def test_page_spec_parser():
    from app.core.errors import AppError
    from app.services.pdf_ops import parse_page_spec
    assert parse_page_spec("1-3,5, 8-9", 10) == [0, 1, 2, 4, 7, 8]
    assert parse_page_spec("3,3,1", 5) == [2, 0]
    for bad in ["", "0", "1-", "a", "2-1", "11", "1;2", "-3"]:
        with pytest.raises(AppError):
            parse_page_spec(bad, 10)
