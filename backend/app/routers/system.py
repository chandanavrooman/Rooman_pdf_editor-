from fastapi import APIRouter

from ..core.config import get_settings
from ..services import external, ocr as ocr_svc

router = APIRouter(prefix="/api", tags=["system"])


@router.get("/health")
def health():
    return {"status": "ok"}


@router.get("/system/capabilities", summary="Which external programs are installed (and which tools they unlock)")
def capabilities():
    s = get_settings()
    caps = external.capabilities()
    avail = {k: v["available"] for k, v in caps.items()}
    return {
        "programs": caps,
        "tools": {
            "compress": avail["gs"], "ocr": avail["tesseract"], "deskew": avail["tesseract"],
            "html_to_pdf": avail["chromium"], "word_to_pdf": avail["soffice"], "excel_to_pdf": avail["soffice"], "powerpoint_to_pdf": avail["soffice"],
            "pdf_to_word_ocr_for_scans": avail["tesseract"],
        },
        "ocr_languages": ocr_svc.available_languages(),
        "limits": {"max_upload_mb": s.max_upload_mb, "file_ttl_minutes": s.file_ttl_minutes},
        "ai_configured": bool(s.ai_api_key),
        "local_test_mode": s.local_test_mode_active,
    }
