"""AI assistant endpoints. All require auth; LLM calls need AI_API_KEY (error code AI_KEY_MISSING otherwise)."""
from __future__ import annotations

import asyncio
from pathlib import Path
from typing import AsyncIterator

from fastapi import APIRouter

from ..ai import agent, features
from ..ai.llm import LLMClient
from ..ai.streaming import Event, collect, ev, sse_response
from ..core.deps import CurrentUser, OpsDep, SettingsDep, StoreDep
from ..core.errors import AppError
from ..schemas import ai as s
from ..schemas.common import ToolResult, to_info
from ..services import tables as tables_svc
from ..services.operations import Ops

router = APIRouter(prefix="/api/ai", tags=["ai"])


async def _respond(source: AsyncIterator[Event], stream: bool):
    if stream:
        return sse_response(source)
    return await collect(source)


@router.get("/status", summary="Is the AI assistant configured? (never returns the key)")
def status(settings: SettingsDep):
    return {"configured": bool(settings.ai_api_key.strip()), "model": settings.ai_model,
            "tools_available": bool(settings.mcp_shared_secret),
            "message": None if settings.ai_api_key.strip() else
            "AI_API_KEY is not set on the server. Text extraction, tables and document comparison still work; chat, summaries, translation and explanations need a key."}


@router.post("/chat", summary="Chat with your PDFs (SSE). Can run PDF tools; destructive tools ask for confirmation")
async def chat(body: s.ChatRequest, user: CurrentUser, ops: OpsDep, settings: SettingsDep):
    llm = LLMClient(settings)
    llm.require_key()
    if body.confirm is not None:
        pending = agent.PENDING.pop(user.id, body.confirm.action_id)
        source = agent.chat_session(settings, llm, ops, prep=None, pending=pending, approve=body.confirm.approve, use_tools=True)
    else:
        prep = await asyncio.to_thread(agent.prepare_chat, ops, [m.model_dump() for m in body.messages or []], body.document_ids)
        source = agent.chat_session(settings, llm, ops, prep=prep, pending=None, approve=False, use_tools=body.use_tools)
    return sse_response(source)


@router.post("/ask", summary="Ask a question about one or more PDFs; answer cites page numbers")
async def ask(body: s.AskRequest, ops: OpsDep, settings: SettingsDep):
    llm = LLMClient(settings)
    llm.require_key()
    job = await asyncio.to_thread(features.prepare_ask, ops, body.document_ids, body.question,
                                  [m.model_dump() for m in body.history])
    return await _respond(features.ask_events(llm, job), body.stream)


@router.post("/summarize", summary="Summarize a PDF (map-reduce for large documents)")
async def summarize(body: s.SummarizeRequest, ops: OpsDep, settings: SettingsDep):
    llm = LLMClient(settings)
    llm.require_key()
    pages, snippets, labels = await asyncio.to_thread(features.prepare_summarize, ops, body.document_id, body.pages)
    return await _respond(features.summarize_events(llm, pages, snippets, labels, body.length, body.language), body.stream)


@router.post("/explain", summary="Explain a page or a selected passage in plain language")
async def explain(body: s.ExplainRequest, ops: OpsDep, settings: SettingsDep):
    llm = LLMClient(settings)
    llm.require_key()
    messages, rag = await asyncio.to_thread(features.prepare_explain, ops, body.document_id, body.page, body.selection,
                                            body.question, body.language)
    return await _respond(features.explain_events(llm, messages, rag), body.stream)


@router.post("/questions", summary="Generate practice questions (multiple choice, short / long answer, true-false) from a PDF")
async def questions(body: s.QuestionsRequest, ops: OpsDep, settings: SettingsDep):
    llm = LLMClient(settings)
    llm.require_key()
    pages, snippets, labels, stem = await asyncio.to_thread(features.prepare_questions, ops, body.document_id, body.pages)
    return await _respond(features.questions_events(llm, ops, pages, snippets, labels, stem, body.kind, body.count, body.difficulty,
                                                    body.with_answers, body.language, body.create_document), body.stream)


@router.post("/translate", summary="Translate a PDF's text (streamed); optionally returns a .docx/.txt document")
async def translate(body: s.TranslateRequest, ops: OpsDep, settings: SettingsDep):
    llm = LLMClient(settings)
    llm.require_key()
    pages, stem = await asyncio.to_thread(features.prepare_translate, ops, body.document_id, body.pages)
    return await _respond(features.translate_events(llm, ops, pages, body.target_language, stem, body.create_document), body.stream)


@router.post("/compare", summary="Compare two PDFs: real text diff by page (+ optional AI explanation)")
async def compare(body: s.CompareRequest, ops: OpsDep, settings: SettingsDep):
    llm = None
    if body.narrative:
        llm = LLMClient(settings)
        llm.require_key()
    diff = await asyncio.to_thread(features.prepare_compare, ops, body.document_id_a, body.document_id_b)
    return await _respond(features.compare_events(llm, diff), body.stream)


@router.post("/extract-tables", response_model=ToolResult,
             summary="Extract tables to an Excel file (pdfplumber; optional AI cleanup)")
async def extract_tables(body: s.AiTablesRequest, ops: OpsDep, settings: SettingsDep, store: StoreDep):
    llm = None
    if body.clean_with_ai:
        llm = LLMClient(settings)
        llm.require_key()

    def detect() -> list[dict]:
        return ops.extract_tables(body.document_id, body.pages)

    tables = await asyncio.to_thread(detect)
    notice = None
    cleaned = 0
    if llm is not None and tables:
        tables, cleaned = await features.clean_tables_with_ai(llm, tables)
        notice = f"AI repaired {cleaned} of {min(len(tables), 10)} table(s); unrepairable ones were kept as extracted."

    def build():
        with ops.store.tempdir() as td:
            out = td / "tables.xlsx"
            tables_svc.tables_to_xlsx(tables, out)
            src = ops.doc(body.document_id)
            return ops.store.adopt(ops.user_id, out, f"{Path(src.filename).stem}_tables.xlsx", "xlsx")

    doc = await asyncio.to_thread(build)
    return ToolResult(documents=[to_info(doc, store)], notice=notice,
                      details={"tables": len(tables), "ai_cleaned": cleaned,
                               "preview": [{"page": t["page"], "index": t["index"], "rows": t["rows"][:5]} for t in tables[:10]]})
