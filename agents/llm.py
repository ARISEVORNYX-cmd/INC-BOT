"""LLM layer: Gemini when a key exists, deterministic offline mode otherwise.

No new dependency. The offline model is intentionally real enough to exercise
planner -> researcher -> coder -> reviewer(retry) -> ops without any API key.
"""
from __future__ import annotations

import json
import os
import re
import threading
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from .models import TeamConfig, small


def _load_dotenv(root: Path) -> None:
    """Pick up GEMINI_API_KEY from repo-root/.env or bot/.env, never override env."""
    for candidate in (root / ".env", root / "bot" / ".env"):
        try:
            if not candidate.exists():
                continue
            for line in candidate.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))
        except Exception:
            continue


class LLM:
    name = "base"

    def complete(self, system: str, prompt: str, json_mode: bool = False) -> str:
        raise NotImplementedError


class DeterministicLLM(LLM):
    """Offline stand-in. Produces valid JSON for every role, including one review retry."""

    name = "offline-deterministic"

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._review_calls = 0

    @staticmethod
    def _role(system: str) -> str:
        m = re.search(r"ROLE:\s*([A-Z_]+)", system or "")
        return m.group(1) if m else "GENERIC"

    @staticmethod
    def _line(prompt: str, label: str) -> str:
        m = re.search(rf"^{label}:\s*(.+)$", prompt or "", re.M)
        return m.group(1).strip() if m else ""

    def complete(self, system: str, prompt: str, json_mode: bool = False) -> str:
        if not json_mode:
            return "ok"
        role = self._role(system)
        goal = self._line(prompt, "GOAL") or "the requested goal"
        goal = goal[:240]
        run_dir = self._line(prompt, "RUN_DIR")

        if role == "PLANNER":
            data = {
                "notes": "Offline deterministic plan (set GEMINI_API_KEY for a model-driven plan).",
                "tasks": [
                    {"id": "research", "title": "Map the repo and gather context", "role": "researcher", "depends_on": [], "input": {}},
                    {"id": "implement", "title": f"Draft the change for: {goal}", "role": "coder", "depends_on": ["research"], "input": {}},
                    {"id": "review", "title": "Review the draft for safety and correctness", "role": "reviewer", "depends_on": ["implement"], "input": {}},
                    {"id": "ship", "title": "Write the final handoff report", "role": "ops", "depends_on": ["review"], "input": {}},
                ],
            }
            return json.dumps(data, ensure_ascii=False)

        if role == "RESEARCHER":
            return json.dumps({
                "summary": f"Repo context gathered for: {goal}. Read README, listed source files, and checked git/CI status. No writes performed.",
                "tool_calls": [
                    {"name": "list_files", "args": {"pattern": "*"}},
                    {"name": "read_file", "args": {"path": "README.md", "max_chars": 2000}},
                    {"name": "git_status", "args": {}},
                ],
                "verdict": "",
                "issues": [],
                "artifacts": {},
            }, ensure_ascii=False)

        if role == "CODER":
            content = (
                f"# Draft for: {goal}\n\n"
                "This artifact is a proposal, not a repo edit.\n"
                "- Researcher context was consumed.\n"
                "- Use `write_file` only after human approval.\n"
                "- Add a unit test before shipping.\n"
            )
            return json.dumps({
                "summary": "Drafted implementation notes in run artifacts. No repository file changed without approval.",
                "tool_calls": [{"name": "write_artifact", "args": {"name": "implementation.md", "content": content}}],
                "verdict": "",
                "issues": [],
                "artifacts": {"draft": "artifacts/implementation.md"},
            }, ensure_ascii=False)

        if role == "REVIEWER":
            with self._lock:
                self._review_calls += 1
                call = self._review_calls
            if call == 1:
                verdict = "revise"
                issues = ["Add a regression test for the new behavior.", "Confirm no secret or token is written to disk."]
                summary = "First review: requested one revision cycle (test + secret check)."
            else:
                verdict = "approve"
                issues = []
                summary = "Re-review passed: draft is safe for handoff (still no repo writes without approval)."
            return json.dumps({
                "summary": summary,
                "tool_calls": [{"name": "read_file", "args": {"path": "artifacts/implementation.md", "max_chars": 1500}}],
                "verdict": verdict,
                "issues": issues,
                "artifacts": {},
            }, ensure_ascii=False)

        if role == "SECURITY":
            return json.dumps({
                "summary": "Security scan: no secrets, no destructive tool calls, path guards active.",
                "tool_calls": [{"name": "git_status", "args": {}}],
                "verdict": "approve",
                "issues": [],
                "artifacts": {},
            }, ensure_ascii=False)

        if role == "OPS":
            return json.dumps({
                "summary": (
                    f"✅ Agent team finished: {goal}.\n"
                    "Lead decomposed the goal, Researcher gathered repo context, Coder produced a draft, "
                    "Reviewer ran a revise/approve loop, and Ops prepared this handoff. "
                    "Risky actions stayed behind the approval gate."
                ),
                "tool_calls": [],
                "verdict": "approve",
                "issues": [],
                "artifacts": {},
            }, ensure_ascii=False)

        return json.dumps({
            "summary": f"Offline response for {role}: {goal}",
            "tool_calls": [],
            "verdict": "",
            "issues": [],
            "artifacts": {},
        }, ensure_ascii=False)


class GeminiLLM(LLM):
    def __init__(self, api_key: str, model: str) -> None:
        self.api_key = api_key
        self.model = model
        self.name = f"gemini:{model}"

    def complete(self, system: str, prompt: str, json_mode: bool = False) -> str:
        text = (system or "") + "\n\n" + (prompt or "")
        if json_mode:
            text += "\n\nReturn ONLY valid JSON. No markdown fences, no commentary."
        body = {
            "contents": [{"parts": [{"text": text}]}],
            "generationConfig": {"temperature": 0.2, "maxOutputTokens": 2048},
        }
        req = urllib.request.Request(
            f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent",
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json", "x-goog-api-key": self.api_key},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        return data["candidates"][0]["content"]["parts"][0]["text"]


class ResilientLLM(LLM):
    """If Gemini errors or returns junk, fall back to the offline brain."""

    def __init__(self, primary: LLM, fallback: LLM) -> None:
        self.primary = primary
        self.fallback = fallback
        self.name = f"{primary.name}+fallback"

    def complete(self, system: str, prompt: str, json_mode: bool = False) -> str:
        try:
            out = self.primary.complete(system, prompt, json_mode=json_mode)
            if out and out.strip():
                return out
        except (urllib.error.URLError, KeyError, IndexError, ValueError, OSError):
            pass
        return self.fallback.complete(system, prompt, json_mode=json_mode)


def get_llm(config: TeamConfig) -> LLM:
    _load_dotenv(config.resolved_root())
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if config.offline or not key:
        return DeterministicLLM()
    model = (
        config.model
        or os.environ.get("AGENT_TEAM_MODEL", "").strip()
        or os.environ.get("GEMINI_MODEL", "").strip()
        or "gemini-2.0-flash"
    )
    return ResilientLLM(GeminiLLM(key, model), DeterministicLLM())


def parse_json(raw: str) -> dict[str, Any]:
    """Strip ```json fences and grab the outermost object."""
    if not raw:
        return {}
    cleaned = re.sub(r"^```(?:json)?|```$", "", raw.strip(), flags=re.M | re.I).strip()
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start < 0 or end <= start:
        return {}
    try:
        data = json.loads(cleaned[start : end + 1])
        return small(data) if isinstance(data, dict) else {}
    except Exception:
        return {}
