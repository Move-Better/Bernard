# Bernard — Project Notes

## Verifying authed pages — use Q's logged-in Chrome (on PROD), don't stop at the Clerk lock

Q keeps a logged-in Chrome session. Drive it with the **Claude-in-Chrome MCP** (`mcp__Claude_in_Chrome__*`): `list_connected_browsers` → `select_browser` (device "DrQ") → `tabs_context_mcp` → `navigate` to the real page on `https://*.withbernard.ai` → `computer` screenshot / `read_page`. That session is already past the Clerk gate, so any authed surface (Slate, Library, Storyboard, Settings, …) can be visually verified directly against prod data. Default to this for "does this UI change look right?" instead of declaring it blocked by auth.

**The one catch — it only works against PROD (`withbernard.ai`), so the code must be deployed first.** Authed verification cannot be done on localhost or a vercel.app preview:
- localhost dev server fails with `Missing VITE_CLERK_PUBLISHABLE_KEY` (it's a Sensitive var stripped from the worktree `.env.local` by `vercel env pull`), and even with the key, prod `pk_live` Clerk is domain-locked and rejects the `localhost`/`*.vercel.app` origin.
- So the workflow for a UI fix is: merge → GitHub-integration auto-deploys to prod (~2 min) → confirm the live SHA (`curl -s https://withbernard.ai/version.json | grep sha`) → THEN open the page in Q's Chrome and screenshot. It's post-deploy verification, but it's real and doesn't require Q to look manually.
- Pure render/transform code (Sharp/SVG compositors) is the exception — verify those locally with a node harness, no browser needed (see the WHOOP note below).

**This is THE standard verification procedure — not a fallback.** For any change to an authed surface, the default is: deploy → confirm live SHA → drive Q's Chrome and screenshot. Do NOT declare a UI change "verified" off a localhost render, a preview URL, or a green build alone, and do NOT report an authed surface as "blocked by Clerk" — the logged-in Chrome session is past the gate and is the way to look. Only skip the browser when the change is pure render/transform code (verify with a node harness) or has no observable surface.

**Relationship to the Playwright e2e suite (they are complementary, not redundant):** Chrome-tab is *interactive* verification — it proves the specific change you're working on, but only when someone actively drives it. The post-deploy e2e smoke is an *unattended regression net* that fires on every merge to `main` and catches breakage on the 5 covered routes when no one is looking. Chrome-tab structurally cannot replace it (it needs an agent in the loop). Policy: keep the e2e suite thin (the existing 5 routes) as a post-deploy tripwire, do NOT expand it to cover deep authed flows (that is Chrome-tab's job and where Clerk fights automation), and carry all "does this work / look right" verification through Q's Chrome.

(Q confirmed 2026-06-04 — "this keeps happening." Chrome-tab-as-standard + keep-e2e-thin confirmed 2026-06-04.)

## Design interview before building

Before scoping or implementing any non-trivial change, interview Q moderately about every relevant aspect of the planned work. Walk down each branch of the design tree, resolving dependencies between decisions one by one — don't ask about a downstream detail until the upstream choice is settled. If a question can be answered by exploring the codebase (checking how something is currently wired, what shape data is in, whether a path is live end-to-end), explore the codebase instead of asking. Ask only what the code can't answer.

## Minimize Q's typing — ask with clickable options, and ask more often

Q's input should be a click whenever the decision can be expressed as a choice. Don't make him type a sentence to answer something that's really "this or that."

- **Default to the `AskUserQuestion` tool for any decision point.** Whenever you'd otherwise write "Do you want A or B?", "Should I do X?", "Which approach — …?", or "Ready to proceed?" in prose and wait for a typed reply, use `AskUserQuestion` instead so Q clicks a button. This includes yes/no confirmations, picking between approaches, scoping toggles, and prioritization — anything with a small, enumerable set of answers. Q can always still type a custom answer via "Other," so offering buttons never costs him flexibility.
- **Ask on branches where guessing wrong means rework; proceed on low-stakes, reversible calls.** For any decision where building the wrong thing would cost real work — the design-interview decisions above, architecture/scoping forks, anything hard to undo — surface a quick multiple-choice question rather than guessing. A 10-second click is cheaper than a wrong build. For genuinely low-stakes, easily-reversible calls (a rename, an obvious default), just proceed and note what you chose. When several decisions that *do* warrant asking are pending, batch them into one `AskUserQuestion` call (up to 4 questions) so Q resolves them in a single pass instead of a back-and-forth.
- **Write self-contained options.** Each option's label is short (1–5 words) and its description states the tradeoff/consequence, so Q can decide from the buttons alone without asking you to explain. Put a recommendation first and tag it "(Recommended)" when you have a clear lean.
- **When to still use prose:** open-ended creative/strategic input that genuinely has no enumerable answer (e.g. "what should this headline say?"), or when Q has explicitly told you to just proceed. Don't force free-form questions into buttons when the answer space is truly unbounded — but that's the exception, not the default.

## Verify feature wiring before scoping changes

Before scoping a change to an "existing" feature, confirm it's actually wired. Pre-launch sprints in this codebase left a number of half-built scaffolds where a function exists, has a sensible signature, even has parameters for the thing you're about to add — but nobody calls it. Examples discovered during the seminar-CTA work (May 2026):

- `getCampaignPromptContext()` in `src/lib/campaigns.js` had been defined for weeks and was imported by zero files.
- `getSocialBatchSystemPrompt` / `getVideoScriptBatchSystemPrompt` / `getMarketingBatchSystemPrompt` in `src/lib/prompts.js` accepted a `campaignContext` parameter that no caller ever passed (and none of the three was actually used in production — atoms came through `getAtomSystemPrompt` instead).

Rule: before estimating a change, grep for callers of the core function(s) and confirm the path is live end-to-end (UI → API → prompt → model). "Function exists" ≠ "Function runs." A 5-minute `grep -rn '<funcName>' src/ api/` saves hours of building against a dead path. If you find the wiring is broken, surface that as part of the scope before coding.

## Re-verify a reported bug still reproduces before you fix it

An observation made earlier in a session (or in a screenshot, or "last night") can be **stale** — this repo runs parallel sessions with auto-merge to `main`, so a "broken" feature may have been fixed by another context *since you saw it*. 2026-06-02: an overnight "fix Slate (empty video grid)" task was nearly a from-scratch rebuild — the exact fix (`mediaData.assets` shape mismatch + missing `staff_id` SELECT field) had already shipped as #1146 and **was already live on prod**. It was caught only by the worktree re-read rule (an 87-line diff between the stale branch and `origin/main`) plus checking prod's deployed SHA.

Rule: before diagnosing or building a fix for an "it's broken" report, confirm it STILL reproduces on **current `origin/main`** and on **live prod**. Cheap checks: `git fetch && git log --oneline -8 origin/main -- <suspect file>` (did someone just touch it?) and `curl -s https://withbernard.ai/version.json` vs `git rev-parse origin/main` (is the fix already deployed?). Grounding the diagnosis in the prod DB (Supabase MCP) is still worth doing even if the fix already exists — it validates the premise rather than wasting it.

## You CAN audit/verify the live authenticated app — Q logs in, you drive the tab

The "Clerk prod keys are domain-locked, so you can't smoke the authed app" belief (`memory/feedback_local_dev_smoke_unavailable.md`) is only half true: you can't *authenticate as Claude*, but you don't need to. The Clerk **session cookie is shared across the whole Chrome profile**, so once Q logs into `<slug>.withbernard.ai` in Chrome, Claude drives the already-authenticated session via the **Claude-in-Chrome MCP** (`list_connected_browsers` → `select_browser` → `tabs_context_mcp` → `navigate`/`computer`) — even in a fresh tab. This is how the 2026-06-02 live UX audit and the Slate-fix verification ran against real prod data.

Rule: to verify a UI change or audit live prod, ask Q to log in once, then drive the authed tab **read-only** (navigate by URL, screenshot, score — never click publish/delete/send). Don't try to auth as Claude, and don't conclude "can't test on prod." Note: workspace subdomains use the full slug (`movebetter`), not the brand short-name.

## A preview is not the published artifact

When a feature renders something to a `<canvas>` (or any in-memory/preview-only surface) and the user can *see* it, that is NOT evidence the same artifact ships at publish/export. The render and the publish are different code paths. This codebase has several preview-vs-output surfaces — carousel on-screen text (`renderFreeformSlide`), the email-template iframe, image/video overlays — and they're easy to get wrong in the same way: the preview looks perfect, the live output is raw.

The 2026-05-29 carousel bug (PR #980) was exactly this: per-slide overlay text (`content_items.slides`) was drawn to a preview canvas via `renderFreeformSlide` but never turned into an image file or uploaded; publish sent the raw `media_urls` photos, so the on-screen text vanished from the live post.

Rule: for any feature that renders a derived artifact (overlay image, composited graphic, baked text, watermark), grep the renderer's callers. If it's called only in `*Preview` / `*Editor` components and never in a publish/upload/export path, the published output is stale or raw — the renderer needs a real produce-and-upload step on the publish path (reuse the SAME renderer so it stays WYSIWYG), not just a canvas. Confirm the live output, not the editor preview, before calling it done.

## Server-side image compositors (Sharp + SVG) — verify locally, mind tspan whitespace

The photo compositor (`api/_lib/brandRender.js` `renderEditorialPhoto`, `api/_lib/whoopTemplates.js` `renderWhoopPhoto`, baked by `api/editorial/compose-photo.js` into `content_items.photo_treatment` / `media_urls`) is pure server-side render code. Two lessons from building it:

- **Pure render/transform code CAN be verified locally even though app smoke is prod-only** (Clerk domain-locked — see "Smoke happens POST-DEPLOY"). The render functions take a workspace object + a source URL and return a JPEG buffer — no Clerk, no request context. Before shipping a template/render change, write a throwaway `node` harness that imports the renderer directly, renders every variant to `/tmp/*.jpg`, and **read the JPEGs** to eyeball them against the mockup. This caught every visual bug in the 6-template WHOOP build *before* merge — far cheaper than a prod round-trip. Don't ship SVG/Sharp render changes blind on "gates are green"; gates don't look at pixels.
- **SVG collapses whitespace at `<tspan>` boundaries.** Rendering multi-color text as inline `<tspan fill=…>` runs inside one `<text>` (the clean way to color one accent word — the renderer measures glyph widths for you) drops the space between runs: `isn't the` rendered as `isn'tthe`, `sciatica worse` as `sciaticaworse`. Fix: put `xml:space="preserve"` on the `<text>` element. Applies to any colored-run or multi-tspan text in these compositors.

## Mockup-first for non-trivial UI/flow work

**Walk the live app and read the real components before building any mock.** A mockup built from a strategy doc or memory produces a worse copy of logic that already exists. 2026-06-02: two full mock rounds reinvented channels-as-a-checkbox and the words editor, overwriting shipped atoms-per-channel and per-piece "Edit words" — because the mock was designed without reading `ContentPlanPanel.jsx`, `atomPlan.js`, or `StoryboardPiece.jsx` first. The rule: grep for the real components the mockup intends to change, read them, confirm what already ships, then frame each mock screen as a labelled diff ("TODAY → CHANGE") rather than a fresh canvas. If a mock screen drops an existing capability, that's a regression to flag, not a simplification.

Before writing code for any non-trivial UI or flow change, build a **clickable HTML mockup and get Q's sign-off first.** Q steers UI design by *reacting to a visual*, not prose, and catches scope/IA problems text reviews miss. This session burned an early build pass (Layout edge-to-edge + new components) before Q stopped it with "the idea is good but I need to see something before we do more"; every subsequent mockup round then surfaced a real refinement — a whole carousel composer, the interview→Words entry seam, a nav reorg, a new top-level surface — that prose alone would have dropped.

**For layout/CSS complaints, screenshot the live page BEFORE making any code change.** 2026-06-21: "sidebar too wide" turned into 4 PRs of guessing at pixel values (max-w-[1200px], w-44, w-fit, negative margins) because the first change was made without looking at what the actual layout rendered. A single Claude-in-Chrome screenshot before touch #1 would have shown the ~45px dead space from Layout.jsx's left padding and the w-fit solution in one pass. Rule: when Q reports a layout problem ("too wide", "too much padding", "off-center"), navigate to the live page, take a screenshot, measure/zoom the relevant region, THEN write code. The diagnosis is in the pixels, not the source.

**Iterative subjective visual polish is mockup-first too — not just flows/redesigns.** 2026-06-16: a photo-template render-tweak session shipped *six* PRs straight to prod, eyeballing each in Q's Chrome, before Q stopped it with "this is not going well — confirm changes with mockup first." The trap was treating each small canvas tweak (panel fade, text-box shape, bubble placement) as trivial, and leaning on the "pure render code → verify locally" exception. Two things that exception does NOT cover: (1) the **client canvas renderer (`renderFreeformSlide` in `overlayTemplates.js`) can't be node-harnessed at all** — it uses `document`/`window`, so the only verification is post-deploy in Chrome; (2) Chrome/local verification proves **technical correctness, never subjective design acceptance** — "does it look right" is Q's call, and a deploy-to-look loop burns a prod round-trip per guess. Rule: when a change's acceptance criterion is "looks right" rather than "works," and you're on the **second** ship-and-eyeball round on the same surface, STOP and switch to a mockup — recreate the layouts in `.claude/*.html` with real photo URLs (grab live blob URLs off the page via the Chrome `javascript_tool`), present CURRENT-vs-PROPOSED options, get Q's pick, then implement once. The node-harness exception (top of file) is for *correctness* of Sharp/SVG output, not for *design sign-off*.

Rule: for an audit/redesign that will touch multiple surfaces, after the assessment go straight to a self-contained prototype in `.claude/*.html` (a *keep* file, not scratch) — Tailwind Play CDN + lucide CDN + the app's real `src/index.css` HSL tokens so it looks like Bernard; replicate the chrome and wire the key interactions (gating, approve→handoff, toggles, view switches) so Q can *feel* the flow, with a dashed "What changed here" legend per screen tying choices to the audit findings. Verify it renders before handing over: serve the mockup with **`python3 -m http.server <port>` from inside the `.claude` dir** — NOT `npx serve`. `serve` 301-redirects `foo.html`→`/foo` (clean URLs) and then 404s, and it hides dot-directories so a worktree-root `serve .` can't reach `.claude/mockups` at all (both cost real time this session). Then drive the Claude_Preview tools (navigate the preview browser to `http://localhost:<port>/mockups/<file>.html` via `preview_eval`) — `preview_start` → `preview_eval` to switch screens → `preview_console_logs` (errors) → `preview_screenshot` at an **explicit wide width (e.g. 1360)**, because the "desktop" preset reverts to a narrow native size that hides the md-breakpoint sidebar. Iterate to sign-off, then build against the mockup as the spec, in trial-able phases. Full preference + how-to: `memory/feedback_mockup_first_for_ui.md`.

## The quality metric itself can be the bug — validate the validator

We gate caption work on an LLM-judge fidelity scorer (`api/_lib/captionFidelity.js` + the offline `scripts/voice-fidelity-captions.mjs`, sharing one rubric module `api/_lib/captionFidelityRubric.js`; CI gate `scripts/verify-caption-fidelity.mjs`). On 2026-05-31 the U1 keystone (feed the clip transcript into captions) measured a **−0.68 regression** — and that number was wrong. The grader was the broken thing: it **never received the transcript** it claimed to judge faithfulness against, and two of its dimensions rewarded clinical register ("real anatomy, technique names"), so it actively penalized faithful warm/personal captions. After the grader was rewritten to grade `said_fidelity` against the transcript with a register-neutral `voice_match` (PR #1081), the same change measured **+1.74**.

Hold both ideas at once: **keep holding on a red metric** (don't declare green when it isn't — that discipline is what forced the investigation), **but audit the metric when it contradicts a strong human read.** Before trusting an LLM-judge score to gate a feature:

- **Confirm it receives the reference it claims to compare against.** Cheapest, highest-yield check. The old grader's inputs were `{caption, phrases, names}` — no transcript. It could not measure faithfulness in principle.
- **Check it isn't rewarding a proxy.** "Sounds clinical" was standing in for "is good"; the proxy silently inverts on the edge case (emotional/personal content).
- **Average ≥3 samples.** Single-shot Haiku scoring swings ±2 and *flips the sign* between runs. A lucky +0.57 and an unlucky −0.68 were both noise.
- **Validate the grader with controlled probes** (faithful vs unfaithful, personal vs clinical) over real references — run the old grader alongside to reproduce the bias. Probe inputs for an instrument are legitimate eval methodology, not the "no fake data" violation (that's about faking app state).
- **Never tune the generator's prompt to game a mismatched grader.** Fix the grader.
- **One shared rubric module.** The eval prompt had drifted into 2–3 near-identical copies; any rubric used in >1 place must be a single import or the copies diverge. Full write-up in `memory/feedback_validate_the_validator.md`.
- **Probe AI-generation features with the REAL workspace data, not an invented stand-in.** When validating an AI feature locally (e.g. a `generateObject` route), pull the actual prod inputs the handler reads — for a from-brand generator, the real `workspaces.brand_style` palette via Supabase MCP — and feed THAT to the probe. An invented palette passed straight into the prompt bypasses the code path that reads the workspace, so it can't surface a data-path bug in that read. 2026-06-20: the first probe used a hand-made teal/navy palette and reported "0 navy, on-brand, great" — green — while the shipped route read a nonexistent `brand_kit_style` column and saw only the accent, so prod generated navy. Q caught it visually; the fake-data probe never could. Re-probing with the workspace's real `brand_style` immediately exposed both the column bug and the navy. The probe's inputs must exercise the same read the handler does.

## Multi-tenant SaaS
Bernard runs as a single shared deployment that serves multiple workspaces by subdomain (`<slug>.withbernard.ai`). Move Better People, Equine, and Animals are the three seed workspaces; external tenants self-onboard at `withbernard.ai/onboard`. All tenant-editable config — display name, voice/tone modifiers, interview/patient context, topic suggestions, output channels, publish credentials — lives in the `workspaces` row in the shared bernard Supabase, edited via `/settings/workspace`.

The legacy `brands/<id>/` filesystem-overlay pattern and the `VITE_BRAND` / `BRAND` env vars were retired in Phase 1F (2026-05-10). Paradigm content is no longer build-time-pinned. To onboard a new tenant, use the wizard — there is no per-deployment scaffolding.

`src/lib/workspace.js` retains a static config for legacy per-brand deployments only; runtime code reads `useWorkspace()` (browser) or `workspaceContext(req)` (serverless), which resolve from the DB by subdomain.

**Tenant onboarding** (`/onboard`, `api/onboarding/*`): a Clerk-authenticated user fills the wizard, which (a) creates a Clerk Organization, (b) inserts a `workspaces` row with the chosen slug + paradigm defaults pre-populated into the JSONB columns, (c) binds the Clerk org id back to the workspace, (d) seeds `enabled_outputs` and a default `clinic_settings` row. Subdomain DNS is wildcard (`*.withbernard.ai` → bernard Vercel project), so the new subdomain works immediately with no DNS step.

**Per-tenant publish credentials** (Buffer / Facebook / GBP / WordPress / etc.) live in the `workspace_credentials` table, encrypted at the column level with `WORKSPACE_CREDENTIALS_KEY` (Sensitive env var on the `bernard` Vercel project). Each row is `{ workspace_id, service, config (jsonb), secret_ciphertext (text) }`. Read/write goes through `api/_lib/workspaceCredentials.js`; never store these as Vercel env vars again — that pattern died with the per-brand deployments.

**Cross-workspace data isolation** is enforced at the API layer, not at the database layer: there is no RLS on the public schema (service_role bypasses anyway). Every API route that touches tenant-scoped tables must call `workspaceContext(req)` (or `workspaceById(id)` for background paths) and filter by `workspace_id`. Forgetting that = cross-tenant data leak. Treat the workspace_id filter the same way you'd treat an authorization check.

## Google Search Console — OAuth, not service accounts (sc-domain: 403s)

GSC analytics (`/analytics` page, `api/_routes/insights/search-queries.js`, `api/_lib/searchConsole.js`) authenticates via **per-workspace OAuth**, not a service-account JSON. The connect flow is `api/_routes/integrations/gsc/{connect,callback,disconnect}.js` + `api/_lib/gscAuth.js`, mirroring the Drive OAuth pattern (HMAC-signed state, refresh token encrypted in `workspace_credentials`, `config.token_type === 'oauth'`). It reuses the Drive OAuth client (`GOOGLE_DRIVE_CLIENT_ID/SECRET` fallback) — one extra redirect URI (`https://withbernard.ai/api/integrations/gsc/callback`) covers both.

Why OAuth and not the service-account path used by GA4: **domain properties (`sc-domain:…`) 403 for service accounts forever** — the API caller must be a verified owner, and a service account can never satisfy DNS verification even when shown as a "Full" user in the SC UI. OAuth as a human account that owns the property is the only path. (GA4 still uses service-account JSON — that limitation is GSC-domain-property-specific.)

Three real bugs hit while shipping this (2026-06-15), all worth knowing:

- **A 403 when the connected account IS a property owner = the Search Console API is disabled in the OAuth client's GCP project**, NOT a missing user grant. These are indistinguishable unless you surface Google's error body — `searchConsole.js` now appends `text.slice(0,300)` to the 403 message for exactly this reason. Fix is in Google Cloud Console → enable "Google Search Console API" on the project that owns the OAuth client. (Hours lost assuming it was an account-permissions issue.)
- **`detectSiteUrl` / any GSC call must use `searchconsole.googleapis.com`**, never the legacy `www.googleapis.com/webmasters/v3/sites` host — the legacy host silently returns null for the sites list, which left `config.site_url` unset at connect time. The site URL is always mirrored to `workspaces.gsc_site_url`, and both the insights read and the test endpoint fall back to it, so a null `config.site_url` is non-fatal — but fix the host so fresh connects populate config cleanly.
- **`apiFetch` does NOT auto-set `Content-Type: application/json`** — a POST whose body must be parsed by a Node handler (`req.body`) needs the header set explicitly, or Vercel leaves `req.body` empty and the handler sees `undefined` fields (symptom here: the test button returned `unsupported-service` because `service` arrived empty). `CredentialForm` sets the header; new callers must too. **A sibling route working WITHOUT the header is not proof you can skip it** — it only survives because every field it reads has a `|| default` fallback, so an empty body is indistinguishable from a default one. The from-brand `generate` route (all fields defaulted) dodged this for weeks; the chat designer route next to it (`messages` required, no default) returned `bad_request` on every turn until the header was added (#1469, caught only by the post-deploy Chrome check — invisible to lint/build/bundle-smoke). Rule: any client POST to a Node handler that reads a **required** body field MUST set `Content-Type: application/json`; never infer it's optional from a defaults-tolerant neighbor.

## API handler runtime conventions
Vercel `/api/*` handlers must match the configured runtime — the runtime flag alone isn't enough. Mismatched handler shapes either crash with a `TypeError` or, worse, **silently hang until the 300s function timeout** (the client just spins forever).

**Node runtime** (`runtime: 'nodejs'`, or default for any file importing Node-only modules like `@sentry/node`, `@clerk/backend`, `@vercel/blob`, `node:*`):
- Signature: `async function handler(req, res)` (Express-style).
- `req.url` is path-only — parse with `new URL(req.url, 'http://localhost')`.
- `req.headers` is a plain lowercased object — use `req.headers['x-foo']`, **not** `.get()`.
- `req.body` is pre-parsed JSON — do **not** call `await req.json()`.
- Respond via `res.status(N).json(...)` or `.send(...)`. **Never return `new Response(...)`** — Vercel ignores it and the function hangs until the 300s execution timeout. No error, no log, just a spinning wheel client-side.
- Rate-limit via `enforceLimit(req, res, bucket)` from `api/_lib/ratelimit.js`.
- Reference handlers: `api/content-pieces/*`, `api/media/*`, `api/db/*`.

**Edge runtime** (`runtime: 'edge'`):
- Signature: `async function handler(req)` where `req` is a Web `Request`.
- Web-style API: `req.url` is a full URL, `req.headers.get()` works, `await req.json()` works.
- Respond via `return new Response(JSON.stringify(...), { status, headers })`.
- Cannot import Node-only modules. The Edge bundler does whole-graph bundling and will choke on even transitive Node imports (e.g. `ratelimit.js → @clerk/backend → node:crypto`).
- Rate-limit via `enforceLimitEdge(req, bucket)` from `api/_lib/ratelimit.js`.

**When converting between runtimes, refactor the handler shape — runtime flag alone is not sufficient.** PR #307 flipped `api/db/*.js` from Edge to Node by only swapping the runtime flag and leaving the Web-style handler in place. Result: four hours of cascading prod failures (PRs #312 / #316 / #317) before the shape was fully fixed.

For Supabase REST failures, the `dbErr(res, r, msg)` helper in each `api/db/*.js` file logs the full PostgREST response body to `vercel logs` (tagged `[db/<file>]`). Use the same pattern when adding new handlers that talk to Supabase REST — public response stays opaque, but root-causing is one log fetch away (`vercel logs --status-code 500 --expand`).

**PostgREST `in.()` filter syntax — double-quoting is FINE, despite a since-corrected lesson here.** PostgREST officially supports double-quoted string values inside `in.()`, and an empirical prod probe (2026-06-18, against `wrqfrjhevkbbheymzezy`) confirms it: for both a text column (`workspaces.clerk_org_id`) and a UUID column (`video_segments.id`), `in.("val")` and `in.("a","b","c")` return exactly the same rows as the bare form `in.(val)` / `in.(a,b,c)` — HTTP 200, all rows, no silent zero-match. (Single-quoting a UUID is what actually breaks: `in.('uuid')` returns HTTP 400 `invalid input syntax for type uuid`.) The production workspace switcher (`api/_routes/workspace/list.js:64`) has used the double-quoted form continuously and works — that alone disproves "double quotes silently match zero rows." **So do NOT mass-rewrite double-quoted `in.()` filters to bare on the theory that they're broken** — an `/auditfull` bug-hunter flagged 9 such sites as a P0 in the 2026-06-18 audit; all 9 are correct and were left untouched. Either form is acceptable; bare is marginally simpler, but double-quoted is not a bug.

The earlier version of this lesson (citing "PR #1391") was a **misdiagnosis on two counts**: (1) the real PR #1391 was a `staffId` UUID-validation fix in `db/content.js`, unrelated to `in.()` quoting; the double-quote→bare change to `auto-detect-clips.js` was actually **PR #1392**. (2) #1392's stated cause — "the quoted form matched zero rows on every run" — is empirically false (see probe above). The auto-clip cron's "processed nothing" was the empty-`wsIds` / candidates path, not the quoting — note #1392 *also* added an empty-`wsIds` log in the same commit. The one genuinely-correct takeaway survives: **validate every query param that lands in a PostgREST filter with `UUID_RE` before interpolating** — a missing check on `staffId` (PR #1391) left a real filter-injection gap while `interviewId` right next to it was correctly validated. That is a security rule; the quoting claim was not.

**Reading `responseStatusCode` in Vercel logs**: a value of `0` means the function crashed or timed out before returning any response — it's NOT an HTTP status code. A value of `200` means the handler returned successfully, even if the response body has `{error: ...}` and the client toasts it as a failure. When triaging prod errors, filter on `responseStatusCode=0` to find crashes, then read the `logs` array on that entry for the actual stack. Always log `e.stack` (not just `e.message`) in catch blocks that capture failures into a response `errors[]` array — Sharp / ffmpeg / native module crashes often have empty `.message` and only a useful `.stack`. Related: a warm function instance can return `200` on code that crashes on cold start (fontconfig init, lazy module load, etc.); "works in prod right now" ≠ "ships safely." Exercise the cold-start path before declaring an SVG-rendering / native-dep feature done.

### Bundle smoke test
CI runs `npm run verify-bundles` (= `node scripts/verify-function-bundles.mjs`) after `npm run build`. The script dynamically imports every `api/**/*.js` handler from the project root and fails if any throws at module-load time — the same failure mode as `ERR_INTERNAL_ASSERTION` from a native dep like `sharp` with the wrong conditional-export resolution, or a static import of a name the target module doesn't export. This is the bundle-time complement to the `bernard/api-handler-shape` ESLint rule.

**Why it doesn't run `vercel build`:** Vercel's Node runtime copies source files into each `.func` unchanged and traces `node_modules` into the bundle — there's no esbuild transform on Node handlers. The crash class we care about fires during Node's module loader, which behaves identically whether deps resolve from a bundled per-function `node_modules` or from the project's installed `node_modules`. So a project-root import reproduces the same module graph that breaks in production, without needing `VERCEL_TOKEN` in CI.

**To run locally:**
```
cd "/Users/qbook/Claude Projects/Bernard" && npm run verify-bundles
```

**When the check fires in CI:**
1. The error message names the exact handler file that failed to load and prints the Node error (e.g. `ERR_INTERNAL_ASSERTION: Module "foo" was loaded as CJS`, or `The requested module 'node:fs/promises' does not provide an export named 'createWriteStream'`).
2. Identify the import that caused the failure — usually a package with ESM-only sub-packages imported in a CJS context, or a wrong-named import from a built-in module.
3. Fix: static-import the CJS build directly (`import Foo from 'pkg/dist/cjs/index.js'`), or swap the import to the correct module/name.

**Allowlisting:** handlers that legitimately cannot be smoke-tested in isolation are listed in the `ALLOWLIST` set at the top of `scripts/verify-function-bundles.mjs`. Each entry must include an inline comment explaining why. The allowlist should stay empty — never add a handler just because it checks env vars at *call* time; the smoke test only loads the module graph, it doesn't invoke any handler.

## Router conventions (App.jsx)

The outer `<Routes>` in `src/App.jsx` has a deliberately minimal shape:

```jsx
<Route path="/privacy" element={<PrivacyPolicy />} />
<Route path="/terms" element={<TermsOfService />} />
<Route path="/onboard" element={<OnboardingShell />} />
<Route path="*" element={<ProtectedAppWithProvider />} />
```

Every authenticated app route — including deep paths like `/onboard/interview` and `/onboard/brand-kit` — flows through the `*` catch-all into `ProtectedAppWithProvider`, which renders a descendant `<Routes>` block matching the actual page. **Do not add explicit outer exemptions** like `<Route path="/onboard/interview" element={<ProtectedAppWithProvider />} />`.

React Router v6 footgun: a parent `<Route>` matched with a fixed path (no `/*` splat) consumes the entire URL. The descendant `<Routes>` rendered inside the parent's element then matches against the EMPTY remainder, and an inner `<Route path="/">` (Home) matches the empty index — so the page silently renders Home at the wrong URL. The `*` catch-all sidesteps this because `*` is splat: the matched parent path is empty, so descendant routes see the full URL. Three PRs in the 2026-05-21 onboarding sprint were burned chasing this; see PR #729.

If you genuinely need an outer exemption (e.g. for a route that must bypass `WorkspaceProvider` or `OrgGate`), use `<Route path="/your-path/*">` with the splat to preserve descendant matching.

## Large-file handling
Functions that download media (videos, audio, large images) from blob storage **must stream** the response body to disk rather than buffering. `await res.arrayBuffer()` materializes the entire file in RAM and OOMs the function on anything over ~500MB (default Node function memory is 1024MB):

```js
import { createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const r = await fetch(blobUrl)
if (!r.ok) throw new Error(`download failed: ${r.status}`)
await pipeline(Readable.fromWeb(r.body), createWriteStream(localPath))
```

Peak memory is then bounded by the stream's internal buffer (a few MB), independent of source size. Reference: `api/_lib/thumbnail.js`, `api/_lib/tagAsset.js` (PR #318 fixed the OOM that was killing video-thumbnail backfill).

## Async pipelines and the detail-drawer refresh contract

When a feature writes meaningful row fields from background work (`waitUntil`, queued jobs, webhook callbacks — anything that PATCHes the row 5+ seconds after the user-facing request returns), the list view's existing refetch-on-upload covers grid/thumbnail freshness but the detail drawer does NOT see the update without help. Without this, users opening the drawer immediately after a triggering action see stale state (e.g. `status='raw'` while the pipeline still runs) and assume the feature is broken.

Rule: any PR that adds a new pipeline-PATCHed column on `media_assets` / `content_items` / `interviews` must also ensure the relevant detail view re-reads the row while the pipeline is still pending. The canonical pattern (see `src/components/MediaDetail.jsx`):

```js
const { data: liveAsset } = useQuery({
  queryKey: ['media-asset', asset.id],
  queryFn: () => getMediaAsset(asset.id),
  initialData: asset,
  refetchInterval: (q) => {
    if (!pipelinePending(q.state.data)) return false
    if (Date.now() - pollStartRef.current.at > 60_000) return false  // hard cap
    return 2000
  },
  refetchOnWindowFocus: false,
})
```

`pipelinePending` is a row-shape predicate (`!web_blob_url` for photos, `transcode_status in ('pending', 'processing')` for videos, etc.). The 60s hard cap matters — silent pipeline failures must not produce an infinite polling loop. Editable form state stays seeded from the original `asset` prop on `asset.id` change so in-progress user edits aren't clobbered by a poll round-trip.

**Hard cap is universal — not just for MediaDetail.** Every `useQuery` with a `refetchInterval` that polls while a status is pending MUST have a time-based hard cap, regardless of where it lives. A Vercel function killed at the 300s wall does not run its `finally` block, so `catch`-based terminal status writes never fire — any "in-progress" status can strand permanently. The `MediaDetail` 60s cap is the reference implementation; page-level polling (Slate packages, ClipFinder segments, Book generation) must apply the same pattern with an appropriate ceiling (60s–5min depending on expected job duration). No cap = silent infinite-poll loop until the tab closes. Found in 2026-05-29 audit: Slate.jsx and ClipFinder.jsx both omitted the cap.

### Fire-and-forget enrichment off a handler must use `waitUntil()` — and a backfill can hide a dead live hook

Background work dispatched from a Node `/api` handler as a **bare floating promise** (no `await`, no `waitUntil`) is not guaranteed to run. On Vercel's Node runtime the instance is frozen the moment the HTTP response is sent, so any async work still pending at that point — embeddings, a late PATCH, an index insert — is silently dropped. This is distinct from the 300s-wall case: it fires immediately at response time, not at a timeout.

Rule: any enrichment a handler kicks off but does NOT `await` before responding (concept extraction, RAG indexing, summarization, book-stale flags) must be wrapped in `waitUntil(...)` from `@vercel/functions`. And `waitUntil` only keeps the instance alive for work that is part of the promise you hand it — so if that promise itself fire-and-forgets a nested step (e.g. `summarizeInterview` → `indexInterviewSummary`), the nested step must be `await`ed, or `waitUntil` won't cover it. Reference: `api/db/interviews.js` + `api/_lib/interviewSummarizer.js` (PR #1066).

The trap that hid this for days: a one-time **backfill makes the data look complete**, masking that the LIVE hook never worked. `practice_memory_chunks` had a summary chunk for every historical interview — but all 7 shared a 2.2-second `created_at` cluster (the 2026-05-24 backfill), and every interview completed *after* it had `summary_text` but zero chunks. Diagnostic tells: (1) if all rows of a derived type share a tight `created_at` cluster, they came from a backfill, not live writes; (2) when verifying any "indexes on completion / approval" feature, confirm a record created *after* the last backfill also has its derived rows — never assume historical coverage means the live path runs. (Same "preview/backfill looks right, live path is dead" shape as the carousel bug, `feedback_canvas_preview_not_published.md`.)

## Streaming chat (/api/stream) conventions

The shared `/api/stream` endpoint and its client wrapper `streamMessage()` in `src/lib/claude.js` are used by every conversational page (InterviewSession, OnboardingInterview, future variants). Two rules to follow when building a NEW page that calls them, or `AI_InvalidPromptError` and retry storms will eat your day:

1. **Inject a silent first-turn user message.** Claude API and the Vercel AI Gateway both require `messages` to contain at least one user message — a system-only request returns `AI_InvalidPromptError` immediately. The canonical pattern (see `InterviewSession.jsx:643`):

   ```js
   const streamInput = currentMessages.length === 0
     ? [{ role: 'user', content: 'Please begin the interview.' }]
     : currentMessages
   for await (const delta of streamMessage(streamInput, systemPrompt, opts)) { ... }
   ```

   The seed message is sent to the stream only; it must NOT be added to the visible transcript or persisted to the row.

2. **Guard the kickoff effect against retry storms.** Any `useEffect` that auto-fires `streamMessage` on mount must have a one-shot ref. Without it, a stream failure clears `streaming` back to false while leaving `messages.length === 0`, and the effect re-fires on every render — producing a ~10 rps hammer on `/api/stream` until the tab closes:

   ```js
   const kickedOffRef = useRef(false)
   useEffect(() => {
     if (loading || streaming || messages.length > 0 || kickedOffRef.current) return
     kickedOffRef.current = true
     runAssistantTurn([], { isFirstMessage: true })
   }, [loading, streaming, messages.length, runAssistantTurn])
   ```

   On error, the user gets the error card with a "Try again" action that page-reloads (resetting the ref). No silent auto-retry. PR #731 fixed both bugs after they hit prod.

## Custom ESLint rules to know before writing JSX

Three project-specific rules bite hard if you don't know them:

- **`react-hooks/static-components`** — component functions defined **inside** another component's render function (`const Foo = () => ...` inside `function Parent()`) reset their state on every render and trigger this error. Fix: declare all sub-components at **module scope**, outside any other component. Caught on `ProgressDots` in the demo session (2026-06-07).
- **`bernard/no-arbitrary-text-size`** — prohibits `text-[10px]`, `text-[11px]`, etc. Use the semantic tokens instead: `text-3xs` (10px) or `text-2xs` (11px). Lint will error at 0-warnings-allowed; the fix is a global replace before committing.
- **`bernard/no-raw-use-mutation`** — use `useAppMutation` not raw TanStack `useMutation`.
- **`bernard/no-raw-api-fetch`** — use `apiFetch`/`apiFetchResponse`, never bare `fetch('/api/...')`.
- **`bernard/no-hardcoded-brand-color`** — bans retired brand-color *literals* (Move-Better orange `#e36525` / hue-20 `hsl(20 …)` / `rgb(227,101,37)`, grey `#6e7072`, evergreen `#1c4d37`, coral `#ff8552`) anywhere in a `src` JS/JSX string. Use the design tokens instead: `bg-primary`/`text-primary`/`hsl(var(--primary))` (emerald brand), `bg-action`/`hsl(var(--action))` (amber act-now signal) — defined in `src/index.css` + `src/lib/brand.js` (the single JS-side brand source). Added #1297 after the #1294 repaint was a multi-file hunt; it immediately caught a `#E36525` a case-sensitive grep had missed. For a genuinely-intentional exception, `eslint-disable-next-line bernard/no-hardcoded-brand-color` with a reason.

## Template literal backticks in `src/lib/prompts.js`

All system-prompt functions in `prompts.js` return template literal strings (backtick-delimited). **Any backtick character inside the return value terminates the string and causes an ESLint parse error** (error message: `Parsing error: Unexpected token :`). This includes markdown code formatting: writing `` `[STAGE:n]` `` inside a prompt causes the failure even though it looks like documentation.

Rule: when editing prompt functions in `prompts.js`, use single quotes `'value'`, `[brackets]`, or plain text for any value you'd normally set in backtick-fenced formatting. Never use raw `` ` `` inside a template literal prompt unless you escape it as `` \` ``.

## Lint ratchet
The `npm run lint` script enforces a `--max-warnings <N>` ceiling (currently **0** — the ratchet has been driven all the way down from 152 at the pre-launch audit). The ratchet should drift **down** over time, not up. Rule:

- A PR may not raise the ratchet ceiling without fixing an equal-or-greater number of warnings elsewhere in the same PR.
- If you introduce 1 new warning, fix at least 1 old one and keep the ceiling unchanged.
- The only exception is intentional `console.error`/`console.warn` in shared instrumentation (e.g. `api/_lib/sentry.js`) — bump the ceiling and note the reason in the commit body, the way `chore(lint): bump ratchet to 152` did.

The ceiling represents merged-baseline tech debt. Driving it down is the goal; raising it is a regression.

## Supabase migrations
Migrations live in `supabase/multitenant/migrations/` and are applied via `node scripts/apply-multitenant-migrations.mjs <file.sql>` against `MULTITENANT_DATABASE_URL`. There is no migration tracker — the script just applies whatever you pass it, so filename ordering is informational only.

**Required:** any migration that creates a new table, view, sequence, or function MUST include explicit `GRANT … TO service_role` in the same file. The REST API used by serverless functions runs as `service_role` and returns 403 / SQLSTATE 42501 on unprivileged objects (lesson from the early multi-tenant rollout — see `003_grant_service_role.sql` for the backfill pattern). Do NOT rely on re-running `003` after each new migration; bundle grants inline so each migration is self-sufficient. Example:

```sql
CREATE TABLE public.foo (...);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.foo TO service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;
```

**Prototype aggregate / function SQL against prod (read-only) BEFORE writing the migration + endpoint.** For dashboard/recap features whose value is a SQL function or non-trivial GROUP BY (e.g. `workspace_recap()`, migrations 121/122 powering the Overview recap), paste the `SELECT`/`WITH` into the Supabase MCP `execute_sql` and run it against a real workspace id first. It validates the JSON shape AND the actual numbers in seconds, and catches window/aggregation bugs that a green build never would (the recap's `prev_week` window was initially mis-bounded to overlap `this_week` — caught only because the prod run showed identical totals). Then a `CREATE OR REPLACE FUNCTION … GRANT EXECUTE … TO service_role` is idempotent: running it via `execute_sql` IS the apply step, so the committed `NNN_*.sql` file is just the record — no separate apply-script run needed for functions. (Pure rendering of the result, like the recap's cost rate-card, still verifies locally; only the app shell is Clerk-prod-locked.)

If two migrations land on the same day, give them sequential numeric prefixes (008, 009, 010 …) rather than sharing a prefix. Shared prefixes are confusing for humans even though the apply script doesn't care.

**Apply before shipping code that depends on them.** Because there's no migration tracker, it's easy to merge a PR that references a new column while the schema lags behind on prod — the handler will 500 with a generic "Database error" on first hit. Rule: before merging a PR that adds a `select=` field, ALTER TABLE, or new column reference, confirm the relevant migration is applied to prod. Quick check via Supabase Studio SQL Editor (https://supabase.com/dashboard/project/wrqfrjhevkbbheymzezy/sql/new):

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = '<table>';
```

If the column is missing, paste the relevant `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` from the migration file straight into the SQL Editor — faster than running the apply script, and idempotent so safe to re-paste.

Local migration runs require an unredacted `MULTITENANT_DATABASE_URL` in `.env.local`. `vercel env pull` replaces Sensitive vars with `*****REDACTED*****`, which silently breaks the apply script (`TypeError: Invalid URL`). After any `vercel env pull`, restore `MULTITENANT_DATABASE_URL` from 1Password (Bernard vault) before running migrations locally.

**Status columns have CHECK constraints.** Any new status value needs a migration — symptom is a generic `db_error`/500. Before adding a new status value, grep `<table>_status_check` in `supabase/multitenant/migrations/` to find the constraint, then add an `ALTER TABLE … DROP CONSTRAINT / ADD CONSTRAINT` in the same migration as the code that uses it. Never assume a text column accepts any value.

**`content_items.media_urls` canonical shape is `[{url, type, kind, …}]` objects** — never bare strings. A bare string URL → the video publisher can't determine type → ships as a broken image. Every writer must use the object shape. Use `clipToMediaEntry()` / `pickerItemToMediaEntry()` from `src/lib/mediaEntry.js` to construct entries.

**A `composed: true` entry's `.url` is a BAKED composite, not the photo — draw `sourceUrl || url` (via `photoSourceUrl()` in `mediaEntry.js`) anywhere you re-render the photo under live text.** The editorial "Bake to image" flow (`api/_routes/editorial/compose-photo.js`) flattens a headline onto a navy `dark-claim` card and writes that composite to `entry.url`, stashing the original photo in `entry.sourceUrl` (`composed: true`). Any surface that draws the photo to apply its OWN live text (carousel themes via `renderFreeformSlide`) must use the raw `sourceUrl`, or it draws the baked text-card and hides the photo. This bit 5 drifting call sites at once (#1447, 2026-06-20): `SlideEditor` canvas/rail/full-preview, `renderSlides.js` publish-bake + ad-export, and `PostPreview` `SlideCanvas` all read `.url` while ad export alone (correctly) used `sourceUrl || url`. Symptom: a mixed carousel shows photos on un-baked slides and navy text-cards on baked ones. Un-baked entries have no `sourceUrl`, so `photoSourceUrl()` is a no-op for them — always route slide-photo reads through it. (Same family as "A preview is not the published artifact".)

## Deleting or merging a `staff` row — repoint FKs first (5 of 12 cascade)

`staff.id` is a foreign key in **12 tables**, and **5 are `ON DELETE CASCADE`** — `content_items`, `interviews`, `practice_memory_chunks`, `staff_recipes`, `staff_voice_phrases`. There is also a denormalized, non-FK reference: `campaigns.target_staff_ids` (`uuid[]`). Deleting a staff row that still has cascade children **silently destroys that learning** (interviews, voice phrases, memory chunks) — no error, it just vanishes.

Rule: before ANY staff delete or merge, count children per `staff_id` across all 12 tables, repoint every one to the surviving row FIRST, then delete. Make the DELETE **self-guarding** — `AND NOT EXISTS (SELECT 1 FROM <child> WHERE staff_id = s.id)` for all 12 tables **plus** `AND NOT EXISTS (SELECT 1 FROM campaigns c WHERE s.id = ANY(c.target_staff_ids))` — so a stray child can never be cascaded away even if state shifted between the count and the delete. **Never trust a plan/spec that calls a row "empty" or "safe to delete" — verify against live counts.** (2026-05-30: the staff-integration plan labeled the Animals Q proxy "0 of everything"; it actually held 1 interview a literal-reading delete would have CASCADE-destroyed.)

Prefer the atomic, collision-safe `merge_staff(source, target, workspace)` SQL function (migration 112) over hand-rolled deletes — it repoints all 12 FKs + the campaigns array, blocks cross-workspace merges, and de-dups the 3 child tables that carry a `staff_id`-bearing unique index (`staff_voice_phrases`, `staff_corpus_documents`, `staff_recipes` one-default). Do NOT combine the repoint `UPDATE`s and the staff `DELETE` in a single multi-CTE statement: data-modifying CTEs share one snapshot, so the cascade-vs-repoint interaction is unpredictable. Sequence them (repoint, verify zero children, then delete) or call the function. This same repoint-then-delete discipline applies to any future table whose FKs cascade — re-discover the FK graph from `information_schema` before assuming the list of children.

## Blob store
All production media lives in a single Vercel Blob store (`bernard-prod`, prefix `t4otw6ecf8ztxfeq`), attached to the `bernard` Vercel project on team `movebetter`. `BLOB_READ_WRITE_TOKEN` in `.env.local` / Vercel env points to this store.

**Legacy stores are gone.** Three per-brand blob stores (`gmrxcvv1cauu7ksf`, `jl52kpqqmvyxuhpr`, `ep9i5v4jhxekujri`) were detached from Vercel when the per-brand projects were deleted on 2026-05-10. All 908 `media_assets.blob_url` values were migrated to the current store by `scripts/migrate-legacy-blobs.mjs` (2026-05-12, PR #325). Legacy public URLs may continue to resolve for a time but are not relied upon.

**Thumbnail uploads** go to `media/thumbs/<uuid>.jpg`; originals go to `media/raw/<workspace-id>/...`. Both live in the same store.

**Blob path namespacing: use `ws.id`, not `ws.slug`.** Blob keys must use the immutable workspace UUID as the primary namespace component, not the mutable slug. Using `ws.slug` creates two failure modes: (1) a workspace rename silently orphans existing blobs and breaks any handler that validates a blob URL against an expected prefix (see `api/voice-clone/resume.js`), (2) a slug reuse window (however brief) creates a path collision. The slug may appear as a secondary human-readable component, but `ws.id` must be the primary key. Five handlers were found using slug-based paths in the 2026-05-29 audit — fix tracked in `fix-tenant-defense-in-depth` worktree.

**Re-running the migration** is safe (idempotent): `node scripts/migrate-legacy-blobs.mjs --dry-run` shows what would migrate; without `--dry-run` it skips rows already on the current store. Requires `MULTITENANT_DATABASE_URL` + `BLOB_READ_WRITE_TOKEN` in `.env.local`.

## GitHub
Use the GitHub CLI (`gh`) for GitHub-specific interactions — PRs, issues, releases, repo management. `gh` is configured as the git credential helper, so plain `git push` / `git fetch` are fine for ref operations (they authenticate through `gh` under the hood). Do not set up separate HTTPS basic auth or raw SSH credentials.

## Parallel sessions — one worktree per session
The project root (`/Users/qbook/Claude Projects/Bernard`) is reserved for two things only: `git pull` on `main` and `npm run deploy:prod`. **No session — Claude or human — does feature work there.** Every active Claude session runs in its own git worktree, so two sessions can never collide on a branch, a working tree, or a half-committed file.

The 2026-05-21 deploy stall was the canonical failure: Session A (post-interview UX, on `fix/post-interview-flow`) finished and merged its PR. Session B (onboarding P2) was still working in the same project root on `feat/onboarding-interview-p2` with uncommitted edits to `src/App.jsx`. When Session A tried `git checkout main` to deploy, the checkout aborted on B's WIP. A had to wait for B to commit before prod could ship. With per-session worktrees, A's deploy step is `cd "/Users/qbook/Claude Projects/Bernard" && git pull && npm run deploy:prod` — independent of whatever B is doing.

**Helper:** `scripts/new-session-worktree.sh <session-name>` creates a fresh worktree at `../Bernard-worktrees/<session-name>` branched off `origin/main`, copies `.env.local` + `.vercel/` in, and symlinks `node_modules` so `npm run dev` works immediately. When the session's PR is merged, clean up with `git worktree remove ../Bernard-worktrees/<session-name>`.

**Rules:**
- A new Claude session that intends to edit code starts by creating a worktree, not by editing in the project root.
- The project root stays on `main`. If you find yourself on another branch in the project root, you (or another session) skipped the worktree step — recover by stashing, switching back to `main`, and re-doing the work in a fresh worktree.
- Long-running sessions can stay parked in their worktree across days. Stale branches still cost nothing in disk space.

**Worktrees symlink `node_modules` to the project root — so when a PR adds a new npm package, all worktrees break until the project root's `node_modules` is updated.** Fix: `git -C "/Users/qbook/Claude Projects/Bernard" stash && git -C "/Users/qbook/Claude Projects/Bernard" checkout main && git -C "/Users/qbook/Claude Projects/Bernard" pull && npm --prefix "/Users/qbook/Claude Projects/Bernard" install`. Never run `npm install` while the project root is on a feature branch — it will add the dep to that branch's `package.json`/`package-lock.json` as an uncommitted side-effect. Always check out `main` first. (2026-06-02: checkup after sprint found `@vercel/toolbar` missing from `node_modules`; fixing it while root was on `feat/url-import-preserve-publish-date` polluted Q's working branch.)

## Branch workflow (avoiding pile-ups)
PRs need to merge close to when they're opened, not batch-stacked indefinitely. The 26-PR pileup of 2026-05-12 happened because work batched while `main` moved in parallel from other contexts — every PR ended up conflicting with a different file `main` had since rewritten. To avoid the repeat:

1. **Rebase before every new branch.** Mechanical rule: at the start of every new feature branch, run `git fetch origin main && git checkout -b <name> origin/main` (or `git fetch && git rebase origin/main` if continuing a branch). The PR's base must be current.

2. **Cap unmerged PRs in flight.** Never open more than 3 unmerged PRs from the same context without stopping to merge. Once 3 are open and unmerged, finish merging before opening a 4th — otherwise the diff against `main` drifts faster than review can keep up.

3. **Enable auto-merge on open.** After `gh pr create`, run `gh pr merge <num> --auto --squash` so the PR ships the moment CI is green. Requires branch protection on `main` to define "ready" (status check on the PR build workflow); without protection, `--auto` merges immediately on open and the gate is moot.

4. **Same-file overlap = base on the older PR, not main.** Before opening a follow-up PR, check whether your next branch touches a file an open PR also touches (`gh pr diff <num> --name-only` per open PR). If yes, base it on that PR's branch (`git fetch && git checkout -b <next> origin/<open-pr-branch>`) instead of `origin/main`. Otherwise the older PR is guaranteed to conflict when the newer ones land first, and auto-merge silently stalls — you only notice when someone asks "did it ship?". Cheaper to base correctly than to rebase three files of conflicts later. (Lesson from the 2026-05-19 approve-flow stack: PRs B/C/E/F all touched `AssetsPane.jsx`; PR D opened mid-stack stalled on a three-way conflict because E/F merged first.)

5. **Check for merged-while-you-worked PRs.** Before the next feature branch, run `gh pr list --state merged --search 'merged:>=<session-start-iso>'`. Catches the case where a parallel agent shipped overlapping work — surfaces conflicts in seconds instead of at end-of-session.

5b. **Don't spawn a follow-up chip for work you then do yourself the same session.** A `spawn_task` chip the user clicks becomes its own parallel session — if you *also* implement that same work, you've guaranteed a same-file conflict between two PRs. 2026-06-09: a chip spawned for the "act-now hue" decision got spun off and shipped #1295 (amber as raw literals) while this session shipped #1297 (amber as the `--action` token) touching the same 3 files — forcing a rebase + `--force-with-lease`. Mine superseded theirs cleanly, but the collision was self-inflicted. Rule: if you decide to do the deferred work yourself, `dismiss_task` the chip FIRST (it only works while still pending — once the user clicks it, you can't withdraw it and must rebase onto whatever it ships). Spawn a chip only for work you are NOT going to touch.

5. **If two agents share a worktree, neither owns it.** When you discover you're not alone in the working tree (a `git branch --show-current` shows an unfamiliar branch, untracked files you didn't create appear, your edits get reverted between an Edit and the next Read, or `git status` shows a divergent branch), do NOT keep editing in place. Stash your work, create a fresh branch off `origin/main`, and pop the stash there. If files were reverted before you could stash, cherry-pick your commit onto a clean branch from `origin/main` instead. Do not push commits to a branch the other agent appears to own — that's how PRs end up containing a mix of work that shouldn't ship together.

When work *has* batched (long autonomous run, lots of stacked PRs), triage rather than mass-merge: identify which PRs are now duplicative of merged work, which can rebase cleanly, and which need to be re-done against the current shape of the codebase.

**Stacked PRs + squash-merge = guaranteed rebase conflict; use cherry-pick instead.** When PR A (the base) merges as a squash, git produces a brand-new commit that subsumes A's individual commits. Branch B, which was stacked on top of A, now has A's original commits in its history — and `git rebase origin/main` finds conflicts because the squash-commit and A's original commits touch the same files differently. `git rebase --abort` is the right response. The clean recovery:
```bash
# from inside the stacked branch
git log --oneline -3          # find B's single meaningful commit SHA
git fetch origin main
git checkout -b <new-branch-name> origin/main
git cherry-pick <B-commit-sha>
git push -u origin <new-branch-name>
# close the old PR, open a new one targeting main
```
Cherry-pick replays only B's actual change onto clean main — no conflict. This pattern recurred twice in the 2026-06-07 function-consolidation session (Phase 2 and Phase 3 stacked PRs after Phase 1 squash-merged).

## Production deploys
Deploy to prod **only** from the project root (`/Users/qbook/Claude Projects/Bernard`) and **only** when the project root is on `main`, fully synced with `origin/main`. `vercel deploy --prod` ships the local working tree (not the git ref), so deploying from a worktree, a feature branch, or a project root with uncommitted changes will publish whatever happens to be on disk — including reverting recently-merged PRs.

Canonical command:

```
cd "/Users/qbook/Claude Projects/Bernard" && npm run deploy:prod
```

`npm run deploy:prod` wraps `vercel deploy --prod` and injects `VERCEL_GIT_COMMIT_SHA=$(git rev-parse HEAD)` as a build-env. CLI uploads have no `.git` in the build container, so without this the prebuild's `write-version.mjs` falls back to `sha: "dev"` and the auto-update notifier silently no-ops for that deploy.

**Preflight check** (`scripts/deploy-prod-preflight.sh`, runs automatically before every `deploy:prod`): refuses to deploy unless (a) cwd is the project root, (b) current branch is `main`, (c) HEAD equals `origin/main`, (d) no uncommitted modifications to tracked files. If a parallel session leaves the project root on a feature branch or with WIP, the deploy aborts before Vercel sees a single byte of code. The 2026-05-22 close-call (deployed `feat/onboarding-interview-p4` instead of `main`, only saved by coincident merge of #720) is the direct prompt for this guard. To bypass in a true emergency: `DEPLOY_PROD_BYPASS_PREFLIGHT=1 npm run deploy:prod`.

If the project root is on another branch (with WIP), do not switch under the user. Either run the deploy from a separate `main`-tracking worktree that's `vercel link`ed to the `bernard` project (copy `.vercel/project.json` in if needed) or ask the user to free up the project root. Always confirm the resulting deploy is aliased to `withbernard.ai` + `*.withbernard.ai` with `vercel inspect <dpl-id>` before declaring it done — deploys from an unlinked worktree silently create a separate Vercel project and never touch the real prod aliases.

**Vercel's GitHub integration auto-deploys every push to `main`.** Each merge to `main` triggers a Vercel build that finishes in ~2 minutes and is aliased to `withbernard.ai` automatically. The auto-deploy runs in a real git clone, so `VERCEL_GIT_COMMIT_SHA` is set naturally and the auto-update notifier works correctly. **Do NOT run `npm run deploy:prod` after your own merge — it ships the exact same commit a second time, doubles the build cost, and just clobbers the GitHub-integration alias with an identical artifact.** Discovered 2026-05-25 (commits #839/#840/#841 each got two production deployments — one auto, one manual — for no benefit).

After a merge, verify the auto-deploy via `vercel ls bernard --prod | head -3` (look for a ● Ready row whose age matches the merge time) or by polling `curl -s https://withbernard.ai/version.json` until `sha` flips to `git rev-parse origin/main`. That's the whole post-merge protocol.

**`vercel inspect <dpl>` Aliases / domains list is FROZEN deployment metadata — NOT live routing.** It shows the domains a deployment was assigned at deploy time and does not update when you add/remove aliases afterward. After `vercel alias rm <name>`, `inspect` will keep listing the removed alias (it refreshes only on the next prod deploy), which reads as "the removal failed" when it actually succeeded. **For live alias/routing state, trust HTTP probes, not `inspect`:** `curl -s -o /dev/null -w "%{http_code}" https://<host>/` (a removed alias → 404/connection refused; a live one → 200). Bit us during the 2026-06-08 legacy-domain → withbernard.ai cutover — `inspect` listed five of the old domain's aliases as still attached after they'd been removed; curl confirmed every one was actually dead.

## Renaming ≠ rebranding — check build-generated output and binary/vector asset *contents*, not just string refs

A global rebrand find/replace (old product name → `bernard`, old domain → `withbernard.ai`) swaps strings and renames files but leaves two whole classes of stale branding that a `grep` of source won't catch. Both shipped to live prod during the 2026-06-08 rebrand and were only caught later:

- **Build-time generators regenerate stale output on every deploy.** `scripts/build-blog.mjs` has inline HTML templates (header logo, `<title>`, canonical/OG URLs, footer email) that were never rebranded. It runs as part of `npm run build`, so Vercel regenerated `public/blog.html` + `public/blog/*.html` with full Bernard branding (favicon `/bernard-icon.svg`, `https://withbernard.ai/blog` canonical) on **every** deploy — the committed files looked correct but were overwritten at build time, and the live blog served the old brand regardless. **Rule: after a rename, grep `scripts/` and any `prebuild`/`build` step for the old name, not just `src/`/`api/`. A file that's regenerated by the build is owned by its generator, not by its committed copy.**
- **Renamed asset files still contain the old artwork.** `git mv <old>-logo.svg bernard-logo.svg` changes the filename, not the pixels/paths inside. Every `public/*.svg` and `public/brand/*.png` was the old evergreen-`#1c4d37`/coral-`#ff8552` mark under a Bernard filename — including `bernard-icon.svg`, the sitewide favicon + PWA + Clerk-org-logo (~43 refs). **Rule: for SVGs, grep the file *bodies* for old brand color hexes / old wordmark text (`grep -l '#ff8552\|#1c4d37' public/**/*.svg`); for PNGs, actually open/rasterize a couple and look. A clean `grep` of code references proves nothing about asset contents.** (Local rasterization fallback when rsvg/ImageMagick are absent: `qlmanage -t -s <px> -o /tmp x.svg` then `sips -z`/`--padToHeightWidth` for exact dimensions.)

`npm run deploy:prod` is still the right tool for:
- The GitHub integration is failing or paused
- A hotfix needs to ship from a worktree without a PR
- You need to deploy code that isn't yet (or won't ever be) on `main`

## Audit and checkup
Three complementary commands cover code/UI/prod health:

- **`/checkup`** (and `/checkup quick`, `/checkup ui`, `/checkup full`) — procedural health pass: lint + build + tests + recent-change code review + optional UI smoke + prod logs. Fast, deterministic, ~3–25 min. Use before opening a PR or after a hot deploy.
- **`/audit`** — multi-agent deep review composing `bug-hunter` + `tenant-isolation-auditor` + `ui-reviewer` in parallel, scoped to commits since the last audit (tracked in `.claude/audit-history/.last-audit`). `ui-reviewer` always sweeps the full app since visual drift is cumulative. Writes a prioritized P0/P1/P2 punch list to `.claude/audit-history/<date>.md` and spawns one-click chips for P0 fixes. ~10 min, ~$3–6. Routine cadence.
- **`/auditfull`** — same three agents, but `bug-hunter` and `tenant-isolation-auditor` sweep the entire codebase with no diff scoping. Higher coverage at higher cost. ~20 min, ~$8–15. Before-release baseline, not weekly cadence.

Pair `/audit` with `/schedule` for an automated weekly run; reserve `/auditfull` for monthly or pre-release passes.

**Pre-merge Claude review** (`pr.yml` `review` job) — runs an inline `prompt` on every PR via `anthropics/claude-code-action@beta`, posting inline findings before merge. Non-blocking (`continue-on-error: true`); `build` is still the only required gate. To promote it to a required check, add `review` to branch protection status checks. Two pitfalls found in initial wiring:
- `github_token` must be passed explicitly — without it, the action silently gets a Bad credentials 401 when posting comments (#1393, 2026-06-18).
- The input is `prompt:`, NOT `direct_prompt:` — the wrong key causes `IS_PR: false` / `CLAUDE_SUCCESS: false` and a 26s no-op exit with no error surfaced (#1399, 2026-06-19). Skills (e.g. `/code-review`) are not available in the headless CI context; use an inline prompt string instead.

## `.claude/` directory — scratch vs. keep

The untracked `.claude/` directory mixes two kinds of files; do NOT bulk-delete it as "scratch." Before deleting anything here, classify:

- **Regenerable scratch (safe to delete)** — outputs that have a committed generator: eval results (`eval-v6.mjs`), smoke reports (`g6-video-onboarding-smoke.mjs`), prompt-eval logs (`prompt-eval-harness.mjs`), voice-fidelity dumps. Rule of thumb: there's a `scripts/*.mjs` that re-creates it.
- **Human-authored, irreplaceable (keep)** — design/planning docs with no generator: `*-spec.md`, `*-plan.md`, `*-sketch.md`, mockup `*.html`. These are real work (one was literally "awaiting owner sign-off") and are never re-derivable. Treat them like source.

These are untracked, so `rm` is unrecoverable (see ~/.claude/CLAUDE.md "Deleting files — untracked means unrecoverable"). When in doubt, leave it or ask — the cost of keeping a stale scratch file is zero; the cost of deleting a spec is the whole document.

**A fresh worktree / spawned follow-up task does NOT inherit untracked or gitignored `.claude` files — commit the handoff docs FIRST.** `spawn_task` (and any new `git worktree`) checks out a branch off `main`; it gets ZERO of the current worktree's untracked planning docs and ZERO gitignored mockups. So if you `spawn_task` a follow-up that says "read `.claude/foo-plan.md`" or "build from `.claude/mockups/bar.html`", the spawned session **cannot see them** unless they're on `main`. Before spawning a doc-dependent follow-up: commit the `.md` keeps (not ignored — plain `git add`) and `git add -f` any referenced mockups. Bit us 2026-06-20: a U3–U5 follow-up referenced `unified-editor-plan.md` + `unified-editor.html`, both worktree-local — had to commit them (#1451) so the handoff worked.

**Mockup-tracking convention (Q, 2026-06-20 — "Option A"):** `.claude/mockups/` is gitignored (`.gitignore:28`) and STAYS that way for iteration scratch — but **`git add -f` a mockup the moment Q signs off on it.** An approved mockup is the build spec (mockup-first rule), so it must be versioned next to the code it specs and reachable from any worktree. Tracked so far: `unified-editor.html`, `carousel-editor-v2.html`, `colorist-brand-look.html` (approved) + `video-editor-v1.html` (pending sign-off). Don't bulk-commit the ~50 exploration mockups — only the sign-off'd ones.

**A `git add -A` during a cherry-pick/merge conflict resolution silently sweeps untracked `.claude` scratch INTO the commit — and a follow-up `git rm --cached .claude/*.md` then stages deletion of the ~40 *tracked* docs the glob also matched.** Hit both during the 2026-06-20 colorist rebase. Clean recovery: `git reset --soft origin/main && git restore --staged .claude/ && git add src api` (stage only the real source paths), then commit. Rule: during conflict resolution, stage specific source paths, never `git add -A`, when untracked scratch is present. (Related: `git checkout <branch> -- CLAUDE.md` to "move" an edit between branches CLOBBERS an uncommitted working-tree edit to that same file — carry the edit by switching branches with it uncommitted, don't `checkout -- <file>` over it.)

## Auto-memory index hygiene (MEMORY.md)

The per-project auto-memory **index** (`~/.claude/projects/-Users-qbook-Claude-Projects-Bernard/memory/MEMORY.md`) is auto-loaded into context at the start of every session and has a hard **~24KB cap** — once over, the tail entries silently truncate and that recall is lost. It ballooned to 27KB+ (2026-06-05, had to be run through `/consolidate-memory` almost daily) because entries were written as multi-line paragraphs and shipped work was never archived. Keep it lean so this stops recurring:

- **One line per entry, <150 chars**: `- [Title](topic-file.md) — one-line hook`. ALL detail goes in the linked topic file, never in the index line. If you're writing a second sentence in the index, move it into the file.
- **Archive shipped work**: once a `project_*` item is SHIPPED / COMPLETE / LIVE, collapse its index line into the "ARCHIVE — shipped & stable" rollup at the bottom (list its file stem for `grep`, drop the per-line hook). Don't carry done projects as live entries.
- **Never delete topic files** to reclaim space — they're untracked and unrecoverable; archive the *index line*, keep the file on disk.
- **Verify after any index rewrite**: extract the `](*.md)` link set before and after and diff — the only links that should disappear are ones you intentionally archived; zero accidental drops.

A weekly launchd job (`com.bernard.memory-maintenance` → `scripts/memory-maintenance.sh`) backs up the index and runs `/consolidate-memory` headlessly when it crosses ~22KB (backup-first, auto-restores on a suspicious mass link-drop). If you notice the index near cap mid-session, trim the fattest entries rather than appending to it.

## Definition of Done
Every PR must satisfy this checklist before merging. The triage on 2026-05-14 traced 12+ bugs to exactly these gaps being skipped.

### Code quality
- [ ] `npm run typecheck` exits 0 — no new implicit-any or JSDoc contract violations
- [ ] `npm run lint` exits 0 at or below the current ratchet ceiling — never raises it without an equal offset
- [ ] `npm run build` exits 0

### Logic
- [ ] Every new `useMutation` call uses `useAppMutation` (not raw TanStack `useMutation`) — enforced by the `bernard/no-raw-use-mutation` ESLint rule
- [ ] Every new `fetch()` to an `/api` route uses `apiFetch` or `apiFetchResponse` — never a raw `fetch()` that could miss the Bearer token — enforced by the `bernard/no-raw-api-fetch` ESLint rule. The rule flags a raw `fetch('/api/...')` only when it can prove no `Authorization` header is attached (variable/spread headers get the benefit of the doubt, so authenticated saves don't trip it). A genuinely public endpoint uses `apiFetch(path, { auth: false })` or an inline `eslint-disable-next-line bernard/no-raw-api-fetch` with a reason. This was the PR #1064 class: tokenless loads of `/api/workspace/me` silently got the slim public-branding shape, so saved settings (`enabled_outputs`, `plan`, `locations`, …) reverted on reload.
- [ ] Every new API handler that touches a tenant-scoped table calls `workspaceContext(req)` and filters by `workspace_id`
- [ ] 401 / 403 branches are handled on `err?.status`, not `err?.message` string matching

### New API routes
- [ ] The handler shape matches the runtime (`(req, res)` for Node, `(req: Request)` for Edge)
- [ ] The Supabase table/column exists on prod before the PR is merged (verify with Studio SQL Editor or `scripts/apply-multitenant-migrations.mjs`)
- [ ] New tables include `GRANT … TO service_role` in the same migration file

### Testing
- [ ] Feature used in-browser at least once before the PR is opened (the step most often skipped)
- [ ] **Any page with a horizontal tab/filter row** → confirm it doesn't overflow at ~390px. A `flex items-center gap-2` row with 3+ buttons + a `w-48 ml-auto` search input totals 600–700px minimum — guaranteed horizontal scroll on mobile, making the site look "not loading." Fix: tabs in `overflow-x-auto` inner div with `shrink-0` buttons; search in `sm:ml-auto` outer row with `w-full sm:w-48`. (Hit on Slate #1316 → fixed #1322, 2026-06-10.)
- [ ] For large-surface features: run `npm run e2e` or manually smoke the relevant page on the Vercel preview URL
- [ ] If the PR changes a label, heading, button name, or default route behavior on a page covered by an E2E spec, update the spec in the same PR. Today the specs cover `/`, `/new`, `/settings/integrations`, `/settings/workspace`, and `/stories` (see `tests/e2e/*.spec.ts`). The post-deploy `E2E smoke` workflow only runs after merge to `main`, so a missed selector update keeps the smoke red until the next person notices — usually several merges later, by which point multiple suites are broken and the failure is harder to triage. Grep the specs for the heading/label you're changing before opening the PR: `grep -rn "<old label>" tests/e2e/`.

**E2E smoke "All jobs have failed" from a stale fixture selector has the same blast radius as a stale secret.** `auth.setup.ts` is the *shared setup step* — if it fails, every downstream spec is skipped and the email reads "All jobs have failed." This looks identical to the `ClerkAPIResponseError` case below, but the cause is a UI label that drifted (a page redesign renamed a heading/CTA the fixture waited for). Diagnostic: look at the fixture's assertion at line ~94 and check whether the locator still matches anything on the live home page. Fix: update the fixture to the current stable anchor (e.g. the greeting `<h1>` instead of a CTA button). Hit 2026-06-15 — the media-flow redesign removed "New interview" / "dashboard" from home; smoke was red for 2 weeks before it was diagnosed. The fixture should anchor on the most structurally-stable element on the landing page (today: `getByRole('heading', { name: /good (morning|afternoon|evening)/ })`), with CTA/Slate fallbacks. Never anchor on a specific CTA label.

**E2E smoke `ClerkAPIResponseError: Unauthorized` = stale `E2E_CLERK_SECRET_KEY` GitHub Actions secret.** The `auth.setup.ts` fixture mints Clerk sign-in tokens using `CLERK_SECRET_KEY` (mapped from the `E2E_CLERK_SECRET_KEY` Actions secret). If the secret is stale, EVERY e2e run fails at setup before any Playwright test runs. The failure is NOT caused by app code. Fix — run in any directory:
```bash
awk -F= '/^CLERK_SECRET_KEY=/{print substr($0,index($0,"=")+1)}' "/Users/qbook/Claude Projects/Bernard/.env.local.1pw" | tr -d '\r' | gh secret set E2E_CLERK_SECRET_KEY --repo Move-Better/Bernard
```
Confirm with `gh secret list --repo Move-Better/Bernard` — the updated timestamp should be today. (Hit 2026-06-06 after the secret was set 2026-05-12 and aged out.)

### Merge hygiene
- [ ] Branch rebased on current `origin/main` (`git fetch && git rebase origin/main`) immediately before opening the PR
- [ ] `gh pr merge <num> --auto --squash` set on open so CI gates the merge

## Brand-color refresh checklist
Whenever the project's primary brand color or one of the semantic tokens (`--success`, `--warning`, `--info`, `--destructive`, `--verbatim-accent`, `--agreement-signal`, `--contrast-signal`) shifts, audit every place those tokens are used as a **navigation or state color** — not just decorative tinting. These are easy to miss because each page reads as internally consistent until you flip between pages.

Common drift sites to grep for after a refresh:

- **Sidebar / tab active states** — historically `bg-success/10 text-success` (green). Should follow the primary brand color when the active state means "selected" rather than "succeeded." (Caught in SettingsLayout, May 2026 blend rollout.)
- **"Do this now" / publisher-inbox surfaces** — historically `bg-blue-50` / `text-blue-700` (cool blue). All of these — Home Drafts card, PipelineKanban Ready-to-Distribute lane, DraftsReadyRow, LibraryReadyStrip — should share one warm-tint treatment so the user's eye lands on the same color for "act now." (LibraryReadyStrip was the straggler.)
- **Mobile section nav chips** — same active-state lineage as the desktop sidebar; usually live in a separate `MobileNavRail` block.
- **Hover states on cards** — `hover:border-primary/30` or `hover:bg-accent/20` get stale when the accent shifts.
- **Status pills inside content surfaces** — green `success` pills used to label things like "Published" stay correct on a refresh; the bug is when the same green is doing duty as a nav active state.

Quick grep:
```
grep -rn "bg-success/\|text-success\|bg-blue-50\|text-blue-700\|bg-info" src
```

**Hex sweeps MUST be case-insensitive (`grep -ri`).** Hex appears in both cases (`#e36525` vs `#E36525`), and a case-sensitive `grep -o "...e36525..."` silently misses the uppercase ones. The #1294 emerald repaint's final-inventory greps were case-sensitive and left a live `#E36525` brand-accent fallback in `StoryboardPiece.jsx` — caught only later by the `bernard/no-hardcoded-brand-color` lint rule (which is case-insensitive). After any color sweep, re-grep with `-i`, and lean on the lint rule as the real backstop rather than a hand-rolled grep.

After fixing, sanity check by clicking through every major surface (Home, Stories, Library, Settings + subpages, Account) in one sitting and watching for any color that doesn't belong to the new identity. Cross-page review catches what per-page review misses.

## Email Template
The email newsletter preview renders the actual TrustDrivenCare (TDC) HTML template via `<iframe srcDoc>`. The template lives at `src/email-template.html` and is imported with Vite's `?raw` loader in `src/components/PostPreview.jsx`.

**To update the template** (e.g. after redesigning in TDC): export the master HTML from TrustDrivenCare, replace `src/email-template.html` with the new HTML, and commit. No React changes needed — all `{{merge_tags}}` are substituted at render time by `fillTemplate()` in PostPreview.jsx.

Merge tags currently in use: `{{preview_text}}`, `{{headline}}`, `{{pull_quote}}`, `{{body_paragraph_1}}`, `{{body_paragraph_2}}`, `{{body_paragraph_3}}`, `{{cta_text}}`, `{{cta_url}}`, `{{ps_text}}`, `{{hero_image_url}}`, `{{year}}`, `{{unsubscribe_url}}`, `{{webview_url}}`.

## 1Password env mount — use `.env.bernard.1pw`, never `.env.local.1pw`

The live 1Password Environments mount for this repo is **`/Users/qbook/Claude Projects/Bernard/.env.bernard.1pw`** (Bernard environment, has MULTITENANT_DATABASE_URL, BLOB_READ_WRITE_TOKEN, AI_GATEWAY_API_KEY, MUX_*, etc.). A stale `.env.local.1pw` FIFO may also exist in the project root — it is NOT an active mount, and reading it (awk/cat/grep) **blocks forever** with no error. If a read of a `.1pw` file hangs, don't retry harder: confirm the active mount path via the 1Password MCP (`list_local_env_files`) and use that. Extract single vars with `awk` per the global CLAUDE.md rules.

## Code minimalism — YAGNI gate before building

Before writing code, run the ladder: (1) **does this need to exist at all?** — don't add unrequested abstractions, parameters no caller passes, or dead scaffolds (see "Verify feature wiring before scoping changes"); (2) does stdlib / a native platform feature / an already-installed dep already cover it? use it, add no new dependency; (3) can it be one small function? Prefer deletion over addition, fewest files. Mark any intentional shortcut with a `ponytail:` comment stating its limit and upgrade path.
**Hard carve-out — never trim a check to be lean.** This bias is wrong for trust-boundary code, where Bernard's bugs come from the *missing* check, not excess abstraction. On any tenant-scoped API handler, `workspaceContext(req)` + the `workspace_id` filter + `requireRole` + `enforceLimit` are non-optional even for a read-only count endpoint — `workspaceContext` resolves the tenant from the Host header, which is **not** authentication. When in doubt, keep the check and apply the ladder only to the logic around it.

## Image generation spikes — OpenAI model names on this account

The Bernard `OPENAI_API_KEY` (in `.env.bernard.1pw`) is on an account where `dall-e-3` does not exist. Available image gen models are `gpt-image-1`, `gpt-image-1-mini`, `gpt-image-1.5`, `gpt-image-2`, `gpt-image-2-2026-04-21`, `chatgpt-image-latest`. Use `gpt-image-2` for quality. The API uses the standard `/v1/images/generations` endpoint but responses return `b64_json` (not a URL) — decode and write to `/tmp/*.png` before viewing. Supported sizes include `1024x1536` for portrait (close to 9:16).
