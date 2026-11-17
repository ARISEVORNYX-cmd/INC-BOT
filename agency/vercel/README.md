# Ari Personal AI — account-based private chat (local changes not yet deployed)

Ari is a responsive web app, not a phone app. Users can create free email-link accounts and, when enabled in Supabase, sign in with Google or Discord; saved conversations are private to each signed-in account. This folder contains the PWA shell, same-origin server APIs, and Supabase-backed chat history. Production remains `https://inc-ari-agency.vercel.app`; the current account-auth and UI work is Preview-only until deployed and verified, and no live email or social login has been tested.

## Authentication and privacy

- `/api/ask`, `/api/studio`, `/api/sales`, and `/api/chats` require a Supabase-authenticated email user. `/api/auth?action=session` verifies the session; `send_link` is intentionally public, restricted to same-origin requests, validates input, and relies on Supabase's email-send rate limit. Its response is generic to avoid account enumeration. The retired `ARI_ALLOWED_EMAIL` variable is not used for access decisions.
- New magic links use Supabase PKCE. The server generates a verifier/challenge pair, keeps the verifier in a short-lived `HttpOnly`, `Secure`, `SameSite=Lax` cookie scoped to `/api/auth`, and redeems the one-time code server-side. The browser removes callback material from the URL before requesting the exchange. Compatibility remains for older, already-sent links that return a token pair.
- Optional Google and Discord sign-in starts through `/api/auth?action=providers` and `POST /api/auth` with `action: "start_oauth"`. The provider list is read from Supabase Auth settings; only those two providers are allowed. Each flow uses a same-origin redirect and the same server-held PKCE verifier cookie, and callback codes use the existing server-side exchange. This is **identity sign-in only**—it does not grant Ari Gmail, Drive, Calendar, or Discord data access.
- Session access and refresh tokens are held in `HttpOnly`, `Secure`, `SameSite=Strict` cookies, not browser storage. The server verifies every session with Supabase Auth and sends the user's token—not a service-role key—to PostgREST.
- `ari_conversations.owner_id` and `ari_messages.owner_id` are set from the verified Supabase user ID. Both tables have RLS policies tied to `auth.uid()`, least-privilege grants, and a composite conversation-owner foreign key. The server also filters every chat read/write/delete by that verified ID. One user should not be able to read or modify another user's rows.
- The deployed Supabase migration is `supabase/migrations/20261116234854_create_ari_personal_memory.sql`. It is already applied; do not edit/replay it. A read-only live metadata check confirmed RLS enabled on both tables, all seven authenticated `auth.uid()` policies, zero conversation/message rows, and no `anon` SELECT grant. Mock tests verify cross-account query scoping; a real two-account read/write test remains pending.
- The public HTML shell contains no chat data. Same-origin checks guard state-changing API requests, the service worker skips APIs, and responses use `no-store`. CSP, `Referrer-Policy: no-referrer`, frame denial, no-index metadata, text-only DOM rendering, and API auth are defense-in-depth; `noindex` itself is not access control.
- Current Production is configured with `AI_PROVIDER=local`. Free accounts do not imply free or unlimited model inference. The optional provider path only accepts free-model slugs, but provider quotas/terms still apply. Do not enable paid models or incur charges without approval.

## Optional Google and Discord sign-in setup

The code only displays a social provider when Supabase Auth reports it enabled. The current Supabase Auth configuration has Google and Discord disabled and no provider client IDs configured, so those buttons will stay hidden until setup is completed. To turn one on:

1. Create an OAuth client in the provider's official developer console. Set the callback/redirect URI to `https://cnklyvojdzsoxzafqzir.supabase.co/auth/v1/callback`.
2. In Supabase Dashboard → Authentication → Providers, enable Google and/or Discord and enter that provider's client ID and secret **directly in Supabase**. Never paste secrets into chat, Git, browser code, or a public issue.
3. In Supabase Auth URL Configuration, allow only the exact Ari origin(s) being tested, such as `https://inc-ari-agency.vercel.app`. For a Vercel Preview, add its exact approved origin and ensure the Preview `ARI_ALLOWED_ORIGIN` matches it; do not broaden redirects to arbitrary sites.
4. Test one provider end-to-end in its same browser: provider consent → Ari callback → private session cookie → chat view → logout. Then repeat the cross-account isolation checks below.

Until a provider is enabled and its redirects are configured, its button is omitted and email-link sign-in remains available. Google/Discord sign-in does **not** enable Gmail/Drive/Calendar/Discord connectors; those need separate, narrowly scoped consent, token storage, and revocation work.

## WhatsApp Sandbox: Twilio, read-only and Preview-only

The user asked for an approved BSP and a free testing option. Ari now targets Twilio's official WhatsApp Sandbox through Twilio's official [Node.js SDK](https://github.com/twilio/twilio-node) (MIT). This is not direct Meta Cloud API code and does not use WhatsApp Web automation. Twilio's free-trial account includes up to 100 WhatsApp messages in trial units; Sandbox messages are billed at the standard WhatsApp rates and the trial units are limited. Sandbox recipients must join the Sandbox; it is for testing, not production traffic. See [Twilio Sandbox](https://www.twilio.com/docs/whatsapp/sandbox) and [WhatsApp pricing](https://www.twilio.com/whatsapp/pricing).

- `GET /api/whatsapp` reports only whether server-side configuration is present. It never returns a credential.
- Authenticated same-origin `POST /api/whatsapp` with `{ "action": "check" }` uses a Twilio **Restricted API Key** to read at most one message from the Sandbox sender, then discards the provider response. It returns only a connection result; no message body, recipient, or provider response is saved or displayed.
- Create a separate Twilio Restricted API Key with only the Messaging Messages **read** permission (`/twilio/messaging/messages/read`). Do not substitute an Auth Token, Main key, or Standard key. If Twilio does not offer the restricted read permission on the account, leave the connection unconfigured rather than use a broader credential. See [Twilio Restricted API Keys](https://www.twilio.com/docs/iam/api-keys/restricted-api-keys) and the [Key resource](https://www.twilio.com/docs/iam/api-keys/key-resource-v1).
- Set `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET`, and optionally `TWILIO_WHATSAPP_FROM` as **Preview-only Vercel environment variables**. Never put real values in Git, browser code, or chat. The default sender is Twilio's Sandbox `whatsapp:+14155238886`.
- The Ari endpoint deliberately has no message-send action. It rejects other actions, and `api/sales.js` remains opt-in-gated draft generation (`awaiting_human_review`, `sent: false`). Sending requires a separate future implementation and explicit approval. No Twilio account was created, credentials added, live API call made, or message sent as part of this code change.

## Public-access gate that remains

The Vercel project still reports SSO protection as `all_except_custom_domains`; the current `.vercel.app` domain is therefore not confirmed open to the public. Supabase email signup is enabled, but opening accounts to everyone also requires the Vercel deployment to be publicly reachable. The available Vercel connector does not expose the SSO-protection setting, and no access setting has been changed. Do not claim that public signups are live until this deployment gate is changed and checked.

Supabase Auth is configured for the exact Production site/redirect origin `https://inc-ari-agency.vercel.app`; email signup is on, email auto-confirm is off, and the email-send limit is two per hour. Keep the default email template's `{{ .ConfirmationURL }}` variable. Custom SMTP is not configured. Test actual delivery and the same-browser PKCE flow before relying on it. A link opened in a different browser will not have the verifier cookie and must fail closed; request a fresh link in that browser.

## Isolated Preview demo

Append `/demo` to a Vercel Preview URL to inspect the scripted UI sandbox. Its fictional data and replies are local only; it makes no API, storage, Supabase, or model calls. Vercel SSO may still gate Preview. The demo is not the account-based app and does not test login or privacy.

## Manual verification still required

The automated tests use mocked Auth/provider/database responses; they do not send email, complete a real Google/Discord consent flow, contact Twilio, or prove live Supabase isolation. The Twilio check remains unverified until Preview-only credentials with the restricted read permission are configured. Before opening public access, test on the deployed domain with two separate disposable accounts: verify a fresh PKCE email link and each enabled social provider work in the requesting browser, a signed-out API is rejected, User B cannot read/delete User A's chat by guessing an ID, logout clears cookies, and email rate limits behave as expected. Do not use real private chat content for this check.

## Model behavior and files

- `index.html`, `styles.css`, `app.js` — responsive sign-in and private chat UI; user text is inserted as text, never HTML.
- `api/auth.js`, `_lib/private-auth.js` — public free-account magic-link request, provider-gated Google/Discord OAuth start, PKCE code redemption, session verification/refresh/logout, and HttpOnly cookies.
- `api/chats.js` — authenticated account-scoped list/read/save/delete operations through Supabase RLS.
- `api/ask.js` — Hinglish local answer, bounded history, optional free-model request, and offline fallback.
- `api/studio.js` — deterministic planning preview; sensitive actions remain approval-gated.
- `api/sales.js` — consent-first draft preview only; no scraping, messages, calls, or CRM writes.
- `api/whatsapp.js`, `_lib/twilio-whatsapp.js` — authenticated Twilio Sandbox status and GET-only read check; no send endpoint.
- `api/demo-page.js`, `demo.js`, `demo.css` — Preview-only fictional UI sandbox.
- `service-worker.js`, `vercel.json` — static shell caching rules, routes, and security headers.

Run the mock suite with `npm test` in this directory. It requires Node.js 18+ and does not need a live email, Supabase session, or model key.
