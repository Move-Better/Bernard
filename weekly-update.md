# Weekly Stack & AI Review — 2026-09-03

Scope: Bernard, Deep Thought, Vigil, Movebetterco/Move Better Website (same repo, two local checkouts — `Move-Better/Movebetterco` on GitHub, confirmed via matching `git remote -v`), Animal Website. `bundle-social-spike`, `Budget`, and `Claude Usage` were scanned but have no framework/AI-SDK surface worth researching against. `NarrateRx` was excluded per standing instruction (retired project).

**Note on last week's edition:** a fully-written 2026-08-27 edition of this file was sitting uncommitted in the working tree when this run started (never shipped in a PR). Its two live findings — the Deep Thought dated-model pin and the stale "gemini-2.5-flash retires 2026-10-16" code comments — were independently re-verified against current source and current vendor pages this week (both still true) and carried forward below; nothing else from that draft was trusted without a fresh check.

## Detected stack

| Project | Framework/runtime | Hosting | AI usage |
|---|---|---|---|
| Bernard | Vite 5.4.21 + React 18.3.1 + Express 5.2.1 (API on Vercel Node functions) | Vercel | `anthropic/*` (sonnet-4-6, opus-4-7, haiku-4-5) + `google/gemini-3.6-flash` + `google/gemini-2.5-pro` via Vercel AI Gateway (`ai` 7.0.66 / `@ai-sdk/gateway` 4.0.52); direct OpenAI Realtime (`gpt-realtime-2.1`, `gpt-4o-mini-transcribe`) + Responses API (`gpt-5.6-terra`) |
| Deep Thought | Vite 8.1.3 + React 19.2.7 + Express 5.2.1 | Railway (Nixpacks) | Direct `@anthropic-ai/sdk` 0.106.0, no gateway (`claude-opus-4-8`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`, one dated pin `claude-sonnet-4-5-20250929`); `openai` 4.104.0 used only for `text-embedding-3-small` |
| Vigil | Static HTML/JS + Node scripts | Vercel (static) | Direct Gemini API (`gemini-3.6-flash` default, `gemini-2.5-pro` for the `audit` focus) in a standalone review-panel script |
| Movebetterco / Move Better Website | Astro 5.0 | Vercel | `anthropic/claude-sonnet-4-6` + `openai/text-embedding-3-small` via `ai` 7.0.71 / `@ai-sdk/gateway` 4.0.57 (local `Move Better Website` checkout is 2 commits behind `origin/main` — informational only) |
| Animal Website | Astro 5.10 | Vercel | none detected |

Auth: Bernard + Deep Thought both use **Clerk** (`@clerk/react`/`@clerk/backend` and `@clerk/express` respectively), not Supabase Auth — the passkey/Supabase-Auth check doesn't apply. DB: both run Supabase Postgres over REST (`service_role`, PostgREST) — Bernard has no `@supabase/supabase-js` dependency at all (hand-rolled `sb()` REST helper), Deep Thought uses `@supabase/supabase-js` 2.x also over REST. Neither has a `create policy`/`auth.uid()` anywhere, and neither uses Postgres Realtime — consistent with each repo's documented "no RLS, service_role bypass" model. No connection-pooling concern either way (REST, not a direct `pg` connection).

No call site in either repo passes `temperature`/`top_p`/`top_k` on an Opus 4.7+ call (checked `bookSynthesis.js` and `outboundCall.js`'s `claude-opus-4-7` calls in Bernard, and `src/lib/claude.js`'s `claude-opus-4-8` wrapper in Deep Thought, which explicitly documents "we set neither").

---

## This Week's Changes

### Anthropic / Claude
- **Model deprecation table: no new deprecations this week.** [Official page](https://platform.claude.com/docs/en/about-claude/model-deprecations), re-fetched today — every model this stack calls (`claude-sonnet-4-6`, `claude-opus-4-7`, `claude-opus-4-8`, `claude-haiku-4-5-20251001`) is **Active**. The one dated snapshot in this stack, `claude-sonnet-4-5-20250929`, is also still Active but carries the closest retirement floor of anything used anywhere in these five repos: **"not sooner than September 29, 2026" — 26 days out.** *(GA, watch)*
- **Claude Code weekly usage limits net-shrink 17% starting September 14** — worth knowing for your own CLI usage, not a code change. Anthropic announced Aug 29 a permanent +25% to the *base* weekly limit for Pro/Max/Team/Enterprise, but that lands *below* the temporary +50% summer boost expiring Sept 13, so anyone on the current boosted limit sees a net ~17% cut from Sept 14 onward. [Coverage](https://www.implicator.ai/anthropic-claude-code-weekly-limits-september-14/) *(confirmed by Anthropic, effective Sept 14)*
- **Claude Code 2.1.252–2.1.259** (Aug 31–Sept 2): managed MCP servers for orgs (`managedMcpServers`), `--permission-prompts none` for unattended headless hosts, GitLab merge-request recognition, Claude Fable 5.1 added as a model option, plus fixes for concurrent-session config clobbering and prompt-cache invalidation on OAuth refresh. [Changelog](https://code.claude.com/docs/en/changelog) *(GA)*
- Claude/Claude Cowork gained shared, persistent memory across chat and Cowork tasks (view/edit/delete/pause/reset) — consumer/Cowork-app feature, no API surface change. *(GA, carried from last check — unchanged)*
- Mandatory C2PA-aligned watermarking of Claude-generated text (rolling out since Aug 2 across every Claude surface, including the API) is still in effect with no new developments this week. *(rolling out — unchanged, see Action Items)*

### OpenAI
- **`gpt-4o-mini-transcribe` (the bare alias, not just a dated snapshot underneath it) now has its own confirmed shutdown date: February 26, 2027**, replacement `gpt-live-transcribe` or `gpt-transcribe`. This is new/more specific than what was previously known — earlier tracking only had the dated snapshot (`-2025-03-20` → `-2025-12-15`, Jan 20, 2027) on the radar. [OpenAI deprecations](https://developers.openai.com/api/docs/deprecations) *(scheduled retirement, ~6 months out)*
- Deprecation table otherwise unchanged for anything this stack touches: `gpt-realtime` family → `gpt-realtime-2.1` retires Jan 20, 2027 (Bernard already on `gpt-realtime-2.1`); `gpt-5-mini-2025-08-07` → `gpt-5.6-terra` retires Dec 11, 2026 (Bernard already on `gpt-5.6-terra`). [OpenAI deprecations](https://developers.openai.com/api/docs/deprecations)
- Confirmed Oct 23, 2026 legacy wave (`gpt-3.5-turbo-0125`, `gpt-4-0613`, `gpt-4-turbo`, `gpt-4.1-nano`, `o1-2024-12-17`, `o1-pro-2025-03-19`, `o3-mini-2025-01-31`, `o4-mini-2025-04-16`) — zero matches anywhere in this stack (verified by grep). *(N/A here)*
- General context, not applicable to this stack: OpenAI reportedly targeting an IPO filing as soon as September 2026; ChatGPT gained healthcare-record connectors (Sept 1); official DALL·E GPT retired from ChatGPT (Aug 30). [OpenAI news](https://openai.com/news/) *(context only)*

### Google Gemini
- **Gemini 3.8 Flash launched September 2, 2026** — Google's third Flash release in six weeks, same price as 3.7 Flash ($0.75/$3.75 per MTok through end of 2026, doubling Jan 1, 2027), beats 3.7 Flash on every published benchmark. This is now two generations ahead of the `gemini-3.6-flash` this stack moved to a few weeks ago. [The Register](https://www.theregister.com/ai-and-ml/2026/09/02/with-gemini-38-flash-google-reminds-everyone-its-still-in-the-race/) *(GA, brand new — see Action Items)*
- **Gemini 2.5 Pro/Flash/Flash-Lite: "No shutdown date announced" — reconfirmed directly on [ai.google.dev/gemini-api/docs/deprecations](https://ai.google.dev/gemini-api/docs/deprecations), page last-updated today (Sept 3, 2026).** This has now held for a month of consecutive weekly checks. Bernard's and Vigil's own code comments still assert a fictional "retires no earlier than 2026-10-16" — see Action Items, this is a documentation bug, not a live deprecation. *(no deprecation in effect)*
- No GA Gemini 3.x Pro-tier model exists yet (Gemini 3.5 Pro has now missed three announced GA targets — June, July, and a widely-reported July 17 date). `gemini-3.1-pro-preview` remains the newest Pro-tier model and is still preview-only. Vigil's own code comment already states this correctly. [Coverage](https://www.cometapi.com/gemini-3-5-pro-release-date-rumored-specifications-all-we-know-in-2026-updated-july-2026/) *(preview-only, unchanged)*

### Vercel / hosting
- **Vercel CLI: locally installed is 59.9.1; latest is 59.11.2** *(flagged by the Vercel plugin's own session-start check; confirmed against the npm registry)*
- **AI SDK / AI Gateway patch drift widened again**: latest published `ai` is now **7.0.92**, latest `@ai-sdk/gateway` is **4.0.74** (both published today). Bernard is 26 patches behind on `ai` (7.0.66) and 22 behind on the gateway (4.0.52); Movebetterco is 21 and 17 patches behind respectively, despite [PR #130](https://github.com/Move-Better/Movebetterco/pull/130) bumping it just two weeks ago. No changelog entry found describing a breaking change in either delta — routine same-major patch drift. [AI SDK 7 announcement](https://vercel.com/changelog/ai-sdk-7)
- **New AI Gateway catalog additions this week** (Sept 1–3): Claude Fable 5.1, Qwen 3.8 Max, Gemini 3.8 Flash, Muse Spark 1.3, and a temporary 50%-off GLM-5.3 promo through Sept 7. [Vercel changelog](https://vercel.com/changelog) *(GA/promo, none of these providers are currently called anywhere in this stack)*
- **Basic build machines now available on Pro and Enterprise** (Sept 3) — a lower-cost 2 vCPU/8GB build tier. Worth a look purely for build-cost, no functional change needed. [Vercel changelog](https://vercel.com/changelog) *(new, low-priority cost item)*
- Free-domain-with-Pro benefit expanded to include `.app`/`.dev` (Sept 2) — general context, not tied to any current need. *(new, N/A)*

### Railway (Deep Thought)
Fetched directly from [railway.com/changelog](https://railway.com/changelog) — most recent entry is **Aug 28**: "Railway plugin for Grok Bot, MySQL High Availability, favorite projects." Nothing dated in the Aug 24–Sept 3 window beyond that. Deep Thought's Postgres is external (Supabase), it has no MySQL and no Grok Bot integration — no fit. *(N/A)*

### Supabase (Bernard, Deep Thought)
No changelog entries in the last ~10 days beyond what prior reviews already covered (read-replica settings relocation Aug 21, a managed-backup scheduling-timeout fix Aug 12 — both previously confirmed N/A for these two repos, which don't use Supabase's managed backups or read replicas). *(nothing new this week)*

### Clerk (Bernard, Deep Thought)
**Reverification window is now admin-configurable** (Aug 28) — orgs can tune how long a successful auth stays valid before re-verification is required for sensitive actions (1–10 minutes). Neither repo currently has a "sensitive action" flow that uses Clerk reverification, so no action, but worth knowing it exists if one is ever built (e.g. changing a workspace's publish credentials). Also this week: Admin Logs/audit dashboard (Aug 25), custom OAuth scopes (Aug 21) — neither maps to a current need. [Clerk changelog](https://clerk.com/changelog) *(GA, informational)*

### Dev tooling
- **MCP's 2026-07-28 spec update continues to be the operative baseline** — stateless protocol core, cacheable list results, a formal extensions framework. No new spec release this week; mentioned only because both Deep Thought's and Bernard's `.claude/` configs rely on MCP servers. [MCP blog](https://blog.modelcontextprotocol.io/posts/2026-07-28/) *(context, not a discrete change)*

### Real-world workflows
- **Microsoft's internal Claude Code rollout** (managed program, first half of 2026): engineers with access merged ~24% more pull requests than they otherwise would have, across a study of tens of thousands of engineers. [arXiv study](https://arxiv.org/html/2607.01418v1) *(named org, measurable outcome)*
- **Anthropic's own internal code-review coverage jumped from 16% to 54%** after adopting Claude Code Review with Agent Teams (shipped alongside Opus 4.6 in February 2026). [Anthropic research](https://www.anthropic.com/research/claude-code-expertise) *(named org, measurable outcome)*

---

## Action Items for My Projects

### BREAKING (do now)
None. Grepped all five repos for every retired/soon-retiring model string surfaced by this week's research — Anthropic's full retired list, OpenAI's Oct 23/Dec 11/Sept 28 waves, and Gemini's dated retirements — zero matches anywhere in `src`/`api`/`scripts`. Confirmed (again) no call site passes `temperature`/`top_p`/`top_k` alongside an Opus 4.7+ model.

### WORTH DOING
1. **Deep Thought — un-pin the dated Sonnet snapshot before its floor arrives.** `scripts/fact-clarity-audit.js:71` hardcodes `model: 'claude-sonnet-4-5-20250929'`, no comment justifying a fixed snapshot. Its retirement floor is now **26 days out** (Sept 29, 2026) — the closest of any model pinned in this stack — while the rest of the repo already uses the rolling `claude-sonnet-4-6` alias in the same fashion (`src/lib/retrieve.js:422`, `src/lib/meeting-agenda.js:28`, `src/lib/outcome-vision.js:77`, and others). This script isn't wired into any cron (checked — no scheduled reference found), so the blast radius is low, but it's a one-line fix with a real, approaching deadline and has now gone unaddressed for at least a week. Effort: **low**.
2. **Bernard + Vigil — fix a stale, factually-wrong code comment before it misleads anyone.** Five sites assert "gemini-2.5-flash retires no earlier than 2026-10-16," which Google's own deprecations page has now said is false for four consecutive weekly checks (still "No shutdown date announced" as of today): `api/_lib/tagAsset.js:26`, `api/_lib/topicRegion.js:44`, `scripts/backfill-display-titles.mjs:30`, `scripts/fix-video-orientations.mjs:169` (all Bernard), and Vigil's `scripts/gemini-review.mjs:16`. The model choice itself (`gemini-3.6-flash`) is fine and doesn't need to change — only the comment is wrong, and it invents an urgency that could cause a rushed migration later. Effort: **low**.
3. **Bernard — bump `ai` and `@ai-sdk/gateway`.** Currently 7.0.66/4.0.52; latest published are 7.0.92/4.0.74 (26/22 patches behind). Same-major patch bump, no known breaking change in the delta. Effort: **low**.
4. **Movebetterco — bump `ai` and `@ai-sdk/gateway` again.** Currently 7.0.71/4.0.57, last bumped in [PR #130](https://github.com/Move-Better/Movebetterco/pull/130) on Aug 20; latest are now 7.0.92/4.0.74, two weeks of drift since. If this keeps needing a manual PR every couple of weeks, a scheduled monthly bump would be less overhead. Effort: **low**.
5. **Vercel CLI outdated on this machine** — 59.9.1 installed, 59.11.2 latest (flagged by the Vercel plugin itself). `npm i -g vercel@latest`. Effort: **low**.

### INVESTIGATE
1. **Gemini 3.8 Flash (launched Sept 2) is now two generations ahead of what Bernard/Vigil moved to a few weeks ago.** Same rough price tier as 3.7 Flash, beats it on every published benchmark. Worth a quality A/B before swapping the classification/tagging call sites (`api/_lib/tagAsset.js:26`, `api/_lib/topicRegion.js:44`, `scripts/backfill-display-titles.mjs:30`, `scripts/fix-video-orientations.mjs:169`, Vigil's `scripts/gemini-review.mjs:36`) — it shipped one day before this review, so there's no operating history yet; no rush, but worth a note for next cycle. Effort: **medium**.
2. **Deep Thought's heavy reliance on one dated Haiku ID is a single point of coordinated-migration risk, though not an active problem.** `claude-haiku-4-5-20251001` is called directly (no gateway, no undated alias available yet from Anthropic) across ~15 files including `src/lib/retrieve.js`, `src/lib/procedure.js`, `src/lib/consolidate.js`, and several route handlers. It's Active with a floor of "not sooner than October 15, 2026" and nothing wrong today — but if Anthropic ships an undated Haiku successor and deprecates this one, every one of those ~15 call sites needs updating at once, unlike Sonnet/Opus which already have rolling aliases. Worth considering a single shared `HAIKU_MODEL` constant now, before there's a deadline forcing it. Effort: **medium**.
3. **Anthropic's mandatory watermarking is worth Q knowing about; no code action exists.** Bernard's whole product is AI-drafted, human-reviewed content published under a clinic's own voice. The watermark is invisible during normal reading, applies at the model level regardless of client, and isn't something Bernard can opt out of. **Couldn't verify** whether it behaves identically for calls proxied through the Vercel AI Gateway versus a direct Anthropic API call — no source addresses gateway-proxied traffic specifically. Effort: **none (informational)**.
4. **Vercel's Basic build machines (new, Sept 3) are a plausible free cost reduction** for Bernard/Movebetterco's Pro-tier builds if their build steps don't need more than 2 vCPU/8GB — worth a one-off check of current build resource usage before switching. Effort: **low** to check, **N/A** if builds already need more headroom.

### IGNORE-FYI
- OpenAI's Oct 23/Dec 11/Sept 28 legacy retirement waves — confirmed unused anywhere in this stack, except the two models already handled (`gpt-realtime-2.1`, `gpt-5.6-terra`).
- New AI Gateway provider additions (Claude Fable 5.1, Qwen 3.8 Max, Muse Spark 1.3, GLM-5.3 promo) and MCP's ongoing 2026-07-28 spec baseline — general ecosystem context, nothing to wire up here.
- Clerk's new features this week (reverification window tuning, Admin Logs, custom OAuth scopes) — none match a current flow in Bernard or Deep Thought.
- Railway's Aug 28 platform update (Grok Bot plugin, MySQL HA) — no fit for Deep Thought's external-Postgres, no-MySQL deploy.
- Supabase — nothing new in the last ~10 days beyond items already confirmed N/A in prior weeks.
- Claude Code 2.1.252–2.1.259 feature drops (managed MCP servers, headless permission flags, GitLab MR recognition) and Claude/Cowork's shared-memory feature — workflow niceties, no code changes needed.
- OpenAI's IPO reporting, healthcare connectors, and the DALL·E GPT retirement from ChatGPT — general company news, not applicable to this stack.

---

**Highest-priority action across all projects:** un-pin `scripts/fact-clarity-audit.js:71` in Deep Thought from the dated `claude-sonnet-4-5-20250929` snapshot to the rolling `claude-sonnet-4-6` alias already used elsewhere in the same repo. It's the only item in this review with a real, approaching floor (26 days), it's a one-line change, and it's been sitting unfixed for at least a week already.

**Couldn't verify:** whether Anthropic's mandatory watermarking applies identically to calls routed through the Vercel AI Gateway versus a direct Anthropic API call (no source addresses gateway-proxied traffic specifically); whether Vercel's Security Dashboard (private beta as of a July 1, 2026 announcement) has changed status — no dated update found either way this week, so it's omitted above rather than repeated on stale information.
