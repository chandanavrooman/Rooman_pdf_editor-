"""Request bodies for every tool endpoint (strict: unknown fields rejected)."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

DocId = str  # 32 hex chars; validated by the store (unknown / foreign -> 404)
PageSpec = Field(None, max_length=500, pattern=r"^[0-9,\-\s]+$", description="e.g. 1-3,5,8-10")


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class DocRef(Strict):
    document_id: DocId = Field(min_length=32, max_length=32)


class MergeRequest(Strict):
    document_ids: list[DocId] = Field(min_length=2, max_length=50)
    filename: str | None = Field(None, max_length=120)


class SplitRequest(DocRef):
    mode: Literal["ranges", "every_n", "by_size", "bookmarks"]
    ranges: str | None = Field(None, max_length=500, pattern=r"^[0-9,\-\s]+$")
    every_n: int | None = Field(None, ge=1, le=10000)
    max_size_mb: float | None = Field(None, gt=0, le=1000)
    zip: bool = False


class PagesRequest(DocRef):
    pages: str = Field(max_length=500, pattern=r"^[0-9,\-\s]+$", description="e.g. 1-3,5")


class ReorderRequest(DocRef):
    order: list[int] = Field(min_length=1, max_length=5000, description="new order of 1-based page numbers")


class RotateRequest(DocRef):
    angle: Literal[90, 180, 270]
    pages: str | None = PageSpec


class CropRequest(DocRef):
    top: float = Field(0, ge=0, le=2000)
    right: float = Field(0, ge=0, le=2000)
    bottom: float = Field(0, ge=0, le=2000)
    left: float = Field(0, ge=0, le=2000)
    pages: str | None = PageSpec


class CompressRequest(DocRef):
    level: Literal["low", "medium", "high"] = "medium"


class OcrRequest(DocRef):
    language: str = Field("eng", max_length=40, pattern=r"^[A-Za-z_+]+$")
    force: bool = False


class DeskewRequest(DocRef):
    language: str = Field("eng", max_length=40, pattern=r"^[A-Za-z_+]+$")


class ProtectRequest(DocRef):
    user_password: str = Field(min_length=1, max_length=127)
    owner_password: str | None = Field(None, min_length=1, max_length=127)
    allow_print: bool = True
    allow_copy: bool = True
    allow_modify: bool = False


class UnlockRequest(DocRef):
    password: str = Field("", max_length=127)


class WatermarkRequest(DocRef):
    text: str | None = Field(None, min_length=1, max_length=200)
    image_document_id: str | None = Field(None, min_length=32, max_length=32)
    opacity: float = Field(0.3, ge=0.02, le=1)
    rotation: float = Field(45, ge=-180, le=180)
    font_size: float = Field(60, ge=6, le=300)
    color: str = Field("#888888", pattern=r"^#[0-9a-fA-F]{6}$")
    pages: str | None = PageSpec
    layout: Literal["center", "tile"] = "center"
    image_scale: float = Field(0.5, gt=0.05, le=1)

    @field_validator("image_document_id")
    @classmethod
    def _one(cls, v, info):
        if v and info.data.get("text"):
            raise ValueError("give either text or image_document_id, not both")
        return v


class RedactArea(Strict):
    page: int = Field(ge=1)
    x0: float
    y0: float
    x1: float
    y1: float


class RedactRequest(DocRef):
    terms: list[str] = Field(default_factory=list, max_length=100)
    patterns: list[str] = Field(default_factory=list, max_length=20, description="regular expressions")
    areas: list[RedactArea] = Field(default_factory=list, max_length=500)
    case_sensitive: bool = False
    scrub_metadata: bool = True

    @field_validator("terms", "patterns")
    @classmethod
    def _len(cls, v):
        if any(not s or len(s) > 200 for s in v):
            raise ValueError("each entry must be 1-200 characters")
        return v


class MetadataUpdate(DocRef):
    title: str | None = Field(None, max_length=1000)
    author: str | None = Field(None, max_length=1000)
    subject: str | None = Field(None, max_length=1000)
    keywords: str | None = Field(None, max_length=1000)
    creator: str | None = Field(None, max_length=1000)
    producer: str | None = Field(None, max_length=1000)
    clear_all: bool = False


class PdfToExcelRequest(DocRef):
    pages: str | None = PageSpec


class PdfToPptRequest(DocRef):
    mode: Literal["image", "editable"] = "image"


class PdfToImagesRequest(DocRef):
    format: Literal["png", "jpg"] = "png"
    dpi: int = Field(150, ge=36, le=400)
    pages: str | None = PageSpec


class PdfToTextRequest(DocRef):
    pages: str | None = PageSpec


class ImagesToPdfRequest(Strict):
    document_ids: list[DocId] = Field(min_length=1, max_length=100)
    page_size: Literal["fit", "a4", "letter"] = "fit"
    margin_mm: float = Field(0, ge=0, le=50)
    orientation: Literal["auto", "portrait", "landscape"] = "auto"


class TextToPdfRequest(Strict):
    document_id: str | None = Field(None, min_length=32, max_length=32)
    text: str | None = Field(None, min_length=1, max_length=2_000_000)
    font_size: float = Field(11, ge=6, le=36)
    page_size: Literal["a4", "letter"] = "a4"


class HtmlToPdfRequest(Strict):
    html: str = Field(min_length=1, max_length=3_000_000)
    page_size: Literal["a4", "letter"] = "a4"
    orientation: Literal["portrait", "landscape"] = "portrait"


class TablesRequest(DocRef):
    pages: str | None = PageSpec
