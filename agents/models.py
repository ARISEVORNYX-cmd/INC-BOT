"""Shared data models for the Level-3 agent team.

Pure stdlib, no framework lock-in. Everything is JSON-serialisable so a run can
be paused, inspected, resumed, or shipped to Discord / GitHub Actions.
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


VALID_STATUSES = {"pending", "running", "done", "failed", "needs_approval", "blocked"}


@dataclass
class Task:
    id: str
    title: str
    role: str
    depends_on: list[str] = field(default_factory=list)
    input: dict[str, Any] = field(default_factory=dict)
    status: str = "pending"
    attempts: int = 0
    summary: str = ""
    verdict: str = ""
    issues: list[str] = field(default_factory=list)
    artifacts: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Task":
        return cls(
            id=str(d.get("id") or "task"),
            title=str(d.get("title") or ""),
            role=str(d.get("role") or "researcher"),
            depends_on=list(d.get("depends_on") or []),
            input=dict(d.get("input") or {}),
            status=str(d.get("status") or "pending"),
            attempts=int(d.get("attempts") or 0),
            summary=str(d.get("summary") or ""),
            verdict=str(d.get("verdict") or ""),
            issues=list(d.get("issues") or []),
            artifacts=dict(d.get("artifacts") or {}),
        )


@dataclass
class ToolResult:
    name: str
    ok: bool
    output: str
    needs_approval: bool = False
    args: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class AgentResult:
    task_id: str
    role: str
    ok: bool
    summary: str
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    verdict: str = ""
    issues: list[str] = field(default_factory=list)
    artifacts: dict[str, Any] = field(default_factory=dict)
    needs_approval: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class RunState:
    run_id: str
    goal: str
    created_at: str
    run_dir: str = ""
    status: str = "running"
    tasks: list[Task] = field(default_factory=list)
    timeline: list[dict[str, Any]] = field(default_factory=list)
    memory: dict[str, Any] = field(default_factory=dict)
    final: str = ""
    model: str = "offline"
    approval_mode: str = "deny"
    dry_run: bool = False

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "RunState":
        return cls(
            run_id=str(d.get("run_id") or "run"),
            goal=str(d.get("goal") or ""),
            created_at=str(d.get("created_at") or ""),
            run_dir=str(d.get("run_dir") or ""),
            status=str(d.get("status") or "running"),
            tasks=[Task.from_dict(t) for t in (d.get("tasks") or [])],
            timeline=list(d.get("timeline") or []),
            memory=dict(d.get("memory") or {}),
            final=str(d.get("final") or ""),
            model=str(d.get("model") or "offline"),
            approval_mode=str(d.get("approval_mode") or "deny"),
            dry_run=bool(d.get("dry_run") or False),
        )

    @property
    def pending_approvals(self) -> list[dict[str, Any]]:
        """Only approvals that are STILL blocking a task (resume clears them)."""
        blocked = {t.id for t in self.tasks if t.status == "needs_approval"}
        return [
            e for e in self.timeline
            if e.get("needs_approval") and e.get("task_id") in blocked
        ]


@dataclass
class TeamConfig:
    root: Path = field(default_factory=lambda: Path(__file__).resolve().parent.parent)
    run_root: Path | None = None
    model: str | None = None
    offline: bool = False
    dry_run: bool = False
    approval_mode: str = "deny"  # deny | auto | interactive
    max_cycles: int = 3          # max review/retry cycles
    parallel: bool = False
    max_tasks: int = 6

    def resolved_run_root(self) -> Path:
        return (self.run_root or self.root / "agents" / "runs").resolve()

    def resolved_root(self) -> Path:
        return self.root.resolve()


@dataclass
class RunContext:
    root: Path
    run_dir: Path
    llm: Any
    registry: Any
    approval_mode: str
    dry_run: bool
    max_cycles: int
    lock: Any


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def log_event(state: RunState, ctx: RunContext, event: str, **fields: Any) -> None:
    """Thread-safe, size-capped append-only timeline."""
    entry: dict[str, Any] = {"ts": utc_now(), "event": event}
    for key, value in fields.items():
        if isinstance(value, (str, int, float, bool, list, dict)) or value is None:
            entry[key] = value
        else:
            entry[key] = str(value)
    with ctx.lock:
        state.timeline.append(entry)
        if len(state.timeline) > 300:
            del state.timeline[:-300]


def small(value: Any, limit: int = 2000) -> Any:
    """Keep untrusted LLM/tool output from bloating state.json."""
    if isinstance(value, str):
        return value[:limit]
    if isinstance(value, list):
        return [small(v, limit) for v in value[:20]]
    if isinstance(value, dict):
        return {str(k)[:80]: small(v, limit) for k, v in list(value.items())[:30]}
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    return str(value)[:limit]


def dump_json(obj: Any, **kwargs: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=2, **kwargs)
