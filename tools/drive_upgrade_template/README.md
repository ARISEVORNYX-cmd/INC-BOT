# INC-BOT AI sidecar — repository upgrade

This folder is a **separate, complete AI companion** embedded in this repository ZIP. It does not overwrite the repository's own source, dependency files, `agents/`, or `agency/`; it lives under `inc_bot_ai/` and can be removed without changing the original project. The generated project profile records detected stack markers, but the upstream application itself was not rewritten.

## Quick start (Python 3.10+; standard library only)
Run from the extracted repository root:

```bash
python inc_bot_ai/launcher.py ask "Explain this project" --offline
python inc_bot_ai/launcher.py team "Audit this repository and propose safe improvements" --offline
python inc_bot_ai/launcher.py sales-agents
python inc_bot_ai/launcher.py sales "Qualify opted-in leads" --leads leads.json
python inc_bot_ai/launcher.py web --host 127.0.0.1 --port 8000
```

For detailed Ari responses, set `GEMINI_API_KEY` in your environment before running; never place the secret in this ZIP or commit it. Team root is this repository, run reports and personal memory stay under `inc_bot_ai/.runtime/`, and risky agent tools default to **deny**. `team --approval interactive` is opt-in and only prompts on an interactive terminal.

The sales preview uses only a lead array supplied by you. Channel-specific explicit opt-in and do-not-contact checks are applied; it never scrapes or enriches contacts, sends a message, places a call, or writes a CRM record. Review every draft before using it.

## Phone use
The included Ari UI is responsive and PWA-ready, with browser speech input/output and a cache of the static app shell. To use it from a phone, run the web host on a trusted network or deploy the included `inc_bot_ai/agency/vercel/` companion to HTTPS, then open it in the phone browser. Android Chrome can offer Install; on iPhone use Safari → Share → Add to Home Screen. A PWA install and speech APIs need a supported secure context. Only the shell is cached; API/model answers are not available offline. The current package is source-ready and does not include a production deployment or an always-on phone-resident LLM.

For LAN access, `--host 0.0.0.0` exposes the unauthenticated HTTP UI to devices on that network. Use only on a trusted private network and do not expose it publicly without adding authentication/TLS. A remote model request sends the question and selected role context to the configured model provider.

## Verification and boundaries
Run the included sidecar tests:

```bash
python inc_bot_ai/launcher.py test
```

These tests validate the shared sidecar code. The original project's build/tests were not run or altered as part of this archive operation. See `project_profile.json` for the per-repo archive metadata and detected stack markers; it is a profile, not a claim of a custom code audit.
