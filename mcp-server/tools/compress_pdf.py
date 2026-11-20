from typing import Literal

from mcp.server.fastmcp import Context, FastMCP

from rooman_pdf_mcp.common import SAFE_WRITE, DocId, ToolOutput, run_op


def register(mcp: FastMCP) -> None:
    @mcp.tool(name="compress_pdf", annotations=SAFE_WRITE,
              description="Reduce a PDF's file size (Ghostscript). level: low = best quality, medium = balanced, high = smallest. "
                          "details has before_bytes, after_bytes, saved_percent.")
    async def compress_pdf(document_id: DocId, level: Literal["low", "medium", "high"] = "medium",
                           ctx: Context = None) -> ToolOutput:  # type: ignore[assignment]
        return await run_op(ctx, lambda ops: ops.compress(document_id, level))
