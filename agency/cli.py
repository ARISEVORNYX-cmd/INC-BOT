"""CLI for Ari + the 66-agent agency.

    python -m agency.cli "2+2*5 kya hai"
    python -m agency.cli "security audit chahiye" --panel
    python -m agency.cli --list
    python -m agency.cli --team "INC-BOT ka audit karo"
    python -m agency.cli --sales "Qualify consented leads" --sales-leads leads.json
    python -m agency.cli --sales-agents
    python -m agency.cli --stats
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from .agency import Agency


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="agency", description="Ari + general and consent-first sales role agencies")
    p.add_argument("question", nargs="?", help="Kuch bhi pucho")
    p.add_argument("--panel", action="store_true", help="5 specialists ka panel jawab")
    p.add_argument("--model", action="store_true", help="Gemini try karo (default: auto, key ho to)")
    p.add_argument("--local-only", action="store_true", help="Gemini/network ko skip karke local fallback use karo")
    p.add_argument("--list", action="store_true", help="66 agents ki list")
    p.add_argument("--stats", action="store_true", help="Agency stats")
    p.add_argument("--team", metavar="GOAL", help="Purane agents/ L3 team ko goal do")
    p.add_argument("--sales", metavar="GOAL", help="Consent-safe sales workflow preview chalao")
    p.add_argument("--sales-leads", metavar="JSON_FILE", help="User-supplied leads JSON array (preview/drafts only)")
    p.add_argument("--sales-channel", choices=("email", "whatsapp", "phone"), default="email", help="Draft channel for --sales")
    p.add_argument("--sales-agents", action="store_true", help="4 departments + 56 sales role profiles list karo")
    p.add_argument("--remember", metavar="FACT", help="Personal memory me fact save karo")
    p.add_argument("--forget", action="store_true", help="Memory saaf karo")
    p.add_argument("--json", action="store_true", help="Pura JSON output")
    args = p.parse_args(argv)
    if args.sales_leads and args.sales is None:
        p.error("--sales-leads ke saath --sales GOAL bhi do")

    a = Agency()
    if args.sales_agents:
        result = {
            "departments": a.sales_departments(),
            "agents": [
                {key: agent[key] for key in ("id", "name", "department", "mission")}
                for agent in a.sales_agents()
            ],
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    if args.sales is not None:
        leads = None
        if args.sales_leads:
            try:
                leads = json.loads(Path(args.sales_leads).read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                p.error(f"sales leads JSON read nahi hua: {exc}")
            if not isinstance(leads, list):
                p.error("sales leads JSON ka top-level array hona chahiye")
        result = a.run_sales(args.sales, leads=leads, channel=args.sales_channel)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    if args.forget:
        print(json.dumps(a.forget(), ensure_ascii=False, indent=2))
        return 0
    if args.remember:
        print(json.dumps(a.remember(args.remember), ensure_ascii=False, indent=2))
        return 0
    if args.list:
        roster = a.list_agents()
        print(f"{len(roster)} specialists:\n")
        for item in roster:
            print(f"  {item['id']:42s} [{item['category']}] {item['name']}")
        return 0
    if args.stats:
        print(json.dumps(a.stats(), ensure_ascii=False, indent=2))
        return 0
    if args.team:
        result = a.delegate(args.team)
    else:
        q = args.question or "tum kya kar sakte ho?"
        result = a.consult(q) if args.panel else a.ask(q, use_model=args.model or not args.local_only)

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(result.get("answer") or result.get("final") or json.dumps(result, ensure_ascii=False))
        if result.get("report"):
            print(f"\n📄 {result['report']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
