from typing import Annotated, Literal

from mcp.server.fastmcp import Context, FastMCP
from pydantic import Field

from rooman_pdf_mcp.common import SAFE_WRITE, DocId, ToolOutput, run_op


def register(mcp: FastMCP) -> None:
    @mcp.tool(name="split_pdf", annotations=SAFE_WRITE,
              description="Split a PDF into several new PDFs: by page ranges ('1-3,4-6'), every N pages, by maximum "
                          "file size in MB, or by top-level bookmarks. Returns one document per part.")
    async def split_pdf(
        document_id: DocId,
        mode: Literal["ranges", "every_n", "by_size", "bookmarks"],
        ranges: Annotated[str | None, Field(max_length=500, pattern=r"^[0-9,\-\s]+$", description="for mode=ranges, e.g. '1-3,4-6'")] = None,
        every_n: Annotated[int | None, Field(ge=1, le=10000, description="for mode=every_n")] = None,
        max_size_mb: Annotated[float | None, Field(gt=0, le=1000, description="for mode=by_size")] = None,
        ctx: Context = None,  # type: ignore[assignment]
    ) -> ToolOutput:
        return await run_op(ctx, lambda ops: ops.split(document_id, mode, ranges=ranges, every_n=every_n, max_size_mb=max_size_mb))
