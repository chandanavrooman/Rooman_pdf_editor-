"""Minimal OpenAI-compatible chat-completions client (httpx, streaming).

The API key lives only in server settings: it is sent as a Bearer header, never logged and never echoed
(error messages from the provider are scrubbed of it).
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any, AsyncIterator

import httpx

from ..core.config import Settings, get_settings
from ..core.errors import AppError

THINK_OPEN, THINK_CLOSE = "<think>", "</think>"


class ThinkStripper:
    """Removes <think>…</think> blocks from a token stream (tags may be split across chunks)."""

    def __init__(self) -> None:
        self.buf = ""
        self.in_think = False
        self._lstrip = False

    @staticmethod
    def _partial(buf: str, tag: str) -> int:
        for n in range(min(len(tag) - 1, len(buf)), 0, -1):
            if buf.endswith(tag[:n]):
                return n
        return 0

    def feed(self, s: str) -> str:
        self.buf += s
        out: list[str] = []
        while True:
            if not self.in_think:
                i = self.buf.find(THINK_OPEN)
                if i >= 0:
                    out.append(self.buf[:i])
                    self.buf = self.buf[i + len(THINK_OPEN):]
                    self.in_think = True
                    continue
                keep = self._partial(self.buf, THINK_OPEN)
                emit = self.buf[: len(self.buf) - keep]
                self.buf = self.buf[len(self.buf) - keep:]
                if self._lstrip and emit:
                    emit = emit.lstrip()
                    if emit:
                        self._lstrip = False
                out.append(emit)
                break
            j = self.buf.find(THINK_CLOSE)
            if j >= 0:
                self.buf = self.buf[j + len(THINK_CLOSE):]
                self.in_think = False
                self._lstrip = True
                continue
            keep = self._partial(self.buf, THINK_CLOSE)
            self.buf = self.buf[len(self.buf) - keep:]
            break
        return "".join(out)

    def flush(self) -> str:
        rest = "" if self.in_think else self.buf
        self.buf = ""
        return rest.lstrip() if self._lstrip else rest


def strip_think(text: str) -> str:
    text = re.sub(r"<think>.*?</think>\s*", "", text, flags=re.S)
    return re.sub(r"<think>.*\Z", "", text, flags=re.S).strip()


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: str  # raw JSON string as produced by the model


@dataclass
class TextDelta:
    text: str


@dataclass
class ToolCalls:
    calls: list[ToolCall]


@dataclass
class Finish:
    reason: str | None = None
    usage: dict[str, Any] = field(default_factory=dict)


class LLMClient:
    def __init__(self, settings: Settings | None = None):
        self.s = settings or get_settings()

    @property
    def configured(self) -> bool:
        return bool(self.s.ai_api_key.strip())

    def require_key(self) -> None:
        if not self.configured:
            raise AppError(503, "AI_KEY_MISSING",
                           "The AI assistant is not configured: the server administrator must set AI_API_KEY.")

    # ---------------------------------------------------------------- errors
    def _scrub(self, text: str) -> str:
        key = self.s.ai_api_key.strip()
        if key:
            text = text.replace(key, "***")
        return text[:400]

    def _map_http_error(self, status: int, body: str) -> AppError:
        detail = ""
        code_hint = ""
        try:
            j = json.loads(body)
            err = j.get("error", j) if isinstance(j, dict) else {}
            detail = str(err.get("message") or "") if isinstance(err, dict) else str(err)
            code_hint = str(err.get("code") or "") if isinstance(err, dict) else ""
        except (ValueError, AttributeError):
            detail = body
        detail = self._scrub(detail)
        low = f"{detail} {code_hint}".lower()
        if status in (401, 403):
            return AppError(502, "AI_KEY_INVALID",
                            "The AI provider rejected the configured API key. The server administrator must check AI_API_KEY.")
        if status == 429:
            return AppError(429, "AI_RATE_LIMITED", "The AI provider is rate limiting requests. Please retry in a moment.")
        if "model" in low and any(w in low for w in ("not found", "does not exist", "decommission", "not_found", "unknown")):
            return AppError(502, "AI_MODEL_NOT_FOUND",
                            f"The AI provider does not know the model '{self.s.ai_model}'. Check AI_MODEL. ({detail})")
        return AppError(502, "AI_UPSTREAM_ERROR", f"The AI provider returned an error ({status}): {detail or 'no details'}")

    # ---------------------------------------------------------------- calls
    async def stream(self, messages: list[dict], *, tools: list[dict] | None = None, temperature: float | None = None,
                     max_tokens: int | None = None) -> AsyncIterator[TextDelta | ToolCalls | Finish]:
        self.require_key()
        payload: dict[str, Any] = {
            "model": self.s.ai_model, "messages": messages, "stream": True,
            "temperature": self.s.ai_temperature if temperature is None else temperature,
            "max_tokens": max_tokens or self.s.ai_max_tokens,
        }
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"
        url = self.s.ai_endpoint.rstrip("/") + "/chat/completions"
        headers = {"Authorization": f"Bearer {self.s.ai_api_key.strip()}", "Content-Type": "application/json",
                   "Accept": "text/event-stream"}
        timeout = httpx.Timeout(connect=10, read=self.s.ai_timeout_seconds, write=30, pool=10)
        stripper = ThinkStripper()
        acc: dict[int, dict[str, str]] = {}
        finish: str | None = None
        usage: dict[str, Any] = {}
        try:
            async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
                async with client.stream("POST", url, headers=headers, json=payload) as r:
                    if r.status_code != 200:
                        body = (await r.aread()).decode("utf-8", "replace")
                        raise self._map_http_error(r.status_code, body)
                    async for line in r.aiter_lines():
                        line = line.strip()
                        if not line.startswith("data:"):
                            continue
                        data = line[5:].strip()
                        if data == "[DONE]":
                            break
                        try:
                            obj = json.loads(data)
                        except ValueError:
                            continue
                        if isinstance(obj, dict) and obj.get("error"):
                            raise self._map_http_error(int((obj["error"] or {}).get("status", 502)) if isinstance(obj["error"], dict) else 502,
                                                       json.dumps(obj))
                        if obj.get("usage"):
                            usage = obj["usage"]
                        for choice in obj.get("choices") or []:
                            delta = choice.get("delta") or {}
                            if delta.get("content"):
                                out = stripper.feed(delta["content"])
                                if out:
                                    yield TextDelta(out)
                            for tc in delta.get("tool_calls") or []:
                                slot = acc.setdefault(int(tc.get("index", 0)), {"id": "", "name": "", "args": ""})
                                if tc.get("id"):
                                    slot["id"] = tc["id"]
                                fn = tc.get("function") or {}
                                if fn.get("name"):
                                    slot["name"] += fn["name"]
                                if fn.get("arguments"):
                                    slot["args"] += fn["arguments"]
                            if choice.get("finish_reason"):
                                finish = choice["finish_reason"]
        except httpx.TimeoutException:
            raise AppError(502, "AI_UPSTREAM_ERROR", "The AI provider timed out.") from None
        except httpx.HTTPError as e:
            raise AppError(502, "AI_UPSTREAM_ERROR", f"Could not reach the AI provider: {self._scrub(type(e).__name__)}") from None
        tail = stripper.flush()
        if tail:
            yield TextDelta(tail)
        if acc:
            yield ToolCalls([ToolCall(v["id"] or f"call_{i}", v["name"], v["args"] or "{}") for i, v in sorted(acc.items())])
        yield Finish(finish, usage)

    async def complete(self, messages: list[dict], **kw: Any) -> str:
        parts: list[str] = []
        async for item in self.stream(messages, **kw):
            if isinstance(item, TextDelta):
                parts.append(item.text)
        return "".join(parts).strip()
