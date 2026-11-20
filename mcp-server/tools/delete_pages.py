from mcp.server.fastmcp import Context, FastMCP

from rooman_pdf_mcp.common import DESTRUCTIVE, DocId, Pages, ToolOutput, run_op


def register(mcp: FastMCP) -> None:
    @mcp.tool(name="delete_pages", annotations=DESTRUCTIVE,
              description="Remove pages from a PDF (creates a new PDF without them; the original is kept). "
                          "Requires the user's confirmation.")
    async def delete_pages(document_id: DocId, pages: Pages, ctx: Context = None) -> ToolOutput:  # type: ignore[assignment]
        return await run_op(ctx, lambda ops: ops.delete_pages(document_id, pages))
