"""FastAPI dependencies."""
from __future__ import annotations

from functools import lru_cache
from typing import Annotated

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from ..services.operations import Ops
from ..services.storage import DocumentStore, User
from .config import Settings, get_settings
from .errors import AppError
from .security import decode_access_token

_bearer = HTTPBearer(auto_error=False)


@lru_cache
def _store_for(storage_dir: str, ttl_seconds: int) -> DocumentStore:
    return DocumentStore(storage_dir, ttl_seconds)  # type: ignore[arg-type]


def get_store() -> DocumentStore:
    s = get_settings()
    return _store_for(str(s.storage_dir), s.file_ttl_minutes * 60)


def reset_store_cache() -> None:
    _store_for.cache_clear()


SettingsDep = Annotated[Settings, Depends(get_settings)]
StoreDep = Annotated[DocumentStore, Depends(get_store)]


def get_current_user(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)], settings: SettingsDep, store: StoreDep
) -> User:
    if creds is None:
        raise AppError(401, "NOT_AUTHENTICATED", "Sign in to continue")
    uid = decode_access_token(creds.credentials, settings)
    user = store.get_user(uid) if uid else None
    if user is None:
        raise AppError(401, "INVALID_TOKEN", "Your session has expired. Please sign in again")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def get_ops(user: CurrentUser, store: StoreDep) -> Ops:
    return Ops(store, user.id)


OpsDep = Annotated[Ops, Depends(get_ops)]
