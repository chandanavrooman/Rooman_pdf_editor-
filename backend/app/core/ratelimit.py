"""Small in-memory sliding-window rate limiter (per client IP). Single-process only."""
from __future__ import annotations

import time
from collections import defaultdict, deque

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

WINDOW = 60.0


class SlidingWindow:
    def __init__(self) -> None:
        self.hits: dict[str, deque[float]] = defaultdict(deque)

    def check(self, key: str, limit: int, now: float | None = None) -> float:
        """Return 0 if allowed, else seconds until a slot frees."""
        now = time.monotonic() if now is None else now
        q = self.hits[key]
        while q and q[0] <= now - WINDOW:
            q.popleft()
        if len(q) >= limit:
            return max(1.0, q[0] + WINDOW - now)
        q.append(now)
        return 0.0


class RateLimitMiddleware:
    def __init__(self, app: ASGIApp, limit: int, auth_limit: int, ai_limit: int = 0):
        self.app = app
        self.limit = limit
        self.auth_limit = auth_limit
        self.ai_limit = ai_limit
        self.ai = SlidingWindow()
        self.general = SlidingWindow()
        self.auth = SlidingWindow()

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope.get("method") == "OPTIONS":
            await self.app(scope, receive, send)
            return
        client = (scope.get("client") or ("unknown", 0))[0]
        path: str = scope.get("path", "")
        retry = 0.0
        if self.auth_limit and path.startswith("/api/auth/") and path != "/api/auth/me":
            retry = self.auth.check(client, self.auth_limit)
        if self.ai_limit and path.startswith("/api/ai/") and path != "/api/ai/status":
            retry = self.ai.check(client, self.ai_limit)
        if not retry and self.limit and path.startswith("/api/"):
            retry = self.general.check(client, self.limit)
        if retry:
            resp = JSONResponse(
                {"detail": "Too many requests. Please slow down.", "code": "RATE_LIMITED"},
                status_code=429,
                headers={"Retry-After": str(int(retry) + 1)},
            )
            await resp(scope, receive, send)
            return
        await self.app(scope, receive, send)
