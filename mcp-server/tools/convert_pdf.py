from typing import Annotated, Literal

from mcp.server.fastmcp import Context, FastMCP
from pydantic import Field

from rooman_pdf_mcp.common import SAFE_WRITE, DocId, ToolOutput, run_op


def register(mcp: FastMCP) -> None:
    @mcp.tool(name="convert_pdf", annotations=SAFE_WRITE,
              description="Convert a PDF to another format: docx (Word), xlsx (Excel tables), pptx (PowerPoint), "
                          "jpg/png (one image per page, returned as a ZIP) or txt (plain text).")
    async def convert_pdf(
        document_id: DocId,
        target: Literal["docx", "xlsx", "pptx", "jpg", "png", "txt"],
        pages: Annotated[str | None, Field(max_length=500, pattern=r"^[0-9,\-\s]+$", description="only for xlsx/jpg/png/txt")] = None,
        ctx: Context = None,  # type: ignore[assignment]
    ) -> ToolOutput:
        def go(ops):
            if target == "docx":
                return ops.pdf_to_word(document_id)
            if target == "xlsx":
                return ops.pdf_to_excel(document_id, pages)
            if target == "pptx":
                return ops.pdf_to_powerpoint(document_id)
            if target == "txt":
                return ops.pdf_to_text(document_id, pages)
            return ops.pdf_to_images(document_id, target, 150, pages)

        return await run_op(ctx, go)
