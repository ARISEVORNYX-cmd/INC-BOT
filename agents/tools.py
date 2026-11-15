"""Tool registry + safe built-ins for the agent team.

Design rules:
- Read-only tools are free to run.
- Every write / send / dispatch tool is `risky=True` and goes through ApprovalGate.
- `write_artifact` is non-risky because it can ONLY write inside the ignored run dir.
- All paths are resolved and checked against the repo root (no `..`, no `.env`, no `.git`).
"""
from __future__ import annotations

import difflib
import json
import os
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from .models import RunContext, ToolResult, small


@dataclass
class Tool:
    name: str
    description: str
    risky: bool
    handler: Callable[[dict[str, Any], RunContext], str]


_DENY_PARTS = {".git", ".env", "__pycache__", ".venv", "node_modules", ".cache", ".local", ".mypy_cache", ".pytest_cache"}
_DENY_NAMES = {".netrc", "credentials", "id_rsa", "id_ed25519", ".git-credentials"}
_BINARY_SUFFIXES = {".pyc", ".so", ".dll", ".exe", ".bin", ".jpg", ".jpeg", ".png", ".gif", ".webp", ".mp3", ".mp4", ".zip", ".gz"}


def _root(ctx: RunContext) -> Path:
    return ctx.root.resolve()


def _is_under(path: Path, root: Path) -> bool:
    try:
        return path.resolve().is_relative_to(root)
    except Exception:
        return False


def _assert_safe(path: Path, root: Path) -> Path:
    resolved = path.resolve()
    if not _is_under(resolved, root):
        raise PermissionError("blocked: path is outside the repo root")
    rel = resolved.relative_to(root)
    if any(part in _DENY_PARTS for part in rel.parts):
        raise PermissionError("blocked: protected directory")
    if resolved.name in _DENY_NAMES or resolved.name.startswith(".env"):
        raise PermissionError("blocked: secret/credential file")
    if resolved.suffix.lower() in _BINARY_SUFFIXES:
        raise PermissionError("blocked: binary file")
    return resolved


def _resolve_read(raw: str, ctx: RunContext) -> Path:
    root = _root(ctx)
    p = Path(str(raw or ""))
    candidates = [p] if p.is_absolute() else [root / p, ctx.run_dir / p]
    first_error: PermissionError | None = None
    for candidate in candidates:
        try:
            safe = _assert_safe(candidate, root)
        except PermissionError as exc:
            if first_error is None:
                first_error = exc
            continue
        if safe.exists() and safe.is_file():
            return safe
    raise first_error or PermissionError("blocked: file not found or not readable")


def _resolve_write(raw: str, ctx: RunContext) -> Path:
    root = _root(ctx)
    p = Path(str(raw or ""))
    target = p if p.is_absolute() else root / p
    resolved = _assert_safe(target, root)
    rel = resolved.relative_to(root)
    if rel.parts[:2] == ("agents", "runs"):
        raise PermissionError("blocked: run state is immutable; use write_artifact")
    if ".." in p.parts:
        raise PermissionError("blocked: path traversal")
    return resolved


def _sanitize(value: Any, depth: int = 0) -> Any:
    if depth > 4:
        return str(value)[:200]
    if isinstance(value, str):
        return value[:20000]
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    if isinstance(value, list):
        return [_sanitize(v, depth + 1) for v in value[:50]]
    if isinstance(value, dict):
        return {str(k)[:100]: _sanitize(v, depth + 1) for k, v in list(value.items())[:50]}
    return str(value)[:2000]


class ApprovalGate:
    @staticmethod
    def check(name: str, args: dict[str, Any], ctx: RunContext) -> bool:
        mode = (ctx.approval_mode or "deny").lower()
        if mode == "auto":
            return True
        if mode == "deny":
            return False
        if mode == "interactive":
            if not sys.stdin.isatty():
                return False
            preview = json.dumps(small(args, 300), ensure_ascii=False)[:500]
            try:
                print(f"\n🤖 Agent wants risky tool `{name}` with {preview}\nApprove? [y/N] ", file=sys.stderr, end="", flush=True)
                answer = input().strip().lower()
            except (EOFError, OSError):
                return False
            return answer in {"y", "yes"}
        return False


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, Tool] = {}

    def register(self, tool: Tool) -> None:
        self._tools[tool.name] = tool

    def describe(self) -> list[dict[str, Any]]:
        return [
            {"name": t.name, "description": t.description, "risky": t.risky}
            for t in self._tools.values()
        ]

    def call(self, name: str, args: dict[str, Any], ctx: RunContext) -> ToolResult:
        clean_args = _sanitize(dict(args or {}))
        tool = self._tools.get(str(name))
        if tool is None:
            return ToolResult(str(name), False, f"unknown tool: {name}", False, clean_args)
        if ctx.dry_run:
            return ToolResult(name, True, f"dry-run: `{name}` not executed", False, clean_args)
        if tool.risky and not ApprovalGate.check(name, clean_args, ctx):
            return ToolResult(
                name,
                False,
                f"approval required/denied for risky tool `{name}` (mode={ctx.approval_mode})",
                True,
                clean_args,
            )
        try:
            output = str(tool.handler(clean_args, ctx))[:4000]
            return ToolResult(name, True, output, False, clean_args)
        except Exception as exc:
            return ToolResult(name, False, f"error: {type(exc).__name__}: {exc}", False, clean_args)


# ---------------- built-in handlers ----------------

def _h_list_files(args: dict[str, Any], ctx: RunContext) -> str:
    root = _root(ctx)
    pattern = str(args.get("pattern") or "*")
    if pattern.startswith("/") or ".." in Path(pattern).parts:
        raise PermissionError("blocked: absolute/traversal pattern")
    found: list[str] = []
    for p in root.glob(pattern):
        try:
            if not p.is_file():
                continue
            rel = p.resolve().relative_to(root)
            if rel.parts[:2] == ("agents", "runs"):
                continue
            _assert_safe(p, root)
            found.append(rel.as_posix())
        except Exception:
            continue
        if len(found) >= 200:
            break
    return "\n".join(sorted(found)) or "(no matching files)"


def _h_read_file(args: dict[str, Any], ctx: RunContext) -> str:
    path = _resolve_read(args.get("path", ""), ctx)
    limit = max(200, min(int(args.get("max_chars") or 4000), 20000))
    text = path.read_text(encoding="utf-8", errors="replace")
    return text[:limit]


def _artifact_path(name: str, ctx: RunContext) -> Path:
    p = Path(str(name or "artifact.txt"))
    if p.is_absolute() or ".." in p.parts:
        raise PermissionError("blocked: bad artifact name")
    base = (ctx.run_dir / "artifacts").resolve()
    target = (base / p).resolve()
    if not target.is_relative_to(base):
        raise PermissionError("blocked: artifact escape")
    return target


def _h_write_artifact(args: dict[str, Any], ctx: RunContext) -> str:
    target = _artifact_path(args.get("name", "artifact.txt"), ctx)
    target.parent.mkdir(parents=True, exist_ok=True)
    content = str(args.get("content") or "")[:20000]
    target.write_text(content, encoding="utf-8")
    try:
        rel = target.relative_to(_root(ctx)).as_posix()
    except Exception:
        rel = target.as_posix()
    return f"wrote {rel} ({len(content)} chars)"


def _h_write_file(args: dict[str, Any], ctx: RunContext) -> str:
    target = _resolve_write(args.get("path", ""), ctx)
    root = _root(ctx)
    rel = target.relative_to(root)
    content = str(args.get("content") or "")[:20000]
    old = ""
    if target.exists():
        old = target.read_text(encoding="utf-8", errors="replace")
    stamp = rel.as_posix().replace("/", "__")
    backup = ctx.run_dir / "artifacts" / "backups" / f"{stamp}.bak"
    diff_path = ctx.run_dir / "artifacts" / "diffs" / f"{stamp}.diff"
    backup.parent.mkdir(parents=True, exist_ok=True)
    diff_path.parent.mkdir(parents=True, exist_ok=True)
    backup.write_text(old, encoding="utf-8")
    diff = "".join(
        difflib.unified_diff(
            old.splitlines(True),
            content.splitlines(True),
            fromfile=f"a/{rel.as_posix()}",
            tofile=f"b/{rel.as_posix()}",
        )
    )
    diff_path.write_text(diff or "(no textual diff)", encoding="utf-8")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    return f"updated {rel.as_posix()} | backup={backup.name} | diff={diff_path.name}"


def _h_git_status(args: dict[str, Any], ctx: RunContext) -> str:
    out = subprocess.run(
        ["git", "status", "--short"],
        cwd=str(_root(ctx)),
        capture_output=True,
        text=True,
        timeout=15,
    )
    return (out.stdout or out.stderr or "").strip() or "(clean working tree)"


def _h_gh_runs(args: dict[str, Any], ctx: RunContext) -> str:
    if not shutil.which("gh"):
        return "gh CLI not installed; skipped CI status"
    limit = max(1, min(int(args.get("limit") or 5), 15))
    out = subprocess.run(
        ["gh", "run", "list", "--limit", str(limit), "--json", "displayTitle,event,headBranch,conclusion,createdAt"],
        cwd=str(_root(ctx)),
        capture_output=True,
        text=True,
        timeout=20,
    )
    if out.returncode != 0:
        return f"gh run list failed: {(out.stderr or '').strip()[:300]}"
    return (out.stdout or "").strip()[:3500]


def _h_py_compile(args: dict[str, Any], ctx: RunContext) -> str:
    paths = list(args.get("paths") or [])[:20]
    resolved: list[str] = []
    for raw in paths:
        resolved.append(str(_resolve_read(raw, ctx)))
    if not resolved:
        resolved = [str(_resolve_read("agents/models.py", ctx))]
    out = subprocess.run(
        [sys.executable, "-m", "py_compile", *resolved],
        cwd=str(_root(ctx)),
        capture_output=True,
        text=True,
        timeout=30,
    )
    tail = ((out.stdout or "") + (out.stderr or "")).strip()
    return f"py_compile rc={out.returncode}: {tail[:800] or 'ok'}"


def _h_send_discord(args: dict[str, Any], ctx: RunContext) -> str:
    webhook = os.environ.get("DISCORD_WEBHOOK", "").strip()
    message = str(args.get("message") or "")[:1900]
    if not webhook:
        return "DISCORD_WEBHOOK not set; nothing sent (wire the adapter or set the secret)"
    body = json.dumps({"content": message}).encode("utf-8")
    req = urllib.request.Request(
        webhook,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            return f"discord webhook HTTP {resp.status}"
    except urllib.error.HTTPError as exc:
        return f"discord webhook HTTP {exc.code}: {exc.read().decode('utf-8', 'replace')[:200]}"


def _h_connector_call(args: dict[str, Any], ctx: RunContext) -> str:
    connector = str(args.get("connector") or "?")
    tool = str(args.get("tool") or "?")
    return (
        f"connector `{connector}.{tool}` is not wired in this standalone runtime. "
        "Register a real adapter with ToolRegistry.register(), or call it from the Arena agent "
        "where Gmail/Drive/Sheets/Supabase/Vercel connectors are available."
    )


def build_registry() -> ToolRegistry:
    reg = ToolRegistry()
    reg.register(Tool("list_files", "List repo files by glob (read-only)", False, _h_list_files))
    reg.register(Tool("read_file", "Read a text file inside the repo (read-only)", False, _h_read_file))
    reg.register(Tool("write_artifact", "Write a draft into this run's ignored artifacts/ folder", False, _h_write_artifact))
    reg.register(Tool("write_file", "Edit a repo file; makes a backup + diff. Needs approval.", True, _h_write_file))
    reg.register(Tool("git_status", "Run read-only `git status --short`", False, _h_git_status))
    reg.register(Tool("gh_runs", "Read recent GitHub Actions runs via gh CLI", False, _h_gh_runs))
    reg.register(Tool("py_compile", "Syntax-check Python files with py_compile", False, _h_py_compile))
    reg.register(Tool("send_discord", "Post a message to DISCORD_WEBHOOK. Needs approval.", True, _h_send_discord))
    reg.register(Tool("connector_call", "Placeholder for Gmail/Drive/Sheets/Supabase/Vercel adapters. Needs approval.", True, _h_connector_call))
    return reg
