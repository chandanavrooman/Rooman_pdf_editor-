from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field

from ..services.storage import Document, DocumentStore


class DocumentInfo(BaseModel):
    id: str
    filename: str
    kind: str = Field(description="pdf | docx | xlsx | pptx | jpg | png | txt | zip")
    mime: str
    size: int = Field(description="bytes")
    pages: int | None = None
    download_url: str
    created_at: datetime
    expires_at: datetime


class ToolResult(BaseModel):
    documents: list[DocumentInfo]
    notice: str | None = Field(None, description="Message the UI should show to the user (e.g. OCR fallback)")
    details: dict[str, Any] = {}


class ErrorBody(BaseModel):
    detail: str
    code: str


def to_info(doc: Document, store: DocumentStore) -> DocumentInfo:
    return DocumentInfo(
        id=doc.id, filename=doc.filename, kind=doc.kind, mime=doc.mime.split(";")[0], size=doc.size, pages=doc.pages,
        download_url=f"/api/documents/{doc.id}/download",
        created_at=datetime.fromtimestamp(doc.created_at, timezone.utc),
        expires_at=datetime.fromtimestamp(store.expires_at(doc), timezone.utc),
    )


def to_result(res, store: DocumentStore) -> ToolResult:
    return ToolResult(documents=[to_info(d, store) for d in res.documents], notice=res.notice, details=res.details)
