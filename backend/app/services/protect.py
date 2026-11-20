"""Password protect / unlock with pikepdf."""
from __future__ import annotations

from pathlib import Path

import pikepdf

from ..core.errors import AppError, bad_request, unprocessable
from .pdf_ops import open_pdf


def protect(src: Path, out: Path, user_password: str, owner_password: str | None = None, *,
            allow_print: bool = True, allow_copy: bool = True, allow_modify: bool = False) -> None:
    if not user_password:
        raise bad_request("PASSWORD_EMPTY", "Password cannot be empty")
    already = unprocessable("ALREADY_ENCRYPTED", "This PDF is already password protected")
    try:
        with open_pdf(src) as pdf:
            if pdf.is_encrypted:
                raise already
            perms = pikepdf.Permissions(
                print_lowres=allow_print, print_highres=allow_print, extract=allow_copy,
                accessibility=True, modify_annotation=allow_modify, modify_assembly=allow_modify,
                modify_form=allow_modify, modify_other=allow_modify,
            )
            pdf.save(out, encryption=pikepdf.Encryption(
                user=user_password, owner=owner_password or (user_password + ":owner"), R=6, allow=perms))
    except AppError as e:
        if e.code == "PASSWORD_REQUIRED":  # opened without a password and refused -> already protected
            raise already from None
        raise


def unlock(src: Path, out: Path, password: str) -> bool:
    """Remove password protection. Returns False if the file was not encrypted."""
    with open_pdf(src, password=password) as pdf:
        was = pdf.is_encrypted
        pdf.save(out, encryption=False)
        return was
