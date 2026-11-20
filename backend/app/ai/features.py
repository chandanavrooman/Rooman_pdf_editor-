"""AI features: ask / chat context, summarize, explain, translate, compare, tables.

Each feature has a synchronous `prepare_*` step (ownership checks, extraction, retrieval — these raise AppError so the
router can answer with a proper HTTP status BEFORE any stream starts) and an async generator of Events.
"""
from __future__ import annotations

import asyncio
import difflib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import AsyncIterator, Callable

from ..core.errors import AppError, unprocessable
from ..schemas.common import to_info
from ..services import pdf_ops, tables as tables_svc
from ..services.operations import Ops
from . import prompts, textindex as tx
from .llm import LLMClient
from .streaming import Event, ev

RETRIEVAL_TOKEN_BUDGET = 6000
SINGLE_PASS_CHARS = 40_000
SEGMENT_CHARS = 24_000
MAX_SEGMENTS = 60
MAP_CONCURRENCY = 3
TRANSLATE_CHUNK_CHARS = 5_000
MAX_TRANSLATE_PAGES = 100

CITE_RE = re.compile(r"\[\s*(?:(D\d+|[AB])\s*)?(?:pp?\.?|pages?)\s*([0-9][0-9,\s\-–]*(?:\s*(?:and|&)\s*[0-9][0-9,\s\-–]*)*)\]", re.I)


# ---------------------------------------------------------------- citations
def _pages_from(spec: str) -> list[int]:
    out: list[int] = []
    for part in re.split(r"[,&]|\band\b", spec):
        part = part.strip()
        m = re.fullmatch(r"(\d+)\s*[-–]\s*(\d+)", part)
        if m:
            a, b = int(m.group(1)), int(m.group(2))
            if 0 < a <= b and b - a < 50:
                out += list(range(a, b + 1))
        elif part.isdigit():
            out.append(int(part))
    return out


def extract_citations(text: str, snippets: dict[str, dict[int, str]], labels: dict[str, str],
                      single_label: str | None = None) -> list[dict]:
    """Structured citations for the `[p. N]` markers in `text`. Only pages that really were in the context are kept
    (the model cannot cite what it was not shown). labels: label -> document id."""
    seen: set[tuple[str, int]] = set()
    out: list[dict] = []
    for m in CITE_RE.finditer(text):
        label = (m.group(1) or single_label or (next(iter(labels)) if len(labels) == 1 else "")).upper()
        for page in _pages_from(m.group(2)):
            snip = snippets.get(label, {}).get(page)
            if snip is None or (label, page) in seen:
                continue
            seen.add((label, page))
            out.append({"document_id": labels.get(label), "label": label, "page": page, "snippet": snip})
    return out


# ---------------------------------------------------------------- RAG context (chat / ask / explain)
@dataclass
class RagContext:
    labels: dict[str, str]  # D1 -> doc id
    names: dict[str, str]  # D1 -> filename
    snippets: dict[str, dict[int, str]]
    block: str  # <document_excerpts> ... </document_excerpts>
    doc_lines: list[str]
    pages_total: dict[str, int]


def prepare_rag(ops: Ops, doc_ids: list[str], query: str, budget: int = RETRIEVAL_TOKEN_BUDGET) -> RagContext:
    """Ownership-checked retrieval over the attached documents (runs in a worker thread)."""
    labels: dict[str, str] = {}
    names: dict[str, str] = {}
    indexes: dict[str, tx.DocIndex] = {}
    lines: list[str] = []
    for n, did in enumerate(dict.fromkeys(doc_ids), 1):
        d = ops.doc(did)  # 404 for foreign/unknown ids, 415 for non-PDF
        label = f"D{n}"
        labels[label], names[label] = d.id, d.filename
        lines.append(f'{label}: id={d.id} file="{d.filename.replace(chr(34), chr(39))}" kind={d.kind} pages={d.pages} size={d.size}')
        try:
            indexes[label] = tx.get_index(d)
        except AppError as e:
            if e.code != "NO_TEXT_LAYER" and e.code != "PASSWORD_REQUIRED":
                raise
            lines[-1] += f" note={'scanned-no-text-layer' if e.code == 'NO_TEXT_LAYER' else 'password-protected'}"
    items = tx.retrieve(indexes, query, budget) if indexes else []
    return RagContext(labels, names, tx.page_snippets(items), tx.format_excerpts(items, names) if items else "",
                      lines, {lbl: ix.n_pages for lbl, ix in indexes.items()})


def require_text(ops: Ops, doc_ids: list[str]) -> None:
    """Fail fast (HTTP 422) when none of the documents has a text layer."""
    for did in doc_ids:
        tx.get_index(ops.doc(did))


# ---------------------------------------------------------------- generic streaming helper
async def stream_text(llm: LLMClient, messages: list[dict], buf: list[str], **kw) -> AsyncIterator[Event]:
    from .llm import TextDelta

    async for item in llm.stream(messages, **kw):
        if isinstance(item, TextDelta):
            buf.append(item.text)
            yield ev("token", text=item.text)


# ---------------------------------------------------------------- ask
@dataclass
class AskJob:
    rag: RagContext
    messages: list[dict]


def prepare_ask(ops: Ops, doc_ids: list[str], question: str, history: list[dict]) -> AskJob:
    require_text(ops, doc_ids)
    recent_user = [m["content"] for m in history if m["role"] == "user"][-1:]
    rag = prepare_rag(ops, doc_ids, " ".join(recent_user + [question]))
    system = prompts.chat_system(rag.doc_lines, tools=False)
    msgs = [{"role": "system", "content": system}, *history,
            {"role": "user", "content": f"{question}\n\n{rag.block}"}]
    return AskJob(rag, msgs)


async def ask_events(llm: LLMClient, job: AskJob) -> AsyncIterator[Event]:
    yield ev("meta", documents=[{"id": i, "label": l, "filename": job.rag.names[l]} for l, i in job.rag.labels.items()],
             model=llm.s.ai_model)
    buf: list[str] = []
    async for e in stream_text(llm, job.messages, buf):
        yield e
    cites = extract_citations("".join(buf), job.rag.snippets, job.rag.labels)
    for c in cites:
        yield ev("citation", **c)
    yield ev("done", status="complete", citations=cites)


# ---------------------------------------------------------------- explain
def prepare_explain(ops: Ops, doc_id: str, page: int | None, selection: str | None, question: str | None,
                    language: str | None) -> tuple[list[dict], RagContext]:
    d = ops.doc(doc_id)
    idx = tx.get_index(d)
    if page is not None and not (1 <= page <= idx.n_pages):
        raise unprocessable("PAGE_OUT_OF_RANGE", f"This document has {idx.n_pages} pages")
    rag_query = (selection or question or (idx.pages[page - 1][:300] if page else "")) or "overview"
    rag = prepare_rag(ops, [doc_id], rag_query, budget=3000)
    parts = []
    if selection:
        page_attr = f' page="{page}"' if page else ""
        parts.append(f'<document_text kind="selection"{page_attr}>\n{tx._esc(selection)}\n</document_text>')
    elif page:
        parts.append(f'<document_text kind="page" page="{page}">\n{tx._esc(idx.pages[page - 1][:12000])}\n</document_text>')
        rag.snippets.setdefault("D1", {})[page] = " ".join(idx.pages[page - 1].split())[:220]
    if selection and page:
        rag.snippets.setdefault("D1", {})[page] = " ".join(selection.split())[:220]
    ask = question or "Explain this in plain language."
    user = f"{ask}\n\n" + "\n".join(parts) + ("\n\nSurrounding context:\n" + rag.block if rag.block else "")
    return [{"role": "system", "content": prompts.explain_system(language)}, {"role": "user", "content": user}], rag


async def explain_events(llm: LLMClient, messages: list[dict], rag: RagContext) -> AsyncIterator[Event]:
    yield ev("meta", model=llm.s.ai_model)
    buf: list[str] = []
    async for e in stream_text(llm, messages, buf):
        yield e
    cites = extract_citations("".join(buf), rag.snippets, rag.labels)
    for c in cites:
        yield ev("citation", **c)
    yield ev("done", status="complete", citations=cites)


# ---------------------------------------------------------------- summarize (map-reduce over page chunks)
def pack_segments(pages: list[tuple[int, str]], limit: int = SEGMENT_CHARS) -> list[list[tuple[int, str]]]:
    segs: list[list[tuple[int, str]]] = []
    cur: list[tuple[int, str]] = []
    size = 0
    for pno, text in pages:
        pieces = [text[i:i + limit] for i in range(0, len(text), limit)] or [""]
        for piece in pieces:
            if cur and size + len(piece) > limit:
                segs.append(cur)
                cur, size = [], 0
            cur.append((pno, piece))
            size += len(piece)
    if cur:
        segs.append(cur)
    return segs


def _paged(seg: list[tuple[int, str]]) -> str:
    return "\n\n".join(f"=== page {p} ===\n{tx._esc(t)}" for p, t in seg)


def prepare_summarize(ops: Ops, doc_id: str, pages_spec: str | None) -> tuple[list[tuple[int, str]], dict[str, dict[int, str]], dict[str, str]]:
    d = ops.doc(doc_id)
    idx = tx.get_index(d)
    nums = pdf_ops.parse_page_spec(pages_spec, idx.n_pages) if pages_spec else range(idx.n_pages)
    pages = [(i + 1, idx.pages[i]) for i in nums if idx.pages[i].strip()]
    if not pages:
        raise unprocessable("NO_TEXT_LAYER", "The selected pages have no text.")
    snippets = {"D1": {p: " ".join(t.split())[:220] for p, t in pages}}
    return pages, snippets, {"D1": d.id}


async def summarize_events(llm: LLMClient, pages: list[tuple[int, str]], snippets: dict, labels: dict,
                           length: str, language: str | None) -> AsyncIterator[Event]:
    total = sum(len(t) for _, t in pages)
    yield ev("meta", model=llm.s.ai_model, pages=len(pages), characters=total, strategy="single" if total <= SINGLE_PASS_CHARS else "map-reduce")
    buf: list[str] = []
    system = prompts.summarize_system(length, language)
    if total <= SINGLE_PASS_CHARS:
        msgs = [{"role": "system", "content": system},
                {"role": "user", "content": f"<document_text>\n{_paged(pages)}\n</document_text>\n\nSummarize this document."}]
        async for e in stream_text(llm, msgs, buf):
            yield e
    else:
        segs = pack_segments(pages)
        if len(segs) > MAX_SEGMENTS:
            yield ev("notice", message=f"Very large document: only the first {MAX_SEGMENTS} sections were summarised.")
            segs = segs[:MAX_SEGMENTS]
        sem = asyncio.Semaphore(MAP_CONCURRENCY)

        async def map_one(i: int, seg: list[tuple[int, str]]) -> tuple[int, str]:
            async with sem:
                out = await llm.complete([{"role": "system", "content": prompts.MAP_SYSTEM},
                                          {"role": "user", "content": f"<document_text>\n{_paged(seg)}\n</document_text>"}],
                                         max_tokens=700)
                return i, f"Pages {seg[0][0]}-{seg[-1][0]}:\n{out}"

        tasks = [asyncio.create_task(map_one(i, s)) for i, s in enumerate(segs)]
        results: dict[int, str] = {}
        yield ev("progress", stage="map", done=0, total=len(tasks))
        try:
            for fut in asyncio.as_completed(tasks):
                i, text = await fut
                results[i] = text
                yield ev("progress", stage="map", done=len(results), total=len(tasks))
        finally:
            for t in tasks:
                t.cancel()
        parts = [results[i] for i in sorted(results)]
        while sum(len(p) for p in parts) > SINGLE_PASS_CHARS:  # hierarchical reduce for enormous documents
            groups = [parts[i:i + 8] for i in range(0, len(parts), 8)]
            parts = [await llm.complete([{"role": "system", "content": prompts.REDUCE_SYSTEM},
                                         {"role": "user", "content": "<document_text>\n" + "\n\n".join(g) + "\n</document_text>"}],
                                        max_tokens=900) for g in groups]
        msgs = [{"role": "system", "content": system + " " + prompts.REDUCE_SYSTEM.split(". ", 1)[1]},
                {"role": "user", "content": "<document_text>\n" + "\n\n".join(parts) + "\n</document_text>\n\nWrite the final summary."}]
        async for e in stream_text(llm, msgs, buf):
            yield e
    cites = extract_citations("".join(buf), snippets, labels)
    for c in cites:
        yield ev("citation", **c)
    yield ev("done", status="complete", citations=cites)


# ---------------------------------------------------------------- generate questions
QUESTIONS_CHARS = 36_000  # how much document text one question-writing request may carry


def prepare_questions(ops: Ops, doc_id: str, pages_spec: str | None) -> tuple[list[tuple[int, str]], dict[str, dict[int, str]], dict[str, str], str]:
    """The text the questions are written from. A long document is sampled evenly so the questions spread over all of it."""
    pages, snippets, labels = prepare_summarize(ops, doc_id, pages_spec)
    total = sum(len(t) for _, t in pages)
    if total > QUESTIONS_CHARS:
        keep, used = [], 0
        per = max(400, QUESTIONS_CHARS // len(pages))
        for pno, text in pages:
            piece = text[:per]
            keep.append((pno, piece))
            used += len(piece)
        pages = keep
    return pages, snippets, labels, Path(ops.doc(doc_id).filename).stem


def build_questions_docx(text: str, out: Path) -> None:
    from docx import Document as Docx

    doc = Docx()
    for block in re.split(r"\n{2,}", text.strip()):
        if block.strip():
            doc.add_paragraph(block.strip())
    doc.save(out)


async def questions_events(llm: LLMClient, ops: Ops, pages: list[tuple[int, str]], snippets: dict, labels: dict, stem: str,
                           kind: str, count: int, difficulty: str, with_answers: bool, language: str | None, create: str) -> AsyncIterator[Event]:
    yield ev("meta", model=llm.s.ai_model, pages=len(pages), kind=kind, count=count, difficulty=difficulty)
    buf: list[str] = []
    msgs = [{"role": "system", "content": prompts.questions_system(kind, count, difficulty, with_answers, language)},
            {"role": "user", "content": f"<document_text>\n{_paged(pages)}\n</document_text>\n\nWrite the questions."}]
    async for e in stream_text(llm, msgs, buf, max_tokens=max(1500, min(8000, count * 220))):
        yield e
    text = "".join(buf)
    cites = extract_citations(text, snippets, labels)
    for c in cites:
        yield ev("citation", **c)
    docs = []
    if create != "none" and text.strip():
        def make() -> dict:
            with ops.store.tempdir() as td:
                suffix = "questions" if with_answers else "practice_questions"
                if create == "docx":
                    out = td / "q.docx"
                    build_questions_docx(text, out)
                    d = ops.store.adopt(ops.user_id, out, f"{stem}_{suffix}.docx", "docx")
                else:
                    out = td / "q.txt"
                    out.write_text(text, encoding="utf-8")
                    d = ops.store.adopt(ops.user_id, out, f"{stem}_{suffix}.txt", "txt")
                return to_info(d, ops.store).model_dump(mode="json")
        docs.append(await asyncio.to_thread(make))
    yield ev("done", status="complete", documents=docs, citations=cites)


# ---------------------------------------------------------------- translate
def split_for_translation(text: str, limit: int = TRANSLATE_CHUNK_CHARS) -> list[str]:
    if len(text) <= limit:
        return [text]
    out: list[str] = []
    cur = ""
    for para in re.split(r"(?<=\n)", text):
        while len(para) > limit:
            if cur:
                out.append(cur)
                cur = ""
            out.append(para[:limit])
            para = para[limit:]
        if len(cur) + len(para) > limit and cur:
            out.append(cur)
            cur = ""
        cur += para
    if cur:
        out.append(cur)
    return out


def prepare_translate(ops: Ops, doc_id: str, pages_spec: str | None) -> tuple[list[tuple[int, str]], str]:
    d = ops.doc(doc_id)
    idx = tx.get_index(d)
    nums = list(pdf_ops.parse_page_spec(pages_spec, idx.n_pages)) if pages_spec else list(range(idx.n_pages))
    if len(nums) > MAX_TRANSLATE_PAGES:
        raise unprocessable("TOO_MANY_PAGES", f"Translate at most {MAX_TRANSLATE_PAGES} pages per request (choose a page range).")
    pages = [(i + 1, idx.pages[i]) for i in nums if idx.pages[i].strip()]
    if not pages:
        raise unprocessable("NO_TEXT_LAYER", "The selected pages have no text.")
    return pages, Path(d.filename).stem


def build_translation_docx(pages: list[tuple[int, str]], out: Path) -> None:
    from docx import Document as Docx

    doc = Docx()
    first = True
    for _, text in pages:
        if not first:
            doc.add_page_break()
        first = False
        for para in re.split(r"\n{2,}", text.strip()):
            if para.strip():
                doc.add_paragraph(para.strip())
    doc.save(out)


async def translate_events(llm: LLMClient, ops: Ops, pages: list[tuple[int, str]], target: str, stem: str,
                           create: str) -> AsyncIterator[Event]:
    yield ev("meta", model=llm.s.ai_model, pages=len(pages), target_language=target)
    translated: list[tuple[int, str]] = []
    system = prompts.translate_system(target)
    for n, (pno, text) in enumerate(pages, 1):
        yield ev("page", page=pno, index=n, total=len(pages))
        out_parts: list[str] = []
        for chunk in split_for_translation(text):
            async for e in stream_text(llm, [{"role": "system", "content": system},
                                             {"role": "user", "content": f"<document_text>\n{tx._esc(chunk)}\n</document_text>"}],
                                       out_parts, max_tokens=max(1024, len(chunk) // 2)):
                yield e
            out_parts.append("\n")
        yield ev("token", text="\n\n")
        translated.append((pno, "".join(out_parts).strip()))
    docs = []
    if create != "none":
        def make() -> dict:
            with ops.store.tempdir() as td:
                lang = re.sub(r"[^A-Za-z]+", "_", target).strip("_")[:20] or "translated"
                if create == "docx":
                    out = td / "t.docx"
                    build_translation_docx(translated, out)
                    d = ops.store.adopt(ops.user_id, out, f"{stem}_{lang}.docx", "docx")
                else:
                    out = td / "t.txt"
                    out.write_text("\n\n".join(t for _, t in translated), encoding="utf-8")
                    d = ops.store.adopt(ops.user_id, out, f"{stem}_{lang}.txt", "txt")
                return to_info(d, ops.store).model_dump(mode="json")
        docs.append(await asyncio.to_thread(make))
    yield ev("done", status="complete", documents=docs, citations=[])


# ---------------------------------------------------------------- compare
MAX_DIFF_LINES = 20_000
MAX_CHANGES = 200


def _lines(pages: list[str]) -> list[tuple[int, str]]:
    out: list[tuple[int, str]] = []
    for pno, text in enumerate(pages, 1):
        for ln in text.splitlines():
            n = " ".join(ln.split())
            if n:
                out.append((pno, n))
    return out


def compute_diff(pages_a: list[str], pages_b: list[str]) -> dict:
    """Real line-level diff of the two documents' text, each change attributed to its pages."""
    la, lb = _lines(pages_a), _lines(pages_b)
    if len(la) > MAX_DIFF_LINES or len(lb) > MAX_DIFF_LINES:  # huge: align by page instead
        la = [(p, " ".join(t.split())) for p, t in enumerate(pages_a, 1)]
        lb = [(p, " ".join(t.split())) for p, t in enumerate(pages_b, 1)]
        mode = "page"
    else:
        mode = "line"
    sm = difflib.SequenceMatcher(a=[t for _, t in la], b=[t for _, t in lb], autojunk=False)
    changes: list[dict] = []
    added = removed = changed = 0
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            continue
        a_txt = "\n".join(t for _, t in la[i1:i2])
        b_txt = "\n".join(t for _, t in lb[j1:j2])
        kind = {"replace": "changed", "delete": "removed", "insert": "added"}[tag]
        if kind == "added":
            added += j2 - j1
        elif kind == "removed":
            removed += i2 - i1
        else:
            changed += 1
        if len(changes) < MAX_CHANGES:
            changes.append({
                "type": kind,
                "a_pages": sorted({p for p, _ in la[i1:i2]}), "b_pages": sorted({p for p, _ in lb[j1:j2]}),
                "a_text": a_txt[:600], "b_text": b_txt[:600],
            })
    n_changes = sum(1 for o in sm.get_opcodes() if o[0] != "equal")
    return {
        "identical": n_changes == 0, "mode": mode, "pages_a": len(pages_a), "pages_b": len(pages_b),
        "similarity": round(sm.ratio(), 4),
        "summary": {"added_lines": added, "removed_lines": removed, "changed_blocks": changed, "total_changes": n_changes},
        "changes": changes, "truncated": n_changes > len(changes),
    }


def prepare_compare(ops: Ops, a: str, b: str) -> dict:
    da, db = ops.doc(a), ops.doc(b)
    pa, pb = tx.extract_pages_text(da.path), tx.extract_pages_text(db.path)
    diff = compute_diff(pa, pb)
    diff["document_a"] = {"id": da.id, "filename": da.filename}
    diff["document_b"] = {"id": db.id, "filename": db.filename}
    return diff


async def compare_events(llm: LLMClient | None, diff: dict) -> AsyncIterator[Event]:
    yield ev("diff", **diff)
    cites: list[dict] = []
    if llm is not None and not diff["identical"]:
        brief = json.dumps({k: diff[k] for k in ("pages_a", "pages_b", "summary")} |
                           {"changes": [{**c, "a_text": c["a_text"][:300], "b_text": c["b_text"][:300]} for c in diff["changes"][:60]]},
                           ensure_ascii=False)
        buf: list[str] = []
        msgs = [{"role": "system", "content": prompts.COMPARE_SYSTEM},
                {"role": "user", "content": f"<document_text kind=\"diff\">\n{tx._esc(brief)}\n</document_text>\n\nExplain the differences."}]
        async for e in stream_text(llm, msgs, buf):
            yield e
    yield ev("done", status="complete", citations=cites, identical=diff["identical"])


# ---------------------------------------------------------------- tables (non-LLM path + optional AI cleanup)
def _valid_rows(obj) -> list[list[str]] | None:
    if not isinstance(obj, list) or not obj or len(obj) > 500:
        return None
    rows = []
    for r in obj:
        if not isinstance(r, list) or len(r) > 60 or not all(isinstance(c, (str, int, float)) for c in r):
            return None
        rows.append([str(c) for c in r])
    return rows


async def clean_tables_with_ai(llm: LLMClient, tables: list[dict]) -> tuple[list[dict], int]:
    """Ask the model to repair each table; accept the answer only if it is valid JSON rows and keeps the same data
    (every original non-empty cell text must still appear). Returns (tables, number_cleaned)."""
    cleaned = 0
    out: list[dict] = []
    for t in tables[:10]:
        try:
            raw = await llm.complete([{"role": "system", "content": prompts.CLEAN_TABLE_SYSTEM},
                                      {"role": "user", "content": f"<document_text>\n{tx._esc(json.dumps(t['rows'], ensure_ascii=False)[:12000])}\n</document_text>"}],
                                     temperature=0, max_tokens=4000)
            raw = re.sub(r"^```(?:json)?|```$", "", raw.strip(), flags=re.M).strip()
            rows = _valid_rows(json.loads(raw))
        except AppError as e:
            if e.code in {"AI_KEY_INVALID", "AI_KEY_MISSING"}:
                raise
            rows = None
        except ValueError:
            rows = None
        flat_new = " ".join(" ".join(r) for r in rows).lower() if rows else ""
        keeps = rows is not None and all(c.lower() in flat_new for r in t["rows"] for c in r if len(c) > 2)
        if rows and keeps:
            out.append({**t, "rows": rows})
            cleaned += 1
        else:
            out.append(t)
    out += tables[10:]
    return out, cleaned
