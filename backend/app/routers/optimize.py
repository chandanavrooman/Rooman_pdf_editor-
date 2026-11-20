from fastapi import APIRouter

from ..core.deps import OpsDep, StoreDep
from ..schemas import requests as r
from ..schemas.common import ToolResult, to_result

router = APIRouter(prefix="/api/optimize", tags=["optimize"])


@router.post("/compress", response_model=ToolResult,
             summary="Compress (Ghostscript). details: before_bytes, after_bytes, saved_percent, smaller")
def compress(body: r.CompressRequest, ops: OpsDep, store: StoreDep):
    return to_result(ops.compress(body.document_id, body.level), store)


@router.post("/repair", response_model=ToolResult)
def repair(body: r.DocRef, ops: OpsDep, store: StoreDep):
    return to_result(ops.repair(body.document_id), store)


@router.post("/flatten", response_model=ToolResult, summary="Flatten form fields and annotations")
def flatten(body: r.DocRef, ops: OpsDep, store: StoreDep):
    return to_result(ops.flatten(body.document_id), store)


@router.post("/ocr", response_model=ToolResult, summary="OCR to a searchable PDF (Tesseract)")
def ocr(body: r.OcrRequest, ops: OpsDep, store: StoreDep):
    return to_result(ops.ocr(body.document_id, body.language, body.force), store)


@router.post("/deskew", response_model=ToolResult)
def deskew(body: r.DeskewRequest, ops: OpsDep, store: StoreDep):
    return to_result(ops.deskew(body.document_id, body.language), store)
