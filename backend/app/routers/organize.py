from fastapi import APIRouter

from ..core.deps import OpsDep, StoreDep
from ..schemas import requests as r
from ..schemas.common import ToolResult, to_result

router = APIRouter(prefix="/api/organize", tags=["organize"])


@router.post("/merge", response_model=ToolResult)
def merge(body: r.MergeRequest, ops: OpsDep, store: StoreDep):
    return to_result(ops.merge(body.document_ids, body.filename), store)


@router.post("/split", response_model=ToolResult, summary="Split by ranges, every N pages, max size or bookmarks")
def split(body: r.SplitRequest, ops: OpsDep, store: StoreDep):
    return to_result(ops.split(body.document_id, body.mode, ranges=body.ranges, every_n=body.every_n,
                               max_size_mb=body.max_size_mb, as_zip=body.zip), store)


@router.post("/extract-pages", response_model=ToolResult)
def extract_pages(body: r.PagesRequest, ops: OpsDep, store: StoreDep):
    return to_result(ops.extract_pages(body.document_id, body.pages), store)


@router.post("/delete-pages", response_model=ToolResult)
def delete_pages(body: r.PagesRequest, ops: OpsDep, store: StoreDep):
    return to_result(ops.delete_pages(body.document_id, body.pages), store)


@router.post("/reorder", response_model=ToolResult)
def reorder(body: r.ReorderRequest, ops: OpsDep, store: StoreDep):
    return to_result(ops.reorder(body.document_id, body.order), store)


@router.post("/rotate", response_model=ToolResult)
def rotate(body: r.RotateRequest, ops: OpsDep, store: StoreDep):
    return to_result(ops.rotate(body.document_id, body.angle, body.pages), store)


@router.post("/crop", response_model=ToolResult, summary="Crop margins (PDF points)")
def crop(body: r.CropRequest, ops: OpsDep, store: StoreDep):
    return to_result(ops.crop(body.document_id, body.top, body.right, body.bottom, body.left, body.pages), store)
