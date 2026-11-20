"""Application settings, loaded from environment / .env (see root .env.example)."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
REPO_ROOT = BACKEND_DIR.parent

_DEV_SECRET = "dev-only-insecure-secret-change-me"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(REPO_ROOT / ".env", BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    env: str = Field("development", description="development | production | test")

    # --- auth ---
    jwt_secret: str = _DEV_SECRET
    jwt_algorithm: str = "HS256"
    token_expire_minutes: int = Field(60 * 24, ge=1)
    allow_registration: bool = True
    # Local testing only: skip sign-in by issuing a session for a fixed local user. Refused unless ENV=development.
    local_test_mode: bool = False

    # --- http ---
    cors_origins: str = "http://localhost:5173"
    max_upload_mb: int = Field(50, ge=1, le=2048)
    rate_limit: int = Field(120, ge=0, description="requests / minute / client; 0 disables")
    auth_rate_limit: int = Field(20, ge=0, description="login+register requests / minute / client")

    # --- storage ---
    storage_dir: Path = BACKEND_DIR / "storage"
    file_ttl_minutes: int = Field(60, ge=1)
    cleanup_interval_seconds: int = Field(60, ge=1)

    # --- external programs ---
    external_timeout_seconds: int = Field(180, ge=1)
    gs_path: str = ""
    soffice_path: str = ""
    chromium_path: str = ""  # Chromium / Chrome / Edge for HTML -> PDF (auto-detected when empty)
    chromium_no_sandbox: bool = False  # only for containers that cannot give the browser a sandbox; see scripts/deploy/README.md
    tesseract_path: str = ""

    # --- AI / MCP (used by later phases) ---
    ai_endpoint: str = "https://api.groq.com/openai/v1"
    ai_model: str = "qwen/qwen3.8-27b"
    ai_api_key: str = ""
    ai_timeout_seconds: int = Field(120, ge=5, le=900, description="read timeout for the model endpoint")
    ai_max_tokens: int = Field(2048, ge=64, le=32768)
    ai_temperature: float = Field(0.2, ge=0, le=2)
    ai_rate_limit: int = Field(30, ge=0, description="AI requests / minute / client; 0 disables")
    agent_max_iterations: int = Field(8, ge=1, le=30, description="max model calls per chat request")
    pending_action_ttl_seconds: int = Field(600, ge=30, description="how long a destructive action waits for confirmation")
    mcp_shared_secret: str = ""
    mcp_url: str = "http://localhost:8001/mcp"
    mcp_host: str = "127.0.0.1"
    mcp_port: int = Field(8001, ge=1, le=65535)
    mcp_user_token_ttl_seconds: int = Field(900, ge=30, le=86400)
    mcp_allowed_urls: str = Field("", description="explicitly authorised MCP server URLs; empty = only a loopback MCP_URL is allowed")

    @field_validator("storage_dir", mode="before")
    @classmethod
    def _storage_dir(cls, v):
        # an empty STORAGE_DIR= in .env means "use the default", not the current working directory
        return BACKEND_DIR / "storage" if v is None or str(v).strip() == "" else v

    @field_validator("env")
    @classmethod
    def _env(cls, v: str) -> str:
        v = v.lower()
        if v not in {"development", "production", "test"}:
            raise ValueError("ENV must be development, production or test")
        return v

    @property
    def is_dev(self) -> bool:
        return self.env == "development"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def mcp_allowed_url_list(self) -> list[str]:
        return [u.strip().rstrip("/") for u in self.mcp_allowed_urls.split(",") if u.strip()]

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    @property
    def local_test_mode_active(self) -> bool:
        return self.local_test_mode and self.is_dev

    def validate_for_runtime(self) -> None:
        if self.local_test_mode and not self.is_dev:
            raise RuntimeError("LOCAL_TEST_MODE skips sign-in and is only allowed with ENV=development")
        if self.env == "production" and self.jwt_secret == _DEV_SECRET:
            raise RuntimeError("JWT_SECRET must be set to a strong random value in production")
        if len(self.jwt_secret) < 16:
            raise RuntimeError("JWT_SECRET must be at least 16 characters")


@lru_cache
def get_settings() -> Settings:
    return Settings()


def reset_settings_cache() -> None:
    get_settings.cache_clear()
