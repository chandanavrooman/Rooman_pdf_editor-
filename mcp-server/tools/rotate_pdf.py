from typing import Annotated, Literal

from mcp.server.fastmcp import Context, FastMCP
from pydantic import Field

from rooman_pdf_mcp.common import SAFE_WRITE, DocId, ToolOutput, run_op


def register(mcp: FastMCP) -> None:
    @mcp.tool(name="rotate_pdf", annotations=SAFE_WRITE,
              description="Rotate pages of a PDF clockwise by 90, 180 or 270 degrees (all pages unless `pages` is given).")
    async def rotate_pdf(
        document_id: DocId, angle: Literal[90, 180, 270],
        pages: Annotated[str | None, Field(max_length=500, pattern=r"^[0-9,\-\s]+$", description="e.g. '1-3,5'; omit for all pages")] = None,
        ctx: Context = None,  # type: ignore[assignment]
    ) -> ToolOutput:
        return await run_op(ctx, lambda ops: ops.rotate(document_id, angle, pages))
