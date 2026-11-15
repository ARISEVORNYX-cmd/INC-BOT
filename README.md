# INC-BOT

eSports Discord + GitHub automation — INC server (guild 1559846127279407145) ke liye.

## Kya hai isme?
1. `.github/workflows/discord-notify.yml` → push/PR/issue/release pe Discord channel `1559886513423257610` me embed
2. `bot/` → Auto-DM bot (join -> DM + Verify button)
3. `setup.sh` → secret set + push ek command me

Live webhook: `1561454862871568445` (INC Bot) channel `1559886513423257610` verify HTTP 200.

> ⚠️ Webhook/Token ko file me commit mat karo — `.env` use karo.

## Quick Start
```bash
export GITHUB_TOKEN=ghp_xxx
export DISCORD_WEBHOOK='https://discord.com/api/webhooks/ID/TOKEN'
./setup.sh glverma592-cmd/INC-BOT
```
## 🤖 Level-3 Agent Team (`agents/`)

L1 chatbot → L2 workflow → **L3 agent teams**: Lead + Researcher + Coder + Reviewer + Ops,
shared task board, handoff, review/retry loop, tool allowlists aur approval gate.
Pura detail: [`agents/README.md`](agents/README.md).

```bash
# Offline demo (koi API key nahi chahiye)
python -m agents.cli --demo --offline --approval deny

# Apna goal
python -m agents.cli "INC-BOT me /health endpoint add karo, test ke saath" --offline

# Tests
python -m unittest discover -s agents/tests -v
python -m unittest discover -s tools/tests -v
```

Teen jagah se chal sakta hai: **CLI**, **Discord `/team`** (`AGENT_TEAM_ENABLED=1` in `bot/.env`),
aur **GitHub Actions** (`Agent Team (manual)` workflow). Default `--approval deny` hai —
koi bhi repo edit / email / webhook bina approve nahi hota. Run state `agents/runs/` me
(generated, gitignored) `state.json` + `report.md` ke saath save hoti hai.

## 🏛️ INC AI Agency (`agency/`)

**Ari + 66 general role profiles + 56 sales role profiles + purana `agents/` Level-3 team.** Ari attempts Gemini when configured and has a non-empty local fallback; the sales workflow is consent-first and draft-only. Detail: [`agency/README.md`](agency/README.md).

```bash
python -m agency.app                       # live host (0.0.0.0:8000)
python -m agency.cli "2+2*5 kya hai"
python -m agency.cli "security audit" --panel
python -m agency.cli --team "INC-BOT ka audit karo"
python -m unittest discover -s agency/tests -v
```

General role profiles [Anas-Khan93/ai-agency-agents](https://github.com/Anas-Khan93/ai-agency-agents)
se curate hue; 56 sales role profiles char consent-first departments me hain. Inhe
independent model instances na samjhein. Vercel-ready companion `agency/vercel/` me hai; production
deployment abhi nahi hua. Sales preview kabhi message send, call, ya CRM write nahi karta.

## Copy-only archive batch for 47 repositories
Generated ZIP copies live in `google_drive/upgraded-repos/`, indexed by
[`AI-Agency-Upgraded-Repos-v1.json`](AI-Agency-Upgraded-Repos-v1.json); see the
[47-archive download index](AI-Agency-Upgraded-Repos-v1.md). The 47 new Drive copies are in
[this folder](https://drive.google.com/drive/folders/1AlfV7pZfGKgORF7VdNGOG-K-oJnO-oAS).
The source manifest is [`AI-Agency-All-Repos-Manifest-v2.json`](AI-Agency-All-Repos-Manifest-v2.json).
Each output adds the shared Ari/Level-3/sales/PWA sidecar in its own directory; it does **not**
rewrite each upstream app, refresh its dependencies, run that project's tests, or deploy it.
Google Drive source ZIPs remain untouched. This is a companion bundle, not proof that all 47
applications have been fully upgraded or use the latest AI model.

## Bot
```bash
cd bot
cp .env.example .env
pip install -r requirements.txt
python bot.py
```

## Hosting (BotKeep / Render)
- Repository: `glverma592-cmd/INC-BOT`, Branch: `main`
- Install: `pip install -r requirements.txt`
- Start: `python main.py`
- Env: `DISCORD_BOT_TOKEN`, `WELCOME_CHANNEL_ID=1559886513423257610`, `VERIFY_ROLE_ID=0`, `REQUIRE_VERIFY=0`
