"""Tool-calling agent loop: model -> (validated) MCP tool calls -> verified results -> model ... -> final answer.

Safety properties (all enforced here, not left to the model):
  * Only the configured internal MCP server is contacted (loopback, or explicitly allow-listed via MCP_ALLOWED_URLS).
  * The MCP server gets a short-lived signed user token, so tools can only touch that user's documents.
  * Tool arguments are validated against each tool's JSON schema BEFORE the call; document IDs are checked against the
    user's ownership BEFORE the call (the model can never reach other users' files or supply paths).
  * Tools flagged destructive (MCP annotation destructiveHint=true) never run without a human confirmation that arrives
    as a separate authenticated HTTP request; the model cannot confirm anything.
  * Every produced document is re-checked (exists, size, page count, expected page count) before it is reported.
  * The loop is capped (AGENT_MAX_ITERATIONS model calls).
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import secrets
import threading
import time
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any, AsyncIterator
from urllib.parse import urlparse

import jsonschema
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

from ..core.config import Settings
from ..core.errors import AppError
from ..core.compat import BaseExceptionGroup
from ..schemas.common import to_info
from ..services import pdf_ops
from ..services.operations import Ops
from . import features, prompts
from .llm import LLMClient, TextDelta, ToolCalls
from .mcp_auth import mint_user_token
from .streaming import Event, ev

DOC_KEYS = {"document_id", "document_ids", "image_document_id", "document_id_a", "document_id_b"}
MAX_TOOL_MESSAGE_CHARS = 8000


# ---------------------------------------------------------------- native tools (AI reasoning that needs the same model)
_PAGES = {"type": "string", "pattern": r"^[0-9,\-\s]+$", "maxLength": 500, "description": "Optional page selection, e.g. 1-3,5. Default: all pages."}
_LANG = {"type": "string", "pattern": r"^[A-Za-z][A-Za-z \-()]{1,59}$", "description": "A language NAME, e.g. Hindi."}
_DOC = {"type": "string", "description": "Document id from the document list or an earlier tool result."}

NATIVE_TOOLS: dict[str, dict] = {
    "summarize_document": {
        "description": "Summarize a document (map-reduce for long ones). The full summary is shown to the user directly; do not repeat it.",
        "schema": {"type": "object", "additionalProperties": False, "required": ["document_id"], "properties": {
            "document_id": _DOC, "length": {"type": "string", "enum": ["short", "medium", "long"]}, "pages": _PAGES, "language": _LANG}},
    },
    "translate_document": {
        "description": "Translate a document's text into another language and optionally save it as a real .docx or .txt file. The translation is shown to the user directly; do not repeat it.",
        "schema": {"type": "object", "additionalProperties": False, "required": ["document_id", "target_language"], "properties": {
            "document_id": _DOC, "target_language": _LANG, "pages": _PAGES, "create_document": {"type": "string", "enum": ["none", "docx", "txt"], "description": "Default docx."}}},
    },
    "generate_questions": {
        "description": "Write practice questions from a document (multiple choice, short, long, true/false or mixed), optionally with answers, optionally saved as a real .docx or .txt file. The questions are shown to the user directly; do not repeat them.",
        "schema": {"type": "object", "additionalProperties": False, "required": ["document_id"], "properties": {
            "document_id": _DOC, "kind": {"type": "string", "enum": ["mcq", "short", "long", "truefalse", "mixed"]},
            "count": {"type": "integer", "minimum": 1, "maximum": 50}, "difficulty": {"type": "string", "enum": ["easy", "medium", "hard"]},
            "with_answers": {"type": "boolean"}, "pages": _PAGES, "language": _LANG,
            "create_document": {"type": "string", "enum": ["none", "docx", "txt"], "description": "Default docx."}}},
    },
    "compare_documents": {
        "description": "Compare two documents line by line (a real text diff with page numbers). Returns the differences for you to explain; cite pages as [D1 p. N] / [D2 p. N].",
        "schema": {"type": "object", "additionalProperties": False, "required": ["document_id_a", "document_id_b"], "properties": {
            "document_id_a": _DOC, "document_id_b": _DOC}},
    },
}


def native_openai_tools() -> list[dict]:
    return [{"type": "function", "function": {"name": n, "description": m["description"], "parameters": m["schema"]}} for n, m in NATIVE_TOOLS.items()]


# ---------------------------------------------------------------- MCP client
@dataclass
class ToolMeta:
    name: str
    description: str
    schema: dict
    destructive: bool
    read_only: bool


@dataclass
class Outcome:
    is_error: bool
    text: str
    structured: dict | None


class McpUnavailable(Exception):
    pass


def mcp_url_allowed(settings: Settings) -> bool:
    url = settings.mcp_url.rstrip("/")
    explicit = settings.mcp_allowed_url_list
    if explicit:
        return url in explicit
    host = (urlparse(url).hostname or "").lower()
    return host in {"localhost", "127.0.0.1", "::1"}


class McpToolbox:
    def __init__(self, settings: Settings, user_id: str):
        if not mcp_url_allowed(settings):
            raise AppError(403, "MCP_URL_NOT_ALLOWED",
                           "MCP_URL is not an authorised MCP server. Private documents are never sent to a non-allow-listed "
                           "server; add it to MCP_ALLOWED_URLS only after an explicit decision.")
        if not settings.mcp_shared_secret:
            raise McpUnavailable("MCP_SHARED_SECRET is not set")
        self.s = settings
        self.url = settings.mcp_url
        self.headers = {
            "Authorization": f"Bearer {settings.mcp_shared_secret}",
            "X-Rooman-User-Token": mint_user_token(user_id, settings.mcp_shared_secret, settings.mcp_user_token_ttl_seconds),
        }
        self._stack: contextlib.AsyncExitStack | None = None
        self.session: ClientSession | None = None
        self.tools: dict[str, ToolMeta] = {}

    async def connect(self) -> "McpToolbox":
        stack = contextlib.AsyncExitStack()
        try:
            read, write, _ = await stack.enter_async_context(
                streamablehttp_client(self.url, headers=self.headers, timeout=15, terminate_on_close=False))
            self.session = await stack.enter_async_context(ClientSession(read, write))
            await asyncio.wait_for(self.session.initialize(), 15)
            for t in (await self.session.list_tools()).tools:
                a = t.annotations
                self.tools[t.name] = ToolMeta(
                    t.name, t.description or "", t.inputSchema or {"type": "object", "properties": {}},
                    # MCP default for an absent destructiveHint is "true": treat unknown as destructive
                    destructive=(a.destructiveHint if a is not None and a.destructiveHint is not None else a is None or not a.readOnlyHint),
                    read_only=bool(a and a.readOnlyHint))
        except BaseException as exc:
            # Hand the exception to the exit stack so anyio turns the task-group cancellation back into the REAL
            # error (connection refused, HTTP 401/403, ...) instead of a bare CancelledError that would end the stream silently.
            await stack.__aexit__(type(exc), exc, exc.__traceback__)
            raise
        self._stack = stack
        return self

    async def close(self) -> None:
        if self._stack is not None:
            with contextlib.suppress(Exception):
                await self._stack.aclose()
            self._stack = None

    def openai_tools(self) -> list[dict]:
        return [{"type": "function", "function": {"name": m.name, "description": m.description[:1000], "parameters": m.schema}}
                for m in self.tools.values()]

    async def call(self, name: str, args: dict) -> Outcome:
        assert self.session is not None
        res = await self.session.call_tool(
            name, args, read_timeout_seconds=timedelta(seconds=max(60, self.s.external_timeout_seconds * 3)))
        text = "\n".join(getattr(c, "text", "") for c in res.content or [])
        return Outcome(bool(res.isError), text, res.structuredContent if isinstance(res.structuredContent, dict) else None)


# ---------------------------------------------------------------- pending (awaiting confirmation) actions
@dataclass
class PendingAction:
    id: str
    user_id: str
    tool: str
    arguments: dict
    state: "AgentState"
    expires_at: float


class PendingStore:
    MAX_PER_USER = 20

    def __init__(self) -> None:
        self._items: dict[str, PendingAction] = {}
        self._lock = threading.Lock()

    def _purge(self, now: float) -> None:
        for k in [k for k, v in self._items.items() if v.expires_at < now]:
            del self._items[k]

    def put(self, user_id: str, tool: str, arguments: dict, state: "AgentState", ttl: int) -> PendingAction:
        now = time.time()
        with self._lock:
            self._purge(now)
            mine = sorted((v for v in self._items.values() if v.user_id == user_id), key=lambda v: v.expires_at)
            for old in mine[: max(0, len(mine) - self.MAX_PER_USER + 1)]:
                del self._items[old.id]
            pa = PendingAction(secrets.token_urlsafe(24), user_id, tool, arguments, state, now + ttl)
            self._items[pa.id] = pa
            return pa

    def pop(self, user_id: str, action_id: str) -> PendingAction:
        """One-shot: a confirmation can be used exactly once, and only by the user it was issued to."""
        with self._lock:
            self._purge(time.time())
            pa = self._items.get(action_id)
            if pa is None or pa.user_id != user_id:
                raise AppError(404, "AI_ACTION_NOT_FOUND", "This confirmation request has expired or was already answered. Ask again.")
            del self._items[action_id]
            return pa


PENDING = PendingStore()


# ---------------------------------------------------------------- state
@dataclass
class AgentState:
    messages: list[dict]
    snippets: dict = field(default_factory=dict)
    labels: dict = field(default_factory=dict)
    names: dict = field(default_factory=dict)  # document id -> filename
    iteration: int = 0
    pending_calls: list[dict] = field(default_factory=list)  # remaining tool calls of the last assistant message
    created_docs: dict[str, dict] = field(default_factory=dict)
    approved_call_id: str | None = None
    halted: bool = False


@dataclass
class ChatPrep:
    history: list[dict]
    last_user: str
    rag: features.RagContext


def prepare_chat(ops: Ops, messages: list[dict], doc_ids: list[str]) -> ChatPrep:
    """Eager, synchronous part: ownership checks + retrieval (runs in a worker thread)."""
    if not messages or messages[-1]["role"] != "user":
        raise AppError(422, "VALIDATION_ERROR", "The last message must be from the user")
    users = [m["content"] for m in messages if m["role"] == "user"]
    rag = features.prepare_rag(ops, doc_ids, " ".join(users[-2:]))
    return ChatPrep(messages[:-1][-30:], messages[-1]["content"], rag)


def make_state(prep: ChatPrep, tools_enabled: bool) -> AgentState:
    system = prompts.chat_system(prep.rag.doc_lines, tools_enabled)
    last = prep.last_user + (f"\n\n{prep.rag.block}" if prep.rag.block else "")
    return AgentState([{"role": "system", "content": system}, *prep.history, {"role": "user", "content": last}],
                      snippets=prep.rag.snippets, labels=prep.rag.labels,
                      names={did: prep.rag.names[lbl] for lbl, did in prep.rag.labels.items()})


# ---------------------------------------------------------------- helpers
def _doc_ids_in(args: Any) -> list[str]:
    ids: list[str] = []
    if isinstance(args, dict):
        for k, v in args.items():
            if k in DOC_KEYS:
                ids += [x for x in (v if isinstance(v, list) else [v]) if x is not None]
    return ids


def describe_action(tool: str, description: str, args: dict, names: dict[str, str]) -> str:
    bits = []
    for k, v in args.items():
        if k in DOC_KEYS:
            ids = v if isinstance(v, list) else [v]
            v = ", ".join(names.get(i, i) for i in ids)
        elif "password" in k:
            v = "••••••"
        bits.append(f"{k}: {v}")
    return f"The assistant wants to run “{tool}” ({description.split('.')[0]}). " + ("; ".join(bits) or "No parameters.")


def expected_pages(ops: Ops, name: str, args: dict) -> int | None:
    """Independent expectation of the output page count, computed without trusting the tool's own report."""
    try:
        if name == "merge_pdfs":
            ns = [ops.doc(i).pages for i in args["document_ids"]]
            return None if any(n is None for n in ns) else sum(ns)  # type: ignore[arg-type]
        src = ops.doc(args["document_id"]).pages
        if src is None:
            return None
        if name == "extract_pages":
            return len(pdf_ops.parse_page_spec(args["pages"], src))
        if name == "delete_pages":
            return src - len(pdf_ops.parse_page_spec(args["pages"], src))
        if name in {"rotate_pdf", "add_watermark", "compress_pdf", "protect_pdf", "redact_pdf"}:
            return src
    except (AppError, KeyError, TypeError):
        return None
    return None


def verify_outcome(ops: Ops, name: str, args: dict, structured: dict | None) -> dict:
    """Re-check what a tool claims to have produced (runs in a worker thread)."""
    problems: list[str] = []
    checks: list[str] = []
    docs = (structured or {}).get("documents") or []
    for d in docs:
        try:
            doc = ops.store.get(ops.user_id, d["id"])
        except (AppError, KeyError):
            problems.append(f"output document {d.get('id')} does not exist")
            continue
        if doc.size <= 0:
            problems.append(f"{doc.filename} is empty")
        elif d.get("size") not in (None, doc.size):
            problems.append(f"{doc.filename}: reported size {d.get('size')} != stored size {doc.size}")
        else:
            checks.append(f"{doc.filename} exists ({doc.size} bytes)")
        if doc.kind == "pdf" and doc.pages is not None:
            actual = pdf_ops.page_count(doc.path)
            if actual is not None and actual != doc.pages:
                problems.append(f"{doc.filename}: has {actual} pages but {doc.pages} were reported")
    if docs and docs[0].get("kind") == "pdf" and docs[0].get("pages") is not None:
        exp = expected_pages(ops, name, args)
        if exp is not None:
            if exp != docs[0]["pages"]:
                problems.append(f"expected {exp} pages but the result has {docs[0]['pages']}")
            else:
                checks.append(f"page count {exp} as expected")
    return {"ok": not problems, "checks": checks, "problems": problems}


def _doc_out(d: dict) -> dict:
    return {**d, "download_url": d.get("download_url") or f"/api/documents/{d['id']}/download"}


def _tool_message(call_id: str, payload: dict) -> dict:
    text = json.dumps(payload, ensure_ascii=False)
    if len(text) > MAX_TOOL_MESSAGE_CHARS:
        text = text[:MAX_TOOL_MESSAGE_CHARS] + '..."[truncated]"'
    return {"role": "tool", "tool_call_id": call_id, "content": text}


# ---------------------------------------------------------------- the loop
class Agent:
    def __init__(self, settings: Settings, llm: LLMClient, ops: Ops, toolbox: McpToolbox | None, native: bool = False):
        self.s, self.llm, self.ops, self.toolbox, self.native = settings, llm, ops, toolbox, native

    async def run(self, state: AgentState) -> AsyncIterator[Event]:
        tools = [*(self.toolbox.openai_tools() if self.toolbox else []), *(native_openai_tools() if self.native else [])] or None
        while True:
            while state.pending_calls:
                async for e in self._handle_call(state, state.pending_calls[0]):
                    yield e
                if state.halted:
                    return
            if state.iteration >= self.s.agent_max_iterations:
                msg = f"\n\nI stopped after {self.s.agent_max_iterations} steps without finishing. Tell me how to continue."
                yield ev("token", text=msg)
                yield self._done(state, "max_iterations", [])
                return
            state.iteration += 1
            text_parts: list[str] = []
            calls: list = []
            async for item in self.llm.stream(state.messages, tools=tools):
                if isinstance(item, TextDelta):
                    text_parts.append(item.text)
                    yield ev("token", text=item.text)
                elif isinstance(item, ToolCalls):
                    calls = item.calls
            text = "".join(text_parts)
            if not calls:
                state.messages.append({"role": "assistant", "content": text})
                cites = features.extract_citations(text, state.snippets, state.labels)
                for c in cites:
                    yield ev("citation", **c)
                yield self._done(state, "complete", cites)
                return
            state.messages.append({"role": "assistant", "content": text or None, "tool_calls": [
                {"id": c.id, "type": "function", "function": {"name": c.name, "arguments": c.arguments}} for c in calls]})
            state.pending_calls = [{"id": c.id, "name": c.name, "arguments": c.arguments} for c in calls]
            for c in calls:
                try:
                    shown: Any = json.loads(c.arguments or "{}")
                except ValueError:
                    shown = c.arguments
                yield ev("tool_call", id=c.id, name=c.name, arguments=shown)

    def _done(self, state: AgentState, status: str, cites: list[dict], **extra: Any) -> Event:
        return ev("done", status=status, citations=cites, documents=[_doc_out(d) for d in state.created_docs.values()], **extra)

    def _finish_call(self, state: AgentState, call: dict, payload: dict) -> None:
        state.messages.append(_tool_message(call["id"], payload))
        state.pending_calls.pop(0)
        state.approved_call_id = None

    def decline(self, state: AgentState) -> list[Event]:
        """The user rejected the pending destructive action."""
        call = state.pending_calls[0]
        self._finish_call(state, call, {"ok": False, "declined": True,
                                        "error": "The user declined this action. Do not retry it; acknowledge and ask what to do instead."})
        return [ev("tool_result", id=call["id"], name=call["name"], ok=False, declined=True,
                   message="You declined this action.", documents=[], notice=None, details={})]

    async def _run_native(self, state: AgentState, call: dict, name: str, args: dict) -> AsyncIterator[Event]:
        """Run one of the AI document tools with the SAME model. The text goes straight to the user (the model is told not to repeat it);
        any document it creates is a real, stored file that is verified like every other tool result."""
        ops, llm = self.ops, self.llm

        def fail(msg: str) -> Event:
            self._finish_call(state, call, {"ok": False, "error": msg})
            return ev("tool_result", id=call["id"], name=name, ok=False, message=msg, documents=[], notice=None, details={})

        try:
            if name == "compare_documents":
                diff = await asyncio.to_thread(features.prepare_compare, ops, args["document_id_a"], args["document_id_b"])
                brief = {"identical": diff["identical"], "pages_a": diff["pages_a"], "pages_b": diff["pages_b"], "summary": diff["summary"],
                         "changes": [{**c, "a_text": c["a_text"][:300], "b_text": c["b_text"][:300]} for c in diff["changes"][:40]], "truncated": diff["truncated"]}
                self._finish_call(state, call, {"ok": True, "documents": [], "data": brief,
                                                "note": "Explain these differences to the user. Cite pages as [D1 p. N] for the first document and [D2 p. N] for the second."})
                yield ev("tool_result", id=call["id"], name=name, ok=True, message="Compared the two documents (line-by-line text diff).",
                         documents=[], notice=None, details=diff["summary"], data=brief)
                return
            if name == "summarize_document":
                pages, snippets, labels = await asyncio.to_thread(features.prepare_summarize, ops, args["document_id"], args.get("pages"))
                source = features.summarize_events(llm, pages, snippets, labels, args.get("length", "medium"), args.get("language"))
            elif name == "translate_document":
                pages, stem = await asyncio.to_thread(features.prepare_translate, ops, args["document_id"], args.get("pages"))
                source = features.translate_events(llm, ops, pages, args["target_language"], stem, args.get("create_document", "docx"))
            else:  # generate_questions
                pages, snippets, labels, stem = await asyncio.to_thread(features.prepare_questions, ops, args["document_id"], args.get("pages"))
                source = features.questions_events(llm, ops, pages, snippets, labels, stem, args.get("kind", "mcq"), args.get("count", 10),
                                                   args.get("difficulty", "medium"), args.get("with_answers", True), args.get("language"),
                                                   args.get("create_document", "docx"))
            chars, docs_raw = 0, []
            async for e in source:
                if e.name == "token":
                    chars += len(e.data.get("text", ""))
                    yield e
                elif e.name == "done":
                    docs_raw = e.data.get("documents") or []
        except AppError as e:
            yield fail(e.message)
            return
        verification = await asyncio.to_thread(verify_outcome, ops, name, args, {"documents": docs_raw})
        docs = [_doc_out(d) for d in docs_raw]
        ok = verification["ok"]
        if ok:
            for d in docs:
                state.created_docs[d["id"]] = d
        payload = {"ok": ok, "delivered_to_user": True, "characters_written": chars, "documents": docs, "verification": verification,
                   "note": "The full output was already shown to the user. Do NOT repeat it; say in one or two sentences what was produced"
                           + (" and give the download link as [filename](download_url)." if docs else ".")}
        if not ok:
            payload["error"] = "Verification of the result failed: " + "; ".join(verification["problems"])
        self._finish_call(state, call, payload)
        yield ev("tool_result", id=call["id"], name=name, ok=ok, message=("; ".join(verification["checks"]) if ok else payload["error"]),
                 documents=docs, notice=None, details={}, verification=verification)

    async def _handle_call(self, state: AgentState, call: dict) -> AsyncIterator[Event]:
        name, raw = call["name"], call["arguments"]

        def fail(msg: str) -> Event:
            self._finish_call(state, call, {"ok": False, "error": msg})
            return ev("tool_result", id=call["id"], name=name, ok=False, message=msg, documents=[], notice=None, details={})

        native = NATIVE_TOOLS.get(name) if self.native else None
        meta = self.toolbox.tools.get(name) if (self.toolbox and not native) else None
        if meta is None and native is None:
            available = [*(self.toolbox.tools if self.toolbox else []), *(NATIVE_TOOLS if self.native else [])]
            yield fail(f"Unknown tool '{name}'. Available tools: {', '.join(available) if available else 'none'}.")
            return
        try:
            args = json.loads(raw or "{}")
            if not isinstance(args, dict):
                raise ValueError
        except ValueError:
            yield fail("The tool arguments were not a valid JSON object. Call the tool again with valid JSON.")
            return
        errors = sorted(jsonschema.Draft202012Validator(native['schema'] if native else meta.schema).iter_errors(args), key=lambda e: list(e.path))
        if errors:
            msgs = [f"{'.'.join(map(str, e.path)) or 'arguments'}: {e.message}" for e in errors[:5]]
            yield fail("Invalid arguments - " + "; ".join(msgs) + ". If the user did not provide a required value, ask them for it.")
            return
        for did in _doc_ids_in(args):  # ownership guard: unknown/foreign ids never reach the tool
            try:
                await asyncio.to_thread(self.ops.store.get, self.ops.user_id, did)
            except AppError:
                yield fail(f"Unknown document id '{did}'. Use only ids from the document list or from earlier tool results; "
                           "if no document is available, ask the user to attach one.")
                return
        if native is not None:
            async for e in self._run_native(state, call, name, args):
                yield e
            return
        assert meta is not None
        if meta.destructive and state.approved_call_id != call["id"]:
            pa = PENDING.put(self.ops.user_id, name, args, state, self.s.pending_action_ttl_seconds)
            state.halted = True
            yield ev("confirmation_required", action_id=pa.id, tool=name, arguments=args, destructive=True,
                     message=describe_action(name, meta.description, args, state.names), expires_at=pa.expires_at,
                     expires_in=self.s.pending_action_ttl_seconds)
            yield self._done(state, "awaiting_confirmation", [], action_id=pa.id)
            return
        assert self.toolbox is not None
        outcome = await self.toolbox.call(name, args)
        if outcome.is_error:
            yield fail(f"The tool failed: {outcome.text[:600]}")
            return
        structured = outcome.structured or {}
        verification = await asyncio.to_thread(verify_outcome, self.ops, name, args, structured)
        docs = [_doc_out(d) for d in structured.get("documents") or []]
        ok = verification["ok"]
        if ok:
            for d in docs:
                state.created_docs[d["id"]] = d
        payload = {"ok": ok, "documents": docs, "notice": structured.get("notice"), "details": structured.get("details"),
                   "data": structured.get("data"), "verification": verification}
        if not ok:
            payload["error"] = "Verification of the result failed: " + "; ".join(verification["problems"])
        self._finish_call(state, call, payload)
        yield ev("tool_result", id=call["id"], name=name, ok=ok,
                 message=("; ".join(verification["checks"]) if ok else payload["error"]), documents=docs,
                 notice=structured.get("notice"), details=structured.get("details") or {}, verification=verification,
                 data=structured.get("data"))


# ---------------------------------------------------------------- session wrapper used by the router
async def chat_session(settings: Settings, llm: LLMClient, ops: Ops, *, prep: ChatPrep | None, pending: PendingAction | None,
                       approve: bool, use_tools: bool) -> AsyncIterator[Event]:
    toolbox: McpToolbox | None = None
    tools_error: str | None = None
    if use_tools or pending is not None:
        try:
            toolbox = await McpToolbox(settings, ops.user_id).connect()
        except AppError:
            raise
        except McpUnavailable as e:
            tools_error = str(e)
        except Exception as e:  # noqa: BLE001 (ExceptionGroup from anyio, connection refused, ...)
            leaf: BaseException = e
            while isinstance(leaf, BaseExceptionGroup) and leaf.exceptions:
                leaf = leaf.exceptions[0]
            tools_error = f"MCP server not reachable ({type(leaf).__name__})"
    try:
        if pending is not None:
            if toolbox is None and approve:
                raise AppError(503, "MCP_UNAVAILABLE", f"Cannot run the confirmed action: {tools_error}")
            state = pending.state
            state.halted = False
        else:
            assert prep is not None
            state = make_state(prep, toolbox is not None or use_tools)
        agent = Agent(settings, llm, ops, toolbox, native=use_tools or pending is not None)
        yield ev("meta", model=settings.ai_model, tools_enabled=toolbox is not None, tools_error=tools_error,
                 tools=sorted([*(toolbox.tools if toolbox else []), *(NATIVE_TOOLS if (use_tools or pending is not None) else [])]), resumed=pending is not None,
                 documents=[{"id": i, "label": l, "filename": state.names.get(i, l)} for l, i in state.labels.items()])
        if pending is not None:
            call = state.pending_calls[0]
            if approve:
                state.approved_call_id = call["id"]
            else:
                for e in agent.decline(state):
                    yield e
        async for e in agent.run(state):
            yield e
    finally:
        if toolbox is not None:
            await toolbox.close()
