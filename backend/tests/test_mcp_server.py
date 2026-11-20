"""rooman-pdf-mcp: every tool through a REAL MCP client over Streamable HTTP against a REALLY started server,
with real fixtures and real PDF processing."""
from __future__ import annotations

import asyncio
import json
import os
import socket
import subprocess
import sys
import textwrap
import time
import zipfile
import io
from pathlib import Path

import httpx
import pytest

from ai_fixtures import mcp_session
from app.ai.mcp_auth import mint_user_token
from app.core.config import get_settings
from conftest import FIXTURES, REPO, User, needs_gs, needs_soffice

SECRET = os.environ["MCP_SHARED_SECRET"]
EXPECTED_TOOLS = {
    "merge_pdfs", "split_pdf", "compress_pdf", "rotate_pdf", "delete_pages", "extract_pages", "extract_text",
    "extract_tables", "convert_pdf", "add_watermark", "protect_pdf", "get_document_info", "search_document",
}


def call(url, user: User, name: str, args: dict, *, secret=SECRET, token=None):
    """Call one tool as `user`; returns (isError, structured, text)."""
    async def go():
        tok = token if token is not None else mint_user_token(user.id, secret or SECRET)
        async with mcp_session(url, secret, tok) as s:
            r = await s.call_tool(name, args)
            return r.isError, r.structuredContent, "\n".join(getattr(c, "text", "") for c in r.content)
    return asyncio.run(go())


def ok(url, user, name, args):
    err, data, text = call(url, user, name, args)
    assert not err, text
    assert data and data["ok"] is True
    return data


def fetch(client, user: User, doc: dict) -> bytes:
    r = client.get(doc["download_url"], headers=user.h)
    assert r.status_code == 200
    return r.content


# ---------------------------------------------------------------- tool listing / annotations
def test_lists_all_required_tools_with_annotations(mcp_url, user):
    async def go():
        async with mcp_session(mcp_url, SECRET, mint_user_token(user.id, SECRET)) as s:
            return (await s.list_tools()).tools
    tools = {t.name: t for t in asyncio.run(go())}
    assert EXPECTED_TOOLS <= set(tools)
    assert tools["delete_pages"].annotations.destructiveHint is True
    assert tools["protect_pdf"].annotations.destructiveHint is True
    assert tools["extract_text"].annotations.readOnlyHint is True
    assert tools["merge_pdfs"].annotations.destructiveHint is False
    for t in tools.values():  # every tool takes document IDs, never paths
        props = t.inputSchema["properties"]
        assert not any("path" in p for p in props), t.name
        assert t.inputSchema["type"] == "object"


# ---------------------------------------------------------------- the tools themselves
def test_get_document_info_and_search_and_text(mcp_url, user):
    d = user.fx("multipage.pdf")
    info = ok(mcp_url, user, "get_document_info", {"document_id": d["id"]})["data"]
    assert info["pages"] == d["pages"] >= 10 and info["kind"] == "pdf" and info["encrypted"] is False
    hits = ok(mcp_url, user, "search_document", {"document_id": d["id"], "query": "chapter 7"})["data"]
    assert hits["count"] >= 1 and hits["matches"][0]["page"] == 7
    assert ok(mcp_url, user, "search_document", {"document_id": d["id"], "query": "zzzqqq"})["data"]["count"] == 0
    text = ok(mcp_url, user, "extract_text", {"document_id": d["id"], "pages": "12"})["data"]
    assert "CH12X" in text["text"] and not text["truncated"]
    short = ok(mcp_url, user, "extract_text", {"document_id": d["id"], "max_chars": 100})["data"]
    assert len(short["text"]) == 100 and short["truncated"] is True


def test_extract_pages_rotate_delete_merge_split(mcp_url, user, client):
    d = user.fx("multipage.pdf")
    ex = ok(mcp_url, user, "extract_pages", {"document_id": d["id"], "pages": "1-3"})
    assert ex["documents"][0]["pages"] == 3 and ex["documents"][0]["download_url"].endswith("/download")
    rot = ok(mcp_url, user, "rotate_pdf", {"document_id": ex["documents"][0]["id"], "angle": 90})
    import pikepdf
    with pikepdf.open(io.BytesIO(fetch(client, user, rot["documents"][0]))) as pdf:
        assert len(pdf.pages) == 3 and all(int(p.get("/Rotate", 0)) == 90 for p in pdf.pages)
    dele = ok(mcp_url, user, "delete_pages", {"document_id": d["id"], "pages": "1,2"})
    assert dele["documents"][0]["pages"] == d["pages"] - 2
    other = user.fx("table.pdf")
    merged = ok(mcp_url, user, "merge_pdfs", {"document_ids": [d["id"], other["id"]], "filename": "both.pdf"})
    assert merged["documents"][0]["pages"] == d["pages"] + other["pages"] and merged["documents"][0]["filename"] == "both.pdf"
    split = ok(mcp_url, user, "split_pdf", {"document_id": d["id"], "mode": "ranges", "ranges": "1-2,3-5"})
    assert [x["pages"] for x in split["documents"]] == [2, 3]
    ev = ok(mcp_url, user, "split_pdf", {"document_id": d["id"], "mode": "every_n", "every_n": 5})
    assert sum(x["pages"] for x in ev["documents"]) == d["pages"]


@needs_gs
def test_compress_pdf_really_smaller(mcp_url, user, client):
    d = user.fx("large.pdf")
    r = ok(mcp_url, user, "compress_pdf", {"document_id": d["id"], "level": "high"})
    det = r["details"]
    assert det["after_bytes"] < det["before_bytes"] == d["size"]
    assert r["documents"][0]["size"] == len(fetch(client, user, r["documents"][0])) < d["size"]


def test_extract_tables_and_xlsx(mcp_url, user, client):
    d = user.fx("table.pdf")
    r = ok(mcp_url, user, "extract_tables", {"document_id": d["id"], "create_xlsx": True})
    assert r["data"]["count"] >= 1
    rows = r["data"]["tables"][0]["rows"]
    assert len(rows) == 6 and all(len(x) == 5 for x in rows)
    import openpyxl
    wb = openpyxl.load_workbook(io.BytesIO(fetch(client, user, r["documents"][0])))
    assert wb.worksheets[0].max_row == 6 and wb.worksheets[0].max_column == 5


def test_convert_pdf_txt_docx_images(mcp_url, user, client):
    d = user.fx("multipage.pdf")
    txt = ok(mcp_url, user, "convert_pdf", {"document_id": d["id"], "target": "txt", "pages": "1-2"})
    assert b"Chapter 1" in fetch(client, user, txt["documents"][0])
    png = ok(mcp_url, user, "convert_pdf", {"document_id": d["id"], "target": "png", "pages": "1-2"})
    assert len(zipfile.ZipFile(io.BytesIO(fetch(client, user, png["documents"][0]))).namelist()) == 2
    t = user.fx("table.pdf")
    docx = ok(mcp_url, user, "convert_pdf", {"document_id": t["id"], "target": "docx"})
    with zipfile.ZipFile(io.BytesIO(fetch(client, user, docx["documents"][0]))) as z:
        assert "<w:tbl>" in z.read("word/document.xml").decode()
    xl = ok(mcp_url, user, "convert_pdf", {"document_id": t["id"], "target": "xlsx"})
    assert xl["documents"][0]["kind"] == "xlsx"


def test_add_watermark_and_protect(mcp_url, user, client):
    import pikepdf
    d = user.fx("multipage.pdf")
    w = ok(mcp_url, user, "add_watermark", {"document_id": d["id"], "text": "CONFIDENTIAL-XYZ", "pages": "1"})
    import fitz
    with fitz.open(stream=fetch(client, user, w["documents"][0]), filetype="pdf") as pdf:
        assert pdf[0].search_for("CONFIDENTIAL-XYZ"), "watermark text not found on page 1"
        assert not pdf[1].search_for("CONFIDENTIAL-XYZ"), "watermark leaked to page 2 (pages='1' was requested)"
    p = ok(mcp_url, user, "protect_pdf", {"document_id": d["id"], "user_password": "pw-12345"})
    data = fetch(client, user, p["documents"][0])
    with pytest.raises(pikepdf.PasswordError):
        pikepdf.open(io.BytesIO(data))
    with pikepdf.open(io.BytesIO(data), password="pw-12345") as pdf:
        assert len(pdf.pages) == d["pages"]
    # and the info tool reports it as encrypted
    assert ok(mcp_url, user, "get_document_info", {"document_id": p["documents"][0]["id"]})["data"]["encrypted"] is True


def test_redact_pdf_extra_tool(mcp_url, user, client):
    import pdfplumber
    d = user.fx("multipage.pdf")
    r = ok(mcp_url, user, "redact_pdf", {"document_id": d["id"], "terms": ["CH12X"]})
    with pdfplumber.open(io.BytesIO(fetch(client, user, r["documents"][0]))) as pdf:
        assert "CH12X" not in "".join(p.extract_text() or "" for p in pdf.pages)


# ---------------------------------------------------------------- validation (Pydantic) & errors
@pytest.mark.parametrize("name,args", [
    ("rotate_pdf", {"document_id": "0" * 32, "angle": 45}),
    ("rotate_pdf", {"document_id": "../../etc/passwd", "angle": 90}),
    ("extract_pages", {"document_id": "0" * 32, "pages": "1;rm -rf"}),
    ("merge_pdfs", {"document_ids": ["0" * 32]}),
    ("compress_pdf", {"document_id": "0" * 32, "level": "extreme"}),
    ("split_pdf", {"document_id": "0" * 32, "mode": "ranges", "bogus": 1}),
    ("add_watermark", {"document_id": "0" * 32, "text": "x", "color": "red"}),
])
def test_invalid_parameters_are_rejected(mcp_url, user, name, args):
    err, _, text = call(mcp_url, user, name, args)
    assert err is True and text


def test_path_like_or_unknown_ids_are_not_documents(mcp_url, user):
    err, _, text = call(mcp_url, user, "get_document_info", {"document_id": "f" * 32})
    assert err and "NOT_FOUND" in text


def test_service_errors_come_back_as_readable_tool_errors(mcp_url, user):
    d = user.fx("multipage.pdf")
    err, _, text = call(mcp_url, user, "extract_pages", {"document_id": d["id"], "pages": "99"})
    assert err and "PAGE_OUT_OF_RANGE" in text


# ---------------------------------------------------------------- authentication / per-user access
def test_requests_without_or_with_wrong_secret_are_refused(mcp_url, user):
    init = {"jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "t", "version": "1"}}}
    base = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json"}
    tok = mint_user_token(user.id, SECRET)
    r = httpx.post(mcp_url, json=init, headers=base)
    assert r.status_code == 401
    r = httpx.post(mcp_url, json=init, headers={**base, "Authorization": "Bearer wrong-secret", "X-Rooman-User-Token": tok})
    assert r.status_code == 403
    r = httpx.post(mcp_url, json=init, headers={**base, "Authorization": f"Bearer {SECRET}"})  # secret but no user
    assert r.status_code == 401
    r = httpx.post(mcp_url, json=init, headers={**base, "Authorization": f"Bearer {SECRET}", "X-Rooman-User-Token": tok})
    assert r.status_code == 200 and "serverInfo" in r.text and "rooman-pdf-mcp" in r.text


@pytest.mark.parametrize("kind", ["garbage", "wrong_key", "expired", "unknown_user", "wrong_audience"])
def test_bad_user_tokens_are_refused(mcp_url, user, kind):
    import jwt
    now = int(time.time())
    tokens = {
        "garbage": "not-a-jwt",
        "wrong_key": mint_user_token(user.id, "x" * 40),
        "expired": jwt.encode({"sub": user.id, "aud": "rooman-pdf-mcp", "typ": "mcp-user", "exp": now - 5}, SECRET, "HS256"),
        "unknown_user": mint_user_token("0" * 32, SECRET),
        "wrong_audience": jwt.encode({"sub": user.id, "aud": "other", "typ": "mcp-user", "exp": now + 99}, SECRET, "HS256"),
    }
    init = {"jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "t", "version": "1"}}}
    r = httpx.post(mcp_url, json=init, headers={"Accept": "application/json, text/event-stream", "Content-Type": "application/json",
                                                "Authorization": f"Bearer {SECRET}", "X-Rooman-User-Token": tokens[kind]})
    assert r.status_code in (401, 403), (kind, r.status_code)
    with pytest.raises(BaseException):  # and a real MCP client cannot even initialise a session
        call(mcp_url, user, "get_document_info", {"document_id": "0" * 32}, token=tokens[kind])


def test_user_b_cannot_touch_user_a_documents(mcp_url, user, user_b):
    a_doc = user.fx("multipage.pdf")
    for name, args in [
        ("get_document_info", {"document_id": a_doc["id"]}),
        ("extract_text", {"document_id": a_doc["id"]}),
        ("search_document", {"document_id": a_doc["id"], "query": "chapter"}),
        ("extract_pages", {"document_id": a_doc["id"], "pages": "1"}),
        ("compress_pdf", {"document_id": a_doc["id"], "level": "low"}),
        ("merge_pdfs", {"document_ids": [a_doc["id"], a_doc["id"]]}),
        ("delete_pages", {"document_id": a_doc["id"], "pages": "1"}),
    ]:
        err, _, text = call(mcp_url, user_b, name, args)
        assert err and "NOT_FOUND" in text, name
    # and what A creates through MCP is invisible to B too
    made = ok(mcp_url, user, "extract_pages", {"document_id": a_doc["id"], "pages": "1"})["documents"][0]
    assert user_b.client.get(made["download_url"], headers=user_b.h).status_code == 404
    assert user.client.get(made["download_url"], headers=user.h).status_code == 200


# ---------------------------------------------------------------- auto-discovery
def test_new_tool_is_added_by_dropping_one_file(tmp_path):
    from mcp.server.fastmcp import FastMCP
    from rooman_pdf_mcp.loader import TOOLS_DIR, ToolLoadError, load_tools

    real = FastMCP("t")
    loaded = load_tools(real, TOOLS_DIR)
    assert "merge_pdfs" in loaded and "get_document_info" in loaded
    names_before = {t.name for t in asyncio.run(real.list_tools())}
    assert EXPECTED_TOOLS <= names_before

    (tmp_path / "hello_tool.py").write_text(textwrap.dedent('''
        def register(mcp):
            @mcp.tool(name="say_hello")
            def say_hello(name: str) -> str:
                return "hello " + name
    '''))
    (tmp_path / "_helper.py").write_text("raise RuntimeError('files starting with _ must be skipped')")
    m = FastMCP("t2")
    assert load_tools(m, tmp_path) == ["hello_tool"]
    assert [t.name for t in asyncio.run(m.list_tools())] == ["say_hello"]

    (tmp_path / "broken.py").write_text("X = 1\n")
    with pytest.raises(ToolLoadError):
        load_tools(FastMCP("t3"), tmp_path)


# ---------------------------------------------------------------- startup rules (real process)
def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _env(**over):
    env = {**os.environ, **over}
    env.pop("PYTHONPATH", None)
    return env


@pytest.mark.parametrize("secret", ["", "too-short"])
def test_server_process_refuses_to_start_without_strong_secret(secret):
    p = subprocess.run([sys.executable, "-m", "rooman_pdf_mcp"], cwd=REPO / "mcp-server", capture_output=True, text=True,
                       timeout=60, env=_env(MCP_SHARED_SECRET=secret))
    assert p.returncode != 0 and "MCP_SHARED_SECRET" in (p.stderr + p.stdout)


def test_server_process_starts_and_serves_over_http(user):
    port = _free_port()
    proc = subprocess.Popen([sys.executable, "-m", "rooman_pdf_mcp"], cwd=REPO / "mcp-server",
                            env=_env(MCP_PORT=str(port), MCP_HOST="127.0.0.1"), stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    try:
        deadline = time.time() + 40
        while time.time() < deadline:
            with socket.socket() as s:
                if s.connect_ex(("127.0.0.1", port)) == 0:
                    break
            assert proc.poll() is None, proc.stdout.read().decode()
            time.sleep(0.2)
        d = user.fx("multipage.pdf")  # subprocess shares STORAGE_DIR (env) -> same documents + users
        err, data, text = call(f"http://127.0.0.1:{port}/mcp", user, "get_document_info", {"document_id": d["id"]})
        assert not err, text
        assert data["data"]["pages"] == d["pages"]
    finally:
        proc.terminate()
        proc.wait(timeout=15)
