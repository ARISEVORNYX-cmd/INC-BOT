"""Lead / Orchestrator: decompose -> delegate -> handoff -> review loop -> ship.

This is the L3 jump: instead of one prompt -> one answer, a Lead owns a shared
task board, runs specialist agents, feeds outputs forward, retries on reviewer
`revise`, and pauses risky tools at an approval gate.
"""
from __future__ import annotations

import json
import re
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

from .llm import get_llm, parse_json
from .models import (
    AgentResult,
    RunContext,
    RunState,
    Task,
    TeamConfig,
    dump_json,
    log_event,
    utc_now,
)
from .roles import ROLE_ORDER, ROLE_SPECS, Agent
from .tools import build_registry


PLANNER_SYSTEM = """ROLE: PLANNER
You are the Lead of a small AI agent team. Decompose the goal into 3-6 ordered tasks.
Available roles: researcher, coder, security, reviewer, ops.
Rules: researcher first, coder after research, reviewer after coder, ops last.
Every task needs id, title, role, depends_on (ids of earlier tasks only), input.
Return ONLY JSON: {"tasks":[...],"notes":"..."}"""


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9_-]+", "-", str(text).lower()).strip("-")[:32] or "task"


def _default_plan(goal: str) -> list[dict[str, Any]]:
    return [
        {"id": "research", "title": "Map the repo and gather context", "role": "researcher", "depends_on": [], "input": {}},
        {"id": "implement", "title": f"Draft the change for: {goal[:120]}", "role": "coder", "depends_on": ["research"], "input": {}},
        {"id": "review", "title": "Review the draft for safety and correctness", "role": "reviewer", "depends_on": ["implement"], "input": {}},
        {"id": "ship", "title": "Write the final handoff report", "role": "ops", "depends_on": ["review"], "input": {}},
    ]


class AgentTeam:
    def __init__(self, config: TeamConfig | None = None, llm: Any = None, registry: Any = None) -> None:
        self.config = config or TeamConfig()
        self.llm = llm or get_llm(self.config)
        self.registry = registry or build_registry()

    # ---------------- public API ----------------

    def run(self, goal: str) -> RunState:
        goal = str(goal or "").strip()
        if not goal:
            raise ValueError("goal cannot be empty")
        run_id = f"{utc_now().replace(':', '').replace('-', '')[:15]}-{_slug(goal)[:20]}-{uuid.uuid4().hex[:4]}"
        run_dir = self.config.resolved_run_root() / run_id
        run_dir.mkdir(parents=True, exist_ok=True)
        (run_dir / "artifacts").mkdir(parents=True, exist_ok=True)

        state = RunState(
            run_id=run_id,
            goal=goal,
            created_at=utc_now(),
            run_dir=str(run_dir),
            status="running",
            model=self.llm.name,
            approval_mode=self.config.approval_mode,
            dry_run=self.config.dry_run,
        )
        ctx = self._ctx(state)
        state.tasks = self._plan(goal, ctx)
        log_event(state, ctx, "plan", tasks=[t.id for t in state.tasks], model=self.llm.name)
        self._execute_loop(state, ctx)
        self._finalize(state, ctx)
        self._persist(state, ctx)
        return state

    def status(self, run_id: str) -> RunState:
        path = self.config.resolved_run_root() / run_id / "state.json"
        if not path.exists():
            raise FileNotFoundError(f"no run found: {run_id} (looked in {path})")
        return RunState.from_dict(json.loads(path.read_text(encoding="utf-8")))

    def resume(self, run_id: str) -> RunState:
        state = self.status(run_id)
        state.approval_mode = self.config.approval_mode
        state.dry_run = self.config.dry_run
        for task in state.tasks:
            if task.status == "needs_approval":
                task.status = "pending"
        ctx = self._ctx(state)
        log_event(state, ctx, "resume", approval_mode=self.config.approval_mode)
        self._execute_loop(state, ctx)
        self._finalize(state, ctx)
        self._persist(state, ctx)
        return state

    # ---------------- internals ----------------

    def _ctx(self, state: RunState) -> RunContext:
        return RunContext(
            root=self.config.resolved_root(),
            run_dir=Path(state.run_dir).resolve(),
            llm=self.llm,
            registry=self.registry,
            approval_mode=self.config.approval_mode,
            dry_run=self.config.dry_run,
            max_cycles=max(1, int(self.config.max_cycles)),
            lock=threading.Lock(),
        )

    def _plan(self, goal: str, ctx: RunContext) -> list[Task]:
        prompt = "\n".join([
            f"GOAL: {goal}",
            f"REPO ROOT: {ctx.root}",
            f"AVAILABLE ROLES: {', '.join(ROLE_SPECS)}",
            "Return 3-6 tasks, ordered, with depends_on pointing only to earlier ids.",
        ])
        data = parse_json(self.llm.complete(PLANNER_SYSTEM, prompt, json_mode=True))
        raw = data.get("tasks")
        if not isinstance(raw, list) or not raw:
            raw = _default_plan(goal)

        prepared: list[dict[str, Any]] = []
        seen: set[str] = set()
        for i, item in enumerate(raw[: self.config.max_tasks]):
            item = dict(item or {})
            tid = _slug(str(item.get("id") or f"t{i + 1}"))
            if tid in seen:
                tid = f"{tid}-{i}"
            role = str(item.get("role") or "researcher")
            if role not in ROLE_SPECS:
                role = "researcher"
            deps = [str(d) for d in list(item.get("depends_on") or []) if str(d) in seen]
            prepared.append({
                "id": tid,
                "title": str(item.get("title") or tid)[:160],
                "role": role,
                "depends_on": deps,
                "input": dict(item.get("input") or {}),
                "_i": i,
            })
            seen.add(tid)

        # Stable role ordering guarantees coder -> reviewer -> ops handoff.
        prepared.sort(key=lambda t: (ROLE_ORDER.get(t["role"], 2), t["_i"]))
        earlier: set[str] = set()
        for task in prepared:
            task["depends_on"] = [d for d in task["depends_on"] if d in earlier]
            earlier.add(task["id"])

        coder_id = next((t["id"] for t in prepared if t["role"] == "coder"), None)
        for task in prepared:
            if task["role"] == "reviewer" and coder_id and coder_id != task["id"] and coder_id not in task["depends_on"] and coder_id in earlier:
                task["depends_on"].append(coder_id)
        if not any(t["role"] == "ops" for t in prepared):
            last = prepared[-1]["id"] if prepared else None
            prepared.append({
                "id": "ship",
                "title": "Write the final handoff report",
                "role": "ops",
                "depends_on": [last] if last else [],
                "input": {},
                "_i": 999,
            })

        return [
            Task(
                id=t["id"],
                title=t["title"],
                role=t["role"],
                depends_on=t["depends_on"],
                input=t["input"],
            )
            for t in prepared
        ]

    @staticmethod
    def _ready(state: RunState) -> list[Task]:
        done = {t.id for t in state.tasks if t.status == "done"}
        return [
            t for t in state.tasks
            if t.status in {"pending", "revise"} and all(d in done for d in t.depends_on)
        ]

    def _run_task(self, task: Task, state: RunState, ctx: RunContext) -> AgentResult:
        with ctx.lock:
            task.status = "running"
            task.attempts += 1
        log_event(state, ctx, "task_start", task_id=task.id, role=task.role, attempt=task.attempts)
        try:
            result = Agent(task.role).execute(task, state, ctx)
        except Exception as exc:
            result = AgentResult(task.id, task.role, False, f"agent crashed: {type(exc).__name__}: {exc}")
        with ctx.lock:
            if result.needs_approval:
                task.status = "needs_approval"
            elif result.ok:
                task.status = "done"
            else:
                task.status = "failed"
            task.summary = result.summary[:2000]
            task.verdict = result.verdict
            task.issues = result.issues
            task.artifacts = result.artifacts
            state.memory[f"task:{task.id}"] = result.summary[:2000]
        log_event(
            state, ctx, "task_end",
            task_id=task.id, role=task.role, status=task.status,
            verdict=result.verdict, summary=result.summary[:300],
        )
        return result

    def _execute_loop(self, state: RunState, ctx: RunContext) -> None:
        hard_limit = ctx.max_cycles * 6 + 6
        for cycle in range(1, hard_limit + 1):
            ready = self._ready(state)
            if not ready:
                break
            log_event(state, ctx, "cycle", cycle=cycle, ready=[t.id for t in ready])
            results: list[AgentResult] = []
            if ctx.max_cycles > 0 and self.config.parallel and len(ready) > 1:
                with ThreadPoolExecutor(max_workers=min(3, len(ready))) as pool:
                    futures = {pool.submit(self._run_task, t, state, ctx): t for t in ready}
                    for future in as_completed(futures):
                        results.append(future.result())
            else:
                for task in ready:
                    results.append(self._run_task(task, state, ctx))

            for result in results:
                if result.role != "reviewer" or result.verdict != "revise":
                    continue
                coder = next((t for t in state.tasks if t.role == "coder"), None)
                reviewer = next((t for t in state.tasks if t.id == result.task_id), None)
                if coder and reviewer and coder.attempts < ctx.max_cycles:
                    with ctx.lock:
                        coder.status = "pending"
                        coder.input["review_issues"] = result.issues
                        reviewer.status = "pending"
                        state.memory.setdefault("review_issues", []).extend(result.issues)
                    log_event(state, ctx, "review_revise", issues=result.issues, coder=coder.id)
                else:
                    log_event(state, ctx, "review_cycle_cap", coder=coder.id if coder else None)

        statuses = {t.status for t in state.tasks}
        if statuses <= {"done"}:
            state.status = "completed"
        elif "needs_approval" in statuses:
            state.status = "blocked"
        else:
            state.status = "partial"
        if self._ready(state):
            state.status = "partial"
            log_event(state, ctx, "loop_cap", remaining=[t.id for t in self._ready(state)])

    def _finalize(self, state: RunState, ctx: RunContext) -> None:
        ops = next((t for t in state.tasks if t.role == "ops" and t.status == "done"), None)
        if ops and ops.summary:
            final = ops.summary
        else:
            lines = [f"Goal: {state.goal}", f"Status: {state.status}", "", "Tasks:"]
            for t in state.tasks:
                lines.append(f"- `{t.id}` [{t.role}] **{t.status}** (attempts={t.attempts}): {t.summary[:220]}")
            final = "\n".join(lines)
        pending = state.pending_approvals
        if pending:
            final += "\n\n⚠️ Pending approvals:\n" + "\n".join(
                f"- `{p.get('tool')}`: {str(p.get('reason') or '')[:200]}" for p in pending[:10]
            )
            final += "\nRe-run with `--approval auto` (or `/team` after wiring an adapter) to execute them."
        state.final = final.strip()
        log_event(state, ctx, "finalize", status=state.status, pending=len(pending))

    def _persist(self, state: RunState, ctx: RunContext) -> None:
        run_dir = ctx.run_dir
        run_dir.mkdir(parents=True, exist_ok=True)
        (run_dir / "state.json").write_text(dump_json(state.to_dict()), encoding="utf-8")
        lines = [
            f"# 🤖 Agent Team Run — `{state.run_id}`",
            "",
            f"- **Goal:** {state.goal}",
            f"- **Status:** `{state.status}`",
            f"- **Model:** `{state.model}`",
            f"- **Approval:** `{state.approval_mode}` | **Dry-run:** `{state.dry_run}`",
            f"- **Created:** {state.created_at}",
            "",
            "## Final handoff",
            "",
            state.final or "(none)",
            "",
            "## Task board",
            "",
            "| id | role | status | attempts | verdict | summary |",
            "|---|---|---|---|---|---|",
        ]
        for t in state.tasks:
            summary = t.summary.replace("|", "\\|").replace("\n", " ")[:180]
            lines.append(f"| `{t.id}` | {t.role} | `{t.status}` | {t.attempts} | {t.verdict or '-'} | {summary} |")
        lines += ["", "## Pending approvals", ""]
        pending = state.pending_approvals
        if pending:
            for p in pending[:20]:
                lines.append(f"- `{p.get('tool')}` — {str(p.get('reason') or '')[:240]}")
        else:
            lines.append("(none)")
        lines += ["", "## Timeline (last 80 events)", ""]
        for event in state.timeline[-80:]:
            detail = {k: v for k, v in event.items() if k not in {"ts", "event"}}
            lines.append(f"- `{event.get('ts')}` **{event.get('event')}** — {json.dumps(detail, ensure_ascii=False)[:400]}")
        lines += ["", "---", "Generated by `agents/` — portable L3 agent team for INC-BOT."]
        (run_dir / "report.md").write_text("\n".join(lines), encoding="utf-8")


def run_goal(goal: str, config: TeamConfig | None = None, **kwargs: Any) -> RunState:
    """Convenience entrypoint for CLI, Discord, Jarvis, or CI."""
    cfg = config or TeamConfig(**kwargs)
    return AgentTeam(cfg).run(goal)
