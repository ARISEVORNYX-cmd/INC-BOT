# Agency persona sources (50–70 AI agents wali repo khoj)

User ne bola tha: *"AI agent like 50 se 70 AI agency karke repo hoga nahi toh iska similar dundh iyo"*.
GitHub search se mila:

| Repo | Personas | Notes |
|---|---|---|
| [Anas-Khan93/ai-agency-agents](https://github.com/Anas-Khan93/ai-agency-agents) | **72** `.md` personas | ✅ Yahi closest hai 50–70 range ke. Isme se **66** curate karke `agency/agents.json` banaya. |
| [msitarzewski/agency-agents](https://github.com/msitarzewski/agency-agents) | **232** persona-ish `.md` | Bahut bada similar repo (168k+ stars): academic/design/engineering/marketing/finance/game-dev/GIS/healthcare/integrations. |
| [jnMetaCode/agency-agents-zh](https://github.com/jnMetaCode/agency-agents-zh) | **277** | Chinese/China-market specialists + DAG orchestrator. |
| [keeply-cn/agency-agents-zh](https://github.com/keeply-cn/agency-agents-zh) | 80+ | Chinese agency roster. |
| [Raheel2774/agency-agents](https://github.com/Raheel2774/agency-agents) | 200+ | Specialist roster for Claude Code / Cursor / Codex / Gemini. |

Hamari `agency/` me:
- **66 general role/persona profiles** (upar wale first repo se curated, `agents.json` me source path ke saath)
- **56 original sales role profiles** in `sales/roster.json` (inspired by the four departments in reel `DfFAIobhrNm`): Lead Generation 16, Outreach 16, Sales Calling 12, CRM Operations 12.
- **1 personal agent** = `Ari` (`personal.py`)
- **1 previous Level-3 orchestrated team runtime** = pehle ka `agents/` package (`Agency.lead_team`)

Yeh profiles hain, 123 independent model instances nahi. A real provider call occurs only when configured; sales actions are local drafts/proposals, never sends/calls/CRM writes.

General-profile categories: design 7, engineering 7, marketing 8, product 3, project-management 5,
spatial-computing 6, specialized 7, strategy 10, support 6, testing 7.

The second earlier reel (`DcWWpNIPwrq`) has a blank public caption and only a thumbnail described as a Twitter screenshot; its topic could not be verified, so no feature has been guessed from it.

## New reels reviewed (2026-11-15)
- `DftTm9LIHcH` — Beyond Marketing (@beyondmarketing.si), caption/title: “₹5,000 ki Website Sabse Mehngi Padti Hai!” The caption is a sales hook about cheap-site total cost; the video transcript and exact claims were not available. It is not an AI demo.
- `DfuaKg6PlJn` — Dexter (@dexter.copilot), caption: “Comment ‘Dexter’ if you need this”. The creator profile calls it an AI sidekick for streamers. [Official site](https://www.dextercopilot.ai/) says Dexter runs on Windows/macOS; its “On your phone?” section emails a download link to install on a computer. Its [terms](https://dextercopilot.ai/terms) describe the product as pre-launch/early-access and warn features may change/not all features are available. This is evidence of a real product offering, not proof that every reel capability is generally available or that it is a phone-native app.
- `DfvCLlMTb2U` — Vikash Dua (@drophouse58), caption: “sourav joshi house || I buy it??” The public post is about a house/plot story, not AI. [AajTak](https://www.aajtak.in/entertainment/news/story/millionaire-youtuber-sourav-joshi-buy-150-plot-flats-project-for-privacy-home-tmovg-dskc-2589503-2026-06-28) and [News18](https://hindi.news18.com/news/entertainment/viral-social-saurav-joshi-buys-plot-150-flats-project-privacy-house-front-land-purchase-10608007.html) report that Sourav Joshi said he bought the plot opposite his home to protect privacy from a planned 150-flat project. The exact property transaction/price was not independently verified from public records.

For the reel pages, public caption/metadata was available through Instagram/Jina renders, but the dedicated Agent Reach connector is not exposed in this environment. No feature was inferred from an inaccessible full video.

License/attribution: persona text sirf reference ke liye `agents.json` ke `persona` field me
chhota excerpt hai; original repo ka README/LICENSE dekh lena agar production me redistribute karo.
