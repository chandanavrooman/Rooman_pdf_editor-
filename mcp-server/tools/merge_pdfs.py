from typing import Annotated

from mcp.server.fastmcp import Context, FastMCP
from pydantic import Field

from rooman_pdf_mcp.common import SAFE_WRITE, DocId, ToolOutput, run_op


def register(mcp: FastMCP) -> None:
    @mcp.tool(name="merge_pdfs", annotations=SAFE_WRITE,
              description="Merge two or more PDFs into one new PDF, in the given order. Returns the new document.")
    async def merge_pdfs(
        document_ids: Annotated[list[DocId], Field(min_length=2, max_length=50, description="PDF document IDs in merge order")],
        filename: Annotated[str | None, Field(max_length=120, description="Output file name, e.g. merged.pdf")] = None,
        ctx: Context = None,  # type: ignore[assignment]
    ) -> ToolOutput:
        return await run_op(ctx, lambda ops: ops.merge(document_ids, filename))
