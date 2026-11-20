from fastapi import APIRouter

from ..core.deps import OpsDep, StoreDep
from ..schemas import requests as r
from ..schemas.common import ToolResult, to_result
from ..services.redact import Area

router = APIRouter(prefix="/api/security", tags=["security"])


@router.post("/protect", response_model=ToolResult)
def protect(body: r.ProtectRequest, ops: OpsDep, store: StoreDep):
    return to_result(ops.protect(body.document_id, body.user_password, body.owner_password,
                                 allow_print=body.allow_print, allow_copy=body.allow_copy,
                                 allow_modify=body.allow_modify), store)


@router.post("/unlock", response_model=ToolResult)
def unlock(body: r.UnlockRequest, ops: OpsDep, store: StoreDep):
    return to_result(ops.unlock(body.document_id, body.password), store)


@router.post("/watermark", response_model=ToolResult)
def watermark(body: r.WatermarkRequest, ops: OpsDep, store: StoreDep):
    return to_result(ops.watermark(
        body.document_id, text=body.text, image_doc_id=body.image_document_id, opacity=body.opacity,
        rotation=body.rotation, font_size=body.font_size, color=body.color, pages=body.pages,
        layout=body.layout, image_scale=body.image_scale), store)


@router.post("/redact", response_model=ToolResult, summary="True redaction: matching content is removed from the file")
def redact(body: r.RedactRequest, ops: OpsDep, store: StoreDep):
    areas = [Area(a.page, a.x0, a.y0, a.x1, a.y1) for a in body.areas]
    return to_result(ops.redact(body.document_id, terms=body.terms, patterns=body.patterns, areas=areas,
                                case_sensitive=body.case_sensitive, scrub_metadata=body.scrub_metadata), store)


@router.get("/metadata/{document_id}", summary="Read PDF metadata")
def get_metadata(document_id: str, ops: OpsDep):
    return ops.get_metadata(document_id)


@router.post("/metadata", response_model=ToolResult, summary="Edit PDF metadata ('' removes a field)")
def update_metadata(body: r.MetadataUpdate, ops: OpsDep, store: StoreDep):
    changes = body.model_dump(exclude={"document_id", "clear_all"}, exclude_none=True)
    return to_result(ops.update_metadata(body.document_id, changes, body.clear_all), store)
