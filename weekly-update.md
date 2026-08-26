# Weekly Stack & AI Review — 2026-08-20

Scope: Bernard, Deep Thought, Vigil, Movebetterco/Move Better Website (same repo, two local checkouts — `Move-Better/Movebetterco` on GitHub), Animal Website. `bundle-social-spike`, `Budget`, and `Claude Usage` were scanned but have no framework/AI-SDK surface worth researching against. `NarrateRx` was excluded per standing instruction (retired project).

## Since last week — a correction (caught at wrap, not before shipping)

This edition's first draft claimed Gemini 2.5 Pro/Flash/Flash-Lite retire "no earlier than October 16, 2026," sourced from third-party aggregators (benchr.org, gcpstudyhub.com). **That's wrong.** The Aug 6 edition of this same file had already fetched Google's own deprecations page directly and found "No shutdown date announced" for these exact bare model IDs — I didn't re-check that primary source this week and re-introduced a claim a prior edition had already corrected. Re-fetched `ai.google.dev/gemini-api/docs/deprecations` directly at wrap time (page last-updated **August 13, 2026**): `gemini-2.5-pro`, `gemini-2.5-flash`, and `gemini-2.5-flash-lite` all still read **"No shutdown date announced."** Only dated `*-preview-*` snapshots in the same families carry real dates; Bernard/Vigil don't call any of them.

**What this changes:** the Gemini item below drops from "8 weeks of runway, do this now" to a proactive-upgrade-with-no-deadline. The code change already shipped this week (flash-tier calls moved to `gemini-3.6-flash`, a GA model) is still worth having — newer, GA, likely better/cheaper — it just wasn't the ticking clock the PR description said it was. Lesson: when a task instruction says "fetch the vendor's own page for retirement dates," that rule applies to EVERY vendor's retirement-date claim, not just the one (Anthropic) the instructions named explicitly — and it applies especially hard when a rolling weekly file already has a prior, more-rigorous answer sitting three sections up that a `git log -p` would have surfaced.

## Detected stack

| Project | Framework/runtime | Hosting | AI usage |
|---|---|---|---|
| Bernard | Vite 5 + React 18 + Express 5 (API on Vercel Node functions) | Vercel | `anthropic/*` + `google/gemini-2.5-*` via Vercel AI Gateway (`ai` SDK v7); direct OpenAI Realtime/Responses API calls |
| Deep Thought | Vite 8 + React 19 + Express 5 | Railway (Nixpacks) | Direct `@anthropic-ai/sdk` (no gateway); `openai` SDK present in deps |
| Vigil | Static HTML/JS + Node scripts | Vercel (static) | Direct Gemini API (`gemini-2.5-pro`/`flash`) for a review-panel tool |
| Movebetterco / Move Better Website | Astro 5 | Vercel | `anthropic/claude-sonnet-4-6` + `openai/text-embedding-3-small` via `ai` SDK v7 |
| Animal Website | Astro 5 | Vercel | none detected |

Auth: Bernard + Deep Thought both use **Clerk** (not Supabase Auth) — the passkey/Supabase-Auth check doesn't apply to either. DB: both use Supabase Postgres via the `service_role` REST client (`supabase-js` / PostgREST), no `create policy`/`auth.uid()` anywhere — consistent with each repo's own documented "no RLS, service_role bypass" model, so no new RLS gap found. Neither uses Postgres `postgres_changes`/Realtime subscriptions.

---

## This Week's Changes

### Anthropic / Claude
- **Model deprecation table unchanged for anything this stack uses.** [Official deprecations page](https://platform.claude.com/docs/en/about-claude/model-deprecations) — `claude-opus-4-1-20250805` retired **August 5, 2026** and `claude-sonnet-4-20250514`/`claude-opus-4-20250514` retired June 15, 2026, but none of those strings appear anywhere in the five repos (verified by grep). *Maturity: GA.*
- **Claude Code 2.1.236–2.1.237** (Aug 19–20): new `ANTHROPIC_DEFAULT_MODEL` env var for session default model, cross-session `notify_when_idle`, a built-in "Concise" output style, and a prompt-caching fix specific to sessions running through an LLM gateway or custom base URL. [Changelog](https://code.claude.com/docs/en/changelog) *(GA)*
- **Claude Developer Platform**: Admin API user-management (members/invites/groups/roles) now GA with no beta header required; Files API + Agent Skills support added; Managed Agents gained web-access controls and self-hosted sandbox memory stores; redesigned Console session viewer. *(GA/beta mix — via web search, no single canonical URL)*
- **Pricing**: Claude Sonnet 5's introductory $2/$10 per-MTok pricing was made the standard price — the previously scheduled Sept 1, 2026 increase to $3/$15 will **not** happen. *(Pricing)*
- **Compliance API** expanded to cover Cowork and Claude Code (desktop/web/mobile/CLI) for Claude Enterprise customers. *(Beta)*

### OpenAI
- **GPT-Realtime-2** (config: `gpt-realtime-2.1`) is the current recommended realtime model — Bernard is already on it. Old `gpt-realtime` retires **January 20, 2027**. [OpenAI deprecations](https://developers.openai.com/api/docs/deprecations) *(GA)*
- **`gpt-5-mini` retires December 11, 2026**, replacement `gpt-5.6-terra`. [OpenAI deprecations](https://developers.openai.com/api/docs/deprecations) *(scheduled retirement)*
- **`gpt-4o-mini-transcribe` retires January 20, 2027** — but that's the dated snapshot behind the alias (`-2025-03-20` → `-2025-12-15`); the bare alias name should roll forward automatically. [OpenAI deprecations](https://developers.openai.com/api/docs/deprecations)
- **GPT-5.6** released with a new Ultrafast preview tier (Cerebras-backed, up to ~750 tok/s, ~14× Standard) — not something this stack currently touches. *(Preview)*

### Google Gemini
- **Gemini 2.5 Pro / Flash / Flash-Lite: "No shutdown date announced"** — confirmed directly on [ai.google.dev/gemini-api/docs/deprecations](https://ai.google.dev/gemini-api/docs/deprecations) (page last-updated Aug 13, 2026). Third-party aggregators (benchr.org, gcpstudyhub.com) reported a "no earlier than October 16, 2026" floor this week; that claim does not appear on Google's own page for these bare model IDs and should not be treated as confirmed. *(no deprecation currently in effect)*
- Gemini 3.x is GA regardless of the above: **Gemini 3.6 Flash** (successor to 2.5 Flash), **Gemini 3.5 Flash** (now backs `gemini-flash-latest`), **Gemini 3.7 Flash** (powers Gemini Spark's coding/agent mode). No GA Gemini 3.x Pro exists yet — the only Pro-tier 3.x model is `gemini-3.1-pro-preview` (preview, both on the Vercel AI Gateway catalog and Google's own docs). *(GA for Flash tier; Pro tier still preview-only)*
- Managed Agents launched in the Gemini API (public preview) — sandboxed, stateful agent runtime. *(Preview)*

### Dev tooling / agents
- MCP and Agent Skills continue to be Anthropic's primary extension mechanisms for Claude Code — no new mechanism this week that changes how these repos' `.claude/` configs work. *(context, not a discrete change)*

### Vercel / hosting
- **Vercel CLI: locally installed is 58.4.0; latest is 59.3.0.** *(flagged directly by the Vercel plugin's own session-start check, not web search)*
- **AI SDK 7** (major, released June 25, 2026) added `WorkflowAgent`, overhauled telemetry, provider-independent uploads, granular timeout controls. Latest published patch is **7.0.71**. [Vercel changelog](https://vercel.com/changelog/ai-sdk-7) *(GA)*
- **AI Gateway**: coding-agent auto-configuration for 8 harnesses, 300+ models from 30+ providers "no markup," Fish Audio speech models added. *(GA/promo — general context, no specific action here)*
- **Next.js 16.3** and **Bun 1.4 on Vercel Functions** shipped this cycle — not applicable, none of these five repos use Next.js or Bun.
- **DeepSec**: one-command AI-powered security scan setup (model selection, threat modeling, coverage checks) — new, worth a look since none of these repos currently run a SAST tool per their CLAUDE.md docs. *(new feature, maturity unclear from search alone)*

### Railway (Deep Thought)
Fetched directly from [railway.com/changelog](https://railway.com/changelog):
- **Aug 14**: Access Groups (access control), improved template editing, Railway Agent Connectors.
- **Aug 7**: Cloud Agents Beta, **Postgres Automatic CVE Patching**, Railway mobile app for Android.

Deep Thought's Postgres is external (Supabase `SUPABASE_URL`/`SUPABASE_SERVICE_KEY`), not a Railway-managed database, so the CVE-patching item doesn't apply. Access Groups/Agent Connectors have no obvious fit for a single-service deploy.

### Supabase (Bernard, Deep Thought)
- Postgres extension **version pinning deprecated as of Aug 5, 2026** — checked, no migration in either repo pins an explicit `CREATE EXTENSION ... VERSION`, so N/A.
- Postgres Changes gained AND filters/more operators/column selection — N/A, neither repo uses `postgres_changes`/Realtime subscriptions.
- Self-hosted SAML SSO endpoint change — N/A, neither project self-hosts Supabase.
- `log_connections` now off by default for new/Free/Pro projects — cosmetic, no action.

### Clerk (Bernard, Deep Thought)
Directory Sync (Google Workspace), promo codes, OAuth Client ID Metadata Documents (beta), a new "elevation" appearance option, and a new sign-in notification feature all shipped recently — none map to a current need in either app (no commerce flow, no enterprise directory sync in use).

### Real-world workflows
- **Spotify** (Anthropic customer case study): using the Claude Agent SDK for fleet-wide infrastructure migrations, generating 650+ monthly pull requests merged into production and cutting time spent writing migrations by up to 90%. [claude.com/customers/spotify](https://claude.com/customers/spotify)
- **Anthropic's own internal teams** (company blog, not third-party coverage): the Growth Marketing team built a Claude Code workflow that ingests CSVs of hundreds of ad performance rows, flags underperformers, and drafts new variations inside strict character-limit constraints; the Legal team built a "phone tree" prototype to route employees to the right in-house lawyer, without dedicated engineering resources. [anthropic.com/news/how-anthropic-teams-use-claude-code](https://www.anthropic.com/news/how-anthropic-teams-use-claude-code)

---

## Action Items for My Projects

### BREAKING (do now)
None. Grepped all five repos for every retired model string on Anthropic's and OpenAI's deprecation pages (`claude-opus-4-1`, `claude-sonnet-4-20250514`, `claude-opus-4-20250514`, `claude-3-*`, `claude-2.*`, `gpt-3.5`, `text-davinci`) — zero matches anywhere in `src`/`api`/`scripts`.

### WORTH DOING — ✅ all shipped this session (2026-08-20)
1. ~~Bernard + Vigil — Gemini 2.5 → 3.x migration~~ **Shipped anyway, as a proactive upgrade, not an urgent one.** No confirmed Google deprecation date exists (see correction above) — but `gemini-3.6-flash` is GA, newer, and a safe swap for the Flash-tier call sites (`api/_lib/tagAsset.js:26`, `api/_lib/topicRegion.js:44`, `scripts/backfill-display-titles.mjs:30`, `scripts/fix-video-orientations.mjs:169` in Bernard; `scripts/gemini-review.mjs:32` in Vigil — [Bernard PR #2646](https://github.com/Move-Better/Bernard/pull/2646), [Vigil PR #87](https://github.com/Move-Better/Vigil/pull/87), both merged). **Left alone on purpose:** `api/_lib/analyzeVideoWindow.js`'s Pro-tier video-analysis model and `gemini-review.mjs`'s `audit` focus — the only 3.x Pro model is `gemini-3.1-pro-preview`, and moving a production vision pipeline onto a preview-tagged model is a separate call, not a string swap.
2. ~~Bernard — `gpt-5-mini` retires Dec 11, 2026~~ **Shipped.** `api/_lib/citationProbe.js:22` → `gpt-5.6-terra` (confirmed same Responses API + `web_search` tool + `reasoning.effort` surface before swapping). [PR #2646](https://github.com/Move-Better/Bernard/pull/2646), merged.
3. ~~Bernard + Movebetterco — bump the `ai` SDK~~ **Bernard: already done by a sibling session before this one got to it** (7.0.2 → 7.0.66, PR #2636, merged 2026-08-20 — found via `git log`, not duplicated). **Movebetterco: shipped this session**, 7.0.14 → 7.0.71 ([PR #130](https://github.com/Move-Better/Movebetterco/pull/130), merged, `astro build` verified clean).
4. ~~Vercel CLI outdated~~ **Done.** `npm i -g vercel@latest` → 59.3.0 on this machine.

### INVESTIGATE
1. **Deep Thought — `scripts/fact-clarity-audit.js:71` pins the dated snapshot `claude-sonnet-4-5-20250929`.** It's Active, but its "not sooner than" floor (Sept 29, 2026) is the earliest of any model pinned across the whole stack — about 5–6 weeks out — and unlike the rolling aliases used everywhere else in this repo (`claude-sonnet-4-6`, `claude-opus-4-8`, `claude-haiku-4-5-20251001`), a dated snapshot won't auto-migrate when Anthropic does eventually deprecate it. Worth switching to `claude-sonnet-4-6` (already used elsewhere in the same repo, e.g. `src/lib/claude.js:29`, `src/lib/meeting-agenda.js:28`) unless the dated pin is intentional for reproducibility.
2. **Vercel DeepSec** — one-command AI security scanning is new this cycle. None of Bernard/Deep Thought/Movebetterco currently run a SAST tool per their own docs. Worth a trial run against Bernard given it's the largest/most complex of the three.

### IGNORE-FYI
- Claude Code 2.1.234–2.1.237 feature drops (default-model env var, Concise output style, idle notifications, GitLab MR support) — workflow niceties, no code changes needed.
- Claude Sonnet 5 pricing staying at $2/$10 instead of increasing — good news, no action.
- Bernard is already on `gpt-realtime-2.1` (`api/realtime-session.js:42`, `api/_lib/twilioSip.js:30`) and the bare `gpt-4o-mini-transcribe` alias (`api/realtime-session.js:199`, `api/_lib/twilioSip.js:148`) — both ahead of or unaffected by their respective Jan 2027 retirement dates.
- Clerk's new features (Directory Sync, promo codes, OAuth CIMD, elevation appearance, sign-in notifications) — none match a current need in Bernard or Deep Thought.
- Supabase's Postgres Changes filters, self-hosted SAML change, extension-pinning deprecation, `log_connections` default — all confirmed not applicable to how Bernard/Deep Thought actually use Supabase.
- Railway's Access Groups/Agent Connectors/Cloud Agents Beta/Android app/Postgres CVE patching — no fit for Deep Thought's single-service deploy with an external (Supabase) database.
- Next.js 16.3, Bun 1.4 on Vercel Functions — no project here uses either.

---

**Highest-priority action across all projects — now that this week's four items are shipped:** decide whether Bernard's video-analysis pipeline (`analyzeVideoWindow.js`) should move to `gemini-3.1-pro-preview` ahead of a GA Pro release, or wait. There's no deadline forcing this (see correction above), so it's a genuine product call about preview-model risk tolerance for a production feature, not a "do this now."

**Couldn't verify:** whether Google's "No shutdown date announced" status for Gemini 2.5 is itself stable — it flipped from a floated Oct 16, 2026 date (per third-party coverage this week) to "none" twice now across two consecutive weekly editions of this file. Worth re-checking `ai.google.dev/gemini-api/docs/deprecations` directly next week rather than assuming this week's read holds.
