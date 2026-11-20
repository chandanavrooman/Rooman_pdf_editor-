from pydantic import BaseModel

from fastapi import APIRouter

from ..core.deps import OpsDep
from ..schemas import requests as r

router = APIRouter(prefix="/api/tables", tags=["tables"])


class Table(BaseModel):
    page: int
    index: int
    rows: list[list[str]]


class TablesResponse(BaseModel):
    tables: list[Table]


@router.post("/extract", response_model=TablesResponse, summary="Detect tables and return their rows as JSON")
def extract(body: r.TablesRequest, ops: OpsDep):
    return TablesResponse(tables=ops.extract_tables(body.document_id, body.pages))
