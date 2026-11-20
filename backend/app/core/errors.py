"""Application errors. All error responses look like {"detail": str, "code": str}."""
from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class AppError(Exception):
    def __init__(self, status: int, code: str, message: str, extra: dict | None = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.extra = extra or {}


def bad_request(code: str, message: str) -> AppError:
    return AppError(400, code, message)


def unprocessable(code: str, message: str) -> AppError:
    return AppError(422, code, message)


def not_found(message: str = "Document not found") -> AppError:
    return AppError(404, "NOT_FOUND", message)


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError):
        body = {"detail": exc.message, "code": exc.code, **exc.extra}
        return JSONResponse(status_code=exc.status, content=body)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError):
        errors = [
            {"loc": [str(p) for p in e.get("loc", ())], "msg": e.get("msg", "")} for e in exc.errors()
        ]
        first = errors[0]["msg"] if errors else "Invalid request"
        return JSONResponse(
            status_code=422,
            content={"detail": f"Invalid request: {first}", "code": "VALIDATION_ERROR", "errors": errors},
        )
