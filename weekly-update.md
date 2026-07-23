# Bernard — Weekly Stack & AI Review
**2026-07-23**

## Since last week (2026-07-16) — prior action items, re-checked
- **Resolved:** `api/_lib/brandVisualAnalyzer.js:30` now reads `const ANALYSIS_MODEL = 'anthropic/claude-sonnet-4-6'` — the off-pattern bare `claude-sonnet-4-5` flagged last week is gone; all Sonnet call sites are consistent again.
- **Resolved:** `api/realtime-session.js:42` and `api/_lib/twilioSip.js:30` both now read `const REALTIME_MODEL = 'gpt-realtime-2.1'` — the upgrade from bare `gpt-realtime` recommended last week has shipped.
- **Resolved:** `@clerk/backend` is `^3.11.7` and `@clerk/react` is `^6.12.5` in `package.json:30-31` — matches the version bump suggested last week.
- Last week's `/publish/:id` UX-dead-click item belongs to the separate weekly PostHog UX-pain routine, not this stack review — not re-checked here.

---

## This Week's Changes

### Platforms detected in this repo
Vercel (Functions, Blob, Cron ×22, AI Gateway, Routing Middleware) · Supabase (Postgres 17.6, via PostgREST — no RLS, Clerk is the auth layer) · Clerk · Sentry · PostHog · Upstash Redis (`@upstash/ratelimit`) · bundle.social · OpenAI (Realtime voice + transcription, direct API) · Anthropic + Google Gemini (both via Vercel AI Gateway) · Twilio (SIP calling) · Mux (video webhooks) · TypeScript 6.0.3.

### Anthropic / Claude
- **Official model-lifecycle table** (fetched directly): every model Bernard actually calls — `claude-sonnet-4-6`, `claude-opus-4-7`, `claude-haiku-4-5-20251001` — is **Active**, none sooner than Feb 2027 retirement. **Maturity: stable.** [Anthropic model deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations).
- **Claude Sonnet 5** (`claude-sonnet-5`) is GA as of June 30, 2026 and now live on the Vercel AI Gateway — "near-Opus intelligence at Sonnet cost," launch pricing $2/$10 per M tokens through Aug 31, 2026 (standard list $3/$15). **Maturity: GA.** [Vercel changelog](https://vercel.com/changelog/claude-sonnet-5-ai-gateway), [PYMNTS coverage](https://www.pymnts.com/news/artificial-intelligence/2026/anthropic-cuts-ai-agent-costs-with-claude-sonnet-5-rollout/).
- **Claude Code** shipped daily point releases this week (2.1.214 → 2.1.218, July 18–22): permission-check hardening (oversized Bash commands, PowerShell bypass, `docker` daemon-redirect flags), a new `EndConversation` tool, emoji-shortcode autocomplete, and `/code-review` now running as a background subagent. **Breaking, tool-level (not code-level):** as of 2.1.215 (July 19), Claude no longer auto-runs `/verify`/`/code-review` after edits — they must be invoked explicitly. Doesn't touch Bernard's CI (`pr.yml`'s `review` job calls `claude-code-action` with an inline prompt, not the interactive skill), but worth knowing for anyone relying on the old auto-invoke habit interactively. **Maturity: stable, incremental.** [Claude Code changelog](https://code.claude.com/docs/en/changelog).
- **Model Context Protocol** — a major spec revision (`2026-07-28`, currently a Release Candidate, not yet final) moves MCP to a stateless architecture and adds an Enterprise-Managed Authorization extension. **Maturity: RC, upcoming.** Not applicable to Bernard today (no MCP servers in this codebase) — informational only. [MCP blog](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/).

### OpenAI
- **Legacy realtime/transcription model families deprecated** (announced July 20, 2026, shutdown Jan 20, 2027): bare `gpt-realtime`, `gpt-4o-realtime`, and dated transcription snapshots are being retired in favor of `gpt-realtime-2.1`/`gpt-realtime-2.1-mini`. **Bernard is already on the recommended replacement** (see "Since last week"). **Maturity: deprecation notice, GA replacement.** [OpenAI deprecations](https://developers.openai.com/api/docs/deprecations).
- Same notice lists `gpt-5-mini-2025-08-07` (dated snapshot) as deprecated, shutdown Dec 11, 2026, replacement `gpt-5.6-terra` — see Action Items (Bernard calls bare `gpt-5-mini`, not the dated snapshot).

### Google Gemini
- **`gemini-2.5-pro`, `gemini-2.5-flash`, and `gemini-2.5-flash-lite` are deprecated, shutdown date October 16, 2026** (Google's own deprecations page). Recommended replacements: `gemini-3.1-pro-preview` (for `-pro`), `gemini-3.6-flash` (for `-flash`). **Maturity: deprecated, ~3 months of runway.** Directly relevant — Bernard calls both retiring models. See Action Items. [Google Gemini API deprecations](https://ai.google.dev/gemini-api/docs/deprecations).
- Gemini 3.x is already live on the Vercel AI Gateway Bernard already uses for these calls — `google/gemini-3-flash`, `google/gemini-3.1-pro-preview`, `google/gemini-3.1-flash-lite-preview` are all confirmed available with no new provider account needed. [Vercel: Gemini 3.1 Pro on AI Gateway](https://vercel.com/changelog/gemini-3-1-pro-is-live-on-ai-gateway).

### Vercel
- **AI Gateway now routes realtime voice, STT, and TTS** (OpenAI + xAI Grok models), with the same routing/observability/spend-control layer as text models. **Maturity: beta.** Bernard's realtime voice interview feature calls OpenAI's Realtime API directly today rather than through the Gateway — see Action Items (Investigate). [Vercel changelog](https://vercel.com/changelog/realtime-voice-speech-and-transcription-now-supported-on-ai-gateway).
- **Vercel Private Blob reached GA June 30, 2026** — private stores, signed URLs, and short-lived auto-rotating OIDC tokens for function-to-Blob auth all graduated from beta, replacing a static `BLOB_READ_WRITE_TOKEN`. **Maturity: GA.** Bernard's blob store is `access: 'public'` by design (served media needs direct public URLs) — see Action Items (Investigate, not a quick swap). [Vercel changelog](https://vercel.com/changelog/vercel-private-blob-is-now-generally-available).
- Build logs now redact Sensitive env var values ≥32 chars (July 9, 2026) — security-positive, no action needed. [Vercel community digest](https://community.vercel.com/t/vercel-weekly-2026-07-06/45111).
- AI SDK `ai@7.0.19` (July 9, 2026) added `fingerprintTools`/`detectToolDrift` to detect MCP "rug pull" tool-definition drift. **Not applicable** — Bernard's `generateText`/`generateObject` calls don't wire in MCP tool servers. [AI SDK changelog](https://github.com/vercel/ai/blob/main/packages/ai/CHANGELOG.md).

### Supabase
- Bernard's prod DB is confirmed on **PostgreSQL 17.6** (checked directly via the Supabase MCP) — the widely-reported "Postgres 14 support ended July 1, 2026" deprecation does not apply.
- No other material Supabase changes this week affect anything Bernard actually uses (no RLS, no Supabase Realtime, no Supabase Auth in this codebase).

### TypeScript
- **TypeScript 7.0 went stable July 8, 2026** — a full Go-native compiler rewrite, reported 8–12× faster full builds. Bernard is on 6.0.3 (`package.json:99`). **Maturity: GA, but 2 weeks old** — ecosystem tooling (ESLint plugins, ts-node-style tooling) is still catching up. See Action Items (Investigate, not urgent). [TypeScript 7.0 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/).

### Real-world workflows (named team, measurable outcome)
- **Duolingo** cut median code-review time from 3 hours to 1 hour after adopting AI-assisted review tooling — a concrete, measurable process win from making review (not just generation) part of the agentic loop.
- **Picnic** (grocery delivery) is a useful cautionary counterpoint: perceived productivity rose sharply in the first weeks of AI-assisted development, then declined once code shipped faster than it could be reviewed, forcing repeated rework on the same features — a reminder that generation speed without review capacity is a net negative, not a win.

Sources: [ZenML LLMOps case study writeup](https://www.zenml.io/llmops-database/building-production-ai-agents-lessons-from-claude-code-and-enterprise-deployments), [AI coding agents July 2026 roundup](https://chatgptaihub.com/the-big-ai-coding-agents-story-what-july-16-s-news-means-for-developers/).

---

## Action Items for My Projects

### BREAKING (do now)
*None.* No retired or bare-deprecated model strings found in `src/`, `api/`, or `scripts/` (checked for `claude-3*`, bare `claude-sonnet-4`/`claude-opus-4`, `gpt-3.5`, `text-davinci`). No `temperature`/`top_p`/`top_k` passed on any `claude-opus-4-7` call site (checked all 7 call sites against every file that also sets a sampling param — none overlap).

### WORTH DOING
| Project | Evidence | Recommendation | Effort |
|---|---|---|---|
| Bernard | `api/_lib/analyzeVideoWindow.js:41` (`DEFAULT_VIDEO_MODEL = 'google/gemini-2.5-pro'`), `api/_lib/tagAsset.js:27`, `api/_lib/topicRegion.js:43` (both `google/gemini-2.5-flash`) | Google's own deprecation page sets an **October 16, 2026** shutdown for gemini-2.5-pro/flash/flash-lite. Confirmed 2026-07-23: both replacements are already live on Bernard's Vercel AI Gateway — `google/gemini-3.6-flash` ($1.50/$7.50 per M, vs $0.30/$2.50 today — 5×/3× cost) and `google/gemini-3.1-pro-preview` ($2/$12 per M, vs $1.25/$10 — still **Preview**, not GA). **Decision: wait, don't migrate yet** — these are commodity tagging/classification/summarization tasks on the flash tier by design, no quality problem to fix today, so switching early just means paying 3–5× longer than necessary for no functional gain. Re-check pricing + `gemini-3.1-pro-preview`'s GA status in early September, then swap + verify with time to spare before Oct 16. | Medium |
| Bernard | `package.json:56` (`"ai": "^7.0.2"`), `package-lock.json` pinned at exactly `7.0.2` | Installed AI SDK is 3 patch-tiers behind the current `7.0.19` (bug fixes, `streamTranscribe`). Caret range already permits it — just needs `npm update ai` + a re-verify of the three `streamText`/`generateObject` call paths (`api/stream.js`, `api/demo/generate.js`, and a couple of `generateObject` sites) since it's a real dependency bump, not a no-op. | Low |

### INVESTIGATE
| Project | Evidence | Recommendation | Effort |
|---|---|---|---|
| Bernard | `api/_lib/citationProbe.js:22` — `const OPENAI_MODEL = 'gpt-5-mini'` (bare, called directly against OpenAI's Responses API, not through the Gateway) | OpenAI's deprecations page lists the dated `gpt-5-mini-2025-08-07` as deprecated (shutdown Dec 11, 2026, replacement `gpt-5.6-terra`); unclear whether the bare, undated `gpt-5-mini` alias is affected or auto-tracks forward. Confirm on OpenAI's model page before it matters — low risk today since it's been running fine, but worth a 5-minute check given a firm date exists. | Low |
| Bernard | `api/realtime-session.js` + `api/_lib/twilioSip.js` call OpenAI's Realtime API directly; Vercel AI Gateway now routes realtime voice/STT/TTS with the same observability/spend controls as text calls (beta) | Architecture question, not a quick swap: would routing F1's realtime voice calls through the Gateway add useful cost/latency observability, or just add a hop for a latency-sensitive path? Worth a scoping conversation once the Gateway's realtime routing is out of beta, not immediate action. | High |
| Bernard | 13 files reference `BLOB_READ_WRITE_TOKEN`; every `put()` call site checked uses `access: 'public'` (e.g. `api/voice-memo.js:131`, `api/capture/upload.js:149`) | Vercel Private Blob (GA) replaces the static token with short-lived OIDC auth — but it requires the store to be private, and Bernard's media (photos, videos, thumbnails) needs direct public URLs for browsers/video players. Not a drop-in win; only worth it if a future feature needs a genuinely private blob segment (e.g. pre-processing originals) that could live in a second, private store while the public-serving store stays as-is. | High |
| Bernard | `package.json:99` — `"typescript": "^6.0.3"` | TypeScript 7.0 (Go-native compiler, stable July 8, 2026) is a major architecture change, not a routine minor bump. Worth a scoped local trial of `tsc --noEmit` under 7.0 once the ecosystem (ESLint's TS parser, ts-related tooling) has a few more weeks to stabilize — no rush given 6.0.3 is still fully supported. | Low (trial) / Medium (adopt) |

### IGNORE-FYI
- Postgres 14 deprecation — confirmed not applicable, Bernard's prod DB is PostgreSQL 17.6.
- MCP 2026-07-28 stateless spec revision — not applicable, no MCP servers in this codebase; still an RC, not final.
- AI SDK `fingerprintTools`/`detectToolDrift` (MCP rug-pull defense) — not applicable, Bernard's AI calls don't wire in MCP tool servers.
- Vercel build-log Sensitive-var redaction — pure upside, no action needed.
- Sentry's new GitLab support for Seer — not applicable, Bernard is on GitHub.
- Clerk's July 2026 UI changes (elevation appearance option, subscription-button fix) — Bernard doesn't use Clerk Billing components; cosmetic to Clerk-hosted UI Bernard doesn't render.
- Twilio's July 13 Conference-list endpoint default change — not applicable, Bernard's Twilio usage is SIP calling only, no Conference resource in the codebase.
- General accumulated npm drift (React 18→19, Vite 5→8, Tailwind 3→4, react-router-dom 6→7, zod 3→4, ESLint 9→10) — standing maintenance backlog, nothing changed about it this week specifically.

---

## Highest-priority action this week
**Nothing urgent.** The Gemini 2.5 deadline (Oct 16, 2026) was the only item with a hard external date; priced out the migration this session (see WORTH DOING) and deliberately deferred it — early switching costs 3–5× more per call with no quality upside for these commodity tasks. Revisit in early September. Everything else this week is either already fixed or genuinely not urgent.

**Couldn't verify:** the exact shipped Vercel changelog slug/date for the July 9 build-log redaction feature (only found it via a community weekly-digest post, not a direct `vercel.com/changelog/...` URL); and whether `gemini-3.6-flash` (Google's stated replacement for `gemini-2.5-flash`) is the exact model slug already live on the Vercel AI Gateway today — confirmed `gemini-3-flash` and `gemini-3.1-flash-lite-preview` are live, but did not find a source explicitly confirming a `gemini-3.6-flash` gateway listing, so re-check the exact slug at migration time rather than trusting this report's naming.
