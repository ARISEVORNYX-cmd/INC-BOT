# INC AI Agency — Vercel companion

Node serverless UI/API for Ari and the sales preview. `/api/ask` uses the official `@openrouter/sdk` server-side when configured; Gemini remains an available provider and the local answer path stays as fallback.

## Files
- `api/ask.js` + `api/agents.json` — OpenRouter/Gemini provider selection, local non-empty answer fallback, and general role list.
- `api/sales.js` + `api/sales-agents.json` — 56 role profiles, department/agent listing, consent-first local scoring, and draft-only actions.
- `index.html` — responsive UI using relative `/api/*` URLs.
- `vercel.json` — UI + API routes.

## OpenRouter setup

The API key is read only on the server from `OPENROUTER_API_KEY`. The default model slug is `openrouter/free`; you can select another free slug with `OPENROUTER_MODEL=<provider>/<model>:free`. Paid model slugs are blocked by the endpoint, and it never falls back to Gemini after an OpenRouter error. Free-model availability, rate limits, and quotas can change; this is not a promise of unlimited or permanent free service.

Provider behavior:
- If `OPENROUTER_API_KEY` is set, OpenRouter is selected by default.
- Otherwise a configured `GEMINI_API_KEY` keeps the existing Gemini behavior.
- `AI_PROVIDER=openrouter|gemini|local` explicitly selects a provider.
- If a provider is missing or errors, Ari returns its local answer and an error code (no API key or upstream message is returned to the browser).

Create a key at <https://openrouter.ai/keys>. Never paste it into source control or chat.

### Local run

```bash
cd agency/vercel
npm ci
cp .env.example .env.local
# Add OPENROUTER_API_KEY to .env.local using a local editor; that file is gitignored.
npx vercel dev
```

Then open `http://localhost:3000` or test the API:

```bash
curl -sS http://localhost:3000/api/ask \
  -H 'Content-Type: application/json' \
  -d '{"question":"OpenRouter se ek chhota test jawab do","use_model":true}'
```

Tests (SDK request mocked; no key or live provider call required):

```bash
npm test
```

For Vercel, add `OPENROUTER_API_KEY` as an encrypted Environment Variable in the project that deploys this directory, and set `AI_PROVIDER=openrouter` plus `OPENROUTER_MODEL=openrouter/free`; redeploy after changing env settings. The key is not stored in this repository.

## Sales safety and deployment

Sales safety is enforced in the function: no scraping/enrichment, messages are never sent, calls are never placed, CRM patches are never applied, and channel-specific opt-in plus do-not-contact checks are required for drafts. The endpoint returns empty `external_actions_performed` and records no lead rows.

A Vercel project was created earlier, but the deployment-creation connector call was blocked before Vercel received it. No production deployment exists yet. Deploy this directory from the connected Vercel dashboard/CLI when ready, after reviewing privacy, consent, and legal requirements. No live Apollo or CRM provider is integrated.
