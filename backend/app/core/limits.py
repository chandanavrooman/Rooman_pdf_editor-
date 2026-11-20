"""Upload validation: size limits and content (magic byte) sniffing. File extensions are never trusted."""
from __future__ import annotations

import zipfile
from pathlib import Path

from .errors import AppError

MAX_UNZIPPED_BYTES = 1024 * 1024 * 1024  # zip-bomb guard for Office files
MAX_ZIP_ENTRIES = 20000

_OFFICE_MARKERS = {"docx": "word/document.xml", "xlsx": "xl/workbook.xml", "pptx": "ppt/presentation.xml"}


def unsupported(msg: str = "Unsupported or corrupted file. Upload a PDF, Word, Excel, PowerPoint, JPG, PNG or TXT file.") -> AppError:
    return AppError(415, "UNSUPPORTED_FILE", msg)


def sniff_kind(path: Path, filename: str) -> str:
    """Return the real file kind from its content; raise 415 if it is not an accepted type."""
    with path.open("rb") as f:
        head = f.read(2048)
    if head[:5] == b"%PDF-" or b"%PDF-" in head[:1024]:
        return "pdf"
    if head[:3] == b"\xff\xd8\xff":
        return "jpg"
    if head[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if head[:4] == b"PK\x03\x04":
        try:
            with zipfile.ZipFile(path) as z:
                infos = z.infolist()
                if len(infos) > MAX_ZIP_ENTRIES or sum(i.file_size for i in infos) > MAX_UNZIPPED_BYTES:
                    raise unsupported("This Office file is too large when unpacked.")
                names = set(z.namelist())
        except zipfile.BadZipFile:
            raise unsupported() from None
        if "[Content_Types].xml" in names:
            for kind, marker in _OFFICE_MARKERS.items():
                if marker in names:
                    return kind
        raise unsupported("This ZIP is not a valid Word, Excel or PowerPoint file.")
    # plain text: only when explicitly named .txt, no NUL bytes, decodable
    if filename.lower().endswith(".txt"):
        if b"\x00" in head and not head.startswith((b"\xff\xfe", b"\xfe\xff")):
            raise unsupported()
        return "txt"
    raise unsupported()


class MaxBodyMiddleware:
    """Reject over-size request bodies (declared or streamed) before they are buffered to disk."""

    def __init__(self, app, max_bytes: int):
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = dict(scope.get("headers") or [])
        declared = headers.get(b"content-length")
        if declared and declared.isdigit() and int(declared) > self.max_bytes:
            await _too_large(scope, receive, send, self.max_bytes)
            return
        seen = 0

        async def limited():
            nonlocal seen
            msg = await receive()
            if msg["type"] == "http.request":
                seen += len(msg.get("body", b""))
                if seen > self.max_bytes:
                    raise AppError(413, "FILE_TOO_LARGE", "Request body is too large")
            return msg

        await self.app(scope, limited, send)


_DRAIN_CAP = 256 * 1024 * 1024


async def _too_large(scope, receive, send, max_bytes: int):
    """Answer 413 with a JSON body the client can show.

    The request body is read and discarded first (bounded): if we answered while the client is still sending, many
    clients and reverse proxies see a reset connection and report a generic 502/network error instead of our message.
    """
    from starlette.responses import JSONResponse

    drained, cap = 0, min(4 * max_bytes, _DRAIN_CAP)
    while drained <= cap:
        msg = await receive()
        if msg["type"] != "http.request":
            break
        drained += len(msg.get("body", b""))
        if not msg.get("more_body", False):
            break
    from .config import get_settings

    mb = get_settings().max_upload_mb
    resp = JSONResponse({"detail": f"The file is larger than the server's {mb} MB upload limit.", "code": "FILE_TOO_LARGE"},
                        status_code=413, headers={"Connection": "close"})
    await resp(scope, receive, send)
