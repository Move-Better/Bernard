# API handlers (`api/`)

Read this before adding or changing a route under `api/`, a handler's runtime or shape, post-response async work, a media download, or the function-bundle check. Moved from `CLAUDE.md` on 2026-11-11; the section headings are unchanged, so a code comment citing `CLAUDE.md "<heading>"` finds its rule here.

## API handler checklist — 7 rules every new route must follow

These patterns caused 26+ consecutive audit rounds because each appeared in one reference handler and got copy-pasted to ~15 others without being caught. The ESLint rule `bernard/no-detail-in-error-response` catches #1 at lint time; the PR review job's Claude prompt checks these. But check them manually before opening a PR:

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

6. **Parse `:id` from `req.url`'s pathname, not `searchParams`.** `api/index.js`'s `wrap()` restores `req.url = req.originalUrl` (the full path) specifically so `[id].js` handlers can do `const id = new URL(req.url, 'http://localhost').pathname.split('/').pop()`. A handler that instead reads `searchParams.get('id')` silently gets `null` on every request — DELETE/PATCH to `/api/foo/:id` never carries an `?id=` query string. This shipped broken for an unknown period in `photo-templates/[id].js` (#2366) with zero errors anywhere except a client toast. Grep sibling `[id].js` files for the pattern before writing a new one; don't reinvent the parsing.

7. **DELETE handlers must return a JSON body, never a bare `204`.** The shared client `apiFetch` (`src/lib/api.js`) unconditionally calls `res.json()` on any non-error response — there's no 204/empty-body branch. `res.status(204).end()` makes `res.json()` throw, surfacing as `"Invalid JSON from <path>"` even though the delete succeeded server-side. Return `res.status(200).json({ deleted: true })` instead, matching `collections/[id].js`. (#2368 — found live on `movebetter`, one delete attempt appeared to fail in the UI but had actually already removed the row.)

## Any endpoint accepting a base64 image/file in the JSON body needs a client-side size cap

Vercel Node functions reject request bodies over ~4.5MB with a bare-text `413 FUNCTION_PAYLOAD_TOO_LARGE` — before the handler ever runs, so there's no `console.error` to grep and no JSON error body (`throwApiError`'s `response.json()` parse silently fails and falls back to a generic `Request failed: 413`). A client that base64-encodes a full-resolution image into a JSON field (screenshot capture, raw file upload) will blow past this the moment the source image is more than a few MB — which a real screen capture or phone photo routinely is. The symptom on the user's end is a generic "Something went wrong" with no clue why, and it looks identical every retry since the input doesn't change.

Confirmed 2026-07-28: the Feedback widget's `getDisplayMedia` screen-capture path sent full-resolution PNGs straight to `/api/feedback` with no downscaling — reproduced live via a direct authenticated POST (plain text → `200`, a 6MB base64 payload → `413`). Fixed by downscaling to a max 1600px dimension and re-encoding as JPEG (q≈0.82) client-side *before* the data URL ever reaches component state, in `FeedbackWidget.jsx`'s `encodeScreenshot()` (#2433).

**Rule: any new feature that lets a user attach an image/screenshot/file as a base64 JSON field must downscale + compress client-side first** (canvas draw at a capped max dimension, JPEG re-encode) — don't rely on the browser's native capture/file resolution. If a future upload surface needs to preserve full resolution, route it through `@vercel/blob` direct upload instead of the JSON body, the same way `media/*` already does.

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

## Fire-and-forget enrichment off a handler must use `waitUntil()` — and a backfill can hide a dead live hook

Background work dispatched from a Node `/api` handler as a **bare floating promise** (no `await`, no `waitUntil`) is not guaranteed to run. On Vercel's Node runtime the instance is frozen the moment the HTTP response is sent, so any async work still pending at that point — embeddings, a late PATCH, an index insert — is silently dropped. This is distinct from the 300s-wall case: it fires immediately at response time, not at a timeout.

Rule: any enrichment a handler kicks off but does NOT `await` before responding (concept extraction, RAG indexing, summarization, book-stale flags) must be wrapped in `waitUntil(...)` from `@vercel/functions`. And `waitUntil` only keeps the instance alive for work that is part of the promise you hand it — so if that promise itself fire-and-forgets a nested step (e.g. `summarizeInterview` → `indexInterviewSummary`), the nested step must be `await`ed, or `waitUntil` won't cover it. Reference: `api/db/interviews.js` + `api/_lib/interviewSummarizer.js` (PR #1066).

The trap that hid this for days: a one-time **backfill makes the data look complete**, masking that the LIVE hook never worked. `practice_memory_chunks` had a summary chunk for every historical interview — but all 7 shared a 2.2-second `created_at` cluster (the 2026-05-24 backfill), and every interview completed *after* it had `summary_text` but zero chunks. Diagnostic tells: (1) if all rows of a derived type share a tight `created_at` cluster, they came from a backfill, not live writes; (2) when verifying any "indexes on completion / approval" feature, confirm a record created *after* the last backfill also has its derived rows — never assume historical coverage means the live path runs. (Same "preview/backfill looks right, live path is dead" shape as the carousel bug, `feedback_canvas_preview_not_published.md`.)

**A degraded-fallback code path that reuses a "real" shape's tag corrupts every downstream consumer that trusts the tag.** `transcribeCallRecording` (`api/_lib/callTranscript.js`, F1 outbound call) has a preferred path (dual-channel ffmpeg split → real per-speaker turns) and a fallback (mixed single-turn transcript, used when the split fails or a channel transcribes empty) that tagged its one blob `role: 'user'` for convenience — same shape as a genuine clinician turn. Two enrichment consumers trusted that tag at face value: `extractVoicePhrases` ingested Bernard's own spoken interview questions as clinician voice (the blob contains BOTH speakers, not just the user), and `classifyAndStoreInterviewStyle`'s assistant-turn filter found zero matches and silently no-opped, on every call that hit the fallback. Neither failure threw or logged — both looked like normal execution. Found 2026-07-10 while spot-checking a completed realtime-voice interview whose `messages` array had exactly one entry. Rule: when a fallback/degraded path can't produce the real shape a "good" path produces (can't attribute speakers, can't fully classify, etc.), don't dress it up in the same tags — return an explicit capability flag (here, `dualChannel: boolean`) and make every downstream consumer that depends on the missing property branch on that flag rather than re-deriving "is this real" from the data's shape. Grep for every consumer of the preferred path's output when adding a fallback, not just the immediate caller. Fixed in `api/_lib/callTranscript.js` + `api/_routes/webhooks/twilio-recording.js` (#2082).
