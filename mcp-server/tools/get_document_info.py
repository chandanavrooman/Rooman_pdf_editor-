from mcp.server.fastmcp import Context, FastMCP

from rooman_pdf_mcp.common import READ_ONLY, DocId, ToolOutput, run


def register(mcp: FastMCP) -> None:
    @mcp.tool(name="get_document_info", annotations=READ_ONLY,
              description="Basic facts about a document: file name, type, size, page count, whether a PDF is encrypted, and metadata.")
    async def get_document_info(document_id: DocId, ctx: Context = None) -> ToolOutput:  # type: ignore[assignment]
        def go(ops):
            d = ops.store.get(ops.user_id, document_id)
            info = {"id": d.id, "filename": d.filename, "kind": d.kind, "size": d.size, "pages": d.pages,
                    "download_url": f"/api/documents/{d.id}/download"}
            if d.kind == "pdf":
                r = ops.info(document_id)
                info["encrypted"] = r["encrypted"]
                info["metadata"] = r["metadata"]
            return info

        return ToolOutput(data=await run(ctx, go))
