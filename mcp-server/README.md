# rooman-pdf-mcp

MCP server (official Python SDK, `FastMCP`, **Streamable HTTP**) exposing the Rooman PDF service layer as tools for the chat agent.

```bash
# needs the backend virtualenv (the server imports ../backend/app) and MCP_SHARED_SECRET (>= 32 chars) in ../.env
python -c "import secrets; print(secrets.token_urlsafe(48))"      # paste into .env as MCP_SHARED_SECRET=...
./run.sh                                                         # http://127.0.0.1:8001/mcp  (MCP_HOST / MCP_PORT)
# equivalent: cd mcp-server && ../backend/.venv/bin/python -m rooman_pdf_mcp
```

* Only our backend may call it: `Authorization: Bearer <MCP_SHARED_SECRET>` + `X-Rooman-User-Token` (JWT signed with the secret, `sub` = user id,
  audience `rooman-pdf-mcp`, short-lived). Without both → 401/403. Tool calls re-verify the user token and use `Ops(store, user_id)`, which enforces ownership.
* Tools take **document IDs only** (no paths) and validate parameters with Pydantic types; failures come back as `isError` results with a readable `CODE: message`.
* Same storage dir + SQLite DB as the backend (`STORAGE_DIR`), so documents created by a tool are immediately downloadable via `/api/documents/<id>/download`.

## Add a tool = add one file
Create `mcp-server/tools/my_tool.py` (files starting with `_` are ignored):
```python
from mcp.server.fastmcp import Context, FastMCP
from rooman_pdf_mcp.common import SAFE_WRITE, DocId, ToolOutput, run_op

def register(mcp: FastMCP) -> None:
    @mcp.tool(name="my_tool", annotations=SAFE_WRITE, description="What it does, for the model.")
    async def my_tool(document_id: DocId, ctx: Context = None) -> ToolOutput:
        return await run_op(ctx, lambda ops: ops.flatten(document_id))     # ops = Ops(store, <calling user>)
```
Annotation presets: `READ_ONLY`, `SAFE_WRITE`, `DESTRUCTIVE` (destructive tools always need the user's confirmation in the chat agent). Restart the server.

## Tools
`merge_pdfs · split_pdf · compress_pdf · rotate_pdf · delete_pages (destructive) · extract_pages · extract_text · extract_tables · convert_pdf (docx/xlsx/pptx/jpg/png/txt) · add_watermark · protect_pdf (destructive) · get_document_info · search_document · redact_pdf (destructive, extra)`

Tests: `cd ../backend && .venv/bin/python -m pytest tests/test_mcp_server.py` (real server over HTTP, real MCP client, real fixtures).
