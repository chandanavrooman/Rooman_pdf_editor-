from typing import Annotated

from mcp.server.fastmcp import Context, FastMCP
from pydantic import Field

from rooman_pdf_mcp.common import SAFE_WRITE, DocId, ToolOutput, run_op


def register(mcp: FastMCP) -> None:
    @mcp.tool(name="add_watermark", annotations=SAFE_WRITE,
              description="Stamp a text watermark (e.g. 'CONFIDENTIAL') on the pages of a PDF; creates a new PDF.")
    async def add_watermark(
        document_id: DocId,
        text: Annotated[str, Field(min_length=1, max_length=200)],
        opacity: Annotated[float, Field(ge=0.02, le=1)] = 0.3,
        rotation: Annotated[float, Field(ge=-180, le=180)] = 45,
        font_size: Annotated[float, Field(ge=6, le=300)] = 60,
        color: Annotated[str, Field(pattern=r"^#[0-9a-fA-F]{6}$")] = "#888888",
        pages: Annotated[str | None, Field(max_length=500, pattern=r"^[0-9,\-\s]+$")] = None,
        ctx: Context = None,  # type: ignore[assignment]
    ) -> ToolOutput:
        return await run_op(ctx, lambda ops: ops.watermark(document_id, text=text, opacity=opacity, rotation=rotation,
                                                           font_size=font_size, color=color, pages=pages))
