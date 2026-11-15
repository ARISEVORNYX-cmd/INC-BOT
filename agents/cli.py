"""Command-line entrypoint for the portable agent team.

Examples:
  python -m agents.cli "Audit INC-BOT and propose a safe improvement" --offline
  python -m agents.cli --demo --approval deny --json
  python -m agents.cli --status <run_id>
  python -m agents.cli --resume <run_id> --approval auto
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from . import __version__
from .models import TeamConfig, dump_json
from .orchestrator import AgentTeam
from .roles import ROLE_SPECS

DEMO_GOAL = "Audit INC-BOT and propose a safe Level-3 agent-team upgrade with tests"


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="agents",
        description="Level-3 agent team for INC-BOT (Lead + specialists + tools + approval gate)",
    )
    p.add_argument("goal", nargs="?", help="Goal to delegate to the agent team")
    p.add_argument("--demo", action="store_true", help="Use a built-in INC-BOT audit goal")
    p.add_argument("--offline", action="store_true", help="Force deterministic offline brain (no Gemini call)")
    p.add_argument("--model", default=None, help="Override Gemini model (default: AGENT_TEAM_MODEL / GEMINI_MODEL)")
    p.add_argument("--dry-run", action="store_true", help="Simulate ALL tools; write no artifacts")
    p.add_argument("--approval", choices=["deny", "auto", "interactive"], default="deny",
                   help="Risky-tool policy (default: deny = safe)")
    p.add_argument("--max-cycles", type=int, default=3, help="Max reviewer revise/retry cycles (default: 3)")
    p.add_argument("--parallel", action="store_true", help="Run independent ready tasks concurrently")
    p.add_argument("--root", default=None, help="Repo root (default: this checkout)")
    p.add_argument("--run-root", default=None, help="Where run state is stored (default: agents/runs/)")
    p.add_argument("--json", action="store_true", help="Print full RunState as JSON")
    p.add_argument("--quiet", action="store_true", help="Suppress human-readable final text")
    p.add_argument("--status", metavar="RUN_ID", default=None, help="Show a previous run")
    p.add_argument("--resume", metavar="RUN_ID", default=None, help="Resume a blocked/partial run")
    p.add_argument("--list-agents", action="store_true", help="List roles and their tool allowlists")
    p.add_argument("--version", action="version", version=f"agents {__version__}")
    return p


def _config(args: argparse.Namespace) -> TeamConfig:
    kwargs: dict[str, Any] = dict(
        offline=args.offline,
        dry_run=args.dry_run,
        approval_mode=args.approval,
        max_cycles=max(1, args.max_cycles),
        parallel=args.parallel,
        model=args.model,
    )
    if args.root:
        kwargs["root"] = Path(args.root)
    if args.run_root:
        kwargs["run_root"] = Path(args.run_root)
    return TeamConfig(**kwargs)


def _print_state(state: Any, args: argparse.Namespace) -> None:
    if args.json:
        print(dump_json(state.to_dict()))
        return
    if not args.quiet:
        print(f"🤖 Run `{state.run_id}` • status=`{state.status}` • model=`{state.model}`")
        print(state.final or "(no final summary)")
    report = Path(state.run_dir) / "report.md"
    print(f"📄 Report: {report}")


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)

    if args.list_agents:
        for name, spec in ROLE_SPECS.items():
            print(f"{name:11s} → {', '.join(spec.allowed_tools)}")
        print(f"{'lead':11s} → planner / task board / review loop / approval gate")
        return 0

    team = AgentTeam(_config(args))

    try:
        if args.status:
            _print_state(team.status(args.status), args)
            return 0
        if args.resume:
            _print_state(team.resume(args.resume), args)
            return 0

        goal = args.goal or (DEMO_GOAL if args.demo else None)
        if not goal:
            _parser().error("give a GOAL, or use --demo / --status / --resume / --list-agents")
        state = team.run(goal)
        _print_state(state, args)
        return 0
    except Exception as exc:
        print(f"❌ agent team failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
