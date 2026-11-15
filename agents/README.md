# 🤖 `agents/` — Level-3 Agent Team for INC-BOT

Reel wala concept: **L1 chatbot → L2 fixed workflow → L3 agent teams**.
Is repo me pehle se L1/L2 tha (`jarvis/brain.py` rules + Gemini allowlist, `.github/workflows` schedules).
Yahan **L3** add hai: ek Lead goal todta hai, specialist agents apne tools chalate hain,
outputs aage handoff hote hain, reviewer `revise` bhej ta hai to coder retry karta hai,
aur risky actions approval gate par rukte hain.

## Kahan chalega (sabse best)
Ek hi portable core, teen jagah se:

| Host | Kaise | Default safety |
|---|---|---|
| **CLI / local** | `python -m agents.cli "goal"` | `deny` — risky tools blocked |
| **Discord bot** | `AGENT_TEAM_ENABLED=1` → `/team <goal>` | owner/admin only, `deny` |
| **GitHub Actions** | `Agent Team (manual)` workflow_dispatch | `deny`, report artifact |

Core kisi bhi host se import ho sakta hai:
```python
from agents import run_goal, TeamConfig
state = run_goal("Audit INC-BOT", config=TeamConfig(offline=True))
print(state.final, state.run_dir)
```

## Architecture
```
Lead / Orchestrator  (orchestrator.py)
 ├── Planner      → shared Task board (JSON, resumable)
 ├── Researcher   → list_files / read_file / git_status / gh_runs   [read-only]
 ├── Coder        → write_artifact (draft) / write_file* / py_compile
 ├── Security*    → read-only secret + path audit
 ├── Reviewer     → approve / revise  → coder retry loop (max_cycles)
 └── Ops          → final handoff / send_discord* / connector_call*
                 * = risky, ApprovalGate se guzarna padta hai
```

- `models.py` — `Task`, `RunState`, timeline, `TeamConfig`, thread-safe `log_event`
- `llm.py` — Gemini (`GEMINI_API_KEY`) + deterministic offline fallback
- `tools.py` — `ToolRegistry`, path guards, backups/diffs, `ApprovalGate`
- `roles.py` — narrow role prompts + per-role tool allowlists
- `orchestrator.py` — plan → ready-task dispatch → handoff → review loop → persist
- `cli.py` — `python -m agents.cli`
- `adapters/discord_adapter.py` — optional `/team`

Har run `agents/runs/<run_id>/` me `state.json` + `report.md` + `artifacts/` likhta hai
(ye folder `.gitignore` me hai, repo me commit nahi hota).

## Quick start
```bash
# No API key? Offline demo still runs the full team + review loop.
python -m agents.cli --demo --offline --approval deny

# Apna goal
python -m agents.cli "INC-BOT me /health endpoint add karo, test ke saath" --offline

# Gemini se (key .env ya env me)
export GEMINI_API_KEY='...'
python -m agents.cli "Refactor the welcome flow" --approval deny

# Pichla run dekho / resume karo
python -m agents.cli --list-agents
python -m agents.cli --status <run_id>
python -m agents.cli --resume <run_id> --approval auto
```

### Flags
| Flag | Matlab |
|---|---|
| `--offline` | Deterministic brain, bilkul no network |
| `--dry-run` | Koi bhi tool execute nahi, sirf simulate |
| `--approval deny\|auto\|interactive` | Risky tool policy (**default `deny`**) |
| `--max-cycles N` | Reviewer kitni baar `revise` bhej sakta hai |
| `--parallel` | Independent ready tasks ek saath |
| `--json` | Pura `RunState` JSON (CI/automation ke liye) |
| `--run-root DIR` | State kahan store ho |

## Safety (important)
- `read_file` / `list_files` / `git_status` / `gh_runs` / `py_compile` → read-only, free.
- `write_artifact` → sirf ignored run folder me, isliye safe.
- `write_file`, `send_discord`, `connector_call` → **risky**. Default `deny` me chalte hi nahi;
  `auto`/`interactive` me `write_file` pehle backup + unified diff bana ke deta hai.
- Path guard: `.git`, `.env`, credentials, `__pycache__`, binaries, `..` traversal, repo-root ke bahar — sab block.
- `agents/runs/` state immutable hai; `write_file` usse overwrite nahi kar sakta.
- Koi API key / token code me nahi. `bot/.env` ya env se automatically uthata hai.

## Apna tool / connector jodo
```python
from agents import Tool, ToolRegistry

reg = ToolRegistry()
reg.register(Tool(
    name="supabase_insert",
    description="Insert a row into Supabase",
    risky=True,                    # approval gate lagega
    handler=lambda args, ctx: f"would insert {args}",
))
# AgentTeam(config, registry=reg)
```
Gmail / Drive / Sheets / Dropbox / Supabase / Vercel ke real calls Arena connector tools se
ya apne adapter se wire karo; standalone runtime me `connector_call` ek saaf placeholder hai.

## Discord me chalana
`bot/.env` me:
```text
AGENT_TEAM_ENABLED=1
# GEMINI_API_KEY already upar hai
```
Bot restart karo → `/team goal:...` (sirf owner/admin). Command dry nahi hai, par
`approval_mode="deny"` hai, isliye repo edit / message bhejna automatically block rahega.
Report `.md` attach ho jati hai.

## CI me chalana
`.github/workflows/agent-team.yml` → **Run workflow** → goal do → `agents/runs/**` artifact upload.
Offline by default; `GEMINI_API_KEY` secret ho to model-driven plan chalega.

## Tests
```bash
python -m unittest discover -s agents/tests -v
python -m compileall -q agents
```

## Status
`state.status` = `completed` / `blocked` (approval pending) / `partial` (cycle cap).
`state.pending_approvals` me exact tool + reason milta hai.
