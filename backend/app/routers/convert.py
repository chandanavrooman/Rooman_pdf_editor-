from fastapi import APIRouter

from ..core.deps import OpsDep, StoreDep
from ..schemas import requests as r
from ..schemas.common import ToolResult, to_result

router = APIRouter(prefix="/api/convert", tags=["convert"])


@router.post("/pdf-to-word", response_model=ToolResult,
             summary="PDF -> DOCX (pdf2docx; scanned pages OCR'd first when Tesseract is available)")
def pdf_to_word(body: r.DocRef, ops: OpsDep, store: StoreDep):
    return to_result(ops.pdf_to_word(body.document_id), store)


@router.post("/pdf-to-excel", response_model=ToolResult, summary="PDF tables -> XLSX (one sheet per table)")
def pdf_to_excel(body: r.PdfToExcelRequest, ops: OpsDep, store: StoreDep):
    return to_result(ops.pdf_to_excel(body.document_id, body.pages), store)


@router.post("/pdf-to-powerpoint", response_model=ToolResult)
def pdf_to_powerpoint(body: r.PdfToPptRequest, ops: OpsDep, store: StoreDep):
    return to_result(ops.pdf_to_powerpoint(body.document_id, body.mode), store)


@router.post("/pdf-to-images", response_model=ToolResult, summary="PDF -> ZIP of PNG/JPG pages")
def pdf_to_images(body: r.PdfToImagesRequest, ops: OpsDep, store: StoreDep):
    return to_result(ops.pdf_to_images(body.document_id, body.format, body.dpi, body.pages), store)


@router.post("/pdf-to-text", response_model=ToolResult)
def pdf_to_text(body: r.PdfToTextRequest, ops: OpsDep, store: StoreDep):
    return to_result(ops.pdf_to_text(body.document_id, body.pages), store)


@router.post("/word-to-pdf", response_model=ToolResult, summary="DOCX -> PDF (LibreOffice)")
def word_to_pdf(body: r.DocRef, ops: OpsDep, store: StoreDep):
    return to_result(ops.office_to_pdf(body.document_id, "docx"), store)


@router.post("/excel-to-pdf", response_model=ToolResult, summary="XLSX -> PDF (LibreOffice)")
def excel_to_pdf(body: r.DocRef, ops: OpsDep, store: StoreDep):
    return to_result(ops.office_to_pdf(body.document_id, "xlsx"), store)


@router.post("/powerpoint-to-pdf", response_model=ToolResult, summary="PPTX -> PDF (LibreOffice)")
def powerpoint_to_pdf(body: r.DocRef, ops: OpsDep, store: StoreDep):
    return to_result(ops.office_to_pdf(body.document_id, "pptx"), store)


@router.post("/html-to-pdf", response_model=ToolResult, summary="HTML (pasted or from a .html file) -> PDF (headless Chromium; no scripts, no network)")
def html_to_pdf(body: r.HtmlToPdfRequest, ops: OpsDep, store: StoreDep):
    return to_result(ops.html_to_pdf(body.html, body.page_size, body.orientation), store)


@router.post("/images-to-pdf", response_model=ToolResult, summary="JPG/PNG (one or many) -> PDF")
def images_to_pdf(body: r.ImagesToPdfRequest, ops: OpsDep, store: StoreDep):
    return to_result(ops.images_to_pdf(body.document_ids, body.page_size, body.margin_mm, body.orientation), store)


@router.post("/text-to-pdf", response_model=ToolResult, summary="TXT (uploaded or inline) -> PDF")
def text_to_pdf(body: r.TextToPdfRequest, ops: OpsDep, store: StoreDep):
    return to_result(ops.text_to_pdf(doc_id=body.document_id, text=body.text, font_size=body.font_size,
                                     page_size=body.page_size), store)
