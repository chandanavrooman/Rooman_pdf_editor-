"""FastMCP server (Streamable HTTP) guarded by the backend's shared secret + signed user identity."""
from __future__ import annotations

import json
from pathlib import Path

from mcp.server.fastmcp import FastMCP
from starlette.types import ASGIApp, Receive, Scope, Send

from app.ai.mcp_auth import SECRET_HEADER, USER_HEADER, McpAuthError, bearer_matches, validate_secret, verify_user_token
from app.core.config import get_settings
from app.core.deps import get_store

from .loader import TOOLS_DIR, load_tools


class BackendOnlyMiddleware:
    """Reject every HTTP request that does not come from our backend for a real user.

    401 = credentials missing, 403 = wrong secret / invalid user token. Constant-time secret comparison.
    """

    def __init__(self, app: ASGIApp, secret: str):
        self.app = app
        self.secret = secret

    async def _deny(self, send: Send, status: int, msg: str) -> None:
        body = json.dumps({"error": msg}).encode()
        await send({"type": "http.response.start", "status": status,
                    "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
        await send({"type": "http.response.body", "body": body})

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}
        auth = headers.get(SECRET_HEADER)
        if not auth:
            await self._deny(send, 401, "missing credentials")
            return
        if not bearer_matches(auth, self.secret):
            await self._deny(send, 403, "invalid credentials")
            return
        try:
            uid = verify_user_token(headers.get(USER_HEADER), self.secret)
        except McpAuthError as e:
            await self._deny(send, 401 if "missing" in str(e) else 403, str(e))
            return
        if get_store().get_user(uid) is None:
            await self._deny(send, 403, "unknown user")
            return
        await self.app(scope, receive, send)


def create_mcp(*, host: str = "127.0.0.1", port: int = 8001, tools_dir: Path | str = TOOLS_DIR) -> FastMCP:
    mcp = FastMCP("rooman-pdf-mcp", instructions=(
        "Rooman PDF tools. Every tool takes document IDs (never file paths) belonging to the calling user "
        "and returns new document IDs with download URLs."),
        host=host, port=port, streamable_http_path="/mcp", stateless_http=True, json_response=True)
    load_tools(mcp, tools_dir)
    return mcp


def create_app(*, secret: str | None = None, host: str | None = None, port: int | None = None,
               tools_dir: Path | str = TOOLS_DIR):
    """Starlette ASGI app serving MCP at /mcp. Refuses to build without a strong MCP_SHARED_SECRET."""
    s = get_settings()
    secret = validate_secret(secret if secret is not None else s.mcp_shared_secret)
    mcp = create_mcp(host=host or s.mcp_host, port=port or s.mcp_port, tools_dir=tools_dir)
    app = mcp.streamable_http_app()
    app.add_middleware(BackendOnlyMiddleware, secret=secret)
    app.state.mcp = mcp
    return app
