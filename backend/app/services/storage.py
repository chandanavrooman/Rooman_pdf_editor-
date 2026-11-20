"""User + document storage.

Files live under  <STORAGE_DIR>/files/<user_id>/<doc_uuid>.<ext>  — every path is generated here,
never taken from a client or from an AI model. Metadata lives in SQLite (<STORAGE_DIR>/rooman.db).
"""
from __future__ import annotations

import contextlib
import re
import shutil
import sqlite3
import tempfile
import threading
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

from ..core.errors import AppError, not_found

# kind -> (extension, mime)
KINDS: dict[str, tuple[str, str]] = {
    "pdf": ("pdf", "application/pdf"),
    "docx": ("docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    "xlsx": ("xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    "pptx": ("pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
    "jpg": ("jpg", "image/jpeg"),
    "png": ("png", "image/png"),
    "txt": ("txt", "text/plain; charset=utf-8"),
    "zip": ("zip", "application/zip"),
}

_UUID_RE = re.compile(r"^[0-9a-f]{32}$")


def safe_filename(name: str, default: str = "document", max_len: int = 120) -> str:
    """Make a client-supplied name safe for display / Content-Disposition (never used as a path)."""
    name = (name or "").replace("\\", "/").split("/")[-1]
    name = re.sub(r"[\x00-\x1f\x7f\"<>|:*?]", "", name).strip(" .")
    if len(name) > max_len:
        stem, dot, ext = name.rpartition(".")
        name = (stem[: max_len - len(ext) - 1] + "." + ext) if dot else name[:max_len]
    return name or default


@dataclass(frozen=True)
class Document:
    id: str
    user_id: str
    filename: str
    kind: str
    size: int
    pages: int | None
    created_at: float
    path: Path

    @property
    def mime(self) -> str:
        return KINDS[self.kind][1]


@dataclass(frozen=True)
class User:
    id: str
    email: str
    name: str
    password_hash: str
    created_at: float


_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL, created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, filename TEXT NOT NULL, kind TEXT NOT NULL,
  size INTEGER NOT NULL, pages INTEGER, relpath TEXT NOT NULL, created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_docs_user ON documents(user_id);
CREATE INDEX IF NOT EXISTS idx_docs_created ON documents(created_at);
"""


class DocumentStore:
    def __init__(self, storage_dir: Path, ttl_seconds: int):
        self.root = Path(storage_dir).resolve()
        self.files_dir = self.root / "files"
        self.tmp_dir = self.root / "tmp"
        self.db_path = self.root / "rooman.db"
        self.ttl_seconds = ttl_seconds
        self._lock = threading.Lock()
        for d in (self.files_dir, self.tmp_dir):
            d.mkdir(parents=True, exist_ok=True)
        with self._db() as db:
            db.executescript(_SCHEMA)

    # ---------------- db helpers ----------------
    @contextlib.contextmanager
    def _db(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.db_path, timeout=15)
        conn.row_factory = sqlite3.Row
        try:
            with self._lock:
                yield conn
                conn.commit()
        finally:
            conn.close()

    # ---------------- users ----------------
    def create_user(self, email: str, name: str, password_hash: str) -> User:
        uid = uuid.uuid4().hex
        now = time.time()
        try:
            with self._db() as db:
                db.execute(
                    "INSERT INTO users(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)",
                    (uid, email, name, password_hash, now),
                )
        except sqlite3.IntegrityError:
            raise AppError(409, "EMAIL_EXISTS", "An account with this email already exists") from None
        return User(uid, email, name, password_hash, now)

    @staticmethod
    def _user(row: sqlite3.Row | None) -> User | None:
        return None if row is None else User(**dict(row))

    def get_user_by_email(self, email: str) -> User | None:
        with self._db() as db:
            return self._user(db.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone())

    def get_user(self, user_id: str) -> User | None:
        with self._db() as db:
            return self._user(db.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone())

    # ---------------- documents ----------------
    def _doc(self, row: sqlite3.Row) -> Document:
        return Document(
            id=row["id"],
            user_id=row["user_id"],
            filename=row["filename"],
            kind=row["kind"],
            size=row["size"],
            pages=row["pages"],
            created_at=row["created_at"],
            path=self.root / "files" / row["relpath"],
        )

    def new_path(self, user_id: str, kind: str) -> tuple[str, Path]:
        """Server-generated (doc_id, path). Directory is created, file is not."""
        if kind not in KINDS:
            raise ValueError(f"unknown kind {kind}")
        doc_id = uuid.uuid4().hex
        udir = self.files_dir / user_id
        udir.mkdir(parents=True, exist_ok=True)
        return doc_id, udir / f"{doc_id}.{KINDS[kind][0]}"

    def adopt(self, user_id: str, src: Path, filename: str, kind: str, pages: int | None = None,
              *, move: bool = True) -> Document:
        """Register an existing file (e.g. a service output in a temp dir) as a user document."""
        doc_id, dest = self.new_path(user_id, kind)
        if move:
            shutil.move(str(src), dest)
        else:
            shutil.copyfile(src, dest)
        size = dest.stat().st_size
        now = time.time()
        filename = safe_filename(filename)
        with self._db() as db:
            db.execute(
                "INSERT INTO documents(id,user_id,filename,kind,size,pages,relpath,created_at) VALUES(?,?,?,?,?,?,?,?)",
                (doc_id, user_id, filename, kind, size, pages, f"{user_id}/{dest.name}", now),
            )
        return Document(doc_id, user_id, filename, kind, size, pages, now, dest)

    def add_bytes(self, user_id: str, data: bytes, filename: str, kind: str, pages: int | None = None) -> Document:
        with self.tempdir() as td:
            tmp = td / "upload.bin"
            tmp.write_bytes(data)
            return self.adopt(user_id, tmp, filename, kind, pages)

    def get(self, user_id: str, doc_id: str) -> Document:
        """Fetch a document the user owns. Unknown id and foreign id are indistinguishable (404)."""
        if not isinstance(doc_id, str) or not _UUID_RE.match(doc_id):
            raise not_found()
        with self._db() as db:
            row = db.execute("SELECT * FROM documents WHERE id=? AND user_id=?", (doc_id, user_id)).fetchone()
        if row is None:
            raise not_found()
        doc = self._doc(row)
        if not doc.path.is_file():
            raise not_found("Document expired or no longer available")
        return doc

    def list(self, user_id: str) -> list[Document]:
        with self._db() as db:
            rows = db.execute(
                "SELECT * FROM documents WHERE user_id=? ORDER BY created_at DESC", (user_id,)
            ).fetchall()
        return [self._doc(r) for r in rows]

    def delete(self, user_id: str, doc_id: str) -> None:
        doc = self.get(user_id, doc_id)
        self._remove(doc)

    def _remove(self, doc: Document) -> None:
        with contextlib.suppress(FileNotFoundError):
            doc.path.unlink()
        with self._db() as db:
            db.execute("DELETE FROM documents WHERE id=?", (doc.id,))

    def expires_at(self, doc: Document) -> float:
        return doc.created_at + self.ttl_seconds

    def cleanup_expired(self, now: float | None = None) -> int:
        """Delete documents older than the TTL (+ stale temp dirs). Returns number of documents removed."""
        now = time.time() if now is None else now
        cutoff = now - self.ttl_seconds
        with self._db() as db:
            rows = db.execute("SELECT * FROM documents WHERE created_at < ?", (cutoff,)).fetchall()
        for r in rows:
            self._remove(self._doc(r))
        # stale temp dirs (crashed requests)
        for d in self.tmp_dir.iterdir():
            with contextlib.suppress(OSError):
                if d.stat().st_mtime < now - max(self.ttl_seconds, 3600):
                    shutil.rmtree(d, ignore_errors=True) if d.is_dir() else d.unlink()
        # rows whose file vanished
        with self._db() as db:
            for r in db.execute("SELECT id, relpath FROM documents").fetchall():
                if not (self.root / "files" / r["relpath"]).exists():
                    db.execute("DELETE FROM documents WHERE id=?", (r["id"],))
        return len(rows)

    # ---------------- temp dirs ----------------
    @contextlib.contextmanager
    def tempdir(self) -> Iterator[Path]:
        """Per-operation scratch directory, always removed afterwards."""
        path = Path(tempfile.mkdtemp(dir=self.tmp_dir, prefix="op-"))
        try:
            yield path
        finally:
            shutil.rmtree(path, ignore_errors=True)
