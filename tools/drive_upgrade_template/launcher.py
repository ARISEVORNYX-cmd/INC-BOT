#!/usr/bin/env python3
"""Sidecar CLI for the repo that contains this inc_bot_ai folder.

The embedded packages live next to this file. Team reads are rooted at the
parent project, while runtime state stays ignored inside inc_bot_ai/.runtime.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

PLUGIN_ROOT = Path(__file__).resolve().parent
DEFAULT_REPO_ROOT = PLUGIN_ROOT.parent
if str(PLUGIN_ROOT) not in sys.path:
    sys.path.insert(0, str(PLUGIN_ROOT))


def _runtime() -> Path:
    path = PLUGIN_ROOT / ".runtime"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _config(root: Path, offline: bool, approval: str = "deny") -> Any:
    from agents import TeamConfig

    return TeamConfig(
        root=root,
        run_root=_runtime() / "runs",
        offline=offline,
        approval_mode=approval,
        dry_run=False,
        max_cycles=2,
        parallel=False,
    )


def _agency(root: Path, offline: bool) -> Any:
    from agency import Agency

    return Agency(
        config=_config(root, offline),
        memory_path=_runtime() / "memory.json",
        offline=offline,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="INC-BOT AI sidecar for this repository")
    parser.add_argument("--root", type=Path, default=DEFAULT_REPO_ROOT, help="Project root to read (default: containing repository)")
    sub = parser.add_subparsers(dest="command", required=True)

    ask = sub.add_parser("ask", help="Ask Ari; optional Gemini via GEMINI_API_KEY")
    ask.add_argument("question", nargs="+", help="Question")
    ask.add_argument("--offline", action="store_true", help="Skip Gemini and use local fallback")
    ask.add_argument("--json", action="store_true", help="Print JSON response")

    team = sub.add_parser("team", help="Run the repository-aware Level-3 team")
    team.add_argument("goal", nargs="+", help="Goal to delegate")
    team.add_argument("--offline", action="store_true", help="Force deterministic local team")
    team.add_argument("--approval", choices=("deny", "interactive"), default="deny", help="Risky tool approval (default deny)")
    team.add_argument("--json", action="store_true", help="Print JSON run state")

    sales = sub.add_parser("sales", help="Run consent-first draft-only sales preview")
    sales.add_argument("goal", nargs="+", help="Sales goal")
    sales.add_argument("--leads", type=Path, help="User-authorized JSON array; no scraping or enrichment")
    sales.add_argument("--channel", choices=("email", "whatsapp", "phone"), default="email")

    sub.add_parser("sales-agents", help="List all sales role profiles")
    sub.add_parser("test", help="Run the bundled agent and agency tests")

    web = sub.add_parser("web", help="Start the Ari/PWA web UI for this project")
    web.add_argument("--host", default="127.0.0.1", help="Use 0.0.0.0 only on a trusted network")
    web.add_argument("--port", type=int, default=8000)
    web.add_argument("--offline", action="store_true", help="Skip Gemini")

    args = parser.parse_args(argv)
    root = args.root.expanduser().resolve()
    if not root.is_dir():
        parser.error(f"project root does not exist: {root}")

    if args.command == "ask":
        offline = args.offline
        result = _agency(root, offline).ask(" ".join(args.question), use_model=not offline)
        print(json.dumps(result, ensure_ascii=False, indent=2) if args.json else result["answer"])
        return 0

    if args.command == "team":
        from agents import AgentTeam

        state = AgentTeam(_config(root, args.offline, args.approval)).run(" ".join(args.goal))
        if args.json:
            print(json.dumps(state.to_dict(), ensure_ascii=False, indent=2))
        else:
            print(state.final or "(no final summary)")
            print(f"Run status: {state.status}\nReport: {Path(state.run_dir) / 'report.md'}")
        return 0 if state.status in {"completed", "needs_approval", "blocked"} else 1

    if args.command == "sales":
        from agency.sales import SalesAgency

        leads = None
        if args.leads:
            try:
                leads = json.loads(args.leads.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                parser.error(f"could not read leads JSON: {exc}")
            if not isinstance(leads, list):
                parser.error("--leads file must contain a top-level JSON array")
        result = SalesAgency().run(" ".join(args.goal), leads=leads, channel=args.channel)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0

    if args.command == "sales-agents":
        from agency.sales import SalesAgency

        sales_agency = SalesAgency()
        print(json.dumps({"departments": sales_agency.departments(), "agents": sales_agency.list_agents()}, ensure_ascii=False, indent=2))
        return 0

    if args.command == "test":
        import unittest

        loader = unittest.TestLoader()
        suite = unittest.TestSuite()
        for test_dir in (PLUGIN_ROOT / "agents" / "tests", PLUGIN_ROOT / "agency" / "tests"):
            suite.addTests(loader.discover(str(test_dir), pattern="test*.py", top_level_dir=str(PLUGIN_ROOT)))
        result = unittest.TextTestRunner(verbosity=2).run(suite)
        return 0 if result.wasSuccessful() else 1

    if args.command == "web":
        from agency import Agency
        from agency import app as app_module

        app_module.AGENCY = Agency(
            config=_config(root, args.offline),
            memory_path=_runtime() / "memory.json",
            offline=args.offline,
        )
        print(f"Ari web app for {root} at http://{args.host}:{args.port}; no API authentication is enabled.", flush=True)
        app_module.serve(host=args.host, port=args.port)
        return 0

    return 2


if __name__ == "__main__":
    raise SystemExit(main())
