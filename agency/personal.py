"""Ari — ARISE ka personal AI agent.

Guarantee: `ask()` NEVER returns an empty answer. It uses, in order:
  1. saved Q&A + personal knowledge (jarvis/my_brain)
  2. safe arithmetic / time-date
  3. optional Gemini (only if a key works)
  4. routed general specialist perspective(s) from the 66-profile registry
  5. a structured Hinglish fallback that always answers and gives a next step

It can also delegate big goals to the earlier `agents/` Level-3 team.
"""
from __future__ import annotations

import ast
import json
import os
import re
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from agents import TeamConfig, run_goal
from agents.llm import GeminiLLM, _load_dotenv

from .registry import AgentSpec, Registry

ROOT = Path(__file__).resolve().parent.parent
IST = timezone(timedelta(hours=5, minutes=30))


def _norm(text: str) -> set[str]:
    return {t for t in re.findall(r"[a-z0-9]+", str(text).lower()) if t}


def _safe_math(expr: str) -> str | None:
    expr = expr.strip()
    if not expr or not re.fullmatch(r"[\d\s\+\-\*/\(\)\.]+", expr):
        return None
    try:
        tree = ast.parse(expr, mode="eval")
        allowed = (
            ast.Expression, ast.BinOp, ast.UnaryOp, ast.Constant,
            ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Pow, ast.USub, ast.UAdd,
        )
        if not all(isinstance(n, allowed) for n in ast.walk(tree)):
            return None
        value = eval(compile(tree, "<ari-math>", "eval"), {"__builtins__": {}}, {})
        return f"{value:g}" if isinstance(value, float) else str(value)
    except Exception:
        return None


class PersonalAgent:
    name = "Ari"
    tagline = "ARISE ka personal AI — har sawaal ka jawab, chahe kuch bhi pucho"

    def __init__(
        self,
        registry: Registry | None = None,
        memory_path: Path | None = None,
        offline: bool = False,
    ) -> None:
        self.registry = registry or Registry()
        self.memory_path = memory_path or ROOT / "agents" / "runs" / "personal" / "memory.json"
        self.memory_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._load_dotenv_once()
        self.offline = offline or not os.environ.get("GEMINI_API_KEY", "").strip()
        self.memory: dict[str, Any] = self._load_memory()
        self.qa = self._load_qa()
        self.knowledge = self._load_knowledge()
        self.persona = self._load_persona()

    # ---------------- setup ----------------

    @staticmethod
    def _load_dotenv_once() -> None:
        try:
            _load_dotenv(ROOT)
        except Exception:
            pass

    def _load_memory(self) -> dict[str, Any]:
        try:
            data = json.loads(self.memory_path.read_text(encoding="utf-8"))
            return {"history": list(data.get("history") or []), "facts": list(data.get("facts") or [])}
        except Exception:
            return {"history": [], "facts": []}

    def _save_memory(self) -> None:
        try:
            self.memory_path.write_text(json.dumps(self.memory, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception:
            pass

    @staticmethod
    def _load_qa() -> list[dict[str, Any]]:
        try:
            data = json.loads((ROOT / "jarvis" / "my_brain" / "qa.json").read_text(encoding="utf-8"))
            return data if isinstance(data, list) else []
        except Exception:
            return []

    @staticmethod
    def _load_knowledge() -> str:
        try:
            return (ROOT / "jarvis" / "my_brain" / "knowledge.md").read_text(encoding="utf-8")[:4000]
        except Exception:
            return ""

    @staticmethod
    def _load_persona() -> str:
        try:
            return (ROOT / "jarvis" / "my_brain" / "persona.txt").read_text(encoding="utf-8").strip()
        except Exception:
            return "Tum Ari ho — ARISE ka personal AI. Hinglish me dostana, saaf jawab do."

    # ---------------- public API ----------------

    def ask(
        self,
        question: str,
        user: str = "ARISE",
        panel: bool = False,
        use_model: bool = True,
    ) -> dict[str, Any]:
        q = str(question or "").strip()
        if not q:
            q = "(tumne kuch nahi poocha)"
        top_k = 5 if panel else 1
        specialists = self.registry.route(q, top_k=top_k)
        answer, source = self._compose(q, specialists, panel=panel, use_model=use_model)
        answer = answer.strip() or self._fallback(q, specialists)
        record = {
            "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "user": str(user or "ARISE"),
            "question": q,
            "answer": answer[:4000],
            "specialists": [s.id for s in specialists],
            "source": source,
        }
        with self._lock:
            self.memory["history"].append(record)
            del self.memory["history"][:-100]
            self._save_memory()
        return {
            "agent": self.name,
            "answer": answer,
            "question": q,
            "specialists": [s.short() for s in specialists],
            "source": source,
            "model": "gemini" if source == "gemini" else "local-always-answer",
            "memory_size": len(self.memory["history"]),
            "timestamp": record["ts"],
        }

    # convenience aliases
    answer = ask
    ask_anything = ask

    def consult(self, question: str, top_k: int = 5) -> dict[str, Any]:
        return self.ask(question, panel=True)

    def delegate(self, goal: str) -> dict[str, Any]:
        goal = str(goal or "").strip() or "Audit INC-BOT"
        state = run_goal(goal, config=TeamConfig(
            offline=True,
            approval_mode="deny",
            dry_run=False,
            max_cycles=2,
            parallel=False,
        ))
        return {
            "run_id": state.run_id,
            "status": state.status,
            "final": state.final,
            "report": str(Path(state.run_dir) / "report.md"),
            "tasks": len(state.tasks),
            "pending_approvals": len(state.pending_approvals),
            "model": state.model,
        }

    def remember(self, fact: str) -> dict[str, Any]:
        fact = str(fact or "").strip()
        if not fact:
            return {"ok": False, "reason": "empty fact"}
        with self._lock:
            self.memory["facts"].append({"ts": datetime.now(timezone.utc).isoformat(timespec="seconds"), "text": fact[:500]})
            del self.memory["facts"][:-200]
            self._save_memory()
        return {"ok": True, "facts": len(self.memory["facts"])}

    def history(self, limit: int = 20) -> list[dict[str, Any]]:
        with self._lock:
            return list(self.memory["history"][-max(1, limit):])

    def forget(self) -> dict[str, Any]:
        with self._lock:
            self.memory = {"history": [], "facts": []}
            self._save_memory()
        return {"ok": True}

    def stats(self) -> dict[str, Any]:
        return {
            "agent": self.name,
            "specialists_available": len(self.registry),
            "conversations": len(self.memory["history"]),
            "facts": len(self.memory["facts"]),
            "offline": self.offline,
            "memory_path": str(self.memory_path),
        }

    # ---------------- answer engine ----------------

    def _qa_hit(self, q: str) -> str | None:
        qt = _norm(q)
        if not qt:
            return None
        for item in self.qa:
            ans = str(item.get("answer") or "").strip()
            if not ans:
                continue
            for question in item.get("questions") or []:
                words = _norm(str(question))
                if words and (words == qt or words.issubset(qt)):
                    return ans
        return None

    def _time_answer(self, q: str) -> str | None:
        ql = q.lower()
        if not any(w in ql for w in ("time", "samay", "baje", "date", "tarikh", "aaj ka din")):
            return None
        now = datetime.now(IST)
        if any(w in ql for w in ("date", "tarikh", "aaj ka din")):
            return f"ARISE, aaj {now.strftime('%A, %d %B %Y')} hai (IST)."
        return f"ARISE, abhi {now.strftime('%I:%M %p')} IST baj rahe hain."

    def _agency_answer(self, q: str) -> str | None:
        ql = q.lower()
        if any(w in ql for w in ("agent", "agency", "team", "kitne ai", "50", "70", "66")):
            cats = self.registry.categories()
            return (
                f"ARISE, is agency me **{len(self.registry)} general specialist role profiles** hain "
                f"({', '.join(f'{k}:{v}' for k, v in list(cats.items())[:6])} …), aur sales division me 56 role profiles hain. "
                "Upar se ek personal agent (main, Ari) aur tumhara purana `agents/` Level-3 "
                "Lead+Researcher+Coder+Reviewer+Ops team bhi juda hai. Profiles alag-alag model instances nahi hain. "
                "Kisi bhi sawaal ko panel mode me 5 specialists ek saath dekh sakte hain, "
                "aur bada goal `/api/team` se poori team ko delegate kar sakte hain."
            )
        return None

    def _model_answer(self, q: str, specialists: list[AgentSpec]) -> str | None:
        if self.offline:
            return None
        key = os.environ.get("GEMINI_API_KEY", "").strip()
        if not key:
            return None
        model = (
            os.environ.get("AGENT_TEAM_MODEL", "").strip()
            or os.environ.get("GEMINI_MODEL", "").strip()
            or "gemini-2.0-flash"
        )
        system = (
            self.persona + "\n\nTum Ari ho, ARISE ka personal AI. Hamesha Hinglish me, "
            "chhota par poora jawab do. Agar pakka nahi pata to seedha bolo aur agla kadam batao. "
            "Kabhi khali jawab mat do. Specialist context: "
            + "; ".join(f"{s.name} ({s.category})" for s in specialists)
        )
        try:
            out = GeminiLLM(key, model).complete(system, "Sawaal: " + q, json_mode=False)
            out = (out or "").strip()
            if len(out) > 8:
                return out[:2000]
        except Exception:
            return None
        return None

    def _compose(
        self,
        q: str,
        specialists: list[AgentSpec],
        panel: bool,
        use_model: bool,
    ) -> tuple[str, str]:
        hit = self._qa_hit(q)
        if hit:
            return hit, "saved-qa"
        math_answer = _safe_math(q)
        if math_answer is not None:
            return f"ARISE, `{q}` = **{math_answer}**.", "math"
        time_answer = self._time_answer(q)
        if time_answer:
            return time_answer, "clock"
        agency_answer = self._agency_answer(q)
        if agency_answer:
            return agency_answer, "agency-intro"
        if use_model:
            model_answer = self._model_answer(q, specialists)
            if model_answer:
                return model_answer, "gemini"

        lines: list[str] = []
        lines.append(f'🤖 **Ari**: "{q}" ke liye mera jawab —')
        lines.append("")
        lines.append(
            "Main is waqt offline/local brain chala raha hu, isliye live internet data nahi "
            "utha raha; par sawaal ko tod kar pakka jawab aur agla kadam de raha hu."
        )
        lines.append("")
        if panel:
            lines.append(f"**Panel ({len(specialists)} specialists ne dekha):**")
        for s in specialists:
            lines.append(
                f"- **{s.name}** `{s.category}` → {s.description[:220]} "
                f"| Suggestion: is angle se check karo, edge-cases likho, phir test karo."
            )
        lines.append("")
        if self.knowledge:
            snippet = " ".join(self.knowledge.split())[:260]
            lines.append(f"📌 Yaad/ context: {snippet}")
            lines.append("")
        lines.append("**Agla kadam:**")
        lines.append("1. Jo exact result chahiye wo ek line me bata do (file, repo, ya output).")
        lines.append("2. Bada kaam ho to `/api/team` ya `python -m agents.cli` se poori agent-team chalao.")
        lines.append("3. `GEMINI_API_KEY` set ho to Ari pehle Gemini se detailed jawab try karta hai; warna yeh offline fallback use karta hai.")
        lines.append("")
        lines.append("(Koi bhi sawaal bhejo — khali jawab kabhi nahi milega ✅)")
        return "\n".join(lines), "local-always-answer"

    def _fallback(self, q: str, specialists: list[AgentSpec]) -> str:
        lead = specialists[0] if specialists else None
        who = lead.name if lead else "Ari"
        return (
            f'🤖 Ari: "{q}" sun liya. Is par {who} ke nazariye se pehla jawab: '
            "sawaal ko chhote steps me todho, input/output likho, ek test banao, phir result check karo. "
            "Aur detail chahiye to dobara pucho ya /api/team se delegate kar do."
        )
