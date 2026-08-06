# Bernard — Weekly Stack & AI Review
**2026-08-06**

## Since last week — a correction
Last week's (uncommitted, 2026-07-30) draft reported a confirmed **October 16, 2026** shutdown date for `gemini-2.5-pro`/`gemini-2.5-flash`/`gemini-2.5-flash-lite` and recommended planning a migration around it. **Re-fetching Google's own deprecations page directly today (last-updated August 3, 2026) shows all three bare model IDs now read "No shutdown date announced."** Only *dated preview* snapshots (`gemini-2.5-pro-preview-*`, `gemini-2.5-flash-preview-*`) carry real shutdown dates — none of which Bernard uses. The Oct 16 figure appears to have been walked back (or was never applied to the bare IDs) after users reported early, unexplained 404s on July 9. See the Gemini section and Action Items below — this drops from a hard-deadline item to a watch item.

## Stack detected in this repo
Vercel (Functions, Blob, Cron ×30, AI Gateway, Node runtime) · Supabase (Postgres, via PostgREST only — no RLS, no Supabase Auth, no Supabase Realtime; Clerk is the auth layer) · Clerk · Sentry · PostHog · Upstash Redis (`@upstash/ratelimit`) · bundle.social (publish, REST) · Stripe (billing, REST) · OpenAI (Realtime voice + Whisper/GPT transcription, direct API) · Anthropic + Google Gemini (both via Vercel AI Gateway) · ElevenLabs (TTS + voice cloning) · Twilio (SIP telephony) · Mux (video hosting/webhooks) · React 18 / Vite 5 / TypeScript 6.0.3 / Tailwind 3.

---

## This Week's Changes

### Anthropic / Claude (weighted first, per Bernard's heaviest dependency)
- **Claude Opus 4.1 (`claude-opus-4-1-20250805`) retired August 5, 2026** — the most recent actual retirement event on Anthropic's platform. Bernard's codebase has zero references to it (confirmed by grep). **Maturity: retired.** [Anthropic model deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations).
- **Official model-lifecycle table (re-fetched directly today)**: `claude-sonnet-4-6` Active (not sooner than Feb 17, 2027), `claude-opus-4-7` Active (not sooner than April 16, 2027), `claude-haiku-4-5-20251001` Active but **not sooner than October 15, 2026** — the closest retirement window of any model Bernard's code calls, by a wide margin. No bare/legacy IDs (`claude-sonnet-4`, `claude-opus-4`, `claude-3*`) found anywhere in `src/`, `api/`, or `scripts/`. **Maturity: stable.** [Model deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations).
- `temperature`/`top_p`/`top_k` remain a hard 400 error on Claude Opus 4.7+ (reconfirmed on the same page) — Bernard's `eslint/rules/no-temperature-on-opus.js` regex already covers this and no call site was found violating it.
- **Claude Code v2.1.223 (Aug 5–6, 2026)**: two security fixes — a Bash permission-check bypass where a crafted command could hide part of itself from the approval dialog, and a fix so tab-padded or invisible-Unicode commands can no longer hide content from permission prompts. Also: owner-wildcard entries for marketplace allow/block lists, a warning when a restricted subagent model falls back to the parent model, and a fix for workflow scripts using dynamic `import()` to escape the sandbox. **Maturity: stable, incremental — informational only** (doesn't touch Bernard's CI; the `pr.yml` `review` job calls `claude-code-action` with an inline prompt, not the interactive workflow sandbox). [Claude Code changelog](https://code.claude.com/docs/en/changelog).

### OpenAI
- **`gpt-5-mini-2025-08-07` (dated snapshot) is deprecated, hard shutdown December 11, 2026**, replacement `gpt-5.4-mini`/`gpt-5.6-terra`. Confirmed this week: the **bare alias `gpt-5-mini` is a separate, floating identifier that keeps working past the shutdown date** (it silently rolls to a newer underlying model rather than hard-failing) — Bernard's `api/_lib/citationProbe.js:22` uses the bare alias, not the dated snapshot, so there's no exposure. [OpenAI deprecations](https://developers.openai.com/api/docs/deprecations), [OpenAI community clarification thread](https://community.openai.com/t/clarification-needed-is-only-gpt-5-mini-2025-08-07-deprecated-or-the-entire-gpt-5-mini-family/1383857).
- No new realtime/transcription deprecation notices since the July 20 one already tracked in prior editions (legacy `gpt-realtime`/`gpt-audio` families, shutdown Jan 20, 2027 — Bernard is already on the recommended `gpt-realtime-2.1` and `gpt-4o-mini-transcribe`).

### Google Gemini
- See the correction at the top: `gemini-2.5-pro`, `gemini-2.5-flash`, and `gemini-2.5-flash-lite` (Bernard's exact call strings) currently show **"No shutdown date announced"** on Google's own deprecations page (fetched directly, page last-updated Aug 3, 2026). Only dated `*-preview-*` snapshots in the same families carry real shutdown dates, and Bernard doesn't call any of them. [Gemini API deprecations](https://ai.google.dev/gemini-api/docs/deprecations).
- Independently, multiple developers on Google's own forum report `gemini-2.5-flash`/`gemini-2.5-flash-lite` returning early, undocumented 404s ("no longer available") starting July 9, 2026, with no official Google response found as of this week. This is a live-outage-style risk distinct from the planned-deprecation risk — worth a passive watch, not a scheduled migration. [Google AI forum thread](https://discuss.ai.google.dev/t/gemini-2-5-flash-and-gemini-2-5-flash-lite-returning-404-no-longer-available-today-july-9-contradicts-oct-16-2026-shutdown-date/174267).

### Vercel / AI SDK
- **`ai` (Vercel AI SDK) is now at `7.0.55` on npm (released today, Aug 6, 2026)**; Bernard's installed/locked version is `7.0.2` (released June 25, 2026) — **53 patch releases behind**, within the same `^7.0.2` semver range already declared in `package.json:56`. [npm registry](https://registry.npmjs.org/ai).

Sources: see inline links above; Anthropic/OpenAI/Google deprecation claims were fetched directly from each vendor's own docs page, not summarized secondhand. Checked but found nothing new/material this week for Bernard's actual usage: Supabase (self-hosted-only Envoy gateway change doesn't apply — Bernard is on hosted Supabase), Clerk (SAML/OAuth-scope changes unrelated to Bernard's auth flow), ElevenLabs, Mux, PostHog, Sentry, bundle.social.

---

## Action Items for My Projects

### BREAKING (do now)
*None.* No retired or bare-legacy model strings found anywhere in `src/`, `api/`, or `scripts/` (checked for `claude-3*`, bare `claude-sonnet-4`/`claude-opus-4`, `gpt-3.5`, `text-davinci`, bare `gpt-realtime`/`gpt-audio`, deprecated ElevenLabs `eleven_monolingual_v1`/`eleven_multilingual_v1`, retired `claude-opus-4-1-20250805`). No `temperature`/`top_p`/`top_k` set on any of the 7 files that call `claude-opus-4-7` (checked every file setting a sampling param against every file resolving to an Opus 4.7+ id — zero overlap).

### WORTH DOING
| Project | Evidence | Recommendation | Effort |
|---|---|---|---|
| Bernard | `package.json:58` (`"ai": "^7.0.2"`), installed `7.0.2` vs current published `7.0.55` (npm registry, checked directly) | Run `npm update ai` (stays within the existing `^7.0.2` range — no code changes required), re-run `npm run build`/`npm test`, commit the updated lockfile. 53 patch releases of bug fixes are being missed for free; this item has been open two editions running. | Low |
| Bernard | `api/_routes/briefs/generate.js:120` (`model: 'anthropic/claude-haiku-4-5-20251001'`) — the **only** call site in the codebase pinned to the dated snapshot; the other 27 Haiku call sites all use the bare `claude-haiku-4-5` alias | This is the single closest retirement window anywhere in Bernard's stack (Anthropic: "not sooner than October 15, 2026," confirmed today). Switch this one call site to the bare `claude-haiku-4-5` alias to match every other call site's pattern and remove the exposure entirely — a one-line change. | Low |

### INVESTIGATE
| Project | Evidence | Recommendation | Effort |
|---|---|---|---|
| Bernard | `api/_lib/bookSynthesis.js:21`, `api/_lib/outboundCall.js:34`, `api/_routes/content-items/blog-regen-prepare.js:189`, `api/_routes/content-items/split-into-series.js:278,337` — all `anthropic/claude-opus-4-7` | Claude Opus 5 (GA since July 24) is priced the same as the Opus 4.x line it's compared against and is reported as a large capability jump. Still open from prior editions — no action taken yet. Pilot on one call site with the project's OLD-vs-NEW harness convention before any swap. | Medium |
| Bernard | 51 files on `anthropic/claude-sonnet-4-6` (workhorse tier — drafting, judging, extraction) | Claude Sonnet 5's introductory pricing ($2/$10 per M) reverts to standard ($3/$15) on **August 31, 2026** — 25 days out. This doesn't affect Bernard today (still on Sonnet 4.6, not Sonnet 5), but if a Sonnet 5 pilot is ever planned, doing it before Aug 31 costs less than after. Given the call-site count and Bernard's own judge/fidelity-gate calibration lessons, still recommend piloting on one low-stakes call site first, not a blanket swap. | High |
| Bernard | `api/_lib/analyzeVideoWindow.js:41,56-57`, `api/_lib/tagAsset.js:26-27`, `api/_lib/topicRegion.js:44` — `google/gemini-2.5-pro` and `google/gemini-2.5-flash` | No scheduled-migration urgency now that Google's own page shows no shutdown date (see correction above). Still worth a passive watch given the reported early-404 incidents on the forum — if either model starts erroring in Bernard's own logs, that's the trigger to migrate immediately to `gemini-3.6-flash`/`gemini-3.1-pro-preview`, not a calendar date. | Low (watch only) |

### IGNORE-FYI
- `gpt-realtime-2.1` (`api/realtime-session.js:42`, `api/_lib/twilioSip.js:30`) and `gpt-4o-mini-transcribe` (`api/realtime-session.js:199`, `api/_lib/twilioSip.js:148`) are already the recommended, non-deprecated forms.
- `whisper-1` (9 call sites: `api/_lib/whisper.js` ×5, `api/voice-memo.js:153`, `api/demo/transcribe.js:127`, `api/_lib/seminarTranscribe.js:131`, `api/handout/create.js:143`) — confirmed absent from OpenAI's current deprecation table; no action needed.
- `gpt-5-mini` (`api/_lib/citationProbe.js:22`) — confirmed this week to be the floating alias, not the deprecated dated snapshot. No exposure.
- `eleven_flash_v2_5` (`api/tts.js:35`) and `eleven_turbo_v2_5` (`api/_routes/voice/pre-visit.js:33`) are unaffected by the July 9 `eleven_monolingual_v1`/`eleven_multilingual_v1`/`scribe_v1` removals — Bernard doesn't use ElevenLabs Scribe (STT) at all, confirmed by grep.
- `@aws-sdk/client-s3` is a devDependency in `package.json` with zero call sites found anywhere in `api/`, `src/`, or `scripts/` — not a stack risk, just worth a future prune if it stays unused.

---

## Highest-priority action
**Repoint `api/_routes/briefs/generate.js:120` from the dated `claude-haiku-4-5-20251001` snapshot to the bare `claude-haiku-4-5` alias.** It's a one-line, low-risk change that eliminates the single closest model-retirement exposure in Bernard's entire stack (Oct 15, 2026 earliest-eligible date vs. Feb/April 2027 for everything else), and it's the only finding this week with any real deadline pressure — everything else is either already clean, a discretionary cost/quality upgrade, or actively *less* urgent than last week's draft believed.

**Couldn't verify:** I could not find an official Google statement explaining the July 9 early-404 reports on `gemini-2.5-flash`/`gemini-2.5-flash-lite`, or whether they've fully stopped recurring — treat the "no shutdown date" reading as current-but-not-guaranteed-stable. I also did not find a verifiable, current (last ~7-10 days) named-team AI-workflow case study with real sourcing to include this week — several generic "ROI" aggregator pages surfaced but none cited a specific, checkable team/outcome, so I omitted rather than reused a stale or unsourced one. `gemini-3.1-pro-preview`'s GA status is still unconfirmed (remains labeled Preview as of this week).
