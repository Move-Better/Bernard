# Weekly Stack & AI Review — 2026-11-12

**Scope:** Bernard (primary), plus Deep Thought, Vigil, Move Better Website, and Animal Website. `NarrateRx` excluded per standing instruction (retired project). Budget and Claude Usage are shell/Python scripts with no framework/AI dependency and are not covered below.

**Important caveat on method:** every local checkout in this session's working directories is behind `origin/main` — Bernard 41 commits, Deep Thought 23, Move Better Website 7 (and on a different branch), Animal Website 5 (also a different branch), Vigil 3. A first pass of this review, grepping the local filesystem, produced at least one stale finding (an "OpenAI Whisper still in use" item that had actually been fixed upstream on 2026-11-05). **All facts below were re-verified against each repo's `origin/main` via `git show`/`git grep`**, not the local working tree — this is noted because it changes what "current" means for every file:line citation that follows.

## Detected stack (as of `origin/main`)

- **Bernard** — Vite 5.1 + React 18.2 + Express 5.2 API on Vercel Node functions. AI: Anthropic (`claude-sonnet-4-6`, `claude-haiku-4-5`, `claude-opus-5`, `claude-opus-4-7`) + Google (`google/gemini-3.8-flash`, `google/gemini-2.5-pro`) via the Vercel AI Gateway (`ai` ^7.0.92); direct OpenAI Realtime (`gpt-realtime-2.1`) and transcription now fully on ElevenLabs Scribe v2 (`api/_lib/transcribe.js`) + `gpt-live-transcribe` for the realtime stream — the old Whisper path is gone. Auth: Clerk. DB: Supabase Postgres over REST/PostgREST (`service_role`, no RLS by design, no direct `pg` in the request path). Publishing: `bundlesocial` ^2.55.0. No `engines.node` pin in `package.json`.
- **Deep Thought** — Express 5.3 + React 19 (Vite 8, devDep only) on Railway (`nixpacks.toml`, Node ≥22). AI: direct `@anthropic-ai/sdk` ^1.6.0 (`claude-sonnet-5`, `claude-opus-5`, `claude-haiku-4-5-20251001`); `openai` ^7.53.0 for embeddings (`src/lib/embed.js`); raw `fetch` calls to OpenAI's REST API for Whisper transcription (`packages/transcribe/index.js` — see Action Items); `gpt-5.5` for one script. Auth: `@clerk/express`. DB: `@supabase/supabase-js` (REST); `pg` is script-only (migrations/restore).
- **Move Better Website** — Astro **^7.4.5** (bumped from ^5.0.0 on 2026-11-02, PR #165/#167 — "Resolve all 33 npm audit findings: Astro 7, zod 4, drop @vercel/node"), Tailwind 4, `ai` ^7.0.159, `zod` ^4.6.7. AI: `anthropic/claude-sonnet-4-6` (concierge chat, `api/ask.ts`) + `openai/text-embedding-3-small` (corpus embeddings) via AI Gateway.
- **Animal Website** — Astro **^5.10.0** (not yet bumped — see Action Items), Tailwind 4, no AI SDK.
- **Vigil** — no `package.json`; static site + Vercel routing middleware (password gate). Uses Gemini directly via `fetch` (not the AI Gateway): `gemini-2.5-pro` (one lens) and `gemini-3.8-flash` (default).

## This Week's Changes

### Anthropic / Claude
- **API version `2026-10-21` removes `temperature`/`top_p`/`top_k` entirely, and the cutoff is not Opus-only.** Earlier API versions already 400 on these params for "Claude 4.7 and later models" (Anthropic's own wording) and Claude Mythos Preview; version `2026-10-21` removes them for every model. *(breaking — see Action Items)* — [Model deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations)
- **`claude-sonnet-4-5-20250929` deprecated, retires November 30, 2026** (18 days out) → `claude-sonnet-5-5`. Grepped all five repos at `origin/main`: zero usage. *(N/A here, confirmed clean)*
- **Claude Fable 5.2 / Claude Mythos 5.2 launched Nov 9** — 1M-token context, 128k max output, $8/$40 per MTok; fast mode followed the same day at $16/$80 ("speed":"fast", no beta header). Mythos 5.2 is gated to verified organizations. Neither model is referenced anywhere in this stack. *(GA / gated-GA)* — [Claude API release notes](https://platform.claude.com/docs/en/release-notes/api)
- **Message threads (beta, Nov 2)** let a long conversation/agent loop send only new messages per turn instead of the full history, lowering request size and time-to-first-token. Potentially relevant to Deep Thought's `ask`/chat loop if it resends full context today — not confirmed either way. *(beta)*
- **Nov 5:** org-level IP allowlist (Console, beta); Nov 3: text watermarking extended to Mythos 5/Opus 4.7/Sonnet 4.6 output. Neither changes anything in this codebase. *(beta/GA, no action)*

### OpenAI
- **`whisper-1`, `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`, `gpt-4o-transcribe-diarize` deprecated (announced Aug 26, 2026), shutdown Feb 26, 2027** → `gpt-live-transcribe` (streaming) / `gpt-transcribe` (batch). **Already fully migrated in Bernard** — confirmed at `origin/main`: `api/_lib/whisper.js` no longer exists, every batch-transcription caller (`api/demo/transcribe.js`, `api/voice-memo.js`, `api/_lib/seminarTranscribe.js`, `api/handout/create.js`) routes through `api/_lib/transcribe.js` (ElevenLabs Scribe v2), and `api/realtime-session.js:204` / `api/_lib/twilioSip.js:151` already use `gpt-live-transcribe`. *(resolved — no action)* — [OpenAI deprecations](https://developers.openai.com/api/docs/deprecations)
- **`gpt-5-mini` deprecated, shutdown Dec 11, 2026** → `gpt-5.6-terra`. Already migrated: `api/_lib/citationProbe.js:22` and `api/_lib/citations/webSearchClient.js:33` both pin `gpt-5.6-terra` with an inline comment citing the Dec 11 date. *(resolved — no action)*
- **`gpt-realtime` deprecated, shutdown Jan 20, 2027** → `gpt-realtime-2.1`. Bernard's `REALTIME_MODEL` (`api/realtime-session.js:42`, `api/_lib/twilioSip.js:30`) is already on `gpt-realtime-2.1`. *(resolved — no action)*
- **SpaceX's $60B acquisition of Cursor closed; OpenAI cuts Cursor's direct model access effective today, Nov 12, 2026**, including withholding its upcoming Astra model. Dev-tooling industry news, not applicable to this stack (no Cursor usage found). *(reported by multiple outlets — Cybernews, Dealroom, Technology Magazine; OpenAI's own statement not independently fetched)*

### Google Gemini
- **`gemini-2.5-pro` and `gemini-2.5-flash` are now Deprecated — shutdown December 1, 2026** (19 days out). Google auto-routes `2.5-pro` requests to `gemini-3.8-flash` and `2.5-flash` requests to `gemini-3.5-flash-lite` from that date; whether the Vercel AI Gateway honors that auto-route or just errors on the old model string is unconfirmed. *(breaking — see Action Items)* — [Gemini API deprecations](https://aistudio.google.com/docs/deprecations)
- **Gemini 4 Carbon reached general availability Nov 10** and is now on the Vercel AI Gateway as `google/gemini-4-carbon` — a new, larger/pricier tier (~$2/$10 per MTok reported), not a replacement for the Flash tier Bernard already uses for cheap classification work. *(GA)* — [Netlify's changelog entry](https://www.netlify.com/changelog/gemini-4-carbon-ai-gateway-agent-runners/) (independently corroborated; a same-day Vercel-attributed "Gemini 4 Hydrogen" and "Gemini Decision 1" could not be confirmed — see "Couldn't verify")
- `gemini-3.8-flash` and `gemini-3.6-flash` have no announced shutdown date yet. Bernard already migrated its two classification call sites (`tagAsset.js`, `topicRegion.js`) from 3.6→3.8 on 2026-09-03. *(no action)*

### Vercel
- AI Gateway added **Gemini 4 Carbon** (Nov 10) and **MiniMax H3 Image/Highspeed** (Nov 10) — neither used here.
- **Vercel Sandbox** snapshot creation now up to ~10x faster (median 4.4s → <0.4s, Nov 9) — not used by this stack.
- **Workflow SDK** event/stream writes now default to WebSockets (Nov 9) — not used by this stack.
- Platform-wide (not this-week, but worth restating against Bernard's missing `engines.node`): **Node.js 20 was deprecated for Builds/Functions Oct 1, 2026**; Node 24 LTS is now the default. *(see Action Items)*
*(all GA except Sandbox items, which are platform features)* — [vercel.com/changelog](https://vercel.com/changelog)

### Supabase
- **Supabase CLI v3.0.0** released Nov 2 (npm/Scoop/Linux/`setup-cli` default to v3 now; Homebrew followed Nov 3). v2 gets only security/bug fixes going forward, no new features.
- TLS 1.2 cipher removal on project HTTP APIs, no earlier than Nov 10, 2026 — Supabase's own estimate is <0.0001% of traffic affected. *(IGNORE-FYI, see below; both items sourced from search results pointing at supabase.com/changelog, not independently fetched)*

### Railway (Deep Thought's host)
- **Nov 5–6:** workspace token management, password rotation for HA databases, CLI tracing. The HA-database password rotation is the one potentially useful item — Deep Thought's `.env.example` documents `DATABASE_URL`/`RESTORE_LOAD_DATABASE_URL` as long-lived, manually-rotated secrets (GitHub Actions secret + 1Password). *(INVESTIGATE, low priority)* — [railway.com/changelog](https://railway.com/changelog)

### Clerk (auth — Bernard + Deep Thought)
- **Passkeys as a second MFA factor** (Oct 29) — apps created before July 8, 2026 need the setting turned on explicitly. Optional hardening, no deadline.
- Nov 3–6: per-session expiry overrides, minimum app version enforcement (mobile-only, N/A here), Directory Sync group webhooks, email events in Application Logs. None apply to this stack's usage. *(sourced from a third-party changelog digest, not fetched directly from clerk.com — treat dates as approximate; IGNORE-FYI either way)*

### Real-world workflow
- **xfive**, a dev consultancy, moved its team from using Claude Code purely interactively to running it autonomously with CLAUDE.md + Hooks as guardrails, and reports a 35% delivery-speed improvement with no quality regression. Vendor-published, self-reported figure, named team. *(anecdotal, directionally useful)* — [X-Team / xfive case study](https://x-team.com/case-studies/xfive-claude-code-training)

## Action Items for My Projects

### BREAKING (do now)

1. **Deep Thought — `temperature: 0` is already causing real production failures today, and two more call sites carry the same risk unconfirmed.**
   `src/lib/ask-actions.js:114-115` documents, in-repo, dated **2026-11-12 (today)**: *"No temperature: claude-sonnet-5 refuses the parameter (400 'temperature: Extra inputs are not permitted', the first live draft)."* `src/lib/decision-check.js:79` and `src/lib/extract-meeting.js:107` (the `l10` meeting-extraction profile) both still pass `temperature: 0` to `claude-haiku-4-5-20251001` through `askWithStop` (`src/lib/claude.js:63-64`, which forwards `temperature` verbatim). `src/lib/claude.js:33-34`'s comment — *"Pass `temperature` ... on a model that still accepts it (Haiku 4.5 does)"* — is now stale by its own repo's later evidence. `package.json` pins `@anthropic-ai/sdk: ^1.6.0`, which is on the v1.x line that can default to API version `2026-10-21`.
   **Confidence:** HIGH that `claude-sonnet-5` 400s (observed, in-repo, today). The two Haiku call sites are **inferred, not independently tested this session** — no live Haiku call was made to confirm during this review.
   **Recommendation:** drop `temperature: 0` from `decision-check.js:79` and `extract-meeting.js:107` (mirroring the fix already shipped in `ask-actions.js`), or pin those two calls to an explicit older `anthropic-version` header if the tuned sampling behavior (documented at `extract-meeting.js:97-105` — a real A/B: temperature 0 gave 100% run-to-run overlap vs. 22-27% at default) must be preserved while this gets a proper fix. — *Sonnet 5, Quick*

2. **Bernard — `google/gemini-2.5-pro` (and its `gemini-2.5-flash` rate-card sibling) deprecate Dec 1, 2026 — 19 days out — and the F13 visual-scoring feature is still wired to it.**
   `api/_lib/analyzeVideoWindow.js:41` — `export const DEFAULT_VIDEO_MODEL = 'google/gemini-2.5-pro'` — with the rate card at lines 56-57 still carrying both `gemini-2.5-pro` and `gemini-2.5-flash`. This is live: it's imported by `api/_lib/scoreMomentsVisual.js` and `api/_lib/visualNominate.js`. Google auto-routes `2.5-pro` traffic to `gemini-3.8-flash` from Dec 1 — but that's Google AI Studio's own behavior; it's unverified whether a `google/gemini-2.5-pro` string sent through the Vercel AI Gateway gets the same silent reroute or a hard error. Bernard already has the exact precedent for this fix: `api/_lib/tagAsset.js:26` and `api/_lib/topicRegion.js:44` both moved `google/gemini-3.6-flash` → `google/gemini-3.8-flash` on 2026-09-03 with an inline comment recording a validated no-regression check against real prod inputs first.
   **Recommendation:** run the same bake-off pattern — swap `DEFAULT_VIDEO_MODEL` to `google/gemini-3.8-flash` (or the closest current Pro-tier equivalent, if F13's video-framing judgment genuinely needs Pro-level quality — the file's own comment at line 37-38 says Pro was picked specifically for subtle visual cues Flash missed), validate against real prod clips before merging, update the rate card, and do it before Dec 1. — *Sonnet 5, Medium (bake-off + validation)*

### WORTH DOING

3. **Bernard — project root is 41 commits behind `origin/main`, with local-only modifications.**
   `git rev-list --left-right --count HEAD...origin/main` → `0  41`. Local changes to `.claude/decisions.md`, `package-lock.json`, this file, plus three untracked `.claude/outcome-reviews/*.md` files. Per this repo's own CLAUDE.md, the project root should stay synced with `origin/main` since it's the only place `npm run deploy:prod` is meant to run from. Not currently causing harm (Vercel's GitHub integration deploys from `origin/main` directly, independent of this checkout) — but a manual `deploy:prod` run from here right now would ship 41-commits-stale code over a live `main`. — *Sonnet 5, Quick*

4. **Bernard — the `bernard/no-temperature-on-opus` ESLint rule's name undersells what it needs to catch.** Per Action Item #1's finding that the real cutoff is "Claude 4.7 and later models," not literally "Opus," and Bernard calls Anthropic exclusively through the Vercel AI Gateway (not a direct SDK import whose API-version default is visible in this repo) — it's genuinely unknown whether Bernard's ~30 `temperature`-passing call sites on `claude-sonnet-4-6`/`claude-haiku-4-5` (e.g. `api/_lib/detectThreads.js:142`, `api/_lib/segmentInterview.js:176`, `api/_lib/visualNominate.js:151,180`, `api/_lib/tagAsset.js:222`) are already silently 400ing through the Gateway. **Recommendation:** make one real Gateway call with `temperature` set on `claude-sonnet-4-6` from a scratch script and confirm success/failure before concluding anything either way. — *Sonnet 5, Quick (to test)* / *Sonnet 5, Medium (if ~30 call sites need a real fix)*

5. **Animal Website is two Astro majors behind its sibling site.** Move Better Website moved `astro` ^5.0.0 → ^7.4.5 and `zod` ^3.25.76 → ^4.6.7 on 2026-11-02 (PR #165/#167, driven by resolving 33 `npm audit` findings and dropping `@vercel/node` entirely). Animal Website's `package.json` is still on `astro` ^5.10.0 with no AI dependency to complicate the jump — this is likely the simpler of the two upgrades and would keep both marketing sites on the same major version. — *Sonnet 5, Medium*

6. **Deep Thought — live, intentional `whisper-1` usage, missed by the initial OpenAI-deprecation pass because it's one level removed from `src/`.** `packages/transcribe/index.js:76,107,136` hard-codes `model: 'whisper-1'` in three functions (`transcribeBuffer`, plus the job-submission/result paths). This isn't a dead fallback: `src/lib/transcribe.js:22` re-exports `transcribeBuffer`, and `transcribeOnly()` (defined at `src/lib/transcribe.js:32`, calling `transcribeBuffer` at line 34) is built for the "combine multiple files into one meeting" flow — the docblock above it (line 29) says *"Plain Whisper only — cross-file speaker labels are not comparable, so diarization is intentionally skipped for combined uploads."* `whisper-1` shuts down **Feb 26, 2027** (~3.5 months out — see "This Week's Changes → OpenAI"), same deadline Bernard already cleared by moving to ElevenLabs Scribe v2. **Recommendation:** Bernard's `api/_lib/transcribe.js` is a working reference for the same migration; port the pattern to `packages/transcribe/index.js`'s plain-transcription path (the AssemblyAI diarization path, when configured, is unaffected — it never calls Whisper). — *Sonnet 5, Medium*

### INVESTIGATE

7. **Bernard/Move Better Website — confirm Vercel project Node.js runtime is ≥22.** Node 20 was deprecated for Builds/Functions Oct 1, 2026 per this session's Vercel platform notes; Node 24 LTS is now the default. Neither Bernard's nor Move Better Website's `package.json` pins `engines.node` (Deep Thought and Move Better Website's Astro config do: `>=22`), so this can only be confirmed in each Vercel project's dashboard settings, not from code. — *Sonnet 5, Quick*
8. **Deep Thought — Railway's new HA-database password rotation (Nov 5-6) could reduce the manual-rotation burden** on `DATABASE_URL`/`RESTORE_LOAD_DATABASE_URL`, which `.env.example` documents as long-lived secrets split across a GitHub Actions secret and 1Password. Only worth it if Deep Thought's Postgres is actually running as a Railway HA database (not confirmed in this review) rather than Supabase-managed. — *Sonnet 5, Quick (to check applicability)*
9. **Anthropic's new message-threads beta (Nov 2)** could lower latency/request size on Deep Thought's `ask`/chat loop if it currently resends full conversation history per turn — not checked this session. — *Sonnet 5, Medium*
10. **Bernard/Deep Thought — Clerk passkeys as a second MFA factor (Oct 29).** Optional hardening, no deadline. — *Sonnet 5, Quick*

### IGNORE-FYI

11. Supabase TLS 1.2 cipher removal (no earlier than Nov 10, 2026) — all Supabase access here is plain HTTPS/PostgREST through Node's own TLS stack; no custom cipher pinning in any repo. Supabase's own estimate is <0.0001% of traffic affected.
12. Supabase CLI v3.0.0 (Nov 2) — relevant only to local migration tooling, no behavior change to any deployed code.
13. Claude Fable 5.2 / Mythos 5.2, Gemini 4 Carbon, Vercel Sandbox/Workflow SDK items — all genuinely new, none used by or relevant to this stack today.

## Resolved since an earlier pass of this review (same day)

A first grep of the **local, stale** checkout flagged OpenAI's Whisper/`gpt-4o-mini-transcribe` deprecation as a live BREAKING issue in Bernard. Re-checked against `origin/main`: it's already fully resolved (migrated 2026-11-05 — see "This Week's Changes → OpenAI" above). Recorded here only so the correction doesn't get lost; no action needed.

## Highest-priority action across all projects

**Deep Thought's `decision-check.js:79` and `extract-meeting.js:107` Haiku calls are the most likely to be silently failing right now**, the same way the sibling `claude-sonnet-5` call in `ask-actions.js` already confirmed failing earlier today — drop `temperature: 0` from both and re-run the 2026-11-05 extraction A/B once removed to see if the tuned sampling behavior still holds under the model's current default.

## Couldn't verify
- Whether the two Deep Thought Haiku call sites (`decision-check.js:79`, `extract-meeting.js:107`) are actually 400ing — inferred from the sibling `claude-sonnet-5` failure and Anthropic's docs, not independently tested with a live call.
- Whether Bernard's Vercel-AI-Gateway-routed Anthropic calls are already on API version `2026-10-21` (and therefore already silently 400ing on `temperature`) — would need a live test call; not made during this review.
- "Gemini Decision 1," which an initial Vercel changelog fetch attributed to a Nov 11 AI Gateway addition — a follow-up search could not confirm it exists as a Google model; "Decision-1" appears to be a Microsoft model per other sources. **Correction 2026-11-16:** `google/gemini-4-hydrogen` (and `gemini-4-argon`) DO appear in the AI Gateway model list, so the earlier "Hydrogen could not be confirmed" note was wrong; neither is used or tested here.
- Whether a `google/gemini-2.5-pro` request through the Vercel AI Gateway will auto-reroute to `gemini-3.8-flash` after Dec 1, 2026 the way Google's own AI Studio does, or simply error — not testable before the cutover date.
- Bernard's and Move Better Website's actual Vercel-project Node.js runtime version — not pinned in either repo's `package.json`, so it can't be checked from code alone.
