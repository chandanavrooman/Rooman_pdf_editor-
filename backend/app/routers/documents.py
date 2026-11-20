from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, File, Request, UploadFile
from fastapi.responses import FileResponse, Response

from ..core.deps import CurrentUser, OpsDep, SettingsDep, StoreDep
from ..core.errors import AppError
from ..core.limits import sniff_kind
from ..schemas.common import DocumentInfo, to_info
from ..services import pdf_ops
from ..services.storage import safe_filename

router = APIRouter(prefix="/api/documents", tags=["documents"])

CHUNK = 1024 * 1024


@router.post("", response_model=DocumentInfo, status_code=201,
             summary="Upload a file (PDF, DOCX, XLSX, PPTX, JPG, PNG, TXT) and get a document ID")
async def upload(request: Request, user: CurrentUser, store: StoreDep, settings: SettingsDep,
                 file: Annotated[UploadFile, File()]):
    limit = settings.max_upload_bytes
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > limit + 64 * 1024:
        raise AppError(413, "FILE_TOO_LARGE", f"File exceeds the {settings.max_upload_mb} MB limit")
    with store.tempdir() as td:
        tmp = td / "upload.bin"
        total = 0
        with tmp.open("wb") as out:
            while chunk := await file.read(CHUNK):
                total += len(chunk)
                if total > limit:
                    raise AppError(413, "FILE_TOO_LARGE", f"File exceeds the {settings.max_upload_mb} MB limit")
                out.write(chunk)
        if total == 0:
            raise AppError(400, "EMPTY_FILE", "The uploaded file is empty")
        name = safe_filename(file.filename or "upload")
        kind = sniff_kind(tmp, name)
        pages = pdf_ops.page_count(tmp) if kind == "pdf" else None
        doc = store.adopt(user.id, tmp, name, kind, pages)
    return to_info(doc, store)


@router.get("", response_model=list[DocumentInfo], summary="List your documents")
def list_documents(user: CurrentUser, store: StoreDep):
    return [to_info(d, store) for d in store.list(user.id)]


@router.get("/{document_id}", response_model=DocumentInfo)
def get_document(document_id: str, user: CurrentUser, store: StoreDep):
    return to_info(store.get(user.id, document_id), store)


@router.get("/{document_id}/download", response_class=FileResponse,
            responses={200: {"content": {"application/octet-stream": {}}}})
def download(document_id: str, user: CurrentUser, store: StoreDep):
    doc = store.get(user.id, document_id)
    return FileResponse(doc.path, media_type=doc.mime.split(";")[0], filename=doc.filename,
                        headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store"})


@router.delete("/{document_id}", status_code=204)
def delete(document_id: str, user: CurrentUser, store: StoreDep):
    store.delete(user.id, document_id)
    return Response(status_code=204)


@router.get("/{document_id}/info", summary="PDF info: pages, encryption and metadata")
def info(document_id: str, ops: OpsDep):
    r = ops.info(document_id)
    return {"document_id": document_id, "pages": r["document"].pages, "encrypted": r["encrypted"],
            "metadata": r["metadata"]}

