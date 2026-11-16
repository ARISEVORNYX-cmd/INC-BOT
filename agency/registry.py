"""Registry of 66 specialist AI agents (the 'agency').

Curated from https://github.com/Anas-Khan93/ai-agency-agents (72 personas,
trimmed to 66 to fit the requested 50-70 range). Pure stdlib, JSON-driven.
"""
from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class AgentSpec:
    id: str
    index: int
    name: str
    category: str
    description: str
    persona: str
    tools: tuple[str, ...]
    keywords: tuple[str, ...]
    source_repo: str
    source_path: str

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["tools"] = list(self.tools)
        d["keywords"] = list(self.keywords)
        return d

    def short(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "category": self.category,
            "description": self.description,
        }


class Registry:
    def __init__(self, path: Path | None = None) -> None:
        self.path = path or Path(__file__).with_name("agents.json")
        data = json.loads(self.path.read_text(encoding="utf-8"))
        raw = data.get("agents") or []
        self.agents: list[AgentSpec] = []
        for i, item in enumerate(raw, 1):
            self.agents.append(AgentSpec(
                id=str(item.get("id") or f"agent-{i}"),
                index=int(item.get("index") or i),
                name=str(item.get("name") or f"Agent {i}"),
                category=str(item.get("category") or "general"),
                description=str(item.get("description") or ""),
                persona=str(item.get("persona") or ""),
                tools=tuple(item.get("tools") or ["read_file", "write_artifact"]),
                keywords=tuple(item.get("keywords") or []),
                source_repo=str(item.get("source_repo") or ""),
                source_path=str(item.get("source_path") or ""),
            ))
        self.by_id = {a.id: a for a in self.agents}
        self.source = str(data.get("source") or "")
        self.note = str(data.get("curated_note") or "")

    def __len__(self) -> int:
        return len(self.agents)

    def __iter__(self):
        return iter(self.agents)

    def categories(self) -> dict[str, int]:
        out: dict[str, int] = {}
        for a in self.agents:
            out[a.category] = out.get(a.category, 0) + 1
        return dict(sorted(out.items()))

    def get(self, agent_id: str) -> AgentSpec | None:
        return self.by_id.get(agent_id)

    @staticmethod
    def _tokens(text: str) -> set[str]:
        return {t for t in re.findall(r"[a-z0-9]+", str(text).lower()) if len(t) > 2}

    def search(self, query: str, limit: int = 5) -> list[tuple[AgentSpec, float]]:
        q = self._tokens(query)
        scored: list[tuple[AgentSpec, float]] = []
        for a in self.agents:
            hay = self._tokens(a.name + " " + a.category + " " + a.description + " " + " ".join(a.keywords))
            score = float(len(q & hay))
            if any(tok in a.category.lower() for tok in q):
                score += 1.5
            if any(tok in a.id for tok in q):
                score += 1.0
            scored.append((a, score))
        scored.sort(key=lambda pair: (-pair[1], pair[0].index))
        return scored[: max(1, limit)]

    def route(self, question: str, top_k: int = 3) -> list[AgentSpec]:
        """Always returns top_k specialists, even for gibberish (fallback roster)."""
        hits = self.search(question, limit=top_k)
        return [a for a, _ in hits]

    def roster(self) -> list[dict[str, Any]]:
        return [a.short() for a in self.agents]
