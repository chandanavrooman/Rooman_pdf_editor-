from mcp.server.fastmcp import Context, FastMCP

from rooman_pdf_mcp.common import SAFE_WRITE, DocId, Pages, ToolOutput, run_op


def register(mcp: FastMCP) -> None:
    @mcp.tool(name="extract_pages", annotations=SAFE_WRITE,
              description="Create a new PDF containing only the given pages (e.g. '1-3,5') of a PDF.")
    async def extract_pages(document_id: DocId, pages: Pages, ctx: Context = None) -> ToolOutput:  # type: ignore[assignment]
        return await run_op(ctx, lambda ops: ops.extract_pages(document_id, pages))
