# Bernard — Project Notes

## Product strategy lives in Vigil — read it before big packaging/tiering changes

Bernard's SaaS-productization strategy (plan tiers, pricing, managed-vs-BYO analytics, onboarding/activation, what's tenant-product vs Move-Better-private) is tracked in the **Vigil** repo, not here: `specs/bernard-saas-productization.md` (plus follow-on specs `specs/bernard-tier-assignment.md` and `specs/bernard-onboarding-path.md` as they land). Vigil is the read-only oversight layer that authors these specs and hands them to Bernard. Key decisions as of 2026-07-11: per-location flat pricing + free trial; jobs-based tiers (Get Found → Grow → Scale/Pro); base-tier analytics is *managed* (OAuth channel data + bought SEO data), never make a clinic wire up GA4/GSC/PostHog. Before building anything tiering-, pricing-, onboarding-, or feature-gating-shaped, read that spec so you don't build against the plan.

## API handler checklist — 5 rules every new route must follow

These five patterns caused 26+ consecutive audit rounds because each appeared in one reference handler and got copy-pasted to ~15 others without being caught. The ESLint rule `bernard/no-detail-in-error-response` catches #1 at lint time; the PR review job's Claude prompt explicitly checks all five. But check them manually before opening a PR:

1. **No `detail:` in error responses.** `res.status(NNN).json({ error: 'key', detail: text })` leaks server internals to callers. Always: `console.error('[handler] msg:', e?.message)` + `res.status(500).json({ error: 'opaque_key' })`. The `bernard/no-detail-in-error-response` lint rule enforces this automatically.

2. **UUID_RE on every param that lands in a PostgREST filter.** Before any `?id=eq.${id}` or `?staff_id=eq.${sid}`, validate:
   ```js
   const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
   if (!UUID_RE.test(id)) return res.status(400).json({ error: 'invalid_id' })
   ```
   Applies to path params, query params, and body fields alike.

3. **`enforceLimit` comes AFTER `workspaceContext` + `requireRole`.** Always in this order:
   ```js
   const ws = await workspaceContext(req)
   if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })
   const auth = await requireRole(req, ROLES, { orgId: ws.clerk_org_id })
   if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
   if (!(await enforceLimit(req, res, 'bucket'))) return
   ```

4. **`timingSafeEqual` for HMAC comparisons.** OAuth/webhook signature checks must use:
   ```js
   import { timingSafeEqual } from 'node:crypto'
   if (expected.length !== sig.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null
   ```
   Never `===` or `!==` on secret strings.

5. **`waitUntil()` for any post-response async work.** Any Promise kicked off after `res.json()` (cache writes, indexing, enrichment) is killed when the response sends unless wrapped:
   ```js
   import { waitUntil } from '@vercel/functions'
   waitUntil(someCacheWrite().catch((e) => console.error('[handler] cache write failed:', e?.message)))
   ```

## Verifying authed pages — use Q's logged-in Chrome (on PROD), don't stop at the Clerk lock

Q keeps a logged-in Chrome session. Drive it with the **Claude-in-Chrome MCP** (`mcp__Claude_in_Chrome__*`): `list_connected_browsers` → `select_browser` (device "DrQ") → `tabs_context_mcp` → `navigate` to the real page on `https://*.withbernard.ai` → `computer` screenshot / `read_page`. That session is already past the Clerk gate, so any authed surface (Slate, Library, Storyboard, Settings, …) can be visually verified directly against prod data. Default to this for "does this UI change look right?" instead of declaring it blocked by auth.

**The one catch — it only works against PROD (`withbernard.ai`), so the code must be deployed first.** Authed verification cannot be done on localhost or a vercel.app preview:
- localhost dev server fails with `Missing VITE_CLERK_PUBLISHABLE_KEY` (it's a Sensitive var stripped from the worktree `.env.local` by `vercel env pull`), and even with the key, prod `pk_live` Clerk is domain-locked and rejects the `localhost`/`*.vercel.app` origin.
- So the workflow for a UI fix is: merge → GitHub-integration auto-deploys to prod (~2 min) → confirm the live SHA (`curl -s https://withbernard.ai/version.json | grep sha`) → THEN open the page in Q's Chrome and screenshot. It's post-deploy verification, but it's real and doesn't require Q to look manually.
- **Confirming the live SHA is NOT enough — Bernard is a PWA, so the service worker serves a CACHED app shell and Q's Chrome can show the OLD UI even after `version.json` already flipped to the new SHA.** A plain reload re-registers the SW and re-serves the stale bundle. (2026-06-21: the moment-miner feed verified as "still the old per-video rows" through multiple plain reloads while `version.json` already read the new SHA AND the new `/api/editorial/moments` route was live — the SW was serving the old client.) **Tell:** if the UI looks unchanged but a `curl` of a NEW `/api/*` route returns **401, not 404**, the code IS deployed and you're looking at a cached client (404 = route not deployed / still propagating; 401 = route live, needs auth). **Caveat — on the apex `withbernard.ai` (no tenant subdomain), a deployed route returns 400, not 401:** most handlers call `workspaceContext(req)` BEFORE `requireRole`, and the apex can't resolve a tenant → `400 "Workspace not resolved"` short-circuits before auth. So when probing a new route against the bare apex, **400 also means "deployed & executing"** (only 404 means not-deployed); probe a `<slug>.withbernard.ai` host if you specifically want the 401 auth signal. (2026-06-24: `/api/content-plan/plan-week` + `week-summary?week=` both confirmed deployed via 400-on-apex.) **Force the new bundle in the Chrome MCP** via `javascript_tool`: `navigator.serviceWorker.getRegistrations().then(rs=>Promise.all(rs.map(r=>r.unregister())))` + clear `caches.keys()`/`caches.delete`, THEN `location.replace('https://<slug>.withbernard.ai/<page>?fresh='+Date.now())` — the cache-busted URL forces a fresh index.html → new hashed bundles. (Real users get the in-app `UpdateAvailableModal` from `useVersionCheck`; the MCP browser does not, so clear it manually.)
- **After clearing the SW/caches and reloading, the FIRST client-side (SPA) navigation into a lazy-loaded route can still hit "Failed to fetch dynamically imported module" — a one-time stale chunk reference, not a real bug.** Even with a fresh index.html/bundle loaded, React Router's lazy `import()` for a not-yet-visited route can resolve against an in-memory manifest reference from the moment the page mounted; the app's own error boundary ("Something went wrong… Reload") catches it cleanly. (2026-07-17, verifying #2185's expandable Stories rows: clicking a sub-row's "Edit →" link — a real `<Link>` to `/publish/:id`, confirmed via `read_page` — hit this screen on the first click after a fresh `?fresh=` reload; clicking the app's own Reload button loaded the correct editor immediately, with the right piece/platform/caption.) **Tell:** the URL bar already shows the correct destination path when the error renders (navigation succeeded, only the chunk fetch failed) — that's the signal to just click the app's "Reload" button rather than suspecting the route/link itself. Don't treat it as a defect in the code you're verifying.
- **A blank `<main>` while the app SHELL still renders during a Chrome verify = you deep-linked to a route that doesn't exist, NOT a chunk-load failure — check the URL before chasing a chunk bug.** Bernard's settings routes are nested: Channels = `/settings/workspace/channels`, Locations = `/settings/workspace/locations`, General = `/settings/workspace`, and Brand = `/settings/brand-identity` / `/settings/brand-kit` — NOT `/settings/<name>`. Deep-linking a wrong path renders the settings shell (sidebar + an empty `<main>`) because the router matches the layout but no child route — which looks exactly like the lazy-chunk failure above. (2026-07-17, verifying #2204's Channels rooms: spent ~15 tool calls diagnosing `/settings/channels` as a chunk error — clearing the SW, opening fresh tabs — before realizing the real route is `/settings/workspace/channels`.) **Two fast discriminators + the fix: (1) an UNCHANGED sibling page at a similarly-wrong URL (`/settings/brand`) blanks IDENTICALLY → rules out your code; (2) `document.querySelector('main').innerHTML.length === 0` with the sidebar present = shell-without-content, i.e. an unmatched child route. Fix: get the real route from the in-app nav link's `href` (`[...document.querySelectorAll('a[href^="/settings"]')].map(a=>a.getAttribute('href'))`) or just click the nav item in-app, rather than guessing the deep-link path.**
- **The Chrome MCP `javascript_tool` serializes an async/Promise result back as `{}` — the actual return value is lost.** An async IIFE (`(async () => { … return {...} })()`) or any top-level `await` whose final value is an object returns an empty `{}` to the tool, even for a plain string, so a probe that fetches data and returns it reads as "nothing came back." (2026-07-09, verifying the publish-editor dead-click fixes #2044: three consecutive probes returned `{}` before the pattern was clear.) **Reliable pattern: inside the async block assign the result to a `window.__x` global and return a sentinel string (e.g. `'kicked'`); then read it in a SECOND, synchronous call — `JSON.stringify(window.__x)` — which serializes correctly.** Synchronous expressions (no await) return fine directly; it's specifically the async/Promise path that drops the value. Prefer targeted DOM assertions (`document.activeElement`, `getBoundingClientRect()`, a `[class*=\"ring-primary\"]` presence check) over screenshots for behavioral verification — they proved all three #2044 clusters (ring appears on select, ring clears on backdrop-deselect, textarea focused on padding-click) more precisely than pixels could. **Related gotcha: a synchronous DOM read of a React-controlled value in the SAME `javascript_exec` call as the triggering `.click()` can see the pre-render DOM — React state updates are async/batched, so `btn.click(); const text = el.textContent` reads the OLD text.** (2026-07-16, verifying the MediaPicker "select a file first" hint #2171: an immediate post-click read returned the stale placeholder; a second call ~100ms later showed the correct hint text.) Add a short `await new Promise(r => setTimeout(r, 100))` between the click and the read, or split into two separate `javascript_exec` calls.
- **rAF-driven count-up animations (NumberTicker) FREEZE mid-flight in a backgrounded Chrome-MCP tab — every stat on screen shows the same wrong fraction of its target, and it looks exactly like a data bug.** `requestAnimationFrame` pauses when the tab isn't visible, so all tickers halt at the same wall-clock instant (~50ms in → all values ≈ the same small fraction, e.g. 7→"1", 8→"1", $0.32→"$0.04") and screenshots/DOM reads keep returning those frozen values indefinitely; they complete the moment the tab is fronted. (2026-07-16, verifying Overview v2: burned three diagnostic round-trips — including a direct authed API fetch that proved the payload was perfect — before recognizing the pattern.) **Tells: multiple independent stats all wrong by the SAME ratio; a delta chip / static text next to the ticker showing the CORRECT value; the API payload verifying clean. Fix for verification: front the tab (take a screenshot, which raises it) and re-read, or assert on the payload/static text instead of ticker values. Not a product bug — real users' tabs are visible while they look at them.**
- **A `<video>` element driven through the Chrome MCP may sit at `readyState 0` indefinitely — the app is not broken, the automation session's network path just never loads media metadata.** Verifying a video-timeline/scrub feature (2026-07-08, VideoEditor's horizontal-timeline + playhead fixes, #1956/#1959/#1961) hit this on both a `.mov` and a `.mp4` served from Vercel Blob: `readyState` stayed `0`, `duration` stayed `null`, and zero `loadstart`/`progress`/`timeupdate` events ever fired across several seconds of waiting, even though a HEAD request confirmed the asset served fine (200, correct content-type). Setting `video.currentTime` still worked at the DOM level (reading it back afterward showed the assigned value) — it just never produced the events a React `timeupdate` listener needs to update visible UI. **Don't conclude a scrub/seek/playback feature is broken from this alone** — check `document.querySelector('video')` state directly via `javascript_tool` (`readyState`, `currentTime`, `duration`) before assuming an app bug; if `currentTime` reflects your seek but the UI doesn't, the gap is event-driven state never updating, not the seek itself failing. The real fix for the *visible* symptom (UI not updating on scrub) is to drive that UI off a locally-tracked optimistic value instead of waiting on the media element's own events — see `ARCHITECTURE.md`'s "Video timeline — optimistic scrub state" for the pattern.
- Pure render/transform code (Sharp/SVG compositors) is the exception — verify those locally with a node harness, no browser needed (see the WHOOP note below).
- **When the actual UI action needed to test a fix is blocked by an unrelated empty-state (no data to click), verify via the persisted draft object instead of the click path.** For a client-state persistence fix (autosave/undo/version-history wiring), the thing under test is "does field X survive the round trip," not "does the picker UI render a selected state" — so trigger any state change, read the persisted JSON (`localStorage.getItem('<key>')` via `javascript_tool`, or the server draft), and confirm the field is present/restored after a reload. (2026-07-09: verifying the music-bed draft-wiring fix (#2038) on prod hit the workspace's music library being empty — "No music tracks yet" — so there was no track to click; instead, triggered an unrelated field change, read `videoEdit:<assetId>` from `localStorage`, confirmed `music` was included in the payload, then reloaded and confirmed it survived the mount-hydration restore. Proved the fix works even though the full user journey — pick a track — isn't exercisable yet.)

**This is THE standard verification procedure — not a fallback.** For any change to an authed surface, the default is: deploy → confirm live SHA → drive Q's Chrome and screenshot. Do NOT declare a UI change "verified" off a localhost render, a preview URL, or a green build alone, and do NOT report an authed surface as "blocked by Clerk" — the logged-in Chrome session is past the gate and is the way to look. Only skip the browser when the change is pure render/transform code (verify with a node harness) or has no observable surface.

**Relationship to the Playwright e2e suite (they are complementary, not redundant):** Chrome-tab is *interactive* verification — it proves the specific change you're working on, but only when someone actively drives it. The post-deploy e2e smoke is an *unattended regression net* that fires on every merge to `main` and catches breakage on the 5 covered routes when no one is looking. Chrome-tab structurally cannot replace it (it needs an agent in the loop). Policy: keep the e2e suite thin (the existing 5 routes) as a post-deploy tripwire, do NOT expand it to cover deep authed flows (that is Chrome-tab's job and where Clerk fights automation), and carry all "does this work / look right" verification through Q's Chrome.

(Q confirmed 2026-06-04 — "this keeps happening." Chrome-tab-as-standard + keep-e2e-thin confirmed 2026-06-04.)

## Challenge gate — adversarial brief before any non-trivial build

Q is a solo founder: no one checks his feature requests unless the session does. Being agreeable here is the failure mode. (Installed 2026-07-21 after a strategy session found months of component-green work that never composed into the user's job — e.g. a working karaoke-reel engine whose output landed in a b-roll graveyard, and a planner structurally unable to plan a Reel.)

Before scoping any **non-trivial** feature request (new capability, surface, or pipeline stage — not bug fixes with a clear repro, not typo/copy changes), produce a five-line adversarial brief and get Q's explicit go via `AskUserQuestion`:

1. **Job** — the user-job this serves, one sentence ("front desk publishes a week of IG in under 30 min").
2. **Evidence** — the data point or feedback row saying this is the top gap *now*. Query the DB / PostHog / `feedback` table; don't accept a vibe, including Q's.
3. **Composition** — the end-to-end chain this must plug into, written as arrows naming every EXISTING stage (`upload → moments → ??? → /week slot → publish-as-REEL`). Any `???` is a finding: the seam gets fixed with (or before) the feature. This line is what catches artifacts that dead-end short of the user.
4. **Simplest version** — what ships in ≤2 days that tests the job.
5. **Case against + kill criterion** — the strongest honest argument for NOT building this now (or for building something else), and a measurable kill criterion with a revisit date, recorded in `.claude/decisions.md`.

Dissent is a required output, not garnish: if the case-against wins, say "I recommend we don't build this" plainly and propose the alternative. If the outcome can't be measured, say so in line 5 — that's usually the tell it isn't ready to build. For high-stakes calls, have a FRESH session (or subagent with no stake in the plan) attack the brief rather than asking the authoring context to critique itself.

**Decision log:** settled decisions + kill criteria live in `.claude/decisions.md` (tracked). Consult it before re-litigating a settled choice or building something that contradicts one; planning sessions append to it; `/outcome-review` checks its revisit-by dates monthly.

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

**The "read-only" rule also covers calling an API directly via `fetch()` with `window.Clerk.session.getToken()` — that's not read-only just because you didn't click a button.** Some routes that read like "generate a preview" are actually bake-and-persist: `POST /api/editorial/compose-photo` renders a composite AND writes it straight into that `content_items` row's `media_urls`/`photo_treatment` — no dry-run flag, no distinction between "preview" and "publish." Calling it against a REAL pieceId to verify a compositor change (2026-07-09, logo-on-editorial-cards #2023) silently overwrote the photo on an already-**published** GBP post with test content. The harness's own safety classifier caught the DB-side fix attempt and forced an explicit confirm — but the mutation itself wasn't blocked, only the repair was. **Rule: before calling any "render"/"compose"/"generate" endpoint directly via authenticated `fetch()` against a real content id, check whether the route persists its output (grep the handler for a `PATCH`/`UPDATE` back to the row) — if it does, either use a disposable/draft test piece you can freely mutate, or verify via a local node harness on the pure render function instead (per the Sharp/SVG exception above) rather than the live route.**

**A "click through it and see" verification pass can itself create a real row you didn't intend to leave behind — "New brief" and similar create-affordances aren't purpose-gated the way the AI pipeline that normally produces them is.** Verifying the media-hub in-app-editor button (2026-07-09, PR #2054/#2056) meant opening a real B-roll asset in Q's Chrome and clicking "New brief" just to get a brief row to click "Edit clip in Bernard" from — but `segmentInterview.js`'s server-side gate (`asset_purpose === 'interview'` only) only restricts the AI segmenter; the manual "New brief" button in `MediaDetail.jsx` has no such restriction, so it happily created a live `content_pieces` row on a B-roll asset in the real `movebetter` workspace. Harmless here (empty caption, `accepted` status, easy to `Delete`), but it's the same class of "read-only isn't really read-only" trap as the `fetch()` case above, just via a UI click instead of a raw API call. **Rule: before using a create/generate button purely to exercise a downstream feature, check the target table for a `workspace_id` filter you could scope to a disposable test record instead — and if you do create one on a real workspace, delete it via the UI's own delete affordance before ending the verification pass, not just note it in your report.**

## Weekly staff-update routine — capturing screenshots for the PDF

The weekly Bernard staff summary (`.claude/scheduled-tasks/bernard-weekly-staff-summary/SKILL.md`) produces a combined PDF with plain-language bullets + embedded screenshots, plus a Gmail draft pointing to it. **Screenshot capture is a ship-time responsibility — not a separate task.**

**When to capture:** Any time you merge a UI change to `main`. Backend-only changes, refactors, CI/test updates, and docs changes need no screenshot.

**What to capture — ZOOMED CROPS, never full pages.** Grab a tight crop of just the ONE component the change is about (a card, a control, a few table rows), not the whole screen. A full-page screenshot downscaled to fit the PDF becomes an unreadable blur — this is the #1 failure mode (hit 2026-07-16: the first Bernard PDF captured whole-`main` pages and had to be fully redone as element-level crops at `scale: 2`). The quality bar is the Deep Thought reference PDF (`/Users/qbook/Claude Projects/Deep Thought/.staff-update-screenshots/`): a colored title + tight per-feature crops (its "My voice" card, its Cmd-K box, its two thumb buttons). The isolation + `scale: 2` steps below produce exactly this — do NOT skip the isolation and `html2canvas(document.querySelector('main'))` wholesale. One representative element per bullet; for a long table hide all but the first ~5 rows, for a card grid capture 2–3 cards, for a form keep the input + the new control and hide the rest.

**How to capture (working pipeline):**

The "what doesn't work" list from Deep Thought (claude-in-chrome `zoom`/`upload_image` return unusable IDs, `javascript_tool` dataURL is blocked, `computer-use` requires interactive approval) applies here. **Use the proven working path:**

1. **Navigate in Q's real Chrome** via claude-in-chrome MCP (`tabs_context_mcp` → `navigate` to `https://<slug>.withbernard.ai/<page>`). This uses his logged-in session; no auth needed.

2. **Isolate the target element** via `javascript_tool`:
   - Walk UP the DOM from the element.
   - At each level, set `display:none` on every SIBLING that doesn't contain the target.
   - Continue up to the shell/nav root.
   - Result: just the target element rendered alone on a blank page.
   - Clear any stale `data-target-card` attribute from a prior run first.

3. **Inject html2canvas from CDN** via `javascript_tool`:
   ```js
   const script = document.createElement('script');
   script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
   document.head.appendChild(script);
   await new Promise(r => setTimeout(r, 500));
   ```

4. **Render the isolated element:**
   ```js
   const target = document.querySelector('[data-target-card]');
   const canvas = await window.html2canvas(target, { backgroundColor: '#ffffff', scale: 2 });
   ```

5. **Trigger a browser download** (do NOT return dataURL from javascript_tool):
   ```js
   const link = document.createElement('a');
   link.href = canvas.toDataURL('image/png');
   link.download = 'screenshot.png';
   link.click();
   link.remove();
   ```
   Chrome writes a real file to `~/Downloads/`.

6. **Move the file into the repo** via Bash:
   ```bash
   cp ~/Downloads/screenshot.png "/Users/qbook/Claude Projects/Bernard/.staff-update-screenshots/YYYY-MM-DD_PR###_slug.png"
   ```

**Storage convention:**

- **Directory:** `.staff-update-screenshots/` (gitignored, not in repo)
- **Filename pattern:** `YYYY-MM-DD_PR###_short-slug.png` (e.g. `2026-07-17_PR2185_stories-table-sort.png`)
- **Index:** `captions.jsonl` in the same directory (one JSON line per screenshot):
  ```json
  {"file":"2026-07-17_PR2185_stories-table-sort.png","date":"2026-07-17","pr":2185,"caption":"the Stories list now shows a dense sortable table with search"}
  ```

**Caption:** One plain-language sentence describing what the user sees / what changed / why it matters. No jargon, no "PR #2185 fixed…" — just the user-visible fact. This caption is what matches bullets in the weekly summary PDF.

**First-time setup:**
- Create `.staff-update-screenshots/` folder manually (or let the routine create it).
- Add to `.gitignore`: `.staff-update-screenshots/`
- Document in a README in that folder (for future sessions) if you'd like.

**Gotchas & testing:**
- html2canvas requires the CSP not to block CDN scripts. Bernard's CSP currently allows it; verify if that changes.
- On some Pillow/PIL installs, `image.save(..., "PDF")` throws `KeyError: 'JPEG'` even though JPEG save works. The routine includes a workaround; only matters when building the PDF.
- Screenshots are not required for the routine to work — if a bullet has no matching screenshot, the PDF just renders the text. Capture what's relevant; don't force every change.

**A fourth variant: a raw screenshot-coordinate click meant for a benign link can land on an adjacent mutating button instead — prefer `find`/`read_page` refs over pixel coordinates near any Approve/Publish/Delete/Send control.** Navigating `/week` to open a piece for read-only verification (2026-07-16, `/publish/:pieceId` dead-click audit #2171), a coordinate click aimed at "Open to change" landed on the "Approve" button one row above it instead — silently triggering a real approve+publish attempt on a live `movebetter` piece. The actual bundle.social publish call failed (`bundle_post_failed`), so nothing posted publicly, but the row's `status` flipped to `approved` without authorization. Caught immediately by cross-checking `content_items.updated_at > now() - interval '15 minutes'` via the Supabase MCP, confirmed with Q, and reverted (`status='draft', approved_at=null`) before continuing. **Rule: when clicking near any button whose label suggests a state-changing action (Approve, Publish, Schedule, Delete, Send), use `find`/`read_page` element refs instead of raw pixel coordinates — refs target the actual DOM node regardless of visual drift between the screenshot and the live layout. If a misclick on a mutating control ever happens anyway, immediately verify via a direct DB read (`updated_at`/`approved_at`/`published_at` on the affected row) rather than trusting the on-screen toast alone, and confirm with Q before reverting.**

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

**When the `Artifact` tool is available, prefer it over the local-python-server flow for single-component before/after mockups.** 2026-07-07 (SlideEditor media-panel resize): built the CURRENT-vs-PROPOSED comparison as a self-contained HTML file and published it with `Artifact` instead of `python3 -m http.server` + Claude Preview. Advantages for this shape of mockup: Q sees it inline in chat immediately (no localhost round-trip), redeploying to the *same* `Artifact` call after an edit updates the same URL in place (fast iterate-on-feedback loop — "even bigger" → edit → redeploy → same link), and it sidesteps the mojibake/charset footgun below since Artifact wraps the file properly. Still use the `.claude/mockups/` + local-server flow for **multi-screen flow prototypes** that need live interaction wiring (toggles, view switches, `sendPrompt`-style state) — Artifact is better suited to a static comparison document than a stateful app mock. Either way, the underlying mockup-first discipline (CURRENT-vs-PROPOSED, real photo URLs, get sign-off before writing code) is unchanged.

**Mockup HTML must declare `<meta charset="UTF-8">` and avoid raw emoji/special characters, or the Claude Preview browser mangles them.** A quick fragment mockup (no `<!doctype html>`/`<head>`) served via `python3 -m http.server` defaults to no charset header; the preview browser then guesses Latin-1 and renders every emoji, em-dash, arrow, and chevron as mojibake (`â€"`, `ðŸ"Š`, etc.) — illegible enough that a design sign-off round has to be redone. Rule: wrap mockup files in a full `<!doctype html><html><head><meta charset="UTF-8">...` skeleton (not just a bare `<div>` fragment) before serving, and prefer plain ASCII text/abbreviations or inline SVG icons over emoji for icon placeholders — emoji are also a poor stand-in for the real Lucide icons the app actually uses, so a reviewer may (correctly) flag them as if they were the real proposal rather than a mockup shorthand.

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
- **Confirm the judge RETURNS a parseable score at all — a null score is worse than a bad one, because it silently disables the gate.** A judge that never gets its system prompt doesn't just miscalibrate; it loses the "Return ONLY valid JSON — no preamble" discipline, rambles a markdown explanation after the JSON, and truncates at `maxOutputTokens` (`finishReason=length`) → `parseFidelity` returns `null` → the caller's `voiceScore` is `null` → the `if (voiceScore && overall < GATE)` regen branch never runs. The gate looks present in code but is a total no-op. 2026-07-02 (PR #1881): `buildFidelityPrompt` returns `{ instructions, user }` (AI SDK v7 renamed `system`→`instructions`; `system` is a deprecated alias), but draft.js + captionFidelity.js read the nonexistent `.system` → passed `undefined` → judge ran with no system prompt → on 10/10 real *long* captions it produced ZERO parseable scores, so the draft fidelity gate had been dead since it shipped. Fix was reading `.instructions`; no token bump needed (the preamble makes Haiku emit terse JSON-only, ~78 tok, `finishReason=stop`). Checks: (1) verify the judge parses a score on your REAL long inputs, not just short probes — the failure only shows on verbose captions that overrun the token cap; (2) verify the system half is actually wired (right field name), since a missing system prompt is invisible until you inspect `finishReason`/raw output; (3) when a "before" condition returns all-`null` in an A/B, that's not "no signal" — it's the bug.
- **A caller's transcript cap is a LIE if a downstream helper re-caps it — trace the WHOLE reference→judge path, not just the caller's constant.** `draftAtom` slices the interview to `TRANSCRIPT_MAX=24_000` and passes it to the judge, but `buildFidelityPrompt` RE-sliced the same transcript to `2500` chars internally — so the judge only ever saw ~13% of the reference, and flagged as "invented" anything a faithful caption drew from later in the interview. The caller's 24k was a no-op. (2026-07-16, the fabrication-hold gate PR #2165: raised `buildFidelityPrompt`'s cap to 24k to match.) **Rule: when a judge grades against a reference, grep the rubric/prompt builder for its OWN `.slice()`/truncation — a two-stage slice silently overrides the caller. Adding an output field (`invented_claims`) also re-broke the token cap (240→null), so bump `maxOutputTokens` AND make the parser recover the first `{…}` from any preamble whenever you extend the judge's JSON.**
- **Before gating on an LLM-judge boolean (fabrication, drift, safety), probe it on LABELED real examples across ≥3 runs AND ≥2 models — more-capable is NOT always more-precise.** Validating the fabrication flag on the real bicep interview: Haiku correctly passed a faithful patient story + real anatomy and flagged a genuinely-invented one (3/3 each); **Sonnet was WORSE** — it false-positived a real "week four" that's verbatim in the transcript. The gate stayed on Haiku. (PR #2165.) A judge task (precise verification against a reference) is not the same shape as a generation task; pick the model empirically, don't assume the bigger one wins.
- **Before calling any specific detail "fabricated" — in analysis, a before/after, a gate, or a prompt fix — grep the actual source transcript for it first. Specificity is not evidence of invention.** I labeled a GBP "surfer in her late 20s… back in the water by week four" as fabrication and built a prompt tweak that generalized it away; the clinician had told that exact story in the interview (`interviews.messages` contained it verbatim). Same class as "validate the premise" — grounding a "fabricated" claim in the source is mandatory, exactly like grounding a "not built" claim in `origin/main`. (2026-07-16; corrected in PR #2166 + the review artifact.) The judge had the identical blind spot, from the two-stage slice above — the fix for both was letting the comparison actually see the whole source.

## Multi-tenant SaaS
Bernard runs as a single shared deployment that serves multiple workspaces by subdomain (`<slug>.withbernard.ai`). Move Better People, Equine, and Animals are the three seed workspaces; external tenants self-onboard at `withbernard.ai/onboard`. All tenant-editable config — display name, voice/tone modifiers, interview/patient context, topic suggestions, output channels, publish credentials — lives in the `workspaces` row in the shared bernard Supabase, edited via `/settings/workspace`.

The legacy `brands/<id>/` filesystem-overlay pattern and the `VITE_BRAND` / `BRAND` env vars were retired in Phase 1F (2026-05-10). Paradigm content is no longer build-time-pinned. To onboard a new tenant, use the wizard — there is no per-deployment scaffolding.

`src/lib/workspace.js` retains a static config for legacy per-brand deployments only; runtime code reads `useWorkspace()` (browser) or `workspaceContext(req)` (serverless), which resolve from the DB by subdomain.

**Tenant onboarding** (`/onboard`, `api/onboarding/*`): a Clerk-authenticated user fills the wizard, which (a) creates a Clerk Organization, (b) inserts a `workspaces` row with the chosen slug + paradigm defaults pre-populated into the JSONB columns, (c) binds the Clerk org id back to the workspace, (d) seeds `enabled_outputs` and a default `clinic_settings` row. Subdomain DNS is wildcard (`*.withbernard.ai` → bernard Vercel project), so the new subdomain works immediately with no DNS step.

**Per-tenant publish credentials** (Buffer / Facebook / GBP / WordPress / etc.) live in the `workspace_credentials` table, encrypted at the column level with `WORKSPACE_CREDENTIALS_KEY` (Sensitive env var on the `bernard` Vercel project). Each row is `{ workspace_id, service, config (jsonb), secret_ciphertext (text) }`. Read/write goes through `api/_lib/workspaceCredentials.js`; never store these as Vercel env vars again — that pattern died with the per-brand deployments.

**Probing live third-party integration state via decrypted `workspace_credentials` — budget it, expect a classifier block after ~3 chained services.** Verifying "is X actually tracked / connected / working" against real prod data (GA4, GSC, GBP, etc.) with a scratch script that pulls `SUPABASE_SERVICE_KEY` + `WORKSPACE_CREDENTIALS_KEY` from the 1Password mount, decrypts a credential row, and calls the live third-party API directly is legitimate and encouraged (same spirit as "Verify feature wiring before scoping changes" above) — but chaining it across **multiple separate services in one session** reads to the platform's auto-mode safety classifier as systematic credential-store exfiltration rather than incremental verification, and a later call gets denied outright ("Credential Exploration"). (2026-07-08: probing whether Book Now clicks were trackable via GA4, whether GBP quota had cleared, and whether GSC could bucket weekly data all in one scratch-script chain worked for the first two services, then got blocked mid-GSC-probe.) **Rule:** treat this as a scarce resource — after ~2 services' worth of decrypt-and-call probing, switch to the app's own scoped read endpoints (or the Supabase MCP for plain data reads that need no secret) for anything further; delete the temp env dump + scratch scripts immediately after each probe rather than leaving them for "just one more check." If denied, stop immediately and report findings from what was already probed — don't retry via a different tool to route around it.

**Cross-workspace data isolation** is enforced at the API layer, not at the database layer: there is no RLS on the public schema (service_role bypasses anyway). Every API route that touches tenant-scoped tables must call `workspaceContext(req)` (or `workspaceById(id)` for background paths) and filter by `workspace_id`. Forgetting that = cross-tenant data leak. Treat the workspace_id filter the same way you'd treat an authorization check.

## Google Search Console — OAuth, not service accounts (sc-domain: 403s)

GSC analytics (`/analytics` page, `api/_routes/insights/search-queries.js`, `api/_lib/searchConsole.js`) authenticates via **per-workspace OAuth**, not a service-account JSON. The connect flow is `api/_routes/integrations/gsc/{connect,callback,disconnect}.js` + `api/_lib/gscAuth.js`, mirroring the Drive OAuth pattern (HMAC-signed state, refresh token encrypted in `workspace_credentials`, `config.token_type === 'oauth'`). It reuses the Drive OAuth client (`GOOGLE_DRIVE_CLIENT_ID/SECRET` fallback) — one extra redirect URI (`https://withbernard.ai/api/integrations/gsc/callback`) covers both.

Why OAuth and not the service-account path used by GA4: **domain properties (`sc-domain:…`) 403 for service accounts forever** — the API caller must be a verified owner, and a service account can never satisfy DNS verification even when shown as a "Full" user in the SC UI. OAuth as a human account that owns the property is the only path. (GA4 still uses service-account JSON — that limitation is GSC-domain-property-specific.)

Three real bugs hit while shipping this (2026-06-15), all worth knowing:

- **A 403 when the connected account IS a property owner = the Search Console API is disabled in the OAuth client's GCP project**, NOT a missing user grant. These are indistinguishable unless you surface Google's error body — `searchConsole.js` now appends `text.slice(0,300)` to the 403 message for exactly this reason. Fix is in Google Cloud Console → enable "Google Search Console API" on the project that owns the OAuth client. (Hours lost assuming it was an account-permissions issue.)
- **`detectSiteUrl` / any GSC call must use `searchconsole.googleapis.com`**, never the legacy `www.googleapis.com/webmasters/v3/sites` host — the legacy host silently returns null for the sites list, which left `config.site_url` unset at connect time. The site URL is always mirrored to `workspaces.gsc_site_url`, and both the insights read and the test endpoint fall back to it, so a null `config.site_url` is non-fatal — but fix the host so fresh connects populate config cleanly.
- **`apiFetch` does NOT auto-set `Content-Type: application/json`** — a POST whose body must be parsed by a Node handler (`req.body`) needs the header set explicitly, or Vercel leaves `req.body` empty and the handler sees `undefined` fields (symptom here: the test button returned `unsupported-service` because `service` arrived empty). `CredentialForm` sets the header; new callers must too. **A sibling route working WITHOUT the header is not proof you can skip it** — it only survives because every field it reads has a `|| default` fallback, so an empty body is indistinguishable from a default one. The from-brand `generate` route (all fields defaulted) dodged this for weeks; the chat designer route next to it (`messages` required, no default) returned `bad_request` on every turn until the header was added (#1469, caught only by the post-deploy Chrome check — invisible to lint/build/bundle-smoke). Rule: any client POST to a Node handler that reads a **required** body field MUST set `Content-Type: application/json`; never infer it's optional from a defaults-tolerant neighbor.

## GA4 Enhanced Measurement already tracks outbound clicks — check before building custom click instrumentation

Before building custom event tracking for any off-domain CTA (booking widget, external scheduler, a social profile link, etc.), check whether GA4's Enhanced Measurement already captures it for free. GA4 auto-fires a `click` event with a `linkUrl` parameter (queryable via the Data API) for any click on a link pointing to a **different domain** than the page — zero code changes needed on the marketing site. Query it with a `dimensionFilter` `andGroup` of `eventName = 'click'` AND `linkUrl CONTAINS <domain>` (see `fetchGA4OutboundClickCount` in `api/_lib/ga4.js`, added for Book Now click tracking on the Insights page). Confirmed 2026-07-08: Move Better's booking widget (`movebetter.janeapp.com`, a different domain from `movebetter.co`) already had 117 outbound clicks captured over the trailing 90 days with zero custom instrumentation — this is how Book Now click tracking shipped without touching the Movebetterco marketing-site repo at all. Only works for genuinely cross-domain links; a same-domain CTA (e.g. an in-app `/book` route) needs a real GA4 custom event or a different signal.

## Manually triggering the citation-probe cron — blank terminal ≠ failure

To validate a citation-engine change on real data (e.g. lighting up a new engine like Google AI Overviews via SerpApi, F16 Phase 4), trigger the cron directly: `curl -s -o /tmp/out.json -w "HTTP %{http_code}\n" https://withbernard.ai/api/cron/probe-citations -H "Authorization: Bearer <CRON_SECRET>"` (CRON_SECRET is Sensitive — the user pastes it in their terminal; don't handle it in chat). Two things bite:
- **The `recently-probed` skip is per-WORKSPACE, not per-engine** (`probeWorkspace` reads the newest `seo_citation_probes.probed_at` across ALL engines; `RECENT_PROBE_MS`=72h). So a freshly-added engine will NOT back-fill on its own until the whole workspace is >72h stale — you must trigger manually (or wait past the window). Adding an engine mid-week and expecting the next weekly cron to probe it is wrong if the workspace was probed <72h ago.
- **The curl blocks up to ~4 min and prints NOTHING until it returns** (ChatGPT web-search probes are ~120s each; `DEADLINE_MS`=240s), and each workspace's rows are inserted in ONE batch at the very END of `probeWorkspace` — so the DB stays empty mid-run and a blank terminal means "still running," not "failed." A real auth failure (`HTTP 401`) prints instantly. Don't stare at the terminal — poll `seo_citation_probes` via Supabase MCP; rows appear when the batch lands. (2026-07-11: burned several round-trips reading a blank terminal + empty DB as failure when the sweep was just still running.)

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

## Every screen is full-bleed — page roots must not self-narrow

Q's standing rule (repeated, frustrated — 2026-07-07): **all screens must be full-bleed; screen space is used fully and wisely.** A page centered in a narrow column with big empty side gutters reads as broken to Q — it's his single most recurring visual complaint, so treat full-bleed as the default, not a per-request ask.

The Layout shell is ALREADY full-bleed: `src/components/Layout.jsx` has `const fullBleed = true` → `<main className="px-4 sm:px-6 lg:px-8 py-8">` with no max-width. Narrowness only ever comes from a **page** wrapping its own root in `mx-auto max-w-*`. So:

- A new/edited page's root fills the width — just padding (e.g. `py-6`), never `mx-auto max-w-3xl`.
- "Fully AND wisely" ≠ stretch one column to 1900px. Use the width: side rails (`AnswerReview` = answer + sticky "Up next" queue rail, #1938), multi-column card grids (interview primers = `grid sm:grid-cols-2`, #1941), CTAs `w-full sm:w-auto` (no full-width button bar).
- On a review/queue screen that advances to the next item on action, `window.scrollTo({ top: 0 })` when the active item id changes — else a new item loads under the old scroll position and it's invisible that anything happened (#1938).
- **Legitimate exceptions (leave centered):** legal reading pages (Privacy/Terms — readable measure), `max-w-*` on a `<p>` for text measure, and centered `text-center py-16` empty/loading states. Those are correct, not offenders — don't strip them.
- Daily drivers (Home, Stories, StoryDetail, Library, Slate, YourWeek, Analytics, MediaHub, Settings, Overview) are already full-bleed — verify a new page matches them, don't reintroduce a centered column.

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

### Back navigation — use `useSmartBack`, never a hardcoded `<Link to="/…">`

Any "Back" / breadcrumb-return / close-that-navigates affordance must use the shared `useSmartBack(fallback)` hook (`src/lib/useSmartBack.js`), NOT a hardcoded `<Link to="/stories">` or `onClick={() => navigate('/foo')}`. The hook does `navigate(-1)` when real in-app history exists (`window.history.state?.idx > 0`) and only falls back to the passed route for direct links / a fresh tab. A hardcoded destination is wrong whenever the page is reachable from more than one entry point — the canonical failure was StoryDetail's "Back to Stories" always dumping the user on `/stories` even when they arrived from a Campaign, Staff profile, or Review inbox. `fallback` may be a function for a route-derived default (e.g. VideoEditor: `() => location.pathname.startsWith('/slate') ? '/slate' : '/moments'`). `BackLink` already routes through `useSmartBack`, so its `to` prop is a *fallback*, not the always-destination — prefer `BackLink` for the Stories→Storyboard→Publish spine. (Swept app-wide 2026-07-07, #1939; ~25 pages.) True hierarchy breadcrumbs (`Breadcrumb`) stay hardcoded — they express structure, not history.

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

**A degraded-fallback code path that reuses a "real" shape's tag corrupts every downstream consumer that trusts the tag.** `transcribeCallRecording` (`api/_lib/callTranscript.js`, F1 outbound call) has a preferred path (dual-channel ffmpeg split → real per-speaker turns) and a fallback (mixed single-turn transcript, used when the split fails or a channel transcribes empty) that tagged its one blob `role: 'user'` for convenience — same shape as a genuine clinician turn. Two enrichment consumers trusted that tag at face value: `extractVoicePhrases` ingested Bernard's own spoken interview questions as clinician voice (the blob contains BOTH speakers, not just the user), and `classifyAndStoreInterviewStyle`'s assistant-turn filter found zero matches and silently no-opped, on every call that hit the fallback. Neither failure threw or logged — both looked like normal execution. Found 2026-07-10 while spot-checking a completed realtime-voice interview whose `messages` array had exactly one entry. Rule: when a fallback/degraded path can't produce the real shape a "good" path produces (can't attribute speakers, can't fully classify, etc.), don't dress it up in the same tags — return an explicit capability flag (here, `dualChannel: boolean`) and make every downstream consumer that depends on the missing property branch on that flag rather than re-deriving "is this real" from the data's shape. Grep for every consumer of the preferred path's output when adding a fallback, not just the immediate caller. Fixed in `api/_lib/callTranscript.js` + `api/_routes/webhooks/twilio-recording.js` (#2082).

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

## Realtime voice session — system prompt caching pattern

`api/realtime-session.js` mints an OpenAI Realtime client secret. The full system prompt is set in `sessionConfig.instructions` at mint time (not via a post-connect `session.update`) so OpenAI can cache it from token zero.

**Do NOT attempt to port `getInterviewSystemPrompt` server-side.** That function pulls past interviews, practice-memory RAG (concept/agreement/gap vector blocks), staff record, tone, and staffType — replicating those fetches server-side would duplicate the entire interview-context pipeline. The established pattern instead:

1. Browser builds the full prompt via `getInterviewSystemPrompt` (same as today).
2. Browser sends `{ interviewId, systemPrompt: fullPrompt }` in the mint POST body.
3. Server validates and injects it into `sessionConfig.instructions` at mint time; falls back to a 2-sentence bootstrap if the field is absent or too short.
4. Browser still sends `session.update { instructions }` after the data channel opens as a belt-and-suspenders — same content, so OpenAI's cache still hits, and it covers the reconnect path.

The server validates `systemPrompt` as a string with a minimum length (100 chars) and a maximum (32 KB) to prevent abuse; it never logs or stores it.

## Custom ESLint rules to know before writing JSX

Three project-specific rules bite hard if you don't know them:

- **`react-hooks/static-components`** — component functions defined **inside** another component's render function (`const Foo = () => ...` inside `function Parent()`) reset their state on every render and trigger this error. Fix: declare all sub-components at **module scope**, outside any other component. Caught on `ProgressDots` in the demo session (2026-06-07).
- **`react-hooks/immutability`** — "Cannot reassign variable after render completes." Fires when you mutate an outer variable *during* a render `.map()` — the classic case is a running accumulator like `let lastMonth = null` reassigned inside the map to draw group/section headers (month dividers, running totals, "first of its kind" flags). Fix: **precompute** the per-row derived data before the JSX (a plain `const rows = items.map((s, i) => ({ ...s, showHeader: i === 0 || key(s) !== key(items[i-1]) }))`), then render from that array — compare against the previous item by index instead of threading a mutable outer var through render. (Caught building the Stories dense table's month-group headers, 2026-07-10 #2080.)
- **`bernard/no-arbitrary-text-size`** — prohibits `text-[10px]`, `text-[11px]`, etc. Use the semantic tokens instead: `text-3xs` (10px) or `text-2xs` (11px). Lint will error at 0-warnings-allowed; the fix is a global replace before committing.
- **`bernard/no-raw-use-mutation`** — use `useAppMutation` not raw TanStack `useMutation`.
- **`bernard/no-raw-api-fetch`** — use `apiFetch`/`apiFetchResponse`, never bare `fetch('/api/...')`.
- **`bernard/no-hardcoded-brand-color`** — bans retired brand-color *literals* (Move-Better orange `#e36525` / hue-20 `hsl(20 …)` / `rgb(227,101,37)`, grey `#6e7072`, evergreen `#1c4d37`, coral `#ff8552`) anywhere in a `src` JS/JSX string. Use the design tokens instead: `bg-primary`/`text-primary`/`hsl(var(--primary))` (emerald brand), `bg-action`/`hsl(var(--action))` (amber act-now signal) — defined in `src/index.css` + `src/lib/brand.js` (the single JS-side brand source). Added #1297 after the #1294 repaint was a multi-file hunt; it immediately caught a `#E36525` a case-sensitive grep had missed. For a genuinely-intentional exception, `eslint-disable-next-line bernard/no-hardcoded-brand-color` with a reason.
- **`bernard/no-temperature-on-opus`** — `temperature`/`top_p`/`top_k` return a 400 on Claude Opus 4.7+ (incl. 4.8). Flags an object literal that sets a sampling param next to a `model` resolving to an Opus 4.7+ id (inline string or same-module const). Registered for `api/**`, `api/_lib/**`, and `src/**`. Added #1699.

**Adding a new `bernard/*` rule? Don't create a fresh config block that overlaps an existing one — flat config errors `Config (unnamed): Key "plugins": Cannot redefine plugin "bernard"`.** `eslint.config.js` already defines the `bernard` plugin in the `api/**` block (which `ignores: ['api/_lib/**']`) and the `src/**` block. A new top-level block whose `files` glob overlaps either of those (e.g. `['api/**/*.js']`) tries to define `bernard` a second time for the same file → the whole lint run dies before checking anything. Fix: register the rule inside the **existing** `api/**` and `src/**` blocks (add to both `plugins.bernard.rules` and `rules`), and only add a *separate* block for files those blocks miss — scoped so it never overlaps (e.g. `files: ['api/_lib/**/*.js']` to cover the helpers the `api/**` block ignores). (#1699 hit this adding `no-temperature-on-opus`.)

## `bg-popover` / `text-popover-foreground` were undefined in `tailwind.config.js` — verify a token compiles before trusting it

`--popover` / `--popover-foreground` are defined in `src/index.css` (opaque white), and `bg-popover`/`text-popover-foreground` are used in several components (`WorkspaceSwitcher`'s dropdown, `SidebarNavLink`'s collapsed tooltip) — but `popover` was never added to `theme.extend.colors` in `tailwind.config.js` (unlike `card`, `accent`, etc., which all have a matching entry). Tailwind silently drops unknown utility classes rather than erroring, so `bg-popover` compiled to **nothing** — those menus/tooltips rendered with zero background and page content showed straight through. This had apparently been live and unnoticed in `WorkspaceSwitcher` before a new sidebar nav flyout (#1895) hit the same bug and made it visible (#1896 fix).

Rule: when using any `bg-<token>`/`text-<token>-foreground` class backed by a CSS custom property in `src/index.css`, confirm the token has a matching entry in `tailwind.config.js`'s `theme.extend.colors` — grep the config, don't assume a var's existence means the utility class works. If you're unsure, check the built CSS (`grep -o "\.bg-<token>{[^}]*}" dist/assets/*.css` after `npm run build`) — a real rule should show `background-color:hsl(var(--<token>))`; an empty/missing match means the utility is a no-op.

## Template literal backticks in `src/lib/prompts.js`

All system-prompt functions in `prompts.js` return template literal strings (backtick-delimited). **Any backtick character inside the return value terminates the string and causes an ESLint parse error** (error message: `Parsing error: Unexpected token :`). This includes markdown code formatting: writing `` `[STAGE:n]` `` inside a prompt causes the failure even though it looks like documentation.

Rule: when editing prompt functions in `prompts.js`, use single quotes `'value'`, `[brackets]`, or plain text for any value you'd normally set in backtick-fenced formatting. Never use raw `` ` `` inside a template literal prompt unless you escape it as `` \` ``.

## Verifying a prompt-QUALITY change — true before/after node harness

A prompt edit whose acceptance criterion is "the output reads better" (CTA flows naturally, voice is warmer, less boilerplate) is normally shipped-and-eyeballed, but it CAN be verified rigorously before merge with a local harness — no deploy, no Chrome. The trick is to make OLD vs NEW differ by *only* your edit, on *identical real inputs*. Recipe (used 2026-07-08 for the campaign-CTA-flow fix, PR #1994):

1. **Import the real post-fix functions** (`getAtomSystemPrompt` from `api/_lib/atomPrompts.js`, `getTentpolePromptContext` from `api/_lib/tentpoleCampaignContext.js` — both are pure/format-only given a campaign+workspace object; the DB work lives in the separate `loadCurrentTentpole`). Build the NEW system prompt.
2. **Derive OLD by reverting exactly your edits via `String.replace` on the built NEW prompt string** — don't copy+revert whole source files (relative imports break in scratch, and reverting escaped `\n`/em-dash/apostrophe literals with `perl -pi` is error-prone). Assert each revert target `.includes()` before replacing so a stale revert map throws loudly instead of silently testing NEW-vs-NEW. Watch straight `'` vs curly `'` — grep the source (`grep -o "phrase" file | cat -v`) to get the exact byte.
3. **Feed real prod data** pulled via Supabase MCP: the actual active campaign (`campaigns` row: `content_style`/`cta_pitch`/`cta_url`/`cta_label`) and a real interview transcript (`interviews.messages`) thematically matched to it. Never invent inputs — the whole point is to exercise the real read path (see "Probe AI-generation features with the REAL workspace data").
4. **Call the same model the handler uses** — `generateText({ model: 'anthropic/claude-sonnet-4-6', instructions, messages })` via the AI SDK gateway. Set `process.env.AI_GATEWAY_API_KEY` from the 1Password scratch dump inside the harness (never print it).
5. Run OLD + NEW across 2–3 platform/angle combos, print both, and look for the specific defect. The smoking-gun signal for the CTA fix: the campaign's raw `cta_pitch` sentence appeared **verbatim** in every BEFORE output and was **rephrased/bridged** in every AFTER — a concrete pass/fail, not a vibe.

Gotchas: bare `import('ai')` needs repo `node_modules` — ESM does NOT honor `NODE_PATH`, so run the harness file from *inside the repo tree* (`cp` it to the repo root and `node ./_x.mjs`), not from the scratch dir. Clean up the harness AND the env dump (it holds a live key) when done.

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

**Schema-drift CI guard — refresh the snapshot after every prod migration.** Since there's no migration tracker, the committed snapshot `supabase/expected-schema.json` acts as the applied-migrations ledger. The `pr.yml` `build` job runs `npm run schema:verify` (= `node scripts/verify-schema-drift.mjs`), which diffs the snapshot against live prod and **fails the PR if any snapshotted column is MISSING from prod** — i.e. a migration was written but not applied, or a column was dropped under code that still reads it. So the workflow when you add a column is: write the migration → apply it to prod → run `npm run schema:snapshot` (needs an unredacted `MULTITENANT_DATABASE_URL`; it re-queries live and rewrites the snapshot) → commit the updated `supabase/expected-schema.json` in the same PR as the code that reads the new column. If you forget the snapshot refresh, the check only **warns** about prod-only columns (it never fails on extras), so a new column won't redden CI — but the snapshot silently stops protecting that column until refreshed. The check skips cleanly (exit 0) if the `MULTITENANT_DATABASE_URL` Actions secret is ever absent.

Local migration runs require an unredacted `MULTITENANT_DATABASE_URL` in `.env.local`. `vercel env pull` replaces Sensitive vars with `*****REDACTED*****`, which silently breaks the apply script (`TypeError: Invalid URL`). After any `vercel env pull`, restore `MULTITENANT_DATABASE_URL` from 1Password (Bernard vault) before running migrations locally.

**Applying a migration and refreshing the snapshot WITHOUT a local `MULTITENANT_DATABASE_URL`:** the Supabase MCP (`mcp__*__apply_migration` / `execute_sql`) can do both steps directly against prod — no raw Postgres connection string needed. Apply the DDL via `apply_migration`, then refresh the snapshot via `scripts/verify-schema-drift.mjs --from-json <flat-dump.json>` (documented in the script's own `--from-json` mode) fed from a fresh `execute_sql` run of the script's own `COLUMNS_QUERY`. The MCP's `execute_sql`/`list_tables` results can exceed the tool's output-token cap on a schema this size (50+ tables) — when that happens, the full JSON is still saved to the tool-result file on disk; extract the embedded array with a `python3`/`jq` one-liner (never `Read` the whole file into context) and write it straight to the flat-dump path `--from-json` expects. This sidesteps both the 1Password-restore step and the "redacted var breaks the apply script" trap entirely for one-off migrations. (Used 2026-07-08 for the `feedback` table migration.)

**Status columns have CHECK constraints.** Any new status value needs a migration — symptom is a generic `db_error`/500. Before adding a new status value, grep `<table>_status_check` in `supabase/multitenant/migrations/` to find the constraint, then add an `ALTER TABLE … DROP CONSTRAINT / ADD CONSTRAINT` in the same migration as the code that uses it. Never assume a text column accepts any value.

**`content_items.media_urls` canonical shape is `[{url, type, kind, …}]` objects** — never bare strings. A bare string URL → the video publisher can't determine type → ships as a broken image. Every writer must use the object shape. Use `clipToMediaEntry()` / `pickerItemToMediaEntry()` from `src/lib/mediaEntry.js` to construct entries.

**A suggest-media *clip* is NOT a media_urls entry — and `useMediaSuggestions` returns `{ clips: [...] }`, not a bare array.** A suggestion clip is `{ blobUrl, assetId, kind, thumbnailUrl, … }`; a media_urls entry is `{ url, type, mediaAssetId, … }`. Storing a clip raw gives `url: null` (it has `blobUrl`, not `url`) AND breaks `mediaEntryKey` (which reads `mediaAssetId`, not `assetId`) — so dedup and `photo_idx` binding silently fail. ALWAYS pass a clip through `clipToMediaEntry()` before storing/keying it — the Swap-photo panel does this (`attach(clipToMediaEntry(clip))`); the carousel auto-attach did NOT and shipped two follow-up PRs (#1660 read the wrong return shape → bailed entirely; #1662 then stored raw clips → `url:null` blanks). When wiring a new consumer of `useMediaSuggestions`, read `.clips` and map through `clipToMediaEntry`. (Symptom that catches it: editor header shows "N photos" but slides render blank / `photo_idx` stays null in the DB — verify the *persisted* row, not just that the effect fired.)

**Carousel auto-attach persists BOTH `media_urls` and the per-slide `photo_idx` binding** (#1663). It only fires on first open of a media-empty carousel, so if it wrote `media_urls` but left the binding in local state until an explicit Save, a reload-before-Save left "N photos" attached-but-unbound and it could never re-fire (media no longer empty). It now PATCHes `{ mediaUrls, slides }` together and sets the saved baseline. No bake on auto-attach — slide images bake on explicit Save (publish has its own render fallback).

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

5c. **`gh pr status`'s "Created by you" is scoped to the git author identity, not to this session.** Every parallel Claude session in this repo commits as the same `drquasney` identity, so at wrap/audit time `gh pr status` lists sibling sessions' unrelated open PRs right alongside this session's own. (Deep Thought/Bernard 2026-07-22: a `/wrap` run saw 5 unfamiliar PR numbers — #2241/#2238/#2237/#2234/#2233 — mixed in with the 2 this session actually opened; almost reported on, and could as easily have force-merged or triaged, work with zero context behind it.) **Rule: before reporting on, merging, or triaging anything `gh pr status` surfaces as "yours," cross-check `headRefName` against branches THIS session actually created/pushed** (`git branch --list`, or just recall what you named them) — don't trust the "created by you" grouping alone.

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

**Adding a new `api/_routes/*` handler? The generated route manifest conflicts on rebase — regenerate, don't hand-merge.** `api/_routes/_manifest.generated.js` is generated by `scripts/build-api-manifest.mjs` (runs in `prebuild`; the build auto-updates it when you add a route). It imports every handler as `h<N>` and registers `{path, handler}`. When ANY other PR that also adds a route merges to `main` first, your rebase hits a conflict in this file (both sides added an `h<N>` at the same numeric slot). **Never resolve the `<<<`/`>>>` by hand** — take main's version and regenerate:
```bash
git checkout --theirs api/_routes/_manifest.generated.js
node scripts/build-api-manifest.mjs        # re-derives all routes from the api/_routes/ tree
git add api/_routes/_manifest.generated.js
git rebase --continue
npm run verify-api-manifest                 # confirms in-sync (also a CI gate)
```
(2026-06-24: the `plan-week` route PR #1680 conflicted on this file against a sibling route PR; regenerate-then-continue resolved it cleanly in one step.)

**`.claude/launch.json` is a single shared file across every worktree — two parallel sessions adding a mockup-server entry at the same time WILL collide, both on port number and on rebase.** Each worktree session that wants `preview_start` for its own `.claude/mockups/` needs its own entry, but the file lives at one path in the repo (not per-worktree), so a port you pick as "clearly unused" can be claimed by a different session's concurrent commit before you push. Symptom: `preview_start` errors "Port already in use by another chat's dev server," and a rebase later conflicts on the same block with `<<<`/`>>>` around two different `runtimeArgs` port numbers. Fix: on the port-in-use error, just pick the next unused port and retry — don't fight for a specific number. On a rebase conflict, keep BOTH sessions' entries (don't drop either), giving each entry a distinct port; never resolve by discarding one worktree's config. (2026-07-08, PR #1963: hit both the live port collision and the rebase conflict in the same session, once each.)

**A `launch.json` entry's `"port"` field is metadata for the preview tool only — it does NOT get passed to `npm run dev` / `vite`.** Vite ignores it and binds its own default (5173, or auto-increments if taken), so `preview_start` sits at "Awaiting server..." forever because nothing is listening on the port it's tracking. Fix: add the port explicitly to `runtimeArgs`, e.g. `["--prefix", "<worktree>", "run", "dev", "--", "--port", "5183", "--strictPort"]` (the `--` separates npm's args from vite's; `--strictPort` makes vite fail loud instead of silently picking a different port). This only matters for a worktree-specific dev-server entry added for local verification — and per the note above, it's still moot for verifying anything behind Clerk auth, since `pk_live` is domain-locked to `*.withbernard.ai` regardless of port. (2026-07-09, `fix-music-bed-draft` session.)

**A worktree can carry a stale, never-pushed local commit from EARLIER unrelated work — pushing new work on top bundles both into one PR and can make it unmergeable.** Distinct from the stacked-PR case above: this isn't a branch built on top of a squash-merged sibling, it's leftover WIP that was committed (but never pushed) in a session worktree before the current task even started, then silently carried forward. Symptom: `gh pr view <n> --json mergeable,mergeable_state` reports `false`/`dirty` even though your own diff looks clean, and `gh api .../check-runs` shows no `build` run at all (GitHub never computed CI for the broken merge state). **Diagnostic: `git cherry-pick <stale-sha>` onto a fresh branch off current `origin/main`.** If it reports "previous cherry-pick is now empty," the commit's content is ALREADY on `main` — shipped by another session, possibly under different wording (2026-07-01: "Center on frame" vs "Center on canvas" — same feature, same author, different session). Confirm with `git show origin/main:<file> | grep <feature-marker>` before trusting the empty-cherry-pick signal. Recovery: `git stash` your real work, drop the stale commit with `git rebase --onto origin/main <stale-commit-sha> <branch>`, `git stash pop`, then `git push --force-with-lease` (confirm with the user first — force-pushing an already-pushed branch is a "still confirm before" action per `~/.claude/CLAUDE.md`). Never assume a stale commit needs its own PR — cherry-pick-onto-main is the cheap way to find out it's already redundant before doing that work.

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

**When confirming deploy for a PAST merge (e.g. at session wrap), don't wait for an exact SHA match against `origin/main` — check ancestry instead.** In a fast-moving repo, `origin/main` keeps advancing from other sessions' merges, so by the time you check, it's normal for `version.json`'s `sha` to differ from both your merge commit AND the current `origin/main` tip. An exact-match check would misread "someone else's later merge already deployed" as "mine never went out." The correct check: `git merge-base --is-ancestor <your-merge-sha> <prod-sha> && echo "live"` — if your commit is an ancestor of whatever SHA prod is currently serving, it shipped, even though a newer commit has since deployed on top of it. (2026-07-08 wrap: prod's SHA matched neither the PR's merge commit nor `origin/main` — turned out prod was one merge *ahead*, and the ancestry check confirmed the fix was already live.)

**`vercel inspect <dpl>` Aliases / domains list is FROZEN deployment metadata — NOT live routing.** It shows the domains a deployment was assigned at deploy time and does not update when you add/remove aliases afterward. After `vercel alias rm <name>`, `inspect` will keep listing the removed alias (it refreshes only on the next prod deploy), which reads as "the removal failed" when it actually succeeded. **For live alias/routing state, trust HTTP probes, not `inspect`:** `curl -s -o /dev/null -w "%{http_code}" https://<host>/` (a removed alias → 404/connection refused; a live one → 200). Bit us during the 2026-06-08 legacy-domain → withbernard.ai cutover — `inspect` listed five of the old domain's aliases as still attached after they'd been removed; curl confirmed every one was actually dead.

## Renaming ≠ rebranding — check build-generated output and binary/vector asset *contents*, not just string refs

A global rebrand find/replace (old product name → `bernard`, old domain → `withbernard.ai`) swaps strings and renames files but leaves two whole classes of stale branding that a `grep` of source won't catch. Both shipped to live prod during the 2026-06-08 rebrand and were only caught later:

- **Build-time generators regenerate stale output on every deploy.** `scripts/build-blog.mjs` has inline HTML templates (header logo, `<title>`, canonical/OG URLs, footer email) that were never rebranded. It runs as part of `npm run build`, so Vercel regenerated `public/blog.html` + `public/blog/*.html` with full Bernard branding (favicon `/bernard-icon.svg`, `https://withbernard.ai/blog` canonical) on **every** deploy — the committed files looked correct but were overwritten at build time, and the live blog served the old brand regardless. **Rule: after a rename, grep `scripts/` and any `prebuild`/`build` step for the old name, not just `src/`/`api/`. A file that's regenerated by the build is owned by its generator, not by its committed copy.**
- **Renamed asset files still contain the old artwork.** `git mv <old>-logo.svg bernard-logo.svg` changes the filename, not the pixels/paths inside. Every `public/*.svg` and `public/brand/*.png` was the old evergreen-`#1c4d37`/coral-`#ff8552` mark under a Bernard filename — including `bernard-icon.svg`, the sitewide favicon + PWA + Clerk-org-logo (~43 refs). **Rule: for SVGs, grep the file *bodies* for old brand color hexes / old wordmark text (`grep -l '#ff8552\|#1c4d37' public/**/*.svg`); for PNGs, actually open/rasterize a couple and look. A clean `grep` of code references proves nothing about asset contents.** (Local rasterization fallback when rsvg/ImageMagick are absent: `qlmanage -t -s <px> -o /tmp x.svg` then `sips -z`/`--padToHeightWidth` for exact dimensions.)

`npm run deploy:prod` is still the right tool for:
- The GitHub integration is failing or paused
- A hotfix needs to ship from a worktree without a PR
- You need to deploy code that isn't yet (or won't ever be) on `main`

## Retiring a domain must include auditing third-party webhook configs

A domain retirement (redirect rules, DNS, code references) is not complete until every **third-party service that pushes webhooks INTO Bernard** is checked for a stale endpoint URL pointing at the old domain. This is a different blast radius than the string/asset rebrand above — a stale webhook doesn't error visibly, it just silently stops delivering, and the failure mode looks identical to "the feature is slow" or "stuck processing" rather than "broken."

Found 2026-07-03: the Mux webhook (Settings → Webhooks in the Mux dashboard) was still registered against the retired `narraterx.ai` domain from the 2026-06-09 cutover. Every `video.asset.ready` event since 2026-05-20 (over a month) went nowhere — 123 videos sat at `transcode_status: 'processing'` indefinitely even though Mux had finished encoding them within minutes each time. No error anywhere in our logs, because our server never received a request to error on. Diagnostic tell: calling the *provider's own API* directly for one affected asset showed it was actually done — the provider's ground truth disagreed with our DB, and only a webhook-delivery failure explains that gap.

Rule: whenever a domain is retired or changed, check every service with a webhook callback into Bernard — at minimum Mux, Stripe, Clerk, bundle.social, and Google (OAuth redirect URIs) — and confirm the registered URL was updated. Prefer checking the provider dashboard directly over assuming a documented cutover PR caught it; webhook config usually lives outside the codebase entirely, so no grep will find it. See `api/_routes/cron/sweep-stuck-transcodes.js` for the self-healing safety net now in place for the Mux case specifically — but this class of bug can recur for any other webhook-driven pipeline and won't have an equivalent sweep unless one is built.

**A third blind spot in the same class: Vercel env vars whose VALUE is an email address at the old domain** (`ADMIN_NOTIFY_EMAIL`, any `*_NOTIFY_*`/`*_ALERT_*` recipient var). Found 2026-07-08: `ADMIN_NOTIFY_EMAIL` on Bernard prod still held `drq@narraterx.ai` — a full month after the narraterx.ai retirement — because it's neither a webhook config on a third-party dashboard (the class above) nor a source-code/asset string a rebrand grep would catch. Resend accepted and "delivered" every notification email against that stale address with **zero error**, so `POST /api/feedback` looked completely healthy (200s, no logged failures) while 4 user-submitted screenshots vanished into a dead mailbox. Compounding factor: a 1Password value can silently drift from what's actually deployed — 1Password held the *correct* `drq@withbernard.ai` as the presumably-already-fixed value, but Vercel prod had never actually been updated to match, so trusting 1Password's value over a direct `vercel env ls`/API check would have given false confidence. Rule: after any domain rename, `vercel env ls` and grep every recipient-style env var for the old domain — don't assume "the webhook audit covered it," and don't trust a secrets-manager value as proof of what's actually deployed without cross-checking Vercel directly.

## Buffer vs bundle.social publish paths: platform-specific limits don't auto-share

`api/_routes/publish/buffer.js` routes every publish through one of two provider paths — the original Buffer path, or `handleBundlePublish` for workspaces on `publish_provider='bundle'`. The bundle path's own comment calls it "byte-for-byte identical" to the Buffer path for non-GBP platforms, which reads as if platform-specific rules (character caps, media limits) are shared — they are NOT. Each path independently re-implements any provider constraint, so a rule enforced in one silently doesn't exist in the other unless someone copies it over by hand.

Found 2026-07-07: the Buffer GBP branch already truncated captions to Google's 1500-char cap (`rawText.slice(0, 1500)`, line ~297) — but `handleBundlePublish`'s GBP branch never did. Any workspace on the bundle.social provider publishing a caption over 1500 chars got a 502 `bundle_gbp_post_failed` with no indication why (bundle.social's real error — a 400 "String must contain at most 1500 character(s)" — was swallowed into the opaque error key per the no-`detail`-in-error-response rule; only visible via `vercel logs --status-code 502 --expand`).

Rule: when adding or auditing a platform-specific constraint (length cap, media-count cap, format requirement) in one publish provider path, grep the sibling path for the same platform and confirm the constraint is mirrored there too — don't assume "byte-for-byte identical" claims in code comments have stayed true as the paths evolved independently. `src/lib/contentMeta.js`'s `CAPTION_LIMITS` map is the client-side mirror of these same caps (surfaced as an editor warning, added in #1960 as a follow-up) — keep it in sync with whatever the server paths actually enforce.

**Same root cause recurs at the UI-copy layer, not just server dispatch.** When the original single-provider integration (Buffer) grew a second provider (bundle.social), the *server* dispatch logic was audited for provider-specific branching, but ~12 UI strings across `AssetsPane.jsx`, `WorkspaceSettings.jsx`, `YourWeek.jsx`, `ReviewInbox.jsx`, `AutoPublishSettings.jsx`, `ChannelsSettings.jsx`, `Onboarding.jsx`, `ProducerOnboarding.jsx`, `ContentBriefDetail.jsx`, and `BufferMetricsRow.jsx` kept hardcoding "Buffer" — including "Published to Buffer" and "Scheduled on Buffer" — regardless of `publish_provider`. Went unnoticed for weeks because **movebetter, the flagship live workspace, is the only workspace on `'bundle'`** (confirmed via `SELECT slug, publish_provider FROM workspaces`) — every other seed/test workspace is still `'buffer'`, so the mislabel was invisible in casual testing. Fixed 2026-07-08 (#1988) by making the copy provider-neutral ("Add to queue", "Scheduled", "Published") rather than dynamically branching every string on the workspace's provider — matches bundle.social's own onboarding pitch of "no third-party tool to manage." Also caught bundle.social missing from the Privacy Policy sub-processor table — a live, undisclosed sub-processor. Rule: when a feature is generalized from single- to multi-provider, grep user-facing copy for the old provider's literal name (`grep -rn "Buffer" src/pages src/components`) as a separate pass from auditing server logic — and check `SELECT DISTINCT publish_provider FROM workspaces` to know which provider is actually live on which tenant before judging blast radius.

**A "hard gate, enforced at every publish path" claim is only as complete as the list of paths you audited — and a route-by-route sweep misses any path that dispatches server-to-server without going through an HTTP route at all.** Shipping the Phase 3 words-approval gate (`api/_lib/wordsApprovalGate.js`), the plan was to enforce it in every publish handler — audited by tracing the client's network calls: `publishItem()` → `/api/publish/buffer`, `publishBlogToWebsite()` → `/api/publish/website`, `sendBlogToBeehiiv()` → `/api/publish/beehiiv`, plus the manual `/api/producer/retry-publish` route. All four got the gate, all four verified green, and the PR description said "enforced in every publish path." That was false: `api/_lib/dispatchContentItem.js` is a **fifth dispatch entry point** — server-side auto-publish for the Standing Producer's "approve from /week" flow (`api/_routes/content-plan/approve.js`) — that calls `BundlePublisher.publish()` directly with no HTTP round-trip and no gate check at all. It was invisible to a client-network-call audit because there IS no client call to trace; the server calls the publisher itself. Found by accident one phase later, while adding unrelated bulk-lane warning copy, not by a deliberate audit — and it was live and reachable on `movebetter` (the one tenant on `publish_provider='bundle'`) the whole time the gate was "done." Rule: when a security-relevant gate needs to cover "every publish path," don't enumerate HTTP routes from the client side — grep for every caller of the underlying dispatch primitives instead (`BundlePublisher.publish`, `runBufferPublish`, `runBundlePublish`, and equivalents for any other external-send call), since a server-internal dispatch helper with no route of its own won't show up any other way. Treat "enforced everywhere" as an unverified claim until you've done that grep, not just until the known routes pass.

## Audit and checkup
Three complementary commands cover code/UI/prod health:

- **`/checkup`** (and `/checkup quick`, `/checkup ui`, `/checkup full`) — procedural health pass: lint + build + tests + recent-change code review + optional UI smoke + prod logs. Fast, deterministic, ~3–25 min. Use before opening a PR or after a hot deploy.
- **`/audit`** — multi-agent deep review composing `bug-hunter` + `tenant-isolation-auditor` + `ui-reviewer` in parallel, scoped to commits since the last audit (tracked in `.claude/audit-history/.last-audit`). `ui-reviewer` always sweeps the full app since visual drift is cumulative. Writes a prioritized P0/P1/P2 punch list to `.claude/audit-history/<date>.md` and spawns one-click chips for P0 fixes. ~10 min, ~$3–6. Routine cadence.
- **`/auditfull`** — same three agents, but `bug-hunter` and `tenant-isolation-auditor` sweep the entire codebase with no diff scoping. Higher coverage at higher cost. ~20 min, ~$8–15. Before-release baseline, not weekly cadence.

Pair `/audit` with `/schedule` for an automated weekly run; reserve `/auditfull` for monthly or pre-release passes.

## Acting on in-app feedback — read the `feedback` table, not the inbox

Every submission from Bernard's in-app Feedback button is stored durably in the **`feedback` Supabase table** (`message`, `page_url`, `screenshot_url`, `user_name`, `created_at` — see `api/_routes/feedback.js`). The email to `ADMIN_NOTIFY_EMAIL` is only a notification copy — **never parse the inbox; query the table.** When a staffer reports bugs via Feedback ("act on these feedback emails"), the table IS the queue.

- **`/triage-feedback`** command — queries untriaged rows (`triaged_at IS NULL`), maps each `page_url` → code, reads the screenshot, diagnoses the root cause, writes a P0/P1 punch list to `.claude/feedback-history/`, spawns a task chip per actionable item, and stamps rows `triaged_at`. **Report-only** by default (no auto-PRs — review before ship). Migration 177 added `feedback.triaged_at` + `triage_note` as DB-native state so a headless routine and an interactive session never double-process a row.
- A weekly scheduled task (`triage-bernard-feedback`, Mondays 9am) runs it automatically.
- To re-open a triaged item: `UPDATE feedback SET triaged_at = NULL WHERE id = '…'`.
- Fixes still go through the normal branch → PR → prod → Chrome-verify loop (authed UI surfaces need the post-deploy Chrome check). Shipped as the feedback-triage loop, #2179 (2026-07-16).

**Audit reports + `.last-audit` live in the PRIMARY checkout's `.claude/audit-history/` — a session worktree writing them relative strands them.** `.claude/audit-history/` is gitignored, and harness session worktrees get their own disconnected copy of `.claude/`, so an audit that writes `<date>-full.md` + `.last-audit` via relative paths leaves them in a disposable worktree: the report vanishes on worktree cleanup and the primary's `.last-audit` silently goes stale, mis-scoping every future `/audit` since-last run. (2026-07-15: the 7-12 full baseline was found stranded this way — the primary's pointer still read Jul 3.) Rule: audit runs write the report and `git rev-parse HEAD > .last-audit` to the absolute primary path (`/Users/qbook/Claude Projects/Bernard/.claude/audit-history/`), and at audit start check the worktree copy for stranded reports from prior sessions and rescue any missing from the primary.

**Pre-merge Claude review** (`pr.yml` `review` job) — runs an inline `prompt` on every PR via `anthropics/claude-code-action@beta`, posting inline findings before merge. Non-blocking (`continue-on-error: true`); `build` is still the only required gate. To promote it to a required check, add `review` to branch protection status checks. Two pitfalls found in initial wiring:
- `github_token` must be passed explicitly — without it, the action silently gets a Bad credentials 401 when posting comments (#1393, 2026-06-18).
- The input is `prompt:`, NOT `direct_prompt:` — the wrong key causes `IS_PR: false` / `CLAUDE_SUCCESS: false` and a 26s no-op exit with no error surfaced (#1399, 2026-06-19). Skills (e.g. `/code-review`) are not available in the headless CI context; use an inline prompt string instead.

**Weekly PostHog UX pain check — verify dead/rage-click hotspots against the actual handler code before fixing; don't fix-the-metric.** `$dead_click`/`$rageclick` fire on a heuristic (no DOM mutation within ~2.5s of a click) that produces real false positives on specific element types: clicking into a `<textarea>` (focus-only), a `<canvas>` (internal redraw, e.g. slide/photo select or video togglePlay), or re-clicking an already-active tab. Before writing a fix for a reported hotspot, read the actual click handler for that element/route. 2026-07-16 run: 3 flagged clusters, read as 2 real bugs + 1 false positive —
- `/week`'s "Draft" button dead clicks (11) were a REAL bug: `handleDraft` uses a page-wide single-flight lock (`if (draftingAtom) return`) but only the in-flight card showed disabled/spinner, so clicking Draft on any *other* "needs draft" card silently no-op'd. Fixed by adding a `draftBusy` prop so every other Draft button visibly disables while one is running (#2170).
- `/moments/clip/:id` canvas dead clicks (15) were a FALSE POSITIVE on inspection: `VideoEditor.jsx`'s `togglePlay`/`selectKey` handlers are correctly wired; the only no-op path is `if (!v) return` when the video hasn't mounted yet — standard player behavior, not a bug. Left as-is.

Rule: for each flagged element, grep the route's component for the click handler before assuming it's broken. `<textarea>`/`<canvas>`/video-container clicks are the recurring false-positive shape; a `disabled` button or a shared-lock-vs-per-item-UI mismatch (like the Draft bug) is the recurring real-bug shape. This will recur every week the `bernard-ux-pain-weekly` routine runs — don't skip the code-read step just because PostHog names an element.

**A P1/P2 slow-route finding is often one shared backend handler with an avoidable sequential waterfall — check for independent `await`s before assuming it needs a bigger rearchitecture.** `/week` and `/` (Home) both share `api/_routes/content-plan/week-summary.js`, flagged for P95 LCP 6.4s/7.7s. The handler ran 4 Supabase REST round-trips strictly sequentially, but only 2 were actually dependent (atoms → drafted-content-items); the backlog query and the reviewer's staff→review-queue chain have zero data dependency on the atoms chain and were just running after it for no reason. Wrapped the 3 independent chains in `Promise.all` — same output shape/values, just concurrent (#2170, same PR as the Draft-button fix above). Rule: before treating a slow-route finding as a "needs real profiling / bigger perf project" item, read the backend handler(s) it hits for a plain sequential-`await` waterfall over calls that don't actually depend on each other — it's a 10-minute read that sometimes is the whole fix.

## `.claude/` directory — scratch vs. keep

The untracked `.claude/` directory mixes two kinds of files; do NOT bulk-delete it as "scratch." Before deleting anything here, classify:

- **Regenerable scratch (safe to delete)** — outputs that have a committed generator: eval results (`eval-v6.mjs`), smoke reports (`g6-video-onboarding-smoke.mjs`), prompt-eval logs (`prompt-eval-harness.mjs`), voice-fidelity dumps. Rule of thumb: there's a `scripts/*.mjs` that re-creates it.
- **Human-authored, irreplaceable (keep)** — design/planning docs with no generator: `*-spec.md`, `*-plan.md`, `*-sketch.md`, mockup `*.html`. These are real work (one was literally "awaiting owner sign-off") and are never re-derivable. Treat them like source.

These are untracked, so `rm` is unrecoverable (see ~/.claude/CLAUDE.md "Deleting files — untracked means unrecoverable"). When in doubt, leave it or ask — the cost of keeping a stale scratch file is zero; the cost of deleting a spec is the whole document.

**A fresh worktree / spawned follow-up task does NOT inherit untracked or gitignored `.claude` files — commit the handoff docs FIRST.** `spawn_task` (and any new `git worktree`) checks out a branch off `main`; it gets ZERO of the current worktree's untracked planning docs and ZERO gitignored mockups. So if you `spawn_task` a follow-up that says "read `.claude/foo-plan.md`" or "build from `.claude/mockups/bar.html`", the spawned session **cannot see them** unless they're on `main`. Before spawning a doc-dependent follow-up: commit the `.md` keeps (not ignored — plain `git add`) and `git add -f` any referenced mockups. Bit us 2026-06-20: a U3–U5 follow-up referenced `unified-editor-plan.md` + `unified-editor.html`, both worktree-local — had to commit them (#1451) so the handoff worked.

**Mockup-tracking convention (Q, 2026-06-20 — "Option A"):** `.claude/mockups/` is gitignored (`.gitignore:28`) and STAYS that way for iteration scratch — but **`git add -f` a mockup the moment Q signs off on it.** An approved mockup is the build spec (mockup-first rule), so it must be versioned next to the code it specs and reachable from any worktree. Tracked so far: `unified-editor.html`, `carousel-editor-v2.html`, `colorist-brand-look.html` (approved) + `video-editor-v1.html` (pending sign-off). Don't bulk-commit the ~50 exploration mockups — only the sign-off'd ones.

**Resolving a rebase conflict with the Edit tool can leave orphan conflict markers that `git rebase --continue` does NOT catch.** When you resolve a two-block conflict (`<<<`/`===`/`>>>`) with an Edit that only matches one block (e.g. you match the `<<<HEAD`…`>>>` half but the `<<<HEAD` marker lands outside the old_string), git stages the partially-resolved file and `--continue` proceeds — but the stale `<<<<<<< HEAD` line remains in the committed file. Lint is the first thing that catches it ("Parsing error: Unexpected token <<"). **Rule: after resolving any rebase conflict with the Edit tool, grep for stale markers before staging:**
```bash
grep -rn "<<<<<<\|>>>>>>>\|=======" <conflicted-file>
```
If any remain, fix them with a targeted Edit, then re-run lint before `git add`. (Hit 2026-06-21 in the F2 phase-2 rebase: the Layout.jsx `<<<<<<< HEAD` orphan marker slipped through `git rebase --continue`, compiled as a parse error, and required an amend + force-push.)

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
- [ ] **Job-level done, not component-done**: if the PR produces an artifact or output a user acts on, the artifact demonstrably reaches the surface where the user consumes it (the draft appears in /week, the rendered file lands on the content item, the published post is live). "The function returns correct bytes" is component-done. The recurring failure class this gates: render-segments baking reels into a b-roll graveyard, carousel overlay text previewed but never published, drafts born without media — working parts, broken job.
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

**Class-string sweeps are ORDER-sensitive — verify with a per-token AND grep and a live-DOM probe, not the pattern you swept with.** A repeated Tailwind class combo (`bg-success text-white shadow-sm …`) drifts into copies with the same classes in a different order, which a byte-exact `Edit replace_all` (and a grep for the canonical string) silently miss — the sweep "completes" with stragglers still live. (2026-07-15, #2150→#2151: the ConnectedBadge dedup left 2 of 10 copies — one order-variant in the same file, one in a sibling component file — caught only by a prod DOM probe `querySelectorAll` filtering on both class tokens independently.) Rules: (1) after any repeated-class sweep, re-grep order-agnostically — `grep -rn "<tokenA>" src | grep "<tokenB>"` — across ALL of `src/`, not just the file you swept; (2) for an authed surface, close the loop with a DOM probe in Q's Chrome counting old-vs-new class tokens (`[class*=…]`), which proves both bundle freshness and sweep completeness in one call; (3) the durable fix for a badge/chip repeated across files is a shared component (`src/components/ui/`), not a swept string.

After fixing, sanity check by clicking through every major surface (Home, Stories, Library, Settings + subpages, Account) in one sitting and watching for any color that doesn't belong to the new identity. Cross-page review catches what per-page review misses.

## Email Template
The email newsletter preview renders the actual TrustDrivenCare (TDC) HTML template via `<iframe srcDoc>`. The template lives at `src/email-template.html` and is imported with Vite's `?raw` loader in `src/components/PostPreview.jsx`.

**To update the template** (e.g. after redesigning in TDC): export the master HTML from TrustDrivenCare, replace `src/email-template.html` with the new HTML, and commit. No React changes needed — all `{{merge_tags}}` are substituted at render time by `fillTemplate()` in PostPreview.jsx.

Merge tags currently in use: `{{preview_text}}`, `{{headline}}`, `{{pull_quote}}`, `{{body_paragraph_1}}`, `{{body_paragraph_2}}`, `{{body_paragraph_3}}`, `{{cta_text}}`, `{{cta_url}}`, `{{ps_text}}`, `{{hero_image_url}}`, `{{year}}`, `{{unsubscribe_url}}`, `{{webview_url}}`.

## 1Password env mount — use `.env.bernard.1pw`, never `.env.local.1pw`

The live 1Password Environments mount for this repo is **`/Users/qbook/Claude Projects/Bernard/.env.bernard.1pw`** (Bernard environment, has MULTITENANT_DATABASE_URL, BLOB_READ_WRITE_TOKEN, AI_GATEWAY_API_KEY, MUX_*, etc.). A stale `.env.local.1pw` FIFO may also exist in the project root — it is NOT an active mount, and reading it (awk/cat/grep) **blocks forever** with no error. If a read of a `.1pw` file hangs, don't retry harder: confirm the active mount path via the 1Password MCP (`list_local_env_files`) and use that. Extract single vars with `awk` per the global CLAUDE.md rules.

**Don't `source` the mount — it fails.** The mount holds at least one multi-line value, so `set -a && source .env.bernard.1pw` dies with `parse error near '\n'`. Instead `cat` it ONCE into a scratch temp file, `awk`-extract the specific vars you need into the env, then `rm` the temp (the FIFO re-serves on each open, so re-catting per shell invocation is fine — shell state doesn't persist across Bash calls). Never `Read` the temp (dumps every secret). Also: the harness shell is **zsh** — bash-isms like `${!var}` indirect expansion and unquoted `--include=*.js` globs fail; quote globs and avoid indirect expansion. `timeout` isn't installed on macOS (use the Bash tool's own timeout or `gtimeout`).

## Prompt refactors — update test markers in the same PR

When `getInterviewSystemPrompt` or any other large prompt function changes its structure (sections renamed, reordered, added/removed), the corresponding test assertions in `tests/lib/prompts.test.js` that check for section markers must be updated in the same PR. A test checking `expect(prompt).toContain('PATIENT SCENARIO')` will fail if that section is renamed to `WHAT TO COVER` in the prompt. Lint + build pass (they don't check prompt markers), so the failure is invisible until CI runs tests. **Always update prompt-marker assertions when the prompt structure changes.** (Lesson from evolving-interviewer P1 #1857: first push passed lint/build but failed tests on the new marker names; caught and fixed in a follow-up.)

## Tactic classifiers — lead vs core moves

When building a post-interview classifier that labels which question techniques were used, don't treat all techniques as "repeats" equally. Some moves (like mechanism-push and concrete-metric) are structural deep-dive behaviors that appear in *any* good clinical interview and should never be penalized for recurrence. Others (like case-first, contrarian, steelman) are distinctive opening/framing tactics that should *rotate* across sessions with the same person to maintain novelty. Split the tactic vocabulary into LEAD (rotate + tracked for anti-repeat) and CORE (always available, never flagged as a repeat). Use the shared LEAD_TACTICS array to filter when building an anti-repeat ledger. (Lesson from evolving-interviewer P2 #1859: the first classifier treated all 11 tactics as tracked repeats, flagging mechanism-push as sameness when it's just good structure; the lead/core split fixed it.)

## Code minimalism — YAGNI gate before building

Before writing code, run the ladder: (1) **does this need to exist at all?** — don't add unrequested abstractions, parameters no caller passes, or dead scaffolds (see "Verify feature wiring before scoping changes"); (2) does stdlib / a native platform feature / an already-installed dep already cover it? use it, add no new dependency; (3) can it be one small function? Prefer deletion over addition, fewest files. Mark any intentional shortcut with a `ponytail:` comment stating its limit and upgrade path.
**Hard carve-out — never trim a check to be lean.** This bias is wrong for trust-boundary code, where Bernard's bugs come from the *missing* check, not excess abstraction. On any tenant-scoped API handler, `workspaceContext(req)` + the `workspace_id` filter + `requireRole` + `enforceLimit` are non-optional even for a read-only count endpoint — `workspaceContext` resolves the tenant from the Host header, which is **not** authentication. When in doubt, keep the check and apply the ladder only to the logic around it.

## Image generation spikes — OpenAI model names on this account

The Bernard `OPENAI_API_KEY` (in `.env.bernard.1pw`) is on an account where `dall-e-3` does not exist. Available image gen models are `gpt-image-1`, `gpt-image-1-mini`, `gpt-image-1.5`, `gpt-image-2`, `gpt-image-2-2026-04-21`, `chatgpt-image-latest`. Use `gpt-image-2` for quality. The API uses the standard `/v1/images/generations` endpoint but responses return `b64_json` (not a URL) — decode and write to `/tmp/*.png` before viewing. Supported sizes include `1024x1536` for portrait (close to 9:16).
