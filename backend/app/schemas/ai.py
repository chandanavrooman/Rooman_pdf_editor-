"""Request bodies for the AI endpoints (strict)."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

DocId = str
LANG = r"^[A-Za-z][A-Za-z \-()]{1,59}$"  # a language NAME only (it is placed into prompts)
PAGES = Field(None, max_length=500, pattern=r"^[0-9,\-\s]+$", description="e.g. 1-3,5")


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ChatMessage(Strict):
    role: Literal["user", "assistant"]  # clients can never inject system/tool messages
    content: str = Field(min_length=1, max_length=20000)


class ConfirmAction(Strict):
    action_id: str = Field(min_length=8, max_length=100)
    approve: bool


class ChatRequest(Strict):
    messages: list[ChatMessage] | None = Field(None, min_length=1, max_length=40,
                                               description="Conversation so far; the last message must be from the user")
    document_ids: list[DocId] = Field(default_factory=list, max_length=5, description="Attached documents (ids you own)")
    use_tools: bool = Field(True, description="Let the assistant run PDF tools (merge, split, compress, …) through MCP")
    confirm: ConfirmAction | None = Field(None, description="Answer to a `confirmation_required` event (instead of messages)")

    @model_validator(mode="after")
    def _one_of(self):
        if (self.messages is None) == (self.confirm is None):
            raise ValueError("send either `messages` or `confirm`")
        if self.messages and self.messages[-1].role != "user":
            raise ValueError("the last message must be from the user")
        return self


class AskRequest(Strict):
    document_ids: list[DocId] = Field(min_length=1, max_length=5)
    question: str = Field(min_length=1, max_length=4000)
    history: list[ChatMessage] = Field(default_factory=list, max_length=20)
    stream: bool = True


class SummarizeRequest(Strict):
    document_id: DocId
    length: Literal["short", "medium", "long"] = "medium"
    pages: str | None = PAGES
    language: str | None = Field(None, pattern=LANG)
    stream: bool = True


class ExplainRequest(Strict):
    document_id: DocId
    page: int | None = Field(None, ge=1)
    selection: str | None = Field(None, min_length=1, max_length=6000)
    question: str | None = Field(None, min_length=1, max_length=1000)
    language: str | None = Field(None, pattern=LANG)
    stream: bool = True

    @model_validator(mode="after")
    def _need(self):
        if self.page is None and not self.selection:
            raise ValueError("give a page number and/or a selected passage")
        return self


class QuestionsRequest(Strict):
    document_id: DocId
    kind: Literal["mcq", "short", "long", "truefalse", "mixed"] = "mcq"
    count: int = Field(10, ge=1, le=50)
    difficulty: Literal["easy", "medium", "hard"] = "medium"
    with_answers: bool = True
    pages: str | None = PAGES
    language: str | None = Field(None, pattern=LANG)
    create_document: Literal["none", "docx", "txt"] = "none"
    stream: bool = True


class TranslateRequest(Strict):
    document_id: DocId
    target_language: str = Field(pattern=LANG)
    pages: str | None = PAGES
    create_document: Literal["none", "docx", "txt"] = "none"
    stream: bool = True


class CompareRequest(Strict):
    document_id_a: DocId
    document_id_b: DocId
    narrative: bool = Field(True, description="Also stream an AI explanation of the differences (needs AI_API_KEY)")
    stream: bool = True


class AiTablesRequest(Strict):
    document_id: DocId
    pages: str | None = PAGES
    clean_with_ai: bool = Field(False, description="Ask the model to repair merged/split cells (needs AI_API_KEY)")
