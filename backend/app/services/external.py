"""Detection and safe execution of external programs (Ghostscript, LibreOffice, Tesseract).

Programs are always run with argument lists (never a shell), with a timeout.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

from ..core.config import get_settings
from ..core.errors import AppError

_INSTALL_HINTS = {
    "gs": "Ghostscript — Windows: `winget install ArtifexSoftware.GhostScript`; macOS: `brew install ghostscript`; Debian/Ubuntu: `apt install ghostscript`",
    "soffice": "LibreOffice — Windows: `winget install TheDocumentFoundation.LibreOffice`; macOS: `brew install --cask libreoffice`; Debian/Ubuntu: `apt install libreoffice`",
    "chromium": "Chromium (or Chrome / Edge) - Windows: Edge or Chrome are usually installed already; macOS: `brew install --cask chromium`; Debian/Ubuntu: `apt install chromium`",
    "tesseract": "Tesseract OCR — Windows: `winget install UB-Mannheim.TesseractOCR`; macOS: `brew install tesseract`; Debian/Ubuntu: `apt install tesseract-ocr`",
}
_LABELS = {"gs": "Ghostscript", "soffice": "LibreOffice", "chromium": "Chromium", "tesseract": "Tesseract"}

_MAC_SOFFICE = "/Applications/LibreOffice.app/Contents/MacOS/soffice"
_EXTRA_PATH = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"]


def _configured(name: str) -> str:
    s = get_settings()
    return {"gs": s.gs_path, "soffice": s.soffice_path, "chromium": s.chromium_path, "tesseract": s.tesseract_path}[name]


# Windows: the programs have other file names and are not on PATH after a normal install
_WIN_NAMES = {"gs": ["gswin64c", "gswin32c", "gs"], "soffice": ["soffice"], "chromium": ["chrome", "msedge"], "tesseract": ["tesseract"]}
_WIN_DIRS = {"gs": ["gs/*/bin"], "soffice": ["LibreOffice/program"], "chromium": ["Google/Chrome/Application", "Microsoft/Edge/Application"], "tesseract": ["Tesseract-OCR"]}


def _find_windows(name: str) -> str | None:
    for n in _WIN_NAMES[name]:
        if found := shutil.which(n):
            return found
    roots = [os.environ.get(v) for v in ("ProgramFiles", "ProgramFiles(x86)", "ProgramW6432")]
    local = os.environ.get("LOCALAPPDATA")
    if local:
        roots.append(str(Path(local) / "Programs"))
    for root in dict.fromkeys(r for r in roots if r):
        for pattern in _WIN_DIRS[name]:
            # newest version first (gs10.01.2 before gs9.55.0)
            for d in sorted(Path(root).glob(pattern), reverse=True):
                for n in _WIN_NAMES[name]:
                    exe = d / f"{n}.exe"
                    if exe.is_file():
                        return str(exe)
    return None


def find_tool(name: str) -> str | None:
    if name not in _INSTALL_HINTS:
        raise ValueError(name)
    explicit = _configured(name)
    if explicit:
        return explicit if os.access(explicit, os.X_OK) else None
    if sys.platform == "win32":
        return _find_windows(name)
    found = shutil.which(name) or shutil.which(name, path=os.pathsep.join(_EXTRA_PATH))
    if not found and name == "soffice":
        found = shutil.which("libreoffice") or (_MAC_SOFFICE if os.access(_MAC_SOFFICE, os.X_OK) else None)
    if not found and name == "chromium":
        for alt in ("chromium-browser", "google-chrome", "google-chrome-stable", "chrome"):
            found = shutil.which(alt) or shutil.which(alt, path=os.pathsep.join(_EXTRA_PATH))
            if found:
                break
    return found


class ExternalToolMissing(AppError):
    def __init__(self, name: str):
        super().__init__(
            503,
            "EXTERNAL_TOOL_MISSING",
            f"{_LABELS[name]} is not installed on the server, so this tool is unavailable. "
            f"Install it: {_INSTALL_HINTS[name]}",
            {"tool": name},
        )


def require_tool(name: str) -> str:
    path = find_tool(name)
    if not path:
        raise ExternalToolMissing(name)
    return path


def capabilities() -> dict[str, dict]:
    out: dict[str, dict] = {}
    for name in _INSTALL_HINTS:
        path = find_tool(name)
        out[name] = {"label": _LABELS[name], "available": bool(path), "install": _INSTALL_HINTS[name]}
    return out


def tool_env(extra: dict[str, str] | None = None) -> dict[str, str]:
    """Minimal environment for children; PATH includes the dirs of the detected tools."""
    dirs = [str(Path(p).parent) for n in _INSTALL_HINTS if (p := find_tool(n))]
    path = os.pathsep.join(dict.fromkeys(dirs + os.environ.get("PATH", "").split(os.pathsep) + _EXTRA_PATH))
    env = {"PATH": path, "HOME": os.environ.get("HOME", tempfile.gettempdir()), "LANG": "en_US.UTF-8"}
    if "TMPDIR" in os.environ:
        env["TMPDIR"] = os.environ["TMPDIR"]
    if sys.platform == "win32":
        # Windows programs need these to start at all (system DLLs, temp files); nothing else of the server's environment is passed on
        for k in ("SystemRoot", "SystemDrive", "windir", "ComSpec", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "ProgramData", "ProgramFiles", "ProgramFiles(x86)"):
            if k in os.environ:
                env[k] = os.environ[k]
    env.update(extra or {})
    return env


def run(args: list[str], *, timeout: int | None = None, cwd: Path | None = None,
        env: dict[str, str] | None = None, label: str = "external program") -> subprocess.CompletedProcess:
    """Run an external program. `args` MUST be a list; never a shell string."""
    if not isinstance(args, list) or not all(isinstance(a, str) for a in args):
        raise TypeError("args must be list[str]")
    timeout = timeout or get_settings().external_timeout_seconds
    try:
        return subprocess.run(
            args, capture_output=True, timeout=timeout, cwd=cwd, env=env or tool_env(),
            check=False, shell=False, stdin=subprocess.DEVNULL,
        )
    except subprocess.TimeoutExpired:
        raise AppError(504, "EXTERNAL_TOOL_TIMEOUT", f"{label} timed out after {timeout}s", {"tool": label}) from None
    except OSError as e:
        raise AppError(502, "EXTERNAL_TOOL_FAILED", f"{label} could not be started: {e.strerror}") from None


def fail(label: str, proc: subprocess.CompletedProcess, status: int = 500) -> AppError:
    tail = (proc.stderr or proc.stdout or b"").decode("utf-8", "replace").strip().splitlines()[-3:]
    return AppError(status, "EXTERNAL_TOOL_FAILED", f"{label} failed (exit {proc.returncode}): " + " | ".join(tail))


def python_module_args(module: str, *args: str) -> list[str]:
    return [sys.executable, "-m", module, *args]
