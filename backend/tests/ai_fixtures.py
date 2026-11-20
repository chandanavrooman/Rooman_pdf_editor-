"""Fixtures for the AI + MCP tests: a REAL MCP server over Streamable HTTP and a scripted OpenAI-compatible server.

The fake model server is a TEST DOUBLE: it replays scripted responses so the agent loop, SSE protocol, MCP calls and real
PDF operations can be tested end to end WITHOUT a real model. Tests using it are labelled "scripted model (test double)".
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import threading
import time
from contextlib import asynccontextmanager
from typing import Any, Callable

import pytest
import uvicorn
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, StreamingResponse
from starlette.routing import Route

TEST_KEY = "sk-test-key-DO-NOT-LEAK-1234567890"


# ---------------------------------------------------------------- tiny uvicorn-in-a-thread runner
class ServerThread:
    def __init__(self, app):
        self.server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=0, log_level="error", lifespan="on"))
        self.thread = threading.Thread(target=self.server.run, daemon=True)

    def __enter__(self):
        self.thread.start()
        deadline = time.time() + 20
        while not self.server.started:
            if time.time() > deadline:
                raise RuntimeError("test server did not start")
            time.sleep(0.02)
        self.port = self.server.servers[0].sockets[0].getsockname()[1]
        return self

    def __exit__(self, *exc):
        self.server.should_exit = True
        self.thread.join(timeout=10)


# ---------------------------------------------------------------- scripted OpenAI-compatible server
class FakeLLM:
    """POST /v1/chat/completions. Script entries: dict(text=, tool_calls=[{name, arguments}], status=, body=, think=) or
    a callable(request_json) -> dict. Every request (body + Authorization header) is recorded."""

    def __init__(self) -> None:
        self.script: list[Any] = []
        self.requests: list[dict] = []
        self.headers: list[dict] = []
        self.lock = threading.Lock()
        self.handler: Callable[[dict], dict] | None = None  # consulted for every request when set

    def reset(self) -> None:
        with self.lock:
            self.script.clear()
            self.requests.clear()
            self.headers.clear()
            self.handler = None

    def push(self, *entries: Any) -> None:
        with self.lock:
            self.script.extend(entries)

    @property
    def app(self) -> Starlette:
        return Starlette(routes=[Route("/v1/chat/completions", self._handle, methods=["POST"])])

    async def _handle(self, request: Request):
        body = await request.json()
        with self.lock:
            self.requests.append(body)
            self.headers.append(dict(request.headers))
            entry = self.handler if self.handler else (self.script.pop(0) if self.script else None)
        if entry is None:
            return JSONResponse({"error": {"message": "scripted model: script exhausted (unexpected extra call)"}}, status_code=500)
        if callable(entry):
            entry = entry(body)
        if entry.get("status", 200) != 200:
            return JSONResponse(json.loads(entry["body"]) if entry.get("body") else {"error": {"message": "scripted error"}},
                                status_code=entry["status"])

        def chunk(delta: dict, finish: str | None = None) -> bytes:
            obj = {"id": "chatcmpl-test", "object": "chat.completion.chunk", "model": body.get("model"),
                   "choices": [{"index": 0, "delta": delta, "finish_reason": finish}]}
            return f"data: {json.dumps(obj)}\n\n".encode()

        async def gen():
            yield chunk({"role": "assistant", "content": ""})
            text = entry.get("text") or ""
            if entry.get("think"):
                text = f"<think>{entry['think']}</think>\n\n" + text
            for i in range(0, len(text), 5):  # tiny pieces: also splits <think> tags across chunks
                yield chunk({"content": text[i:i + 5]})
                await asyncio.sleep(0)
            for idx, tc in enumerate(entry.get("tool_calls") or []):
                args = json.dumps(tc["arguments"])
                half = len(args) // 2
                yield chunk({"tool_calls": [{"index": idx, "id": f"call_{len(self.requests)}_{idx}", "type": "function",
                                             "function": {"name": tc["name"], "arguments": args[:half]}}]})
                yield chunk({"tool_calls": [{"index": idx, "function": {"arguments": args[half:]}}]})
            yield chunk({}, "tool_calls" if entry.get("tool_calls") else "stop")
            yield b"data: [DONE]\n\n"

        return StreamingResponse(gen(), media_type="text/event-stream")


@pytest.fixture(scope="session")
def _fake_llm_server():
    llm = FakeLLM()
    with ServerThread(llm.app) as srv:
        llm.base = f"http://127.0.0.1:{srv.port}/v1"
        yield llm


@pytest.fixture(scope="session")
def _mcp_server_thread():
    from rooman_pdf_mcp.server import create_app

    from app.core.config import get_settings

    app = create_app(secret=get_settings().mcp_shared_secret, host="127.0.0.1", port=1)
    with ServerThread(app) as srv:
        yield f"http://127.0.0.1:{srv.port}/mcp"


@pytest.fixture
def mcp_url(_mcp_server_thread, monkeypatch):
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "mcp_url", _mcp_server_thread)
    return _mcp_server_thread


@pytest.fixture
def fake_llm(_fake_llm_server, monkeypatch):
    """Scripted model (test double) wired into the settings with a configured key."""
    from app.core.config import get_settings

    s = get_settings()
    monkeypatch.setattr(s, "ai_endpoint", _fake_llm_server.base)
    monkeypatch.setattr(s, "ai_api_key", TEST_KEY)
    _fake_llm_server.reset()
    yield _fake_llm_server
    _fake_llm_server.reset()


@pytest.fixture
def agent_env(fake_llm, mcp_url):
    return fake_llm


# ---------------------------------------------------------------- helpers
def parse_sse(text: str) -> list[tuple[str, dict]]:
    events = []
    for frame in text.split("\n\n"):
        name, data = None, None
        for line in frame.splitlines():
            if line.startswith("event:"):
                name = line[6:].strip()
            elif line.startswith("data:"):
                data = line[5:].strip()
        if name and data is not None:
            events.append((name, json.loads(data)))
    return events


def sse_post(client, url: str, headers: dict, json_body: dict):
    r = client.post(url, headers=headers, json=json_body)
    return r


@asynccontextmanager
async def mcp_session(url: str, secret: str | None, user_token: str | None, extra: dict | None = None):
    from mcp import ClientSession
    from mcp.client.streamable_http import streamablehttp_client

    headers = dict(extra or {})
    if secret is not None:
        headers["Authorization"] = f"Bearer {secret}"
    if user_token is not None:
        headers["X-Rooman-User-Token"] = user_token
    async with streamablehttp_client(url, headers=headers, terminate_on_close=False) as (r, w, _):
        async with ClientSession(r, w) as s:
            await s.initialize()
            yield s
