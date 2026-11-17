# Ari Studio Director — phased design

## Confirmed product direction
- Build order is user-confirmed: **Personal Ari first; the 50–70-specialist AI agency only after Ari is useful and stable.**
- Owner's personal AI director for an **AI Automation, Creative & Product Development Studio**.
- First use surface: a private, responsive web app/PWA on the owner's phone and laptop; Android device-control tasks can use the Termux companion later.
- Client research for India and worldwide; product work includes AI websites/apps, Discord bots, integrations, and automation.
- Ari's presentation is warm and humanoid-style, while staying transparent that it is an AI—not a human or a conscious being. It should default to Roman Hindi + English technical terms (Hinglish), unless the user asks for another language. Give reasoned recommendations and one useful proactive next step, with uncertainty and trade-offs clearly stated.
- Creative coverage includes graphic/vector design, image editing, storyboards, motion design, programmatic video, UI micro-interactions, and 3D. The curated 10-source catalog is reference-only; nothing third-party has been installed or run.
- The owner approves client outreach, production releases, sensitive phone actions, asset/cloud writes and deletes.
- **Selected payment notification threshold:** notify only when a provider verifies a final cleared/settled payment; no alerts for project acceptance alone, invoices created, pending/initiated/authorized payments. Provider and delivery channel are not selected, so this is a requirement only and no live notifications are enabled. No money movement.
- Free-first providers only; do not use Gemini. Respect rate limits and pause/resume when quotas are exhausted.

## User-confirmed build order and where Ari will be used

1. **Personal Ari MVP first.** Make the single-user assistant useful for the owner's daily planning, Hinglish conversation, voice/chat, project notes and safe recommendations.
2. **Use it privately on phone and laptop.** The intended surface is the responsive web app/PWA opened in a mobile or desktop browser. The current Vercel companion is only a local/preview prototype: it is not deployed and has no live private URL. Do not tell the owner to sign into a nonexistent production app.
3. **Then build the agency.** Curate 50–70 specialist role profiles total, then route work through Ari. These are not 50–70 separate model sessions; start with no more than five active specialist runs, and keep model, time and cost budgets bounded.
4. **Android device actions are a separate, later capability.** A web page cannot operate other phone apps by itself. Use the local Termux companion only for allowlisted tasks with Android permissions and owner confirmation.

The reel mentioning OpenJarvis points to a relevant local-first personal-AI reference: the official project describes on-device use with optional cloud APIs, plus presets such as morning briefings. It is a benchmark, not a dependency selected for this product. No OpenJarvis code was cloned, installed, or run. Review the install script, model/hardware requirements, OAuth scopes and outbound network behavior before deciding to reuse it.

## Existing building blocks
- `agency/`: Ari plus 66 general and 56 sales role-profile templates. These are catalog entries, not active model sessions; the later agency roster must be curated to 50–70 profiles total.
- `agency/creative/`: persona contract and creative QA/playbook; `agency/vercel/data/creative-sources.json` is the bundled ten-source reference catalog. No external code has been installed.
- `agents/`: bounded Level-3 plan/research/code/review workflow with an approval gate.
- `jarvis/`: Android/Termux companion and allowlisted local phone actions.
- `agency/vercel/`: mobile PWA and serverless companion. The connected Vercel project exists but has not been deployed.

Ari is the one persistent personal assistant. In the later agency phase, she can delegate a small number of tasks to specialist profiles; 50–70 does not mean 50–70 model calls running simultaneously.

## Phase 1 — Personal Ari MVP (code built; preview-only)
- The Vercel app shell now contains owner-email magic-link sign-in, server-side owner checks, secure HttpOnly cookies, chat UI, conversation history, and a deterministic planning preview. These are local repository changes, not a live service.
- Every stateful API is intended to require the single owner email. The static sign-in shell can load publicly; private chat data and API responses must remain inaccessible without an authenticated owner session.
- Creative briefs can select up to three of ten reviewed repository references by fit. The selector does not install, execute or copy a source.
- The 5-role review is one Ari response using role context, not five separate running agents. No autonomous workers, external search, lead capture, client contact, device action, file mutation, or asset upload is enabled. The approved cloud setup so far is limited to empty RLS-protected chat tables, one publishable key, the exact owner allowlist, and production Auth/origin configuration; no app deployment exists yet.
- The existing Python `agency.app` is still unauthenticated; do not expose it.
- The Vercel web app is not live yet: production runtime environment variables and Supabase Auth URL allow-list now target `https://inc-ari-agency.vercel.app`, but there is no owner Auth account or deployment yet. The owner has approved private/free hosting; no paid services or unauthenticated Python app exposure are authorized.

## Phase 1B — private persistence/work queue (existing schema; app persistence pending cloud setup)
- Three additive migrations are now applied to the approved `Personal ai Project`: `20261116150351_create_studio_core`, `20261116150602_tighten_studio_table_grants`, and `20261116234854_create_ari_personal_memory`. The Ari conversation/message tables have RLS enabled and were verified empty after migration.
- New tables: `studio_jobs` (plan/status/checkpoint and bounded attempts), append-only `studio_job_events`, `studio_approvals`, and metadata-only `studio_repo_sources` (Drive file references; no ZIP contents).
- Every table has RLS scoped by `owner_id = auth.uid()`. Authenticated access is least-privilege; the queue tables do not grant hard-delete or truncate, and events are read/insert only. Use a `cancelled` job status rather than hard deletion.
- The existing `assistant_memories` table was inspected at the schema/metadata level only. No existing rows were read, changed, or deleted.
- Local migration `supabase/migrations/20261116234854_create_ari_personal_memory.sql` and server-side chat/auth code match the applied Supabase schema. The new tables are RLS-enabled and empty; no Auth account or personal chat row has been created. Supabase Auth Site URL/redirect allow-list and production Vercel environment variables are configured for `https://inc-ari-agency.vercel.app`, but no Vercel deployment exists yet. A publishable Supabase API key named `ari_web` is stored as a sensitive Vercel production variable; do not expose key values or claim the website is private until owner/non-owner access checks pass.

## Phase 2 — AI agency (50–70 curated profiles; only after Personal Ari is useful)
- Curate 50–70 specialist role profiles total from the existing templates; do not market the current 66 + 56 template libraries as 122 running AIs.
- Ari routes work to at most five active specialists per task; use explicit budgets, isolated workspaces and owner review.
- Public-source research records URLs and timestamps; respect robots, API terms, privacy, and opt-outs.
- Website/code tasks work in an isolated branch/worktree, run tests/security checks, and generate a preview artifact.
- Retries are capped (initially 3); each run has a timeout, output cap, and provider-call budget. Blocked runs persist and resume instead of spinning forever.
- Payment-alert preference is configured in the plan preview only. A live implementation must verify the selected provider's webhook signature, map an authoritative cleared/settled status, enforce idempotency, and notify only the owner; it must not charge/refund/transfer funds. Choose the provider and delivery channel before wiring it.

## Optional phone/device companion (after the private web MVP)
- Keep device execution on the user's Android phone; a Vercel page cannot directly control other apps.
- Use Termux/Termux:API and explicit Android permissions. The phone polls for owner-authorized, signed, allowlisted jobs; never expose Jarvis's local control port publicly.
- Require confirmation for messaging/calls, account or security settings, payments, deletes, and any action that could expose private data.

## Controlled integrations and deployment
- Add Gmail/Calendar/Drive only with minimum OAuth scopes and read-only access first.
- Client outreach remains a draft until the owner approves the exact recipient and content.
- Deploy previews first; production deploys require owner approval and a rollback record.
- Use security headers, authentication, rate limiting, RLS, redacted logs, and backups. Firewall/WAF and free-tier guarantees depend on the provider plan.

## Cost and availability
A zero-cost, unlimited, always-on AI workforce cannot be guaranteed: Vercel, database, phone background execution, and free model providers all impose quotas or platform restrictions. The system should use local deterministic actions when possible, queue and checkpoint model work, and pause safely when free limits are reached. It must not evade paid quotas or platform controls.
