"""Backend <-> MCP-server trust.

The MCP server accepts a request only if it carries BOTH:
  * `Authorization: Bearer <MCP_SHARED_SECRET>`   (proves the caller is our backend), and
  * `X-Rooman-User-Token: <JWT>` signed with the same secret, naming the end user (proves WHOSE documents
    a tool call may touch). The token is short-lived and minted per chat request.
"""
from __future__ import annotations

import hmac
import time

import jwt

AUDIENCE = "rooman-pdf-mcp"
MIN_SECRET_LEN = 32
SECRET_HEADER = "authorization"
USER_HEADER = "x-rooman-user-token"


class McpAuthError(Exception):
    pass


def validate_secret(secret: str) -> str:
    if not secret or len(secret) < MIN_SECRET_LEN:
        raise McpAuthError(
            f"MCP_SHARED_SECRET must be set to a random string of at least {MIN_SECRET_LEN} characters. "
            "Generate one with: python -c \"import secrets; print(secrets.token_urlsafe(48))\"")
    return secret


def mint_user_token(user_id: str, secret: str, ttl_seconds: int = 900) -> str:
    now = int(time.time())
    return jwt.encode({"sub": user_id, "aud": AUDIENCE, "iat": now, "exp": now + ttl_seconds, "typ": "mcp-user"},
                      secret, algorithm="HS256")


def verify_user_token(token: str | None, secret: str) -> str:
    if not token:
        raise McpAuthError("missing user token")
    try:
        claims = jwt.decode(token, secret, algorithms=["HS256"], audience=AUDIENCE,
                            options={"require": ["exp", "sub", "aud"]})
    except jwt.PyJWTError as e:
        raise McpAuthError(f"invalid user token: {type(e).__name__}") from None
    if claims.get("typ") != "mcp-user" or not isinstance(claims.get("sub"), str) or not claims["sub"]:
        raise McpAuthError("invalid user token")
    return claims["sub"]


def bearer_matches(header_value: str | None, secret: str) -> bool:
    if not header_value or not header_value.lower().startswith("bearer "):
        return False
    return hmac.compare_digest(header_value[7:].strip().encode(), secret.encode())
