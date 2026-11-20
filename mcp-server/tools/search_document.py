from typing import Annotated

from mcp.server.fastmcp import Context, FastMCP
from pydantic import Field

from rooman_pdf_mcp.common import READ_ONLY, DocId, ToolOutput, run


def register(mcp: FastMCP) -> None:
    @mcp.tool(name="search_document", annotations=READ_ONLY,
              description="Find a word or phrase in a PDF (case-insensitive). Returns data.matches = [{page, snippet}].")
    async def search_document(
        document_id: DocId,
        query: Annotated[str, Field(min_length=1, max_length=200)],
        limit: Annotated[int, Field(ge=1, le=200)] = 50,
        ctx: Context = None,  # type: ignore[assignment]
    ) -> ToolOutput:
        hits = await run(ctx, lambda ops: ops.search(document_id, query, limit))
        return ToolOutput(data={"count": len(hits), "matches": hits},
                          notice=None if hits else f"'{query}' was not found.")
