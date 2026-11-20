"""Per-document text extraction (page tracked), page-aware chunking and BM25 retrieval.

* Chunks never span pages, so every retrieved passage maps to an exact page for citations.
* The index is cached per (document id, size, mtime) so repeated questions on a big PDF are fast.
* Retrieval returns the best chunks that fit a token budget (≈ chars/4), so large PDFs work.
"""
from __future__ import annotations

import math
import re
import threading
from collections import Counter, OrderedDict, defaultdict
from dataclasses import dataclass
from pathlib import Path

from ..core.errors import AppError
from ..services import pdf_ops
from ..services.storage import Document

TOKEN_RE = re.compile(r"[^\W_]+", re.UNICODE)
STOP = frozenset("a an and are as at be by for from has have in is it its of on or that the this to was were will with".split())
SENT_SPLIT = re.compile(r"(?<=[.!?])\s+|\n")

CHUNK_CHARS = 1200
CHUNK_OVERLAP = 150
MIN_TEXT_CHARS = 20


def est_tokens(s: str) -> int:
    return len(s) // 4 + 1


def tokenize(text: str) -> list[str]:
    return [t for t in TOKEN_RE.findall(text.lower()) if t not in STOP]


def normalize(text: str) -> str:
    text = text.replace("\x00", "")
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r" ?\n ?", "\n", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def extract_pages_text(path: Path, password: str = "") -> list[str]:
    """Text of every page of the ORIGINAL file (index 0 = page 1)."""
    doc = pdf_ops.open_fitz(path, password)
    try:
        return [normalize(p.get_text("text")) for p in doc]
    finally:
        doc.close()


def chunk_page(text: str, max_chars: int = CHUNK_CHARS, overlap: int = CHUNK_OVERLAP) -> list[str]:
    if len(text) <= max_chars:
        return [text] if text.strip() else []
    units: list[str] = []
    for u in SENT_SPLIT.split(text):
        u = u.strip()
        while len(u) > max_chars:  # one gigantic "sentence": hard split
            units.append(u[:max_chars])
            u = u[max_chars:]
        if u:
            units.append(u)
    chunks: list[str] = []
    cur: list[str] = []
    size = 0
    for u in units:
        if size + len(u) + 1 > max_chars and cur:
            chunks.append(" ".join(cur))
            keep: list[str] = []
            kept = 0
            for prev in reversed(cur):  # overlap: carry the tail into the next chunk
                if kept + len(prev) > overlap:
                    break
                keep.insert(0, prev)
                kept += len(prev) + 1
            cur, size = keep, kept
        cur.append(u)
        size += len(u) + 1
    if cur:
        chunks.append(" ".join(cur))
    return chunks


@dataclass(frozen=True)
class Chunk:
    doc_id: str
    page: int  # 1-based
    index: int  # position within the document
    text: str


class DocIndex:
    K1 = 1.5
    B = 0.75

    def __init__(self, doc_id: str, pages: list[str]):
        self.doc_id = doc_id
        self.pages = pages
        self.chunks: list[Chunk] = []
        for pno, text in enumerate(pages, 1):
            for c in chunk_page(text):
                self.chunks.append(Chunk(doc_id, pno, len(self.chunks), c))
        self.lengths: list[int] = []
        self.postings: dict[str, list[tuple[int, int]]] = defaultdict(list)
        for ch in self.chunks:
            toks = tokenize(ch.text)
            self.lengths.append(len(toks))
            for term, tf in Counter(toks).items():
                self.postings[term].append((ch.index, tf))
        n = len(self.chunks)
        self.avgdl = (sum(self.lengths) / n) if n else 0.0
        self.total_chars = sum(len(c.text) for c in self.chunks)

    @property
    def n_pages(self) -> int:
        return len(self.pages)

    def search(self, query: str, k: int = 10) -> list[tuple[Chunk, float]]:
        n = len(self.chunks)
        if not n:
            return []
        scores: dict[int, float] = defaultdict(float)
        for term in set(tokenize(query)):
            post = self.postings.get(term)
            if not post:
                continue
            idf = math.log(1 + (n - len(post) + 0.5) / (len(post) + 0.5))
            for ci, tf in post:
                dl = self.lengths[ci] or 1
                norm = tf * (self.K1 + 1) / (tf + self.K1 * (1 - self.B + self.B * dl / (self.avgdl or 1)))
                scores[ci] += idf * norm
        best = sorted(scores.items(), key=lambda kv: (-kv[1], kv[0]))[:k]
        return [(self.chunks[ci], sc) for ci, sc in best]


# ---------------------------------------------------------------- cache
_CACHE: "OrderedDict[tuple, DocIndex]" = OrderedDict()
_LOCK = threading.Lock()
CACHE_SIZE = 32


def get_index(doc: Document) -> DocIndex:
    """Cached index for a stored document; raises NO_TEXT_LAYER for scanned/empty PDFs."""
    st = doc.path.stat()
    key = (doc.id, st.st_size, st.st_mtime_ns)
    with _LOCK:
        hit = _CACHE.get(key)
        if hit is not None:
            _CACHE.move_to_end(key)
            return hit
    idx = DocIndex(doc.id, extract_pages_text(doc.path))
    if sum(len(p) for p in idx.pages) < MIN_TEXT_CHARS:
        raise AppError(422, "NO_TEXT_LAYER",
                       "This PDF has no selectable text (it looks scanned). Run the OCR tool first, then try again.")
    with _LOCK:
        _CACHE[key] = idx
        while len(_CACHE) > CACHE_SIZE:
            _CACHE.popitem(last=False)
    return idx


def clear_cache() -> None:
    with _LOCK:
        _CACHE.clear()


# ---------------------------------------------------------------- retrieval across documents
@dataclass(frozen=True)
class Retrieved:
    label: str  # "D1", "D2", ...
    chunk: Chunk
    score: float


def retrieve(indexes: dict[str, DocIndex], query: str, token_budget: int = 6000, k_per_doc: int = 12) -> list[Retrieved]:
    """Best chunks that fit `token_budget`. If everything fits, everything is returned (in reading order)."""
    all_chunks = [Retrieved(lbl, c, 0.0) for lbl, ix in indexes.items() for c in ix.chunks]
    if sum(est_tokens(r.chunk.text) for r in all_chunks) <= token_budget:
        return all_chunks
    scored: list[Retrieved] = []
    for lbl, ix in indexes.items():
        scored += [Retrieved(lbl, c, s) for c, s in ix.search(query, k_per_doc)]
    scored.sort(key=lambda r: -r.score)
    picked: list[Retrieved] = []
    used = 0
    for r in scored:
        t = est_tokens(r.chunk.text)
        if used + t > token_budget:
            continue
        picked.append(r)
        used += t
    if not picked:  # no term overlap: fall back to the beginning of each document
        per = max(token_budget // max(len(indexes), 1), 200)
        for lbl, ix in indexes.items():
            used = 0
            for c in ix.chunks:
                t = est_tokens(c.text)
                if used + t > per:
                    break
                picked.append(Retrieved(lbl, c, 0.0))
                used += t
    order = {lbl: i for i, lbl in enumerate(indexes)}
    picked.sort(key=lambda r: (order[r.label], r.chunk.index))
    return picked


def _esc(text: str) -> str:
    return text.replace("</", "<\\/")


def format_excerpts(items: list[Retrieved], names: dict[str, str]) -> str:
    """Untrusted document text, wrapped in tags the system prompt tells the model never to obey."""
    lines = ["<document_excerpts>"]
    for r in items:
        name = _esc(names.get(r.label, r.label)).replace('"', "'")
        lines.append(f'<excerpt doc="{r.label}" file="{name}" page="{r.chunk.page}">\n{_esc(r.chunk.text)}\n</excerpt>')
    lines.append("</document_excerpts>")
    return "\n".join(lines)


def page_snippets(items: list[Retrieved]) -> dict[str, dict[int, str]]:
    """label -> {page -> first ~220 chars of the best excerpt on that page} (used to verify + show citations)."""
    out: dict[str, dict[int, str]] = defaultdict(dict)
    for r in sorted(items, key=lambda r: -r.score):
        out[r.label].setdefault(r.chunk.page, " ".join(r.chunk.text.split())[:220])
    return {k: dict(v) for k, v in out.items()}
