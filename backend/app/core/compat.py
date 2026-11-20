"""Small compatibility shims, so the backend also runs on Python 3.10."""
from __future__ import annotations

try:  # built in from Python 3.11
    BaseExceptionGroup = BaseExceptionGroup  # type: ignore[name-defined]  # noqa: F821
except NameError:  # Python 3.10: the backport that anyio already depends on
    from exceptiongroup import BaseExceptionGroup  # type: ignore[no-redef]

__all__ = ["BaseExceptionGroup"]
