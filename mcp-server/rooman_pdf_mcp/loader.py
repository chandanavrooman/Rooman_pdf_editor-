"""Auto-discovery: every `*.py` file in the tools directory (not starting with `_`) must expose `register(mcp)`.

Adding a tool = adding one file to mcp-server/tools/. Nothing else needs editing.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

from mcp.server.fastmcp import FastMCP

TOOLS_DIR = Path(__file__).resolve().parents[1] / "tools"


class ToolLoadError(RuntimeError):
    pass


def load_tools(mcp: FastMCP, tools_dir: Path | str = TOOLS_DIR) -> list[str]:
    """Import and register every tool module; returns the module names loaded."""
    tools_dir = Path(tools_dir)
    loaded: list[str] = []
    for path in sorted(tools_dir.glob("*.py")):
        if path.name.startswith("_"):
            continue
        mod_name = f"rooman_pdf_mcp_tools.{path.stem}"
        spec = importlib.util.spec_from_file_location(mod_name, path)
        if spec is None or spec.loader is None:
            raise ToolLoadError(f"cannot load {path}")
        module = importlib.util.module_from_spec(spec)
        sys.modules[mod_name] = module
        spec.loader.exec_module(module)
        register = getattr(module, "register", None)
        if not callable(register):
            raise ToolLoadError(f"{path.name} must define register(mcp)")
        register(mcp)
        loaded.append(path.stem)
    return loaded
