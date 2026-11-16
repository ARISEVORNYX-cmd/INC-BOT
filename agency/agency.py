"""INC AI Agency — Ari + 66 general profiles + 56 sales profiles + old Level-3 team.

Yahi wo 'agent agency' hai jisme bahut AI hain, aur `agents/` wala pehle ka
kaam (Lead/Orchestrator + review loop + approval gate) bhi isi me add hai.
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from agents import AgentTeam, TeamConfig

from .personal import PersonalAgent
from .registry import Registry
from .sales import SalesAgency


class Agency:
    def __init__(
        self,
        config: TeamConfig | None = None,
        registry: Registry | None = None,
        memory_path: Path | None = None,
        offline: bool = False,
    ) -> None:
        self.registry = registry or Registry()
        self.sales = SalesAgency()
        self.personal = PersonalAgent(self.registry, memory_path=memory_path, offline=offline)
        # 👇 pehle wala `agents/` Level-3 team, agency ke andar
        self.team_config = config or TeamConfig(
            offline=True, approval_mode="deny", dry_run=False, max_cycles=2, parallel=False
        )
        self.lead_team = AgentTeam(self.team_config)
        self.started_at = datetime.now(timezone.utc).isoformat(timespec="seconds")

    # ---------------- single AI ----------------

    def ask(self, question: str, **kwargs: Any) -> dict[str, Any]:
        """Kuch bhi pucho — jawab pakka aayega."""
        return self.personal.ask(question, **kwargs)

    answer_anything = ask

    def hire(self, agent_id: str, question: str) -> dict[str, Any]:
        spec = self.registry.get(agent_id)
        if spec is None:
            return {
                "ok": False,
                "answer": f"Ari: `{agent_id}` agency me nahi mila. `/api/agents` se 66 agents ki list dekho.",
                "agent": self.personal.name,
            }
        result = self.personal.ask(question)
        result["hired"] = spec.short()
        result["answer"] = (
            f"🎯 {spec.name} (`{spec.category}`) hire kiya.\n\n"
            f"{spec.description[:300]}\n\n{result['answer']}"
        )
        result["ok"] = True
        return result

    # ---------------- many AI ----------------

    def consult(self, question: str, top_k: int = 5) -> dict[str, Any]:
        return self.personal.consult(question, top_k=top_k)

    def list_agents(self, category: str | None = None) -> list[dict[str, Any]]:
        roster = self.registry.roster()
        if category:
            roster = [a for a in roster if a["category"] == category]
        return roster

    def categories(self) -> dict[str, int]:
        return self.registry.categories()

    def sales_departments(self) -> list[dict[str, Any]]:
        return self.sales.departments()

    def sales_agents(self, department: str | None = None, query: str | None = None) -> list[dict[str, Any]]:
        return self.sales.list_agents(department=department, query=query)

    def run_sales(self, goal: str, leads: list[dict[str, Any]] | None = None, channel: str = "email") -> dict[str, Any]:
        return self.sales.run(goal, leads=leads, channel=channel)

    # ---------------- earlier work ----------------

    def delegate(self, goal: str) -> dict[str, Any]:
        state = self.lead_team.run(goal)
        return {
            "run_id": state.run_id,
            "status": state.status,
            "final": state.final,
            "report": str(Path(state.run_dir) / "report.md"),
            "tasks": len(state.tasks),
            "pending_approvals": len(state.pending_approvals),
            "model": state.model,
            "integrated_from": "agents/ (Level-3 lead + researcher + coder + reviewer + ops)",
        }

    # ---------------- memory / stats ----------------

    def remember(self, fact: str) -> dict[str, Any]:
        return self.personal.remember(fact)

    def history(self, limit: int = 20) -> list[dict[str, Any]]:
        return self.personal.history(limit)

    def forget(self) -> dict[str, Any]:
        return self.personal.forget()

    def stats(self) -> dict[str, Any]:
        return {
            "name": "INC AI Agency",
            "started_at": self.started_at,
            "personal_agent": self.personal.name,
            "specialists": len(self.registry),
            "sales_role_profiles": len(self.sales.roster),
            "sales_departments": self.sales.departments(),
            "categories": self.registry.categories(),
            "registry_source": self.registry.source,
            "curated_note": self.registry.note,
            "level3_team": {
                "model": self.lead_team.llm.name,
                "approval": self.team_config.approval_mode,
                "max_cycles": self.team_config.max_cycles,
                "roles": ["lead", "researcher", "coder", "security", "reviewer", "ops"],
            },
            "memory": self.personal.stats(),
        }
