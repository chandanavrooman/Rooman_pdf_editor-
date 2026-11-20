"""Rooman PDF backend (FastAPI)."""
from __future__ import annotations

import asyncio
import contextlib
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .core.config import get_settings
from .core.deps import get_store
from .core.errors import install_error_handlers
from .core.limits import MaxBodyMiddleware
from .core.ratelimit import RateLimitMiddleware
from .routers import ai, auth, convert, documents, optimize, organize, security_tools, system, tables

log = logging.getLogger("rooman")


def create_app() -> FastAPI:
    settings = get_settings()
    settings.validate_for_runtime()
    logging.getLogger().setLevel(logging.WARNING)  # keep third-party libraries (pdf2docx...) quiet

    @contextlib.asynccontextmanager
    async def lifespan(_: FastAPI):
        store = get_store()

        async def sweeper():
            while True:
                try:
                    n = await asyncio.to_thread(store.cleanup_expired)
                    if n:
                        log.info("cleanup removed %d expired document(s)", n)
                except Exception:  # noqa: BLE001
                    log.exception("cleanup failed")
                await asyncio.sleep(settings.cleanup_interval_seconds)

        task = asyncio.create_task(sweeper())
        try:
            yield
        finally:
            task.cancel()

    dev = settings.is_dev
    app = FastAPI(
        title="Rooman PDF API", version="0.1.0", lifespan=lifespan,
        docs_url="/docs" if dev else None, redoc_url="/redoc" if dev else None,
        openapi_url="/openapi.json" if dev else None,
    )
    # outermost last: CORS must wrap everything so error responses carry CORS headers
    app.add_middleware(RateLimitMiddleware, limit=settings.rate_limit, auth_limit=settings.auth_rate_limit,
                       ai_limit=settings.ai_rate_limit)
    app.add_middleware(MaxBodyMiddleware, max_bytes=settings.max_upload_bytes + 1024 * 1024)
    app.add_middleware(
        CORSMiddleware, allow_origins=settings.cors_origin_list, allow_credentials=False,
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"], allow_headers=["Authorization", "Content-Type"],
        expose_headers=["Content-Disposition"],
    )
    install_error_handlers(app)
    for module in (system, auth, documents, organize, convert, optimize, security_tools, tables, ai):
        app.include_router(module.router)
    return app


app = create_app()
