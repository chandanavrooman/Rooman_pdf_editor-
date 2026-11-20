from typing import Annotated

from mcp.server.fastmcp import Context, FastMCP
from pydantic import Field

from rooman_pdf_mcp.common import SAFE_WRITE, DocId, ToolOutput, run, run_op


def register(mcp: FastMCP) -> None:
    @mcp.tool(name="extract_tables", annotations=SAFE_WRITE,
              description="Detect tables in a PDF (pdfplumber). Returns data.tables (rows, truncated for size). "
                          "With create_xlsx=true also creates an Excel document with one sheet per table.")
    async def extract_tables(
        document_id: DocId,
        pages: Annotated[str | None, Field(max_length=500, pattern=r"^[0-9,\-\s]+$")] = None,
        create_xlsx: bool = False,
        ctx: Context = None,  # type: ignore[assignment]
    ) -> ToolOutput:
        if create_xlsx:
            out = await run_op(ctx, lambda ops: ops.pdf_to_excel(document_id, pages))
            tables = await run(ctx, lambda ops: ops.extract_tables(document_id, pages))
        else:
            out = ToolOutput()
            tables = await run(ctx, lambda ops: ops.extract_tables(document_id, pages))
        out.data = {"count": len(tables), "truncated": len(tables) > 20,
                    "tables": [{"page": t["page"], "index": t["index"], "rows": t["rows"][:50]} for t in tables[:20]]}
        if not tables:
            out.notice = "No tables were found (scanned pages need OCR first)."
        return out
