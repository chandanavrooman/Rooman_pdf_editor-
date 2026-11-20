from __future__ import annotations

import os
import shutil
import sys
import tempfile
import uuid
from pathlib import Path

import pytest

pytest_plugins = ["ai_fixtures"]

REPO = Path(__file__).resolve().parents[2]
FIXTURES = REPO / "tests" / "fixtures"
sys.path.insert(0, str(FIXTURES))
sys.path.insert(0, str(REPO / "backend"))
sys.path.insert(0, str(REPO / "mcp-server"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

_TMP = tempfile.mkdtemp(prefix="rooman-test-")
os.environ.update(
    ENV="test", STORAGE_DIR=_TMP, JWT_SECRET="test-secret-test-secret-1234567890", RATE_LIMIT="0",
    AUTH_RATE_LIMIT="0", MAX_UPLOAD_MB="60", FILE_TTL_MINUTES="60", CORS_ORIGINS="http://localhost:5173",
    AI_API_KEY="", AI_RATE_LIMIT="0", MCP_SHARED_SECRET="test-mcp-shared-secret-0123456789-abcdef", MCP_ALLOWED_URLS="",
    AGENT_MAX_ITERATIONS="8", LOCAL_TEST_MODE="false", GS_PATH="", SOFFICE_PATH="", TESSERACT_PATH="",
)

from fastapi.testclient import TestClient  # noqa: E402

from app.core import config  # noqa: E402
from app.core.deps import reset_store_cache  # noqa: E402
from app.services import external  # noqa: E402

# ensure committed fixtures exist (large.pdf is generated on demand)
import make_fixtures  # noqa: E402

if not (FIXTURES / "table.pdf").exists():
    make_fixtures.make_all()
make_fixtures.ensure_large()


def _skip(tool: str):
    return pytest.mark.skipif(
        external.find_tool(tool) is None, reason=f"UNTESTED: {tool} is not installed on this machine"
    )


needs_gs = _skip("gs")
needs_tesseract = _skip("tesseract")
needs_soffice = _skip("soffice")
needs_chromium = _skip("chromium")


def pytest_sessionfinish(session, exitstatus):
    shutil.rmtree(_TMP, ignore_errors=True)


@pytest.fixture(scope="session")
def app():
    config.reset_settings_cache()
    reset_store_cache()
    from app.main import create_app

    return create_app()


@pytest.fixture(scope="session")
def client(app):
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="session")
def store():
    from app.core.deps import get_store

    return get_store()


class User:
    def __init__(self, client: TestClient):
        self.client = client
        self.email = f"user-{uuid.uuid4().hex[:8]}@example.com"
        r = client.post("/api/auth/register", json={"email": self.email, "password": "password123", "name": "T"})
        assert r.status_code == 201, r.text
        self.token = r.json()["access_token"]
        self.id = r.json()["user"]["id"]
        self.h = {"Authorization": f"Bearer {self.token}"}

    def upload(self, path: Path | str, name: str | None = None, content: bytes | None = None, expect: int = 201):
        path = Path(path)
        data = content if content is not None else path.read_bytes()
        r = self.client.post("/api/documents", headers=self.h, files={"file": (name or path.name, data)})
        assert r.status_code == expect, r.text
        return r.json()

    def fx(self, name: str) -> dict:
        return self.upload(FIXTURES / name)

    def post(self, url: str, json: dict, expect: int = 200):
        r = self.client.post(url, headers=self.h, json=json)
        assert r.status_code == expect, f"{url} -> {r.status_code} {r.text}"
        return r.json()

    def download(self, doc: dict) -> bytes:
        r = self.client.get(doc["download_url"], headers=self.h)
        assert r.status_code == 200, r.text
        return r.content


@pytest.fixture
def user(client):
    return User(client)


@pytest.fixture
def user_b(client):
    return User(client)


@pytest.fixture
def fixtures_dir():
    return FIXTURES
