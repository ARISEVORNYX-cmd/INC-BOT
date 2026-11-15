from __future__ import annotations

import json
import tempfile
import threading
import unittest
from pathlib import Path
from typing import Any

from agents import AgentTeam, TeamConfig, build_registry, run_goal
from agents.models import RunContext


class _ScriptedLLM:
    """Always asks for one risky `write_file`, so we can test deny -> resume."""

    name = "scripted-test"

    def complete(self, system: str, prompt: str, json_mode: bool = False) -> str:
        if "ROLE: PLANNER" in system:
            return json.dumps({"tasks": [
                {"id": "edit", "title": "Edit a note", "role": "coder", "depends_on": [], "input": {}},
            ]})
        if "ROLE: CODER" in system:
            return json.dumps({
                "summary": "requesting a repo write",
                "tool_calls": [{"name": "write_file", "args": {"path": "notes.txt", "content": "approved draft"}}],
                "verdict": "",
                "issues": [],
                "artifacts": {},
            })
        return json.dumps({
            "summary": "handoff ok",
            "tool_calls": [],
            "verdict": "approve",
            "issues": [],
            "artifacts": {},
        })


class AgentTeamTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        base = Path(self._tmp.name)
        self.root = base / "repo"
        self.root.mkdir()
        (self.root / "README.md").write_text("# Test repo\n", encoding="utf-8")
        (self.root / ".env").write_text("SECRET=do-not-read\n", encoding="utf-8")
        self.run_root = base / "runs"

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def cfg(self, **kw) -> TeamConfig:
        base: dict[str, Any] = dict(
            root=self.root,
            run_root=self.run_root,
            offline=True,
            approval_mode="deny",
            dry_run=True,
            max_cycles=2,
            parallel=False,
        )
        base.update(kw)
        return TeamConfig(**base)

    def ctx(self, registry, run_dir_name: str = "ctx") -> RunContext:
        run_dir = self.run_root / run_dir_name
        run_dir.mkdir(parents=True, exist_ok=True)
        return RunContext(
            root=self.root.resolve(),
            run_dir=run_dir.resolve(),
            llm=None,
            registry=registry,
            approval_mode="deny",
            dry_run=False,
            max_cycles=2,
            lock=threading.Lock(),
        )

    def test_offline_run_completes_with_review_retry(self) -> None:
        state = run_goal("Add a health check endpoint", config=self.cfg())
        self.assertEqual(state.status, "completed", state.final)
        self.assertTrue(state.final)
        self.assertTrue(all(t.status == "done" for t in state.tasks))
        self.assertTrue((Path(state.run_dir) / "report.md").exists())
        self.assertTrue((Path(state.run_dir) / "state.json").exists())
        coder = next(t for t in state.tasks if t.role == "coder")
        reviewer = next(t for t in state.tasks if t.role == "reviewer")
        self.assertGreaterEqual(coder.attempts, 2, "reviewer should trigger one coder retry")
        self.assertEqual(reviewer.verdict, "approve")

    def test_read_blocks_secret_files(self) -> None:
        registry = build_registry()
        result = registry.call("read_file", {"path": ".env"}, self.ctx(registry))
        self.assertFalse(result.ok)
        self.assertIn("blocked", result.output.lower())

    def test_risky_write_is_denied_by_default(self) -> None:
        registry = build_registry()
        result = registry.call(
            "write_file",
            {"path": "notes.txt", "content": "should not exist"},
            self.ctx(registry, "deny"),
        )
        self.assertTrue(result.needs_approval)
        self.assertFalse(result.ok)
        self.assertFalse((self.root / "notes.txt").exists())

    def test_write_artifact_is_allowed_inside_run_dir(self) -> None:
        registry = build_registry()
        ctx = self.ctx(registry, "artifact")
        result = registry.call(
            "write_artifact",
            {"name": "draft.md", "content": "hello"},
            ctx,
        )
        self.assertTrue(result.ok, result.output)
        self.assertTrue((ctx.run_dir / "artifacts" / "draft.md").exists())

    def test_status_and_resume(self) -> None:
        state = run_goal("Audit the repo", config=self.cfg())
        team = AgentTeam(self.cfg())
        loaded = team.status(state.run_id)
        self.assertEqual(loaded.goal, state.goal)
        resumed = team.resume(state.run_id)
        self.assertEqual(resumed.run_id, state.run_id)
        self.assertEqual(resumed.status, "completed")

    def test_blocked_run_resumes_with_auto_approval(self) -> None:
        registry = build_registry()
        denied = AgentTeam(
            self.cfg(dry_run=False, approval_mode="deny", max_cycles=1),
            llm=_ScriptedLLM(),
            registry=registry,
        )
        state = denied.run("Write a note")
        self.assertEqual(state.status, "blocked")
        self.assertEqual(len(state.pending_approvals), 1)
        self.assertFalse((self.root / "notes.txt").exists())

        approved = AgentTeam(
            self.cfg(dry_run=False, approval_mode="auto", max_cycles=1),
            llm=_ScriptedLLM(),
            registry=registry,
        )
        resumed = approved.resume(state.run_id)
        self.assertEqual(resumed.status, "completed")
        self.assertEqual(resumed.pending_approvals, [])
        self.assertTrue((self.root / "notes.txt").exists())
        self.assertEqual((self.root / "notes.txt").read_text(encoding="utf-8"), "approved draft")


if __name__ == "__main__":
    unittest.main()
