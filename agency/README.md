# 🏛️ INC AI Agency — `agency/`

**Ari (personal AI) + 66 general role profiles + 56 sales role profiles + tumhara `agents/` Level-3 team** — sab ek local-first app me.

Important: `66 + 56` ka matlab **prompt/role profiles** hain, itne 122 independent models ek saath run nahi ho rahe. Sales pipeline deterministic, consent-first preview hai; real messages, phone calls, live Apollo/CRM writes ke adapters/credentials configured nahi hain.

## Architecture
```
User question ──▶ Ari (personal AI)
                    ├── saved Jarvis Q&A / safe math / IST clock
                    ├── Gemini when GEMINI_API_KEY is configured
                    └── always-nonempty local fallback (not a guarantee of factual correctness)

General panel ──▶ 66 searchable role/persona profiles (5 perspectives in panel mode)
Sales workflow ─▶ 56 role profiles across 4 departments
                    Lead Generation → Outreach → Sales Calling → CRM Operations
                    └── local scoring + drafts + proposed CRM patches (never sent/applied)
Big goal ───────▶ old `agents/` L3 Lead → Researcher → Coder → Reviewer/retry → Ops
                    └── path-guarded tools + approval gate (default deny)
```

## Kya-kya hai
| Cheez | File | Count / use |
|---|---|---|
| Personal AI (**Ari**) | `personal.py` | 1; memory + local fallback + optional Gemini |
| General role/persona profiles | `agents.json` + `registry.py` | **66** searchable profiles |
| Sales agency roster | `sales/roster.json` + `sales/engine.py` | **56** role profiles: 16 + 16 + 12 + 12 |
| Agency wrapper | `agency.py` | joins Ari + both registries + old L3 team |
| Previous Level-3 orchestrator | `../agents/` | one team runtime, researcher/coder/security/reviewer/ops |
| Hosted app | `app.py` | live preview + Vercel-ready companion |
| CLI | `cli.py` | `python -m agency.cli` |
| Reference / attribution | `SOURCES.md` | persona-repo research + sales-reel notes |

## Run locally / Arena live preview
```bash
python -m agency.app                       # host 0.0.0.0:8000
python -m agency.cli "2+2*5 kya hai"
python -m agency.cli "security audit chahiye" --panel
python -m agency.cli --list
python -m agency.cli --team "INC-BOT ka safe audit karo"
python -m agency.cli --sales-agents
python -m agency.cli --sales "Qualify opt-in leads" --sales-leads leads.json
python -m agency.cli --stats
python -m unittest discover -s agency/tests -v
```

For detailed general answers, configure `GEMINI_API_KEY` in environment or a local `.env` (never commit it). Ari tries Gemini automatically if a key exists; if absent/unavailable, it returns a **non-empty local fallback**, which may not know current facts. No API key is required for offline tests or demos.

## Phone / PWA
The UI now has a responsive mobile layout, browser speech input/output where supported, an installable PWA manifest, and an offline cache for the static shell only. Open the hosted HTTPS app on Android Chrome and choose Install; on iPhone use Safari → Share → Add to Home Screen. Only the UI shell is cached: Ari still needs the API/server for answers, so it is not an offline phone-resident LLM. The PWA source is ready, but production hosting is not deployed yet. The Dexter reel's official site says Dexter runs on Windows/macOS and that the phone prompt emails a download link for installing on a computer—not an Android/iPhone app [source](SOURCES.md).

## Sales workflow — inspired by the first new reel
Reel `DfFAIobhrNm` describes 50+ agents in four departments: Lead Generation, Outreach, Sales Calling, CRM Operations. This project adds **56 original sales-role definitions** across those four groups and a safe pipeline preview.

CLI/API:
```bash
python - <<'PY'
from agency import Agency
from agents import TeamConfig
app = Agency(config=TeamConfig(offline=True, approval_mode="deny"), offline=True)
print(app.sales_departments())
result = app.run_sales("Qualify opt-in leads", leads=[{
    "id": "example-1", "company": "Example Co", "title": "Operations lead",
    "email": "person@example.com", "source": "user supplied",
    "intent": "exploring automation", "email_opt_in": True,
    "phone_call_opt_in": False, "whatsapp_opt_in": False
}])
print(result["status"], result["counts"], result["actions"])
PY
```

| Method | Path | Kaam |
|---|---|---|
| GET | `/api/sales/departments` | 4 departments + role counts |
| GET | `/api/sales/agents?department=lead_generation` | Filter 56 profiles |
| POST | `/api/sales/run` | Local qualification + outreach/call drafts + CRM patch proposals |

**Boundaries:** lead input must be supplied by the user or a configured, authorized provider. No scraping, Apollo enrichment, email/WhatsApp send, call, calendar invite, or CRM update is performed. Channel-specific explicit opt-in and do-not-contact checks apply. Every output remains a human-reviewable draft/proposal. Raw rows are not persisted by this workflow.

## General-agent HTTP API (relative URLs)
| Method | Path | Kaam |
|---|---|---|
| GET | `/` | Chat + sales preview UI |
| GET | `/api/health` | service + role counts |
| GET | `/api/agents?category=design` | 66 general role profiles |
| GET | `/api/stats` | full stats |
| GET | `/api/memory` | saved conversation history |
| GET | `/api/ask?q=...` | quick ask |
| POST | `/api/ask` | `{"question":"...","panel":false,"use_model":true}` |
| POST | `/api/team` | `{"goal":"..."}` → previous `agents/` L3 team |
| POST | `/api/hire` | `{"agent_id":"...","question":"..."}` |
| POST | `/api/remember` | `{"fact":"..."}` |
| POST | `/api/forget` | clear personal memory |

## Answer behavior
`PersonalAgent.ask()` always produces a non-empty answer:
1. Saved Q&A from `jarvis/my_brain/qa.json`
2. Safe arithmetic and date/time (IST)
3. Gemini when `GEMINI_API_KEY` is configured (network/model failure falls back)
4. Specialist routing + structured local fallback

**Non-empty is not the same as factually correct.** Without a configured model, the offline fallback is limited; it should not be treated as a current web search or expert factual answer. Tests verify non-empty behavior and the cases above, not truth for arbitrary questions.

## Existing L3 work integrated
`Agency.lead_team = AgentTeam(...)`; `agency.delegate(goal)` / `POST /api/team` invokes the existing `agents/` orchestrator: plan → Researcher → Coder → Reviewer revise/approve loop → Ops → run report. Approval defaults to `deny`; no repository edit or outgoing message is automatically executed.

## Vercel companion
`agency/vercel/` contains the Node UI + `/api/ask` + `/api/sales` functions. `/api/ask` uses OpenRouter when `OPENROUTER_API_KEY` is configured (default slug `openrouter/free`, free slugs only); Gemini remains selectable with `AI_PROVIDER=gemini`, and provider failures use the local answer fallback. Configure secrets in Vercel's encrypted environment settings; see [`agency/vercel/README.md`](vercel/README.md). The project has been created, but the provider blocked the deployment-creation request; **production is not deployed yet**. Arena's local preview is running separately.

## Google Drive companion bundle (not direct repo integration)
The refreshed bundle and corrected manifest are uploaded to `02 - GitHub Repositories`:
- [AI-Agency-Connector-v2.zip](https://drive.google.com/file/d/10x4Cvw8y3Klj7HNEjyC_f2U1-3s4ucCr/view)
- [AI-Agency-All-Repos-Manifest-v2.json](https://drive.google.com/file/d/1trwdRSmw3w2M8a9m0M5IKznJiycDv7WY/view)

V1 copies were renamed `*-v1-SUPERSEDED`. **The 47 original Drive repo ZIP files were not modified**, no comments were added (the comment operation was blocked), and this does not establish live integrations with the GitHub repositories. To integrate one repo, download its ZIP, extract it locally, then review/copy `agents/` and `agency/` into that repository. The v2 manifest marks each entry as companion-bundle-only.

## 47 repository archive copies
A local copy-only batch is generated under `google_drive/upgraded-repos/`; its machine-readable index is `AI-Agency-Upgraded-Repos-v1.json`, and the [download catalog](../AI-Agency-Upgraded-Repos-v1.md) links all 47 outputs. The copies are also uploaded as new files to this [Drive folder](https://drive.google.com/drive/folders/1AlfV7pZfGKgORF7VdNGOG-K-oJnO-oAS); original Drive ZIPs were not replaced. Each archive keeps the upstream app in place and adds the shared Ari/Level-3/sales/PWA sidecar under an isolated directory. The index records each source Drive ID and SHA-256; the original staged ZIPs are untouched. This does **not** integrate a latest model into each upstream app, update its dependencies, perform a repo-specific security review, run upstream builds/tests, or deploy it. Treat it as a bundled companion, not a completed custom upgrade of every repository.

## Safety & secrets
- API keys stay in environment/`.env`, never source control.
- Personal history lives under ignored `agency/.runtime/memory.json`.
- Sales workflows are draft-only; external actions are not registered.
- The old team defaults to approval `deny`; `write_file`/webhook tools stay gated.
- Vercel functions are stateless; only add model secrets in Vercel's encrypted environment settings.

## Tests
```bash
python -m unittest discover -s agency/tests -v
python -m unittest discover -s agents/tests -v
python -m unittest discover -s tools/tests -v
```
