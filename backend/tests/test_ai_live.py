"""LIVE smoke test against the real model endpoint. Runs ONLY when a real key is available:
  * ROOMAN_LIVE_AI_KEY in the environment, or
  * AI_API_KEY=... in the repo-root .env (the test suite itself blanks AI_API_KEY in the process environment).
Otherwise it is skipped with an explicit reason, and the real model call is reported as UNTESTED."""
from __future__ import annotations

import os
import re

import pytest

from ai_fixtures import parse_sse
from conftest import REPO


def _real(name: str) -> str:
    if name == "AI_API_KEY" and os.environ.get("ROOMAN_LIVE_AI_KEY"):
        return os.environ["ROOMAN_LIVE_AI_KEY"]
    env = REPO / ".env"
    if env.exists():
        m = re.search(rf"^{name}=(.*)$", env.read_text(), re.M)
        if m and m.group(1).strip():
            return m.group(1).strip().strip("\"'")
    return ""


KEY = _real("AI_API_KEY")
pytestmark = [pytest.mark.live, pytest.mark.skipif(not KEY, reason="UNTESTED: no real AI_API_KEY (set it in .env or ROOMAN_LIVE_AI_KEY) - the real model call was not exercised")]


def test_live_ask_with_citation(user, monkeypatch):
    from app.core.config import get_settings
    s = get_settings()
    monkeypatch.setattr(s, "ai_api_key", KEY)
    monkeypatch.setattr(s, "ai_endpoint", _real("AI_ENDPOINT") or "https://api.groq.com/openai/v1")
    monkeypatch.setattr(s, "ai_model", _real("AI_MODEL") or s.ai_model)
    d = user.fx("multipage.pdf")
    r = user.client.post("/api/ai/ask", headers=user.h, json={"document_ids": [d["id"]], "question": "What is the marker string in chapter 7? Cite the page."})
    assert r.status_code == 200, r.text
    evs = parse_sse(r.text)
    assert evs[-1][0] == "done", evs[-1]
    assert "CH07X" in "".join(d["text"] for n, d in evs if n == "token")
