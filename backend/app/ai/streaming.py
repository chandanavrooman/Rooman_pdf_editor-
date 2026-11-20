"""Server-Sent Events plumbing shared by every AI endpoint.

Wire format (one frame per event):
    event: <name>\\ndata: <json>\\n\\n
A stream ends with exactly one `done` or one `error` event. `: ping` comment lines are keep-alives.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from dataclasses import dataclass, field
from typing import Any, AsyncIterator

from fastapi.responses import StreamingResponse

from ..core.errors import AppError
from ..core.compat import BaseExceptionGroup

log = logging.getLogger("rooman.ai")


@dataclass
class Event:
    name: str
    data: dict[str, Any] = field(default_factory=dict)


def ev(event_name: str, /, **data: Any) -> Event:
    return Event(event_name, data)


def encode(e: Event) -> bytes:
    return f"event: {e.name}\ndata: {json.dumps(e.data, ensure_ascii=False, default=str)}\n\n".encode()


def error_event(exc: Exception) -> Event:
    if isinstance(exc, AppError):
        return ev("error", code=exc.code, message=exc.message, status=exc.status)
    log.exception("unexpected error in AI stream")
    return ev("error", code="AI_INTERNAL_ERROR", message="Something went wrong while processing your request.", status=500)


async def pump(source: AsyncIterator[Event], ping_seconds: float = 15.0) -> AsyncIterator[bytes]:
    """Run `source` in its own task (so anyio cancel scopes of MCP/HTTP clients live in ONE task) and
    relay its events as SSE bytes. Cancelled when the client disconnects."""
    queue: asyncio.Queue[Event | None] = asyncio.Queue(maxsize=512)

    async def producer() -> None:
        try:
            async for e in source:
                await queue.put(e)
        except asyncio.CancelledError:
            raise
        except BaseException as exc:  # noqa: BLE001 — ExceptionGroups from anyio too
            leaf = exc
            while isinstance(leaf, BaseExceptionGroup) and leaf.exceptions:
                leaf = leaf.exceptions[0]
            await queue.put(error_event(leaf if isinstance(leaf, Exception) else Exception(str(leaf))))
        finally:
            await queue.put(None)

    task = asyncio.create_task(producer())
    try:
        while True:
            try:
                item = await asyncio.wait_for(queue.get(), ping_seconds)
            except asyncio.TimeoutError:
                yield b": ping\n\n"
                continue
            if item is None:
                break
            yield encode(item)
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await task


def sse_response(source: AsyncIterator[Event]) -> StreamingResponse:
    return StreamingResponse(
        pump(source), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


async def collect(source: AsyncIterator[Event]) -> dict[str, Any]:
    """Non-streaming mode: run to completion and return {text, citations, documents, ...done fields}."""
    text: list[str] = []
    extra: dict[str, Any] = {}
    async for e in source:
        if e.name == "token":
            text.append(e.data.get("text", ""))
        elif e.name == "error":
            raise AppError(int(e.data.get("status", 502)), e.data.get("code", "AI_UPSTREAM_ERROR"), e.data.get("message", ""))
        elif e.name == "done":
            extra.update(e.data)
        elif e.name == "diff":
            extra["diff"] = e.data
    return {"text": "".join(text), **extra}
