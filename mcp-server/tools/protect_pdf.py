from typing import Annotated

from mcp.server.fastmcp import Context, FastMCP
from pydantic import Field

from rooman_pdf_mcp.common import DESTRUCTIVE, DocId, ToolOutput, run_op


def register(mcp: FastMCP) -> None:
    @mcp.tool(name="protect_pdf", annotations=DESTRUCTIVE,
              description="Encrypt a PDF with a password (AES-256) into a new PDF. Requires the user's confirmation; "
                          "the password must be given by the user - never invent one.")
    async def protect_pdf(
        document_id: DocId,
        user_password: Annotated[str, Field(min_length=1, max_length=127, description="password needed to open the PDF")],
        owner_password: Annotated[str | None, Field(min_length=1, max_length=127)] = None,
        allow_print: bool = True,
        allow_copy: bool = True,
        allow_modify: bool = False,
        ctx: Context = None,  # type: ignore[assignment]
    ) -> ToolOutput:
        return await run_op(ctx, lambda ops: ops.protect(document_id, user_password, owner_password, allow_print=allow_print,
                                                         allow_copy=allow_copy, allow_modify=allow_modify))
