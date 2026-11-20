"""The service-layer `Ops` API (what the MCP server calls) — used directly, without HTTP."""
import pytest

from app.core.errors import AppError
from app.services.operations import Ops
from conftest import FIXTURES, User


@pytest.fixture
def ops(client, store):
    u = User(client)
    return Ops(store, u.id), u


def _add(store, user_id, name):
    p = FIXTURES / name
    return store.add_bytes(user_id, p.read_bytes(), name, p.suffix[1:])


def test_ops_chain_extract_then_rotate(ops, store):
    o, u = ops
    d = _add(store, u.id, "multipage.pdf")
    step1 = o.extract_pages(d.id, "1-3")
    step2 = o.rotate(step1.documents[0].id, 90)
    assert step2.documents[0].pages == 3
    assert o.extract_text(step2.documents[0].id).startswith("Chapter 1 heading")


def test_ops_search_and_text(ops, store):
    o, u = ops
    d = _add(store, u.id, "multipage.pdf")
    hits = o.search(d.id, "chapter 7")
    assert hits and all(h["page"] == 7 for h in hits[:1]) and "chapter 7" in hits[0]["snippet"].lower()
    assert o.search(d.id, "no-such-text-xyz") == []
    assert "CH12X" in o.extract_text(d.id, "12")


def test_ops_enforces_ownership(ops, store, client):
    o, u = ops
    other = User(client)
    foreign = _add(store, other.id, "table.pdf")
    for call in (lambda: o.extract_text(foreign.id), lambda: o.merge([foreign.id, foreign.id]),
                 lambda: o.get_metadata(foreign.id), lambda: o.compress(foreign.id, "low")):
        with pytest.raises(AppError) as e:
            call()
        assert e.value.status == 404


def test_ops_rejects_path_like_ids(ops):
    o, _ = ops
    for bad in ["../../etc/passwd", "/etc/passwd", "a" * 31, "", "G" * 32]:
        with pytest.raises(AppError) as e:
            o.extract_text(bad)
        assert e.value.status == 404


def test_ops_tables(ops, store):
    o, u = ops
    d = _add(store, u.id, "table.pdf")
    t = o.extract_tables(d.id)
    assert t[0]["rows"][0][0] == "Item" and len(t[0]["rows"]) == 6
