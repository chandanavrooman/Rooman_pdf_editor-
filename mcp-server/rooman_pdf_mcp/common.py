"""Helpers shared by every tool file in mcp-server/tools/."""
from __future__ import annotations

import asyncio
from typing import Annotated, Any, Callable

from mcp.server.fastmcp import Context
from mcp.server.fastmcp.exceptions import ToolError
from mcp.types import ToolAnnotations
from pydantic import BaseModel, Field

from app.ai.mcp_auth import USER_HEADER, McpAuthError, verify_user_token
from app.core.config import get_settings
from app.core.deps import get_store
from app.core.errors import AppError
from app.services.operations import OpResult, Ops

# ---- parameter types (validated by Pydantic before a tool body runs) -------------------------------------------
DocId = Annotated[str, Field(min_length=32, max_length=32, pattern=r"^[0-9a-f]{32}$",
                             description="Document ID (32 hex characters) from the document list or an earlier tool result")]
Pages = Annotated[str, Field(max_length=500, pattern=r"^[0-9,\-\s]+$", description="1-based pages, e.g. '1-3,5,8-10'")]

# ---- annotation presets ----------------------------------------------------------------------------------------
# destructiveHint=True means "the agent must ask the user to confirm before running this".
READ_ONLY = ToolAnnotations(readOnlyHint=True, destructiveHint=False, idempotentHint=True, openWorldHint=False)
SAFE_WRITE = ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=False, openWorldHint=False)
DESTRUCTIVE = ToolAnnotations(readOnlyHint=False, destructiveHint=True, idempotentHint=False, openWorldHint=False)


class DocOut(BaseModel):
    id: str
    filename: str
    kind: str
    size: int
    pages: int | None = None
    download_url: str


class ToolOutput(BaseModel):
    ok: bool = True
    documents: list[DocOut] = Field(default_factory=list, description="Documents produced by the tool (new IDs)")
    notice: str | None = None
    details: dict[str, Any] = Field(default_factory=dict)
    data: Any | None = None


def doc_out(d) -> DocOut:
    return DocOut(id=d.id, filename=d.filename, kind=d.kind, size=d.size, pages=d.pages,
                  download_url=f"/api/documents/{d.id}/download")


def user_id_from(ctx: Context) -> str:
    """The end user, taken from the signed per-request token (re-verified on every tool call)."""
    try:
        request = ctx.request_context.request
        token = request.headers.get(USER_HEADER) if request is not None else None
    except (ValueError, AttributeError):
        token = None
    secret = get_settings().mcp_shared_secret
    try:
        uid = verify_user_token(token, secret)
    except McpAuthError as e:
        raise ToolError(f"unauthorized: {e}") from None
    if get_store().get_user(uid) is None:
        raise ToolError("unauthorized: unknown user")
    return uid


def ops_for(ctx: Context) -> Ops:
    return Ops(get_store(), user_id_from(ctx))


async def run(ctx: Context, fn: Callable[[Ops], Any]) -> Any:
    """Run a blocking service-layer call in a worker thread as the calling user; AppError -> readable ToolError."""
    ops = ops_for(ctx)
    try:
        return await asyncio.to_thread(fn, ops)
    except AppError as e:
        raise ToolError(f"{e.code}: {e.message}") from None


async def run_op(ctx: Context, fn: Callable[[Ops], OpResult]) -> ToolOutput:
    res = await run(ctx, fn)
    return ToolOutput(documents=[doc_out(d) for d in res.documents], notice=res.notice, details=res.details)
