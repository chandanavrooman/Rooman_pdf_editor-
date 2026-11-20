"""Extra tool (not in the required list) - also proves a new capability is just one new file."""
from typing import Annotated

from mcp.server.fastmcp import Context, FastMCP
from pydantic import Field

from rooman_pdf_mcp.common import DESTRUCTIVE, DocId, ToolOutput, run_op


def register(mcp: FastMCP) -> None:
    @mcp.tool(name="redact_pdf", annotations=DESTRUCTIVE,
              description="Permanently remove the given words/phrases from a PDF (text is truly deleted, not covered) into a new PDF. "
                          "Requires the user's confirmation.")
    async def redact_pdf(
        document_id: DocId,
        terms: Annotated[list[Annotated[str, Field(min_length=1, max_length=200)]], Field(min_length=1, max_length=100)],
        case_sensitive: bool = False,
        ctx: Context = None,  # type: ignore[assignment]
    ) -> ToolOutput:
        return await run_op(ctx, lambda ops: ops.redact(document_id, terms=terms, case_sensitive=case_sensitive))
