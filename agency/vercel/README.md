# Ari Personal AI — private-by-design app code (not deployed)

Personal Ari is phase 1. The planned 50–70 specialist profiles are phase 2 and are not running agents. This directory now contains a responsive PWA shell, an owner-only email magic-link login, protected server APIs, a private chat-history API, and a Supabase RLS schema. **Initial cloud setup is in progress, but the app is not deployed and no owner Auth account exists.** The chat migration `20261116234854_create_ari_personal_memory` has been applied to the connected Supabase project; both tables have RLS enabled and a read-only check found zero chat rows. Production Vercel variables are configured for Supabase, the owner allowlist, the exact app origin, and local-only AI mode; Supabase Auth Site URL and redirect allow-list now target `https://inc-ari-agency.vercel.app`. Do not treat the site as live/private until deployment and owner/non-owner access checks pass.

## Privacy and security design

- The public app shell contains no user chats. `/api/auth`, `/api/ask`, `/api/studio`, `/api/sales`, and `/api/chats` use same-origin requests and are protected by a server-side Supabase user check plus an exact `ARI_ALLOWED_EMAIL` allowlist.
- The Supabase email magic-link callback is checked by the server. Access/refresh tokens are immediately exchanged for `Secure`, `HttpOnly`, `SameSite=Strict` cookies, not kept in browser storage. The browser never receives a Supabase API key or service-role credential; callback tokens are removed from the address bar before the exchange.
- Personal conversations are stored in `ari_conversations` and `ari_messages`. Every row has an `owner_id`; RLS checks it against `auth.uid()`. The server uses the signed-in owner's token for PostgREST requests. It never uses `service_role`.
- `supabase/migrations/20261116234854_create_ari_personal_memory.sql` defines those tables, indexes, least-privilege grants, and owner-only policies. It has been applied to the connected project; RLS is enabled on both tables.
- The service worker caches only the non-personal app shell; `/api/*` is never cached. The page uses a restrictive Content Security Policy, same-origin resource policy, no-index metadata, and `no-store` response headers. `noindex` is not an access-control mechanism; the login gate and API checks are.
- The login page itself can load publicly. Chat contents and server features must remain unavailable without the owner email. Avoid pasting passwords, payment details, health records, or other high-risk secrets.
- If a cloud model is configured, the question and bounded recent history are sent to that model provider. OpenRouter is optional, `store: false` is requested, and provider retention policies still apply. No model key is configured by this repository.

## Required owner setup before any live use

1. Configure these **server-side** Vercel Environment Variables for Production (and Preview only if needed):
   - `SUPABASE_URL` — the existing personal Supabase project's URL.
   - `SUPABASE_ANON_KEY` or `SUPABASE_PUBLISHABLE_KEY` — the project's public key; never use a `service_role`/secret key here.
   - `ARI_ALLOWED_EMAIL` — the one exact owner email address.
   - `ARI_ALLOWED_ORIGIN` — the exact canonical app origin, e.g. `https://ari.example.com` (origin only; no path or trailing slash). Use separate exact values for Production and any Preview environment you intentionally enable. Production POST requests fail closed if this is unset.
   - `AI_PROVIDER=local` initially. Leave all model keys unset until deliberately enabling a provider.
2. The chat schema migration has already been applied. Keep RLS enabled, then verify as the owner that reads/writes work and that an unrelated authenticated account cannot read, insert, update, or delete any Ari row before saving personal conversations.
3. Supabase Auth URL settings are now configured for the exact production origin `https://inc-ari-agency.vercel.app` only; a fresh read confirmed the Site URL and redirect allow-list. The default magic-link email template correctly links with `{{ .ConfirmationURL }}`; keep that template variable (this flow does not use `{{ .Token }}` or a numeric email code). Email Auth is enabled, but custom SMTP is not configured; Supabase reports a 2-email/hour send limit, so verify delivery when the owner requests a sign-in link. The first owner sign-in is allowlisted server-side and must be opened in the same browser. No Auth users exist yet and `disable_signup=false` remains temporarily necessary for the first allowlisted owner sign-in; after verifying that account, disable further sign-ups while keeping sign-in enabled. Do not broaden the allowlist.
4. Deploy the Vercel project with this directory as its root, then verify on the live domain: owner login works; a different email is rejected; `/api/ask`, `/api/studio`, `/api/sales`, and `/api/chats` return 401/403 when signed out; another Supabase account sees no chat rows; sign-out clears the session. Do not share the URL as if it were private before these checks pass.
5. Free-tier services have quotas, retention policies, and availability limits. They are not unlimited or guaranteed to remain free. For regional latency, the existing Supabase project is in `ap-south-1` (Mumbai), close to Lucknow; Vercel functions may run elsewhere unless configured.

**Current blocker:** Supabase's empty owner-scoped chat schema and production redirect settings are ready, and production Vercel env variables are set. There are still zero Auth users and no Vercel deployment. The existing default domain `https://inc-ari-agency.vercel.app` has Vercel SSO protection for non-custom domains, so it may require Vercel account access before Ari's own magic-link sign-in. After deployment, the owner must request and open a one-time link in the same browser; live sign-in and non-owner isolation checks have not yet been completed.

## Model behavior

- Default behavior is local, non-empty fallback; it does not call a model provider.
- Optional OpenRouter integration runs server-side with the official `@openrouter/sdk`. Use only free-model slugs in this app; paid slugs are blocked. Quotas and model availability can change, so no unlimited-access claim is made.
- `GEMINI_API_KEY` is ignored. Never place any provider key in HTML, `app.js`, a browser bundle, Git, or chat.
- The 5-role review uses specialist context in one Ari response; it does not start five separate workers.

## FreeLLMAPI with Claude (reference)

Repository: <https://github.com/tashfeenahmed/freellmapi>

The repository's current docs describe a local OpenAI-compatible gateway and generator commands for Claude Code. After installing/running the gateway on a supported computer, its documented Claude Code setup is:

```text
npx freellmapi setup-claude --url http://localhost:3001 --dry-run
npx freellmapi setup-claude --url http://localhost:3001
```

The installer/CLI guide is <https://github.com/tashfeenahmed/freellmapi/blob/main/docs/en/install/01-install.md>; Claude client guidance is <https://github.com/tashfeenahmed/freellmapi/blob/main/docs/en/clients/01-agent-clients.md>. FreeLLMAPI says it aggregates provider free tiers, but its token/provider counts are the project's own claims, not an unlimited or privacy guarantee. Provider keys and prompts are subject to the providers' terms.

For Claude Desktop, the project's docs describe **Setup → Gateway**, a bare gateway origin and a unified key. The desktop-app endpoint is `http://127.0.0.1:31415`; a local server install uses `http://localhost:3001`. Claude Code is a terminal coding tool, not the Claude phone app or `claude.ai`. The repository has an experimental Android Termux guide for FreeLLMAPI, but it does not turn Claude Code into an Android-phone app. This user currently has only a phone, so no desktop/terminal setup has been performed.

## Files

- `index.html`, `styles.css`, `app.js` — mobile-first sign-in and Ari workspace; user content is inserted as text, not HTML.
- `api/auth.js`, `_lib/private-auth.js` — allowlisted magic-link proxy, owner check, refresh handling, and HttpOnly cookie session.
- `api/chats.js` — owner-scoped chat list/read/save/delete operations through Supabase RLS.
- `api/ask.js` — Hinglish responses, bounded history, optional free-model request, and offline fallback.
- `api/studio.js` — deterministic, side-effect-free planning preview.
- `api/sales.js` — consent-first preview only; no scraping, sending, calling, or CRM writes.
- `data/` — role and creative reference catalogues, outside the public API directory.
- `service-worker.js` — app-shell caching only; never caches chat/API responses.
- `vercel.json` — routes and security headers.

## Local developer checks

The repository's automated suite mocks authentication/provider calls and does not need a real email, Supabase session, or OpenRouter key. Run `npm test` from this directory. For a local authenticated manual test, use a disposable Supabase project and test mailbox; do not expose a local dev server or use real private data.
