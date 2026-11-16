"""Specialist agents. One narrow role, one system prompt, one tool allowlist.

The Lead/Orchestrator lives in orchestrator.py; these are the teammates.
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from typing import Any

from .llm import parse_json
from .models import AgentResult, RunContext, RunState, Task, ToolResult, log_event, small


@dataclass(frozen=True)
class RoleSpec:
    name: str
    system: str
    allowed_tools: tuple[str, ...]


ROLE_SPECS: dict[str, RoleSpec] = {
    "researcher": RoleSpec(
        "researcher",
        "ROLE: RESEARCHER\nYou are the read-only Researcher of an AI agent team. "
        "Gather concrete repo facts: file paths, current architecture, CI status. "
        "Never write, never send, never guess. Return a short brief with evidence.",
        ("list_files", "read_file", "git_status", "gh_runs"),
    ),
    "coder": RoleSpec(
        "coder",
        "ROLE: CODER\nYou are the Coder. Turn the Researcher brief into a concrete draft. "
        "Use `write_artifact` for proposals. Use `write_file` ONLY when the human has approved "
        "and a real repo edit is required. Always mention tests and rollback.",
        ("list_files", "read_file", "write_artifact", "write_file", "py_compile"),
    ),
    "security": RoleSpec(
        "security",
        "ROLE: SECURITY\nYou are the Security reviewer. Look for leaked secrets, path escapes, "
        "destructive commands, and unreviewed writes. Read-only. Return verdict approve/revise.",
        ("list_files", "read_file", "git_status", "py_compile"),
    ),
    "reviewer": RoleSpec(
        "reviewer",
        "ROLE: REVIEWER\nYou are the Quality Gate. Check correctness, tests, safety and secrets. "
        "Find problems, do not silently fix them. Return verdict `approve` or `revise` with issues. "
        "On the first pass, prefer `revise` if tests/secrets are not explicitly addressed.",
        ("list_files", "read_file", "git_status", "py_compile"),
    ),
    "ops": RoleSpec(
        "ops",
        "ROLE: OPS\nYou are Ops / Lead. Synthesise the final handoff for the human: what was done, "
        "what was deliberately blocked, pending approvals, and exact next steps. Be concise.",
        ("list_files", "read_file", "git_status", "send_discord", "connector_call"),
    ),
}

ROLE_ORDER = {"researcher": 0, "coder": 1, "security": 2, "reviewer": 3, "ops": 4}


class Agent:
    def __init__(self, role: str) -> None:
        self.role = role if role in ROLE_SPECS else "researcher"
        self.spec = ROLE_SPECS[self.role]

    def _prompt(self, task: Task, state: RunState, ctx: RunContext) -> str:
        deps = []
        by_id = {t.id: t for t in state.tasks}
        for dep in task.depends_on:
            parent = by_id.get(dep)
            if parent:
                deps.append(f"- {parent.id} [{parent.role}]: {parent.summary[:400]}")
        tools = json.dumps(ctx.registry.describe(), ensure_ascii=False)
        issues = task.input.get("review_issues") or []
        return "\n".join([
            f"GOAL: {state.goal}",
            f"ROLE: {self.role.upper()}",
            f"TASK: {task.title}",
            f"ATTEMPT: {task.attempts}",
            f"RUN_DIR: {ctx.run_dir}",
            "",
            "DEPENDENCY RESULTS:",
            "\n".join(deps) or "(none yet)",
            "",
            "REVIEW ISSUES TO FIX:",
            "\n".join(f"- {i}" for i in issues) or "(none)",
            "",
            "SHARED MEMORY:",
            json.dumps(small(state.memory, 800), ensure_ascii=False)[:2500],
            "",
            f"AVAILABLE TOOLS: {tools}",
            "",
            "Return ONLY this JSON shape:",
            '{"summary":"...","tool_calls":[{"name":"...","args":{...}}],'
            '"verdict":"approve|revise|","issues":["..."],"artifacts":{...}}',
            "Max 6 tool_calls. Use only tools allowed for your role.",
        ])

    def execute(self, task: Task, state: RunState, ctx: RunContext) -> AgentResult:
        prompt = self._prompt(task, state, ctx)
        raw = ctx.llm.complete(self.spec.system, prompt, json_mode=True)
        data = parse_json(raw)
        if not data:
            return AgentResult(
                task_id=task.id,
                role=self.role,
                ok=False,
                summary="LLM returned no usable JSON; task marked failed.",
            )

        calls = list(data.get("tool_calls") or [])[:6]
        results: list[dict[str, Any]] = []
        pending: list[dict[str, Any]] = []
        for call in calls:
            name = str((call or {}).get("name") or "")
            args = dict((call or {}).get("args") or {})
            if name not in self.spec.allowed_tools:
                res = ToolResult(name, False, f"tool `{name}` not allowed for role `{self.role}`", False, args)
            else:
                res = ctx.registry.call(name, args, ctx)
            entry = asdict(res)
            results.append(entry)
            if res.needs_approval:
                pending.append({"tool": res.name, "args": small(res.args, 300), "reason": res.output})
            log_event(
                state,
                ctx,
                "tool",
                task_id=task.id,
                role=self.role,
                tool=res.name,
                ok=res.ok,
                needs_approval=res.needs_approval,
                output=res.output[:500],
            )

        verdict = str(data.get("verdict") or "")
        if verdict not in {"approve", "revise", ""}:
            verdict = ""
        return AgentResult(
            task_id=task.id,
            role=self.role,
            ok=True,
            summary=str(data.get("summary") or "No summary returned.")[:2000],
            tool_calls=results,
            verdict=verdict,
            issues=[str(i)[:300] for i in list(data.get("issues") or [])[:10]],
            artifacts=small(dict(data.get("artifacts") or {}), 800),
            needs_approval=pending,
        )
