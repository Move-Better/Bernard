# Bernard — Architecture

Read this file before working in a subsystem it covers. Verify current details against source
files before acting on anything here — this document describes design intent and stable patterns,
not a snapshot of every field in every table.

---

## Multi-tenant model

Bernard is a single Vercel deployment serving multiple workspaces by subdomain. DNS is wildcard
(`*.withbernard.ai` → the `bernard` project), so new subdomains work immediately.

**Runtime workspace resolution:**
- Browser: `useWorkspace()` hook (resolves from `/api/workspace/me` keyed on the subdomain)
- Serverless: `workspaceContext(req)` in `api/_lib/workspaceContext.js` (reads `Host` header,
  looks up the `workspaces` row by slug)
- Background paths (cron, webhooks) without a `Host` header: `workspaceById(id)` from the same
  module

**Tenant isolation is enforced at the API layer, not the database.** Every route that reads or
writes tenant-scoped data must call `workspaceContext(req)` and include `workspace_id` in every
query filter. Treat the workspace_id filter the same way you'd treat an authorization check —
missing it is a cross-tenant data leak, not just a bug.

### Decision: no database-level RLS (deliberate — do not re-flag)

There is deliberately **no RLS on the public schema**, and turning it on today would be a no-op.
Every serverless handler connects to Supabase over PostgREST as **`service_role`**
(`SUPABASE_SERVICE_KEY`, sent as both `apikey` and `Bearer`). `service_role` carries the Postgres
`BYPASSRLS` attribute, so RLS policies are never evaluated on any query the app makes — writing
`CREATE POLICY … USING (workspace_id = …)` would enforce nothing and would falsely imply a DB
backstop exists.

This follows from the architecture, not from oversight. RLS's job is to protect the DB from an
**untrusted client** (browser → Supabase with the `anon` key + a per-user JWT, `auth.uid()` in
policies). Bernard is the opposite shape: the **browser never touches Supabase**. It goes
browser → `apiFetch` (Clerk Bearer) → Vercel function → Supabase-as-`service_role`. Tenant
identity lives in the HTTP request (`Host` → subdomain → workspace), which only the function
sees — Postgres has no per-user session and no way to know the tenant. So the API handler is the
only layer that *has* the information to enforce isolation, and it is therefore *the* enforcement
layer by design.

**Accepted tradeoff:** there is exactly one enforcement layer, and it is hand-written per route.
The compensating controls are `workspaceContext` being mandatory, the `tenant-isolation-auditor`
agent, and the `/audit` cadence. Auditors should verify *that layer* (every tenant query is
filtered), **not** re-flag the absence of RLS as a finding — it is a known, accepted decision.

**When this decision would change (revisit RLS only then):** if any code path starts talking to
Supabase as a **non-`service_role`** identity — e.g. the browser querying Supabase directly with
the `anon` key, or handlers switching to per-request user JWTs / a non-superuser DB role with
`SET LOCAL app.workspace_id`. At that point RLS becomes real defense-in-depth and should be
added. Absent that architectural shift, "add RLS" is not an actionable finding.

**Per-tenant publish credentials** (Buffer, Facebook, GBP, WordPress, etc.) live in the
`workspace_credentials` table, encrypted at the column level with `WORKSPACE_CREDENTIALS_KEY`.
Row shape: `{ workspace_id, service, config (jsonb), secret_ciphertext (text) }`. Read/write
goes through `api/_lib/workspaceCredentials.js`.

**Clerk organizations** map 1:1 to workspaces. The Clerk org id is stored on the `workspaces`
row. `api/_lib/auth.js` verifies the Clerk session and resolves the org membership.

**Workspace-scoping is necessary but NOT sufficient for row ownership.** `requireRole(req, null, …)`
authenticates the caller as a *member* of the workspace org — it does NOT check that they own a
particular row. When `allowedRoles` is null/empty the role check is skipped entirely
(`auth.js:149`), so any authenticated member passes. For a route that performs an
ownership-bearing or irreversible action on a *specific staff member's* resource (deleting a
voice clone, training a clone, editing a person's profile), `workspace_id`-scoping the lookup is
not enough — a plain clinician could act on a colleague's row. Add an explicit self-or-admin gate
after the row lookup:

```js
// SELECT must include user_id
const isSelf = staffMember.user_id && staffMember.user_id === auth.userId
if (!isSelf && auth.role !== 'admin') return res.status(403).json({ error: 'forbidden' })
```

- **`staffMember.user_id === auth.userId` is the canonical "which clinician am I?" link** — same
  field `useSelfStaffId()` resolves self by, and the gate form used at `api/_routes/capture/token.js`
  and `api/_routes/staff/capabilities.js` (the null-guard on `user_id` stops an unlinked row from
  coincidentally matching). NOT `created_by_id` (that's the UI's "I created this row" signal).
- **`auth.role === 'admin'` is the admin-authority signal** — a strict superset of `auth.isOrgAdmin`
  (`auth.js:148` resolves `role` to `'admin'` for Clerk org admins, `publicMetadata.role:'admin'`
  users, AND every member of an `internal`-plan workspace). Gate on `role === 'admin'`, not
  `isOrgAdmin`, or you'll 403 internal-plan members (the Move Better seed workspaces, where every
  member is a trusted admin). The security property holds identically either way.

The 4 `voice-clone/{opt-out,revoke,create,resume}` routes had this gap (PR #1806); the audit
flagged it as a P0 because opt-out/revoke call ElevenLabs `deleteVoice()` (irreversible). The
class recurs by copy-paste — apply this gate to any new staff-row-scoped destructive route.

### Capability keys are PERSISTED — renaming one is a data migration, not a code edit

The capability-id strings in `ALL_CAPABILITIES` (`api/_lib/capabilities.js` + its `src/lib/`
mirror — e.g. `'content.approve'`, `'moments.generate'`) are **stored in the DB**, not just
compared in code: `workspaces.role_templates` (migration 092, per-workspace role→caps override,
JSON arrays) and `staff.capability_overrides` (migration 107, per-person `{capId: bool}` deltas).
So renaming or removing a capability key is a **data migration**, not a code-only change.

The trap: `resolveCapabilities()` silently **drops any stored key not in `ALL_CAPABILITIES`**
(`if (!ALL_CAPABILITIES.includes(cap)) continue` — a deliberate guard against a stale client
injecting arbitrary strings). So a naive rename `X`→`Y` makes every stored `X` grant resolve to
*nothing* — the permission is silently revoked for exactly the workspaces/staff that had it. If a
route gates on that cap via `requireCapability`, the feature goes invisible (the "permission-gated
feature at zero usage" failure mode).

Safe rename procedure (used 2026-07-10 for `slate.*`→`moments.*`, migration 167):
1. Rename the constant value in **both** `capabilities.js` mirrors.
2. Add a `LEGACY_CAP_ALIASES` forward-map + `normalizeCap()`, applied in `resolveTemplate`
   (override caps) and `resolveCapabilities` (the `staffOverrides` loop) — and in the client
   `capabilityLabel`/`capabilityShortLabel` lookups so AccessMatrix renders legacy keys correctly.
   This makes the rename **deploy-order-independent**: stored old keys keep resolving.
3. Ship a backfill migration that rewrites the stored keys in `workspaces.role_templates` +
   `staff.capability_overrides` (quoted-string `replace()` on the `::text` cast handles both the
   array-element and object-key shapes). Data-only → `expected-schema.json` unaffected.
4. Once the backfill is confirmed (`0` rows carry the legacy key), the alias map can be deleted.

Blast radius is small (the Move Better seed workspaces + a couple of producer staff carry custom
`role_templates`/overrides; most rows are `null` → fall back to code `DEFAULT_TEMPLATES`), and no
route currently enforces the Moment Miner caps — but the silent-drop behavior is the thing to
respect for any capability the *next* rename touches.

### Platform-admin gate — cross-tenant surfaces

A *cross-tenant* route (one that deliberately reads across ALL workspaces, e.g. the global
`/admin` usage view → `api/_routes/admin/platform-usage.js`) is gated by **`requirePlatformAdmin(req)`**
(`auth.js`), NOT `requireRole`. This is a **user-level** Clerk flag (`publicMetadata.platform_admin === true`),
deliberately distinct from the per-workspace `'admin'` role: org admins and internal-plan members are
NOT platform admins. Such a route does **not** call `workspaceContext(req)` — there is no tenant to
scope to; the platform-admin flag IS the authorization boundary. Frontend mirror = `usePlatformAdmin()`
(`src/lib/usePlatformAdmin.js`), used for nav visibility (`requiresPlatformAdmin` in Layout) and a
page self-guard; the server gate is authoritative. (PR #1831.) Set the flag in the Clerk dashboard.

---

## API handler runtimes

Vercel has two runtimes. The handler **shape** must match the runtime — swapping just the
`runtime` flag silently breaks the handler (it either crashes immediately or hangs until the
300s function timeout with no error logged).

### Node runtime (default for most handlers)
```js
export const config = { runtime: 'nodejs' }  // or omit — Node is the default

export default async function handler(req, res) {
  // req.url is path-only — parse with: new URL(req.url, 'http://localhost')
  // req.headers is a plain lowercased object — use req.headers['x-foo'], NOT .get()
  // req.body is pre-parsed JSON — do NOT call await req.json()
  res.status(200).json({ ok: true })
  // NEVER: return new Response(...)  — Vercel ignores it; function hangs 300s
}
```
Rate-limit: `enforceLimit(req, res, bucket)` from `api/_lib/ratelimit.js`.
Reference handlers: `api/content-pieces/*`, `api/media/*`, `api/db/*`.

Required for any handler importing `@sentry/node`, `@clerk/backend`, `@vercel/blob`, or any
`node:*` built-in.

### Consolidated `_routes` vs standalone physical handlers

Most light JSON routes live in `api/_routes/**` and are served by the single consolidated
Express app (`api/index.js`, routed via the generated `_manifest.generated.js`). But
**heavy-render handlers (ffmpeg / `includeFiles` / large uploads / SSE/streaming) MUST stay as
their own physical `api/**/*.js` files — NOT in `api/_routes`.** They win Vercel's filesystem
phase over the `/api/(.*) → /api/index` rewrite, so each gets its own function bundle that
carries the per-function dep (e.g. the `ffmpeg-static` binary). A heavy handler placed under
`api/_routes` would load into the shared function without its bundle and fail at runtime.
Reference: `api/editorial/render-clip.js` and `api/ads/render-video.js` (both import
`renderVideoChannel` → ffmpeg) live outside `_routes` for exactly this reason; the photo
`api/_routes/ads/render-pack.js` (Sharp only) is fine consolidated. Adding a new `api/_routes/*`
file requires regenerating the manifest (`node scripts/build-api-manifest.mjs`, also run in
prebuild); a standalone physical file needs no manifest change.

**Webhook signature verification: read `req.rawBody`, never re-read the stream.** Because every
`_routes` handler runs inside the `api/index.js` Express app, its `express.json({ verify: (req,_res,buf)
=> { req.rawBody = buf } })` middleware has ALREADY consumed the request stream before the handler
runs and stashed the exact signed bytes on `req.rawBody` (the Stripe-webhook pattern). A webhook that
re-reads the body itself (`req.on('data')`/`'end'`, a local `readRawBody(req)` helper, or `await
req.json()`) waits on a stream that has already emitted `'end'` — the promise never resolves, the
function hangs to the 300s limit, and every POST returns **504**. Verify the HMAC against `req.rawBody`
(it's the raw `Buffer` signature functions expect) and guard an empty/missing body → `400`. This bit
both publish-status webhooks: `api/_routes/webhooks/bundle.js` (#1685) and `api/_routes/webhooks/mux.js`
(#1686), each fixed by swapping `readRawBody(req)` → `req.rawBody`. Probe tell: GET→405 fast +
POST→504 = a stream-read hang (not "unconfigured", which is a fast 503); after the fix an unsigned
POST returns 401/400 in well under a second.

**Webhook idempotency: third-party callbacks are at-least-once — guard the whole handler, not just one
write.** Twilio / Stripe / Mux / Clerk / bundle.social all redeliver (or double-fire) callbacks, so a
handler that runs paid work or non-idempotent writes MUST dedup the whole cascade — guarding only one
write is the trap (`twilio-recording.js` guarded just its `content_items` insert while the surrounding
transcription + 2 LLM calls + concept-weight / voice-phrase writes re-ran on every redelivery, double-
billing and double-counting practice-memory scores — #2137 P1). Guard pattern (see
`api/_routes/webhooks/twilio-recording.js` `processRecording`): (1) **fast path** — early-return when
the row is already in its terminal status (the redelivery that lands after processing finished); (2)
**race path** — an atomic compare-and-set claim on the row's status column, `PATCH …&status=eq.<open>`
→ `{status:'<claimed>'}` with `Prefer: return=representation`; under Postgres READ COMMITTED row-
locking exactly one of two near-simultaneous deliveries gets a row back, the loser gets `[]` and bails
before any side effect. Release the claim back to the open status on failure so a genuine re-fire can
retry (mirrors `dispatchContentItem.js`'s `dispatching_at` claim + `releaseClaim`). **No migration is
needed** to introduce a transient claim value IF the status column has no CHECK constraint AND every
reader positive-matches known values (an unknown transient value simply misses their filters) — verify
BOTH before reusing a status column instead of adding a dedicated `*_claimed_at` timestamp. Do NOT
reuse the trigger-managed `updated_at` as the claim marker: the `update_<table>_updated_at` trigger
overwrites it on every write (exactly why `dispatchContentItem` uses a dedicated `dispatching_at`
column rather than `updated_at`).

### Edge runtime
```js
export const config = { runtime: 'edge' }

export default async function handler(req) {  // req is a Web Request
  // req.url is a full URL
  // req.headers.get('x-foo') works
  // await req.json() works
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
```
Rate-limit: `enforceLimitEdge(req, bucket)` from `api/_lib/ratelimit.js`.
Cannot import Node-only modules — the Edge bundler does whole-graph bundling and will choke on
even transitive Node imports (e.g. `ratelimit.js → @clerk/backend → node:crypto`).

### Log diagnostics
`responseStatusCode: 0` in Vercel logs = function crashed or timed out before returning — it
is NOT an HTTP status. Filter on this to find crashes; read the `logs` array for the stack.
Always log `e.stack` (not just `e.message`) in catch blocks — Sharp/ffmpeg/native module
crashes often have empty `.message`.

### `AbortSignal.timeout()` on every external fetch — mandatory

Every `fetch()` call that reaches Supabase REST, an external API (ElevenLabs, Mux, Runway,
Google OAuth, OpenAI Whisper, Buffer, Resend, Stripe, etc.), or any other network resource
**must** carry `AbortSignal.timeout(N)`. Without it, a slow or unresponsive upstream holds the
Vercel function slot open until the 300s wall — burning a slot that could serve other requests.

**Canonical `sb()` pattern** (copy-paste for any new Supabase REST helper):
```js
function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    signal: AbortSignal.timeout(8_000),
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...init.headers,
    },
  })
}
```

**Timeout budgets by call type:**
- Supabase REST reads/writes: 8s (fast, same region)
- `workspaceContext()` cache-miss fetch: 10s (critical path — affects every request)
- `workspaceById()` background fetch: 10s
- Google OAuth token exchange/refresh: 15s
- ElevenLabs, OpenAI Whisper, standard external APIs: 15–30s
- Runway video submit: 30s; poll: 15s; large download: 120s
- Jina AI, import-url fetches: 25s

**The footgun:** the `...init` spread in `sb()` must come BEFORE `headers:`, and `signal:` must
be BEFORE `...init` — otherwise a caller-supplied `signal` or `headers` in `init` can override
the timeout. The pattern above is correct. A 58-round `/auditfull` loop (2026-06-27) found ~25
files missing this timeout; the fix is tracked in PR #1824.

### Background work: `waitUntil()`
A bare floating promise dispatched from a Node handler (no `await`, no `waitUntil`) is not
guaranteed to run. Vercel freezes the instance the moment the HTTP response is sent. Any async
work still pending at that point — embeddings, a late PATCH, an index insert — is silently
dropped.

Rule: any enrichment a handler kicks off but does not `await` before responding must be wrapped
in `waitUntil(promise)` from `@vercel/functions`. If that promise itself fire-and-forgets a
nested step, the nested step must be `await`ed inside or `waitUntil` won't cover it.
Reference: `api/db/interviews.js` + `api/_lib/interviewSummarizer.js`.

Diagnostic tell: if all rows of a derived type share a tight `created_at` cluster, they came
from a backfill, not live writes — the live hook may be silently dropped.

**`maxDuration` bounds the WHOLE invocation, including everything inside `waitUntil` — it is
NOT a separate budget for background work.** Converting a synchronous handler to
respond-then-`waitUntil` does not mean the handler's time cap can shrink to "just cover the
response." The background promise still runs inside the same invocation lifetime, and gets
killed the moment `maxDuration` elapses — silently, with no error, no catch fired, no terminal
write. Hit exactly this in `api/media/tag.js` (2026-07-03): making the manual AI-tagging button
async correctly fixed its 504 (the old bug — the whole download+ffmpeg+Gemini pipeline ran
synchronously before responding), but `maxDuration` was dropped 120 → 30 on the assumption only
the response needed covering. On a 488MB video the background job got killed at the 30s mark,
before it could reach its own `catch` (which reverts status + records an error) — the row sat
in a `'tagging'`-equivalent pending state forever with no error ever surfaced. Fix: keep
`maxDuration` sized for the ACTUAL background work, not the response.

### Verifying a new cron handler before it ships — invoke it directly, don't wait for the schedule

Every `api/_routes/cron/*.js` handler is a plain Node `(req, res)` function gated by
`verifyCronSecret(req)` (Bearer `CRON_SECRET`). That means it can be exercised end-to-end —
real Supabase reads/writes, real third-party API calls — from a throwaway local script, with no
deploy and no waiting for the actual schedule to fire:

```js
process.env.CRON_SECRET = 'local-verify-' + process.pid
const { default: handler } = await import('./api/_routes/cron/<name>.js')
const req = { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }
const res = { status(n) { this._s = n; return this }, json(b) { console.log(this._s, JSON.stringify(b, null, 2)) } }
await handler(req, res)
```

Run with real env (`SUPABASE_URL`/`SUPABASE_SERVICE_KEY`/whatever third-party key, sourced per
the 1Password-mount rules) and it produces the exact same rows the scheduled run would — the
cheapest way to confirm auth, query shape, and any external API call all actually work before
merging, rather than trusting build/lint alone. Delete the script when done. Used to verify
`cron/snapshot-social-posts.js` (PR #2220) — seeded real rows against prod on the first call.

**Why that matters more than it sounds: an explicit PostgREST `select=` list is invisible to
every gate we run.** `cron/auto-reel-week.js` shipped selecting a `workspaces.name` column that
does not exist (the real columns are `display_name` / `app_name`). PostgREST 400s an unknown
select column, so the handler returned `500 workspace fetch failed` on **every invocation from
the moment it deployed** — it never rendered anything. `lint`, `typecheck`, `build`, 300+ tests
and `verify-bundles` were all green, because none of them ever executes a query. Worse, the
route *probed* healthy: an unauthenticated `curl` returned **401, not 404**, which only proves
the handler is deployed and reached its auth check — it says nothing about whether the body
works. Only calling the endpoint for real surfaced it (PR #2232).

Rules: (1) a 401/400 probe proves DEPLOYED, never WORKING — after shipping a cron, invoke it
once and read the response body; (2) `grep information_schema.columns` before writing any
explicit `select=` list; (3) for a small-N query feeding a render path that consumes the broad
`workspaceContext()` shape, prefer `select=*` — an explicit list there is a standing trap where
one newly-required column silently 400s the whole job.

### Long per-item work: persist as each item lands, never batch to the end

Any `waitUntil`/cron loop doing multi-minute work per item (ffmpeg renders, transcodes, LLM
passes) must write each unit's result the moment that unit succeeds. Accumulating results in an
array and doing one insert after the loop means hitting `maxDuration` mid-loop destroys **all**
of them — including the units that already finished successfully.

`reelFactory.fillReelSlots` did exactly this on its first live run: two clips rendered and
created correct `content_items` drafts, then the function was killed at the 300s wall during the
third render, before the batched `content_plan_atoms` insert at the end. The result was two
real, fully-rendered reels that were **invisible on `/week`** (which reads atoms, not items) —
and because their `video_segments` were already flipped to `'rendered'`, nothing would ever
retry them. Silent, permanent orphans, with every gate green and the drafts looking perfect in
the DB.

Pattern: compute any cross-item derived data (here, the even-spread slot times) UP FRONT, then
insert per item inside the loop. Size the batch to the wall too — `MAX_PER_RUN` went 3 → 2
because a render is ~90s on real footage and three sequential renders genuinely raced 300s. Fixed
in PR #2238.

---

## Social-publishing provider adapter (Buffer / bundle.social)

Bernard posts to social + local-listing platforms through a **swappable provider** behind a
thin adapter seam in `api/_lib/social/` — `SocialPublisher` (the interface),
`BufferPublisher` + `BundlePublisher` (the impls), `getPublisher(workspace)` (the resolver).

- **One switch, not feature-wide.** Feature code calls `getPublisher(ws)` and the six
  interface methods (`createTeam` / `connect` / `publish` / `getAnalytics` / `deletePost` /
  `checkConnection`); it never imports a provider SDK. The provider is chosen by
  `workspaces.publish_provider` (`'buffer'` default | `'bundle'`); unknown/absent → Buffer.
- **The provider SDK stays in its adapter.** Only `bundlePublisher.js` imports `bundlesocial`;
  only the Buffer files touch Buffer's GraphQL. Keeps the function graph (and `verify-bundles`)
  clean.
- **Flip a path with a SAFE ADDITIVE branch.** To route a path (publish, analytics) by
  provider, add `if ((ws.publish_provider||'buffer')==='bundle') return handleBundleX(...)`
  *after* the auth check and *before* any Buffer-specific logic, leaving the Buffer path
  BYTE-FOR-BYTE unchanged (the diff should be `+N/-0`). That makes the flip provably safe for
  every Buffer tenant; the "dedup the inline Buffer logic into BufferPublisher" cleanup is
  deferred on purpose. See `api/_routes/publish/buffer.js` (`handleBundlePublish`) and
  `api/_routes/buffer-analytics.js`.
- **The provider scope id is an AUTHORIZATION boundary**, not a parameter. One bundle API key
  reads/posts to every team in the org; derive the bundle `teamId` (or Buffer channel id) from
  the workspace / `workspace_locations` row — bound at adapter construction — NEVER from client
  input. A wrong id is a cross-tenant leak, same blast radius as a missing `workspace_id` filter.

**External-resource ids go stale — self-heal, don't just create-if-absent.** A persisted id
into an external system (`workspaces.bundle_team_id`, OAuth tokens, GBP channel ids) can point
at a resource a tenant deleted out-of-band. A handler that reuses it must recover on the
provider's not-found error, not just create-when-null. Reference: `api/_routes/integrations/
bundle/connect.js` — on a bundle 404 "No team found" it recreates the team and retries once
(`isMissingTeam`). Apply this to any handler that stores and later reuses an external id.

**bundle.social analytics: the non-force response nests metrics in `items[]`, not `post.analytics`
— and only a FORCED read ever advances that history.** Verified live against the real API
(2026-07-09): `analyticsGetPostAnalytics` (no `force`) returns `{ post, profilePost, items: [...] }`
where `items[]` is a time-series array of past forced reads; the metrics are NOT on `post.analytics`
(that field doesn't exist — an earlier guess in `normalizeBundleAnalytics` read it anyway and
silently normalized every non-force call to all-zero). `analyticsForcePostAnalytics` returns the
metrics flat on the root object instead. Consequence: **nothing advances bundle's engagement
history unless something calls `getAnalytics({..., force: true})`** — a plain read just returns
whatever the last force call produced (or nothing, if there's never been one). Force-refresh is
rate-limited to ~5/team/day, shared across every platform on one workspace's brand Team, so don't
force every post daily — `api/_routes/cron/refresh-engagement.js`'s `processWorkspaceBundle` forces
only at post-age checkpoints (1/3/7/30 days) plus a budget-capped one-time catch-up for posts never
pulled, and writes the snapshot even when all-zero (a real reading) so catch-up doesn't re-queue the
same post forever. Any new bundle analytics consumer must pass `force: true` explicitly — the
default is a silent no-op, not a fresh read. The force selection round-robins across platforms
(not a flat `slice(0,N)` in DB order) so one busy platform can't starve the others out of the
per-run budget.

**bundle.social's socialAccount object has NO `status` field — connection health lives in
`deletedAt` / `disconnectedCheckTryAt` / `deleteOn`.** `accountIsConnected()` (bundlePublisher.js)
originally read `account.status` to decide whether a channel counted as broken for the daily
channel-health email (`cron/check-channel-health.js`). Verified live 2026-07-22 — against both the
installed SDK's `TeamGetTeamResponse` type and a real `teamGetTeam` call — that the field does not
exist at all, so the predicate always returned `true` and the alert could never fire, for any
workspace, since it shipped; the unit tests stayed green because they exercised invented status
strings instead of the real shape. The real signals: `deletedAt` (hard disconnect), `disconnectedCheckTryAt`
(bundle's own background disconnect-check has flagged and is retrying the account — gated by
`organization.disconnectCheckEnabled`), `deleteOn` (scheduled auto-removal after a prolonged
disconnect, per `organization.deleteAccountAfter`). Any new health/connection check against a
bundle socialAccount must key off these three fields, not a status string — same class of bug as
the analytics `items[]`-vs-`post.analytics` gotcha above: an assumed field shape that silently
no-ops instead of erroring, caught only by a live call, not by review or tests written against the
assumption.

**Instagram must be connected via the DIRECT method or per-post analytics 400 forever.**
`BundlePublisher.connect()` pins `instagramConnectionMethod: 'INSTAGRAM'` (+ `forceBrowserOAuth: true`)
on the portal link whenever Instagram is among the requested networks. The Facebook-linked method
(`instagramConnectionMethod: 'FACEBOOK'`) posts fine but every
`analyticsGetPostAnalytics({platformType:'INSTAGRAM'})` returns a 400 "not available" — including for
plain single-image posts, so the error's "carousel/story" wording is a red herring; carousels work
under the direct method (confirmed live 2026-07-11). **Guard those two fields to IG-only** — the
per-location GBP connect calls `connect({networks:['gbp']})` and must not receive Instagram-only
params. A bundle 400 on IG analytics is now classified as structurally unavailable and written as a
sentinel snapshot (`stats.unavailable=true`) so the UI shows "not available" instead of a phantom 0,
and catchUp stops re-forcing it. Old posts published under a prior connection are orphaned (the direct
reconnect mints a new account `externalId`) and can't be retro-linked.

**Core publish execution is reusable — call it, don't re-derive it.** `api/_routes/publish/
buffer.js` exports `runBufferPublish({ workspaceId, token, platform, content, mediaUrls,
scheduledAt, useQueue, locationIds, locationContents })` and `runBundlePublish(workspace, {...})`
— the channel-resolution + fan-out logic with the HTTP req/res stripped off, returning
`{ status, body }`. Both the original `/api/publish/buffer` handler and
`api/_routes/producer/retry-publish.js` call these directly. Any future caller that needs to
(re)publish a `content_items` row (retry, a resend action, a cron) should call these, not
duplicate the GraphQL/SDK sequence. GBP fan-out note for such callers: `content_items.
location_overrides` is populated for **every** active GBP location at draft time
(`buildGbpLocationVariants`), so `Object.keys(item.location_overrides)` already equals what
`resolveGbpChannelIds`/`resolveBundleGbpTargets` default to when `locationIds` is omitted —
safe to pass either way. What is NOT persisted anywhere on the row: a human narrowing a
multi-location GBP publish down to a subset at publish-click time (that's ephemeral Review-
picker UI state) — a retry/resend of such a post re-targets every active location, not the
originally-picked subset.

**Every interactive publish of a `content_items` row takes the SAME `dispatching_at` claim, or
two paths double-post it.** `content_items.dispatching_at` is a cross-path mutex shared by all
three interactive publish paths — `/week` Approve (`dispatchContentItem`), the editor Publish/
Schedule button (`handleBundlePublish`), and manual Retry (`retry-publish`) — each of which calls
`claimDispatch(pieceId, wsId)` from `api/_lib/dispatchClaim.js` before dispatching. It's an atomic
conditional PATCH (`dispatching_at IS NULL OR < 5-min-stale`); Postgres serializes it, so exactly
one caller gets the row back and publishes while every other gets 0 rows → bails without posting.
On success, `releaseDispatch(..., { status: 'scheduled'|'published', … })` commits the terminal
status **in the same release PATCH** — releasing to a still-`approved` row would leave a window a
concurrent path can re-claim and re-post into before the caller's own status write lands. Any NEW
caller of `runBundlePublish` / `BundlePublisher.publish()` on a persisted piece MUST take this
claim (grep those primitives + `runBufferPublish` — the "enforced at every publish path" rule).
**Two lock domains, bridged by the cron:** the interactive paths lock
`content_items.dispatching_at`; the auto-publish cron (`cron/auto-publish.js`) claims
`story_packages.auto_published_at` + per-location `published_channels` (it dispatches from
packages, not content_items) — and it ALSO takes the shared `dispatching_at` claim on the
package's GBP `content_items` row before its dispatch loop, so a concurrent human "Publish now"
on that same row can't double-post it. A new publish path picks the domain matching what it
iterates, and must additionally take the content_items claim whenever a row it dispatches is
also reachable interactively. (audit P1, 2026-07-15 — the editor + retry paths originally
skipped the claim, so a concurrent Approve + Publish double-posted the piece to the customer's
live channel; audit P2 same date — the cron originally never touched `dispatching_at`.)

**The words-approval hard gate covers SIX dispatch paths — and package content is a documented
exception to its interview check.** `checkWordsApproved` (`api/_lib/wordsApprovalGate.js`) is
called by every path that sends a `content_items` row to a live channel: `publish/buffer.js`
(both provider paths), `publish/website.js`, `publish/beehiiv.js`, `producer/retry-publish.js`,
`_lib/dispatchContentItem.js`, and the auto-publish cron (`cron/auto-publish.js`). Rows sourced
from Moment-Miner story packages (`editorial/approve-package.js`) carry `interview_id: null`,
which the gate deliberately passes through — for that pipeline, **package approval IS the human
words checkpoint** (the approver sees the exact caption + renders, on top of the autoPublishGate
voice-fidelity/similarity/consent/QC signals), so there is no parent interview to gate against.
The cron still calls the gate so any future interview-linked lineage is enforced automatically.
Related invariant: the cron requires the package's GBP `content_items` row to EXIST and still be
`approved` before dispatching — a package approved with `destination='library'` has no
content_items row and must never auto-publish (audit follow-up, 2026-07-15).

---

## Router conventions (App.jsx)

The outer `<Routes>` in `src/App.jsx` has this shape intentionally:

```jsx
<Route path="/privacy" element={<PrivacyPolicy />} />
<Route path="/terms" element={<TermsOfService />} />
<Route path="/onboard" element={<OnboardingShell />} />
<Route path="*" element={<ProtectedAppWithProvider />} />
```

Every authenticated route — including deep paths like `/onboard/interview` — flows through the
`*` catch-all. **Do not add explicit fixed-path outer routes** like
`<Route path="/onboard/interview" element={...} />`.

React Router v6 footgun: a fixed-path parent (no `/*` splat) consumes the full URL. The
descendant `<Routes>` then matches against the empty remainder, and an inner `<Route path="/">`
(Home) matches — so the page silently renders Home at the wrong URL. The `*` catch-all sidesteps
this because `*` is a splat: the matched portion is empty, so descendants see the full URL.

If you genuinely need an outer exemption (to bypass `WorkspaceProvider` or `OrgGate`), use
`<Route path="/your-path/*">` with the splat.

---

## Loading states — no empty/blank flash

Three layers between a click and rendered content; each must show a content-shaped skeleton, never
blank or the empty/zero layout. (PRs #1835–#1837.)

1. **Code-chunk load** — the in-app routed `<Suspense>` in `src/App.jsx` (inside `<Layout>`) uses
   `fallback={<PageSkeleton />}`, NOT `fallback={null}`. A null fallback flashes blank on the first
   visit to each lazy page.
2. **Data load** — gate a page's first render on its PRIMARY query's `isPending` with the shared
   **`src/components/PageSkeleton.jsx`** (variants `dashboard|list|grid|detail`):
   ```jsx
   const { data = {}, isPending } = useThing()
   if (!roleLoading && !isEditor) return <Navigate to="/" replace />  // existing guards first
   if (isPending) return <PageSkeleton variant="dashboard" />          // AFTER all hooks (rules-of-hooks)
   ```
   Place the gate after ALL hook calls and after any role-guard early returns. Without it the page
   renders its `= []`/`= {}` defaults (empty state) during load, then pops to content.
3. **Param-driven refetch** (week steppers, filters that change the query key) — add
   `placeholderData: keepPreviousData` to the hook so changing the param keeps the prior result
   on screen (dim via `isFetching`) instead of skeleton-flashing each step. See `useWorkspaceUsage`.

Auth is NOT a flash source: `OrgGate` already blocks page render until the Clerk org-token carries
`org_id`, so queries don't fire pre-auth. Do not add an `enabled: authReady` gate — redundant.
Pre-existing good examples: `Home.jsx` (`HomeSkeleton`), `MediaHub.jsx` (`MediaGridSkeleton`).

---

## Supabase / migrations

Migrations live in `supabase/multitenant/migrations/`. Apply with:
```
node scripts/apply-multitenant-migrations.mjs <file.sql>
```
There is no migration tracker — the script applies whatever file you pass. Filename ordering is
informational only. Verify a column exists on prod before merging code that references it:
```sql
-- in Supabase Studio SQL Editor
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = '<table>';
```

**Every migration must include `GRANT … TO service_role`** in the same file:
```sql
CREATE TABLE public.foo (...);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.foo TO service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;
```
Handlers run as `service_role` via the PostgREST REST API; unprivileged objects return 403 /
SQLSTATE 42501.

**Status columns have CHECK constraints.** Adding a new status value without a migration
produces a generic `db_error`/500. Grep `<table>_status_check` in migrations to find the
constraint; add `DROP CONSTRAINT / ADD CONSTRAINT` in the same migration as the code that uses
the new value.

**Prototype aggregate SQL before writing migrations.** For non-trivial GROUP BY or window
functions, run the SELECT against a real workspace_id via the Supabase MCP `execute_sql` first.
`CREATE OR REPLACE FUNCTION … GRANT EXECUTE … TO service_role` is idempotent — running it via
`execute_sql` IS the apply step.

### Staff FK cascade rules
`staff.id` is a foreign key in 12 tables; 5 are `ON DELETE CASCADE` (`content_items`,
`interviews`, `practice_memory_chunks`, `staff_recipes`, `staff_voice_phrases`). There is also
a denormalized `campaigns.target_staff_ids` (`uuid[]`). Deleting a staff row with cascade
children silently destroys that data.

Before any staff delete or merge: count children across all 12 tables, repoint every FK to the
surviving row, then delete. Use the atomic `merge_staff(source, target, workspace)` SQL function
(migration 112) rather than hand-rolled deletes — it repoints all 12 FKs and the campaigns
array, blocks cross-workspace merges, and de-dups the 3 child tables with unique indexes.

---

## Blob store

All production media lives in a single Vercel Blob store attached to the `bernard` Vercel project.

Path conventions (always use `ws.id`, never `ws.slug` — slugs are mutable):
- Thumbnails: `media/thumbs/<uuid>.jpg`
- Originals: `media/raw/<workspace-id>/...`

**Large-file downloads must stream to disk**, not buffer with `arrayBuffer()`. `arrayBuffer()`
materializes the full file in RAM and OOMs on anything over ~500 MB:
```js
import { createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const r = await fetch(blobUrl)
if (!r.ok) throw new Error(`download failed: ${r.status}`)
await pipeline(Readable.fromWeb(r.body), createWriteStream(localPath))
```
Reference: `api/_lib/thumbnail.js`, `api/_lib/tagAsset.js`.

---

## Async pipeline patterns

### Polling: hard cap is universal
Any `useQuery` with a `refetchInterval` that polls while a pipeline status is pending MUST have
a time-based hard cap. A Vercel function killed at the 300s wall does not run its `finally`
block, so `catch`-based terminal status writes never fire — any "in-progress" status can strand
permanently. The canonical pattern:

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
Reference: `src/components/MediaDetail.jsx`. Page-level polling (Slate packages, ClipFinder
segments) must apply the same pattern with an appropriate ceiling (60 s–5 min depending on job
duration).

**Any client action that flips a row into a pending state server-side must explicitly
`refetch()` the polling query right after — the query will NOT notice on its own.**
`refetchInterval` decides whether to keep polling by reading its own cached `q.state.data`, not
the response of whatever mutation just fired. If a button POSTs to kick off background work and
the row's `status` flips server-side, but nothing tells the query to look again, the next
`refetchInterval` evaluation still sees the pre-click cached data and may conclude nothing is
pending — so it never starts polling, and the eventual result (success or failure) is silently
missed even though the backend finished normally. Hit this in `MediaDetail.jsx`'s "Tag with AI"
button (2026-07-03, follow-up to the `maxDuration` bug above): the backend tagged the asset
correctly, but the spinner never resolved because the kickoff never called the query's
`refetch()`. Fix: call `refetch()` (destructured from the same `useQuery`) immediately after the
kickoff request resolves, so the very next evaluation sees the fresh pending status.

### Pipeline-transient status values must not round-trip through editable form state
A row's `status` column can legitimately hold values the server sets itself and that never
appear as a user-selectable option — e.g. `media_assets.status = 'tagging'` while AI tagging is
in flight (see `pipelinePending()` above). If a detail-drawer's editable `status` field is seeded
directly from `asset.status` on load (`useState(asset.status || 'raw')`), it can end up holding
that transient value with no matching UI chip selected — and if the user (or an autosave) fires a
save while it's still in that state, the transient value gets sent back verbatim in the PATCH
body. A backend allowlist that (correctly) rejects pipeline-only values then 400s with a generic
error that looks like an unrelated validation bug. Fix: when building the save payload, only
forward a field's value if it's one of the values the UI actually lets the user pick — filter
against the same `STATUSES`-style constant the chips render from — rather than trusting whatever
local state happens to hold; consider also disabling Save while the pipeline-only state is live so
the race can't be hit at all. Hit in `MediaDetail.jsx` (2026-07-21, PR #2233): saving while "Tag
with AI" was still running sent `status: 'tagging'` and 400'd with "Invalid status" — same
symptom, different cause, from an earlier same-day fix (#2226) that widened the allowlist for the
user-selectable statuses but didn't account for the transient one leaking through.

### Preview ≠ published artifact
When a feature renders something to a `<canvas>` or any in-memory/preview-only surface, that is
NOT evidence the same artifact ships at publish/export. The render and the publish are different
code paths. Before shipping any feature that renders a derived artifact (overlay image, composited
graphic, baked text), grep the renderer's callers — if it is called only in `*Preview` /
`*Editor` components and never in a publish/upload/export path, the published output is raw.
The renderer needs a real produce-and-upload step on the publish path reusing the SAME renderer
so it stays WYSIWYG.

### `interviews.messages` contract — alternating role turns, and consumers that can't assume it
Most downstream consumers of an interview's transcript — `api/_lib/interviewStyleClassifier.js`
(`buildTranscript`, filters `role === 'assistant'`), the clinician-turn extraction feeding
`extractVoicePhrases` (filters `role === 'user'`), `summarizeInterview`, and the RAG indexer —
assume `messages` (and `cleaned_messages`) is an array of alternating `{role, content}` turns, one
per speaker exchange. That assumption doesn't always hold: a capture path can legitimately only
produce a single mixed blob (e.g. `transcribeCallRecording` in `api/_lib/callTranscript.js` falls
back to one combined turn when the dual-channel audio split fails or a channel transcribes empty —
there's no way to attribute who said what after the fact). The fix for that case is NOT to force
the fallback into a fake alternating shape; it's to make the capability explicit (`dualChannel:
boolean`) and have every role-sensitive consumer branch on it, skipping enrichment it can't
honestly do rather than silently mis-attributing content. When adding a new transcript-capture
path, check whether it can guarantee real per-speaker turns — if not, thread through an explicit
flag rather than tagging a combined blob with a role that looks legitimate to downstream filters.

---

## Streaming chat

All conversational pages use `/api/stream` via `streamMessage()` in `src/lib/claude.js`.

**1. Inject a silent first-turn user message.** Claude API requires at least one user message.
A system-only request returns `AI_InvalidPromptError` immediately:
```js
const streamInput = currentMessages.length === 0
  ? [{ role: 'user', content: 'Please begin the interview.' }]
  : currentMessages
```
The seed message is sent to the stream only — never add it to the visible transcript or persist it.

**2. Guard the kickoff `useEffect` with a one-shot ref.** Without it, a stream failure clears
`streaming` while leaving `messages.length === 0`, and the effect re-fires on every render —
producing a ~10 rps hammer on `/api/stream` until the tab closes:
```js
const kickedOffRef = useRef(false)
useEffect(() => {
  if (loading || streaming || messages.length > 0 || kickedOffRef.current) return
  kickedOffRef.current = true
  runAssistantTurn([], { isFirstMessage: true })
}, [loading, streaming, messages.length, runAssistantTurn])
```
Reference: `src/pages/InterviewSession.jsx`.

**3. Gate post-completion synthesis on the PERSISTED status, not local state.** Interview pages
that auto-fire a synthesize POST when the interview completes must wait for the `status:'completed'`
PATCH to *land* first — firing off the local `completed` flag races the write, and the synthesize
handler loads the row still `in_progress` and 409s (`interview_not_synthesizable`). Set a separate
`synthReady` flag only AFTER `await persist(..., 'completed')` resolves, and trigger synthesis off
that. Belt-and-suspenders: on a 409, re-assert `completed` and retry the POST once. This bit the
brand-discovery interview (#1828); the onboarding interview shares the shape and only avoids it by
timing luck. Also invalidate `queryKeys.workspace.me` after synthesis writes to the workspace, or
the Settings surface shows stale (empty) data until a hard reload. Reference: `src/pages/BrandInterview.jsx`.

---

## Server-side image compositing

The photo compositor (`api/_lib/brandRender.js`, `api/_lib/whoopTemplates.js`) is pure
server-side Sharp + SVG. It is baked into `content_items.photo_treatment` / `media_urls` by
`api/editorial/compose-photo.js`.

**Verify render/transform code locally with a node harness** — these functions take a workspace
object + a source URL and return a JPEG buffer; they have no Clerk dependency. Write a throwaway
`node` harness that renders every template variant to `/tmp/*.jpg` and inspect the files. Don't
ship SVG/Sharp changes blind on "gates are green" — gates don't look at pixels.

**SVG collapses whitespace at `<tspan>` boundaries.** Multi-color text rendered as inline
`<tspan fill=…>` runs inside one `<text>` drops the space between runs (e.g. `isn't the` →
`isn'tthe`). Fix: add `xml:space="preserve"` on the `<text>` element.

**Client canvas renderer (`renderFreeformSlide` in `src/lib/overlayTemplates.js`) cannot be
node-harnessed** — it uses `document`/`window`. Verification is post-deploy in Chrome only.
This means subjective design sign-off for canvas changes requires a mockup, not a deploy-to-look
loop. When the acceptance criterion is "looks right" and you are on the second ship-and-eyeball
round on the same surface, stop and build an HTML mockup for Q to approve first.

## Running a multimodal model over source video — sample frames, never transcode a clip

To have a model "watch" a clinical source video (F13 visual scoring/nomination; F17 read-back
verification), the ONLY viable path is `api/_lib/analyzeVideoWindow.js` — sample a handful of
stills via ffmpeg **fast input seeks** (`-ss T -i URL -frames:v 1`) and send the JPEGs as image
parts to Gemini (`google/gemini-2.5-pro`, via the AI Gateway — same path as `tagAsset.js`, no new
SDK). Two hard constraints learned on real footage, both non-obvious:

- **Never download the whole source.** Real footage is multi-GB 4K (a movebetter seminar is 3.3GB);
  a `fetch` of the whole blob just `terminated`. ffmpeg reads the blob URL over **HTTP range
  requests** and pulls only the bytes it needs — the same trick `segmentDetect.js` uses for audio.
- **Never transcode a clip.** Decoding 4K to encode even a 20s 720p proxy runs **~8× slower than
  realtime** (2m45s for one 20s window) — intractable in a node harness AND a 300s function.
  Keyframe-skip (`-skip_frame nokey`) made it *worse*. A single-frame input seek returns in **~3s
  regardless of source size** because it decodes ~1 frame. So sample N stills (6 for a window,
  `sampleFramesAcross` for a whole-source scan with a concurrency pool), not a video. Stills read
  eye-contact/framing/gesture/scene well; energy is the one dimension they read weaker than motion.
  `media_assets.web_blob_url` (a would-be low-res proxy) is **never populated** — don't rely on it.

Pure scoring/transform code with no Clerk dependency → **verify with a node harness against a real
blob URL** (same discipline as the Sharp compositor above): pull a real source + its
`video_segments` from prod via the service key, run the scorer, print the result. Cost is real but
cheap (~$0.10/video at Gemini 2.5 Pro + 6 frames) — **log per-video cost** and, for any bulk
re-score, log the count + total (no silent spend). The Chrome screenshot tool returns **blank
frames at deep-scroll positions** in long/virtualized feeds (the moment feed) even though the DOM
is present — don't chase a render bug; verify the rendered result via a **DOM assertion**
(`getBoundingClientRect`, computed styles, element text), which is the more precise check anyway.
Refinement (2026-07-08): you can't render pixels in node, but you CAN verify the draw-path
*logic* — stub `globalThis.document`/`window` and pass a mock 2D `ctx` (record `fillText`/`fillRect`
calls + the current `font`/`fillStyle`, approximate `measureText` as `len * px * 0.5`) into
`renderFreeformSlide({ sourceUrl: null, canvas })`. This confirmed per-word runs (distinct fonts/
sizes/colors) and `ctx.letterSpacing` for the P1/P3 text-styling work without a browser. `document.
createElement` is only hit when `canvas` is omitted, and `loadImage` only when `sourceUrl` is set —
pass a mock canvas + `sourceUrl:null` to avoid both. Guard: `drawFreeformBlock` bails on empty
`block.text`, so a runs-only harness block must still set `text` to the plain concatenation.

**A slide text-styling field must be added in FOUR coordinated sites or it silently fails to bake
or re-render.** The on-canvas text pipeline (per-block AND per-word `runs`) has one renderer shared
by editor preview + client publish-bake, but the *plumbing* around it is spread out. When you add a
new block/run style dimension (this session: per-word `font`/`sizeScale`/`bold`/`italic`/`underline`/
`strike`/`case` runs, and whole-box `letterSpacing`/`lineHeight`/`shadow`), touch all of:
1. **Renderer** — `overlayTemplates.js`: `blockStyleOf` (extract from block) + `roleTypography`
   (apply/override) + the draw path. Per-word style gates on `hasRunStyle(runs)` (any override, not
   just `color`) and renders via `wrapRichRuns`; a colour-only run must stay byte-identical to the
   pre-rich path (default runs inherit the block typo).
2. **`sanitizeSlide`** (`SlideEditor.jsx`) — whitelist the new field, or it's stripped on persist.
3. **Editor `renderKey`** (`SlideEditor.jsx`) — hash it, or the preview canvas won't re-render.
4. **`slideSignature`** (`renderSlides.js`) — hash it, or the cached `rendered_url` stays stale and
   the wrong pixels publish.
Miss #2/#3/#4 and gates stay green while the feature is invisible or unshipped. Corollary: `runs` is
the single WYSIWYG source of per-word style — BOTH text editors (the on-canvas `RichTextEditOverlay`
and the side-panel `BlockRow`) must serialize the SAME shape via the shared `serializeRichCE`/
`richRunsToHTML`; a narrower serializer in one editor silently drops the dims it doesn't understand
when the user edits there (the colour-only `serializeCE` clobber, #2001).

**Brand colors live in the `workspaces.brand_style` JSONB — NOT a `brand_kit_style` column**
(that column does not exist; the BrandKit "Style" `style` object maps to `brand_style`). Shape:
`{ primary_colors: [], secondary_colors: [], accent_color, suggested_palette: [], heading_font,
body_font }`. `useWorkspace()` exposes the row, so the full palette is available client-side.
Reading the wrong path silently yields only the accent (everything else is `undefined`) — this
bit the photo-template swatches + AI generator in 2026-06-20 (#1462). One derivation feeds every
surface: `src/lib/brandSwatches.js` exports `brandSwatches()` (picker chips), `brandInk()`
(darkest palette color) and `brandPaper()` (lightest); the renderer has the SAME `brandInk`/
`brandPaper` over `brandStyle`. **Template grounds are brand-derived, never hardcoded** — a
"dark" template renders on `brandInk` (the workspace's darkest brand color), "light" on
`brandPaper`, with the old WHOOP navy/paper/sage only as fallback when a workspace has no palette.
Don't reintroduce a hardcoded ground color; route it through `brandInk`/`brandPaper`.

## LLM-generated structured data — never trust echoed ids/values

When an LLM call returns structured output (`generateText`/`generateObject`) whose fields you
then use in a DB write or a PostgREST filter — especially an **identifier you asked the model to
echo back** — do NOT trust it verbatim. The model can silently corrupt it: the F2 Strategist asks
the LLM to return `interview_id` per candidate, and a run injected a space mid-uuid
(`…2af b1de5aa4b`), which 400'd the `content_plan_atoms` insert. Worse, the writer didn't check
the POST result, so the whole workspace's plan **silently failed to persist** (the first cron run
got lucky and masked it).

Rule (see `api/_lib/strategist.js` `composeWeeklyPlan`): **normalize then validate against
known-good inputs** — strip whitespace from the echoed id and require an **exact match to a real
input** (`new Set(interviews.map(i => i.id))`), dropping anything that doesn't match. This repairs
corruption AND blocks invented/hallucinated ids. And **check `res.ok` on the write** (`persistPlan`
throws on a failed insert) so the caller's fallback/logging fires instead of swallowing it. This
extends the existing "validate every query param with `UUID_RE` before interpolating" rule to
LLM-echoed values, not just request params.

## Prompt-building — an unguarded `${workspace.field}` becomes literal text the model obeys

Interpolating a workspace field straight into an LLM system prompt (`atomPrompts.js`'s per-platform
`instructions` templates) is a different risk class than interpolating it into a DB query or a UI
string: if the field is `undefined`, the model doesn't error or render a blank — it receives the
literal instruction *"Include the full URL undefined on its own line near the end"* and, being a
good instruction-follower, writes "undefined" as its own line/paragraph in the generated caption.
The bug is invisible in code review (a template literal with a missing value looks identical to one
with a present value) and only surfaces in the model's output.

This bit hardest at the exact seam `atomPrompts.js`'s own comments warn about: `draftAtom.js` is
shared by **two callers** — the interactive `content-plan/draft.js` route (fetches the workspace via
`workspaceContext(req)`, which selects `*`) and the Standing Producer's pre-draft cron
(`agent-tick.js`, which hand-lists a `select=`). `agent-tick.js` already had a comment noting
*"audience_options + story_type_options... the pre-draft path must select them too or the two
callers diverge"* — and it still missed `website`, because that field wasn't part of the specific
divergence someone had already hit and fixed. A comment documenting one instance of the pattern is
not proof every field was audited.

Rule: (1) any `${workspace.<field>}` interpolated directly into prompt text sent to an LLM needs an
explicit fallback (`workspace.location_hashtag ?? '#physicaltherapy'` is the pattern already used
for two fields in this file — `website` was the one field that had none); (2) when a core generation
function is shared by an interactive route (`select=*`) and a background/cron path (a hand-written
`select=`), don't trust a prior "make sure both paths select the same fields" comment — grep the
downstream function (and everything it calls) for every `workspace.*`/`ws.*` read and confirm each
one is either in the cron's `select=` or has a safe fallback. (2026-07-08, PR #2000: `website` was
missing from `agent-tick.js`'s `select=`, so `getAtomSystemPrompt`'s facebook/linkedin/gbp templates
rendered `${workspace.website}` as the string `"undefined"`, which the model dutifully wrote into
four live captions across one pre-draft batch before a human review caught it.)

**`draftAtom`'s `angle` param is a fixed per-platform enum key, not free text — the prompt SUBJECT
comes from `interview.topic`, not `angle`.** A third caller of `draftAtom` (F20, `draftOnTopic.js`,
PR #2073/#2077) synthesized an ad-hoc atom by setting `atom.angle` to a human-typed topic string,
reasoning "angle sounds like the framing the user wants." It doesn't — `angle` looks up a specific
key in `atomPrompts.js`'s `instructions[platform]` object (e.g. instagram only has
`hook`/`quick_win`/`clinical_insight`/`cta`), and any other value throws `"No prompt defined for
<platform>/<angle>"`. This shipped and passed every static gate (lint/typecheck/build/bundle-smoke)
because the value is just a string at that layer — it only surfaces at runtime, on the actual
`generateText` call. Caught by the prod smoke test (per `CLAUDE.md`'s standard verification
procedure), not by any automated check. Rule: before adding a **third** (or Nth) caller of a shared
generation core, don't infer a parameter's semantics from its name — grep the function's body for
where that parameter is actually consumed downstream (here: `getAtomSystemPrompt`'s
`instructions[platform][angle]` lookup) and confirm it accepts the kind of value your new caller
intends to pass, especially for any param that reads like free text but is secretly a fixed
vocabulary.

## AI SDK v6 — `maxOutputTokens`, not `maxTokens`

AI SDK v6 (`generateText`/`generateObject`) uses `maxOutputTokens` to cap the completion length.
`maxTokens` is silently ignored (not an error, not a warning) — the call succeeds but uses the
model default, which can be much larger than intended. Any handler that calls `generateText` with a
token budget should use `maxOutputTokens`. Grep check: `grep -rn "maxTokens:" api/` should return 0
— if it returns any (other than `max_tokens` in JSON bodies), revert them to `maxOutputTokens`.

## Model provider — all Claude calls go through the Vercel AI Gateway

Production has **no `ANTHROPIC_API_KEY`**. Every Claude call routes through the **Vercel AI
Gateway** via `AI_GATEWAY_API_KEY`, using plain `'anthropic/<model>'` strings (e.g.
`anthropic/claude-sonnet-4-6`, `anthropic/claude-haiku-4-5`). This holds for `/api/stream`, every
`generateText`/`generateObject`/`streamText` handler, and the offline backfill scripts — those
fall back to a raw `ANTHROPIC_API_KEY` only when the gateway key is absent, a local-dev path that
never runs in prod. There is no `@ai-sdk/anthropic` direct wiring and no BYOK provider key plumbed
into the gateway.

**The only consumer of a raw `sk-ant-…` key is CI**: the `pr.yml` review job
(`anthropics/claude-code-action@beta`) reads the `ANTHROPIC_API_KEY` GitHub Actions secret on
`Move-Better/Bernard`. So rotating or deleting the Anthropic key affects **only the PR-review
job** — never the live app. (Confirmed 2026-06-28: the legacy Anthropic key was deleted and prod
Claude kept serving; the migration to a dedicated "Bernard" Console workspace + key required no
Vercel change.)

**Smoke the gateway → Anthropic path with no auth and zero tenant writes** via the public
`POST /api/demo/generate` endpoint (body `{ text, topicId }`, `topicId` ∈ `story|faq|insight`). It
uses the same `AI_GATEWAY_API_KEY` + `anthropic/claude-sonnet-4-6` path but has no
`workspaceContext`/Supabase, so a `200` + streamed text proves the gateway is healthy. From a
browser console on any `*.withbernard.ai` host:
```js
const r = await fetch('/api/demo/generate', { method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ topicId: 'insight', text: 'short clinical note' }) })
// r.status === 200 and r.body streams SSE text-deltas of real generated copy
```

## How `/week` gets populated — the Strategist drip model

`/week` (YourWeek.jsx → `GET /api/content-plan/week-summary`) renders ONLY `content_plan_atoms`
where `plan_week = mondayOf(now)` AND `scheduled_at IS NOT NULL`. Atoms become visible there
through the **Strategist**, never directly. The lifecycle is deliberately metered, and the
gotchas below cost a full session (2026-06-21) when `/week` read empty despite 160 planned atoms:

- **An interview generates a full plan of atoms (`buildPlanRows`), all at `status='pending'`.**
  Pending ≠ generated and ≠ visible. The caption is only generated (LLM) on demand when you open
  the atom in `/week` and hit Draft (`/api/content-plan/draft`), which creates the `content_item`
  and flips the atom to `drafted`. There is no batch "generate everything" — by design.
- **`plan_week`/`scheduled_at` are stamped by the Strategist, not by `buildPlanRows`.** A freshly
  planned atom has `plan_week=NULL, held_at=NULL, scheduled_at=NULL` → invisible to `/week` AND to
  the backlog. To enter the drip it must be **banked as backlog**: `held_at=now`,
  `planned_by='strategist'`. (Legacy per-interview "grid" atoms have `planned_by=NULL` and were
  never banked — they surface nowhere now that `/storyboard`/`/publish`/`/needs-media` all redirect
  to `/week`.)
- **`replanWorkspaceWeek` (`api/_lib/strategistPlan.js`) is the only thing that promotes backlog
  into a week.** It runs on every interview completion (`db/interviews.js`) and via the weekly cron
  backstop (`/api/cron/weekly-plan`). `allocateToCadence` promotes backlog FIFO up to each channel's
  `cadence_policy.channels[ch].target_per_week`, and `assignSlots` stamps `scheduled_at` (spread
  across non-quiet weekdays at per-channel best hours; `BEST_HOUR[platform] ?? 11`). So the backlog
  drains ~`sum(target_per_week)` atoms/week — a deliberate drip, not a dump.
- **The cron silently no-ops for a workspace with no fresh interviews that week UNLESS it composes
  from backlog.** The original `replanWorkspaceWeek` bailed `skipped:'no-interviews'`, so a workspace
  whose captures predate this week never got a plan even with a full backlog. Fixed: it now proceeds
  when interviews OR backlog is non-empty (#1567). When debugging an empty `/week`, check in order:
  (1) are there atoms with `held_at` set (backlog exists)? (2) does the READ boundary match what you
  expect? `/week`'s read side (`week-summary.js` `nowMonday` + the client `weekMondayDate`) is now
  tz-aware — `mondayOf(now, ws.cadence_policy.timezone)` resolves "this week" at the workspace's LOCAL
  midnight (#2138), so it no longer jumps to next week during the Sun-PT-evening/Mon-UTC gap. The WRITE
  side (the Strategist stamping `plan_week`) still uses bare `mondayOf(now)` UTC — coherent, since the
  weekly cron fires ~Mon-00:00 UTC and its stamp shows under the board's "Next week" until local
  midnight promotes it. (3) did a replan run for that week?
- **Cadence is COMPUTED from `enabled_outputs`, not a hand-maintained list (Auto mode, the default).**
  `cadence_policy.provenance` selects the source. In **Auto** (`provenance !== 'user'`, the default),
  `getWeekInputs` (`strategistPlan.js`) computes the per-channel cadence at plan time as
  `computeAutoCadenceChannels(enabled_outputs, prior)` (`api/_lib/cadenceDefaults.js`) — so every
  enabled output that maps to a cadence-bearing atom platform automatically gets a `target_per_week`.
  The **prior** is `app_config.cadence_defaults` (migration 142) — a DB row (posts/wk per atom
  platform), editable without a redeploy, NOT a code constant. In **Manual** (`provenance === 'user'`)
  the stored `cadence_policy.channels` is authoritative and a channel must be explicitly present to drip.
  - **Cadence keys are ATOM PLATFORMS, not `enabled_outputs` ids.** `enabled_outputs` splits Instagram
    into `instagram_post`/`instagram_reel`/`instagram_story`; the atom plan (and thus cadence) collapses
    post+reel into one `instagram` bucket (`instagram_story` stays separate) via
    `atomPlatformsFromEnabledOutputs` (`api/_lib/atomPlan.js`). The settings UI mirrors this mapping;
    keep `CADENCE_PLATFORMS` (me.js) ⊇ the prior's keys or a computed channel is dropped on save.
  - Non-atom channels (blog/email/youtube/ads/landing_page) have no prior entry and are never given a
    weekly atom cadence — they're digest/single-output governed.
  - **`workspace/me.js`'s `sanitizeCadencePolicy` REBUILDS `channels[platform]` from scratch on every
    client save** — `{target_per_week, enabled}` only, nothing else survives. Any extra key nested
    under `cadence_policy.channels[platform]` (a per-channel metric, a flag) is silently dropped the
    next time Settings → Channels saves. Server-computed data that isn't a user-editable per-channel
    setting therefore belongs at the TOP level, not nested under `channels[platform]` — see
    `day_time_proposal`, `day_time_dismissed`, and `trust_metrics` (T4 learning loop, #2222–#2228).
  - **Top-level keys are preserved only because the sanitizer now seeds from the STORED row.** It did
    not always: `out` was seeded from the incoming value alone (`out = {...value}`), so the
    "unknown top-level keys are preserved" guarantee this doc asserted was false — ANY writer that
    PATCHed a `cadence_policy` it had built without a key silently DELETED that key, with a 200
    response and no error. It ate `formats` (the Reel target + voice) within hours of shipping, when a
    sibling settings save that knew nothing about `formats` wiped it off movebetter; every T4 top-level
    key was exposed the same way. Fixed in #2255 — `sanitizeCadencePolicy(value, existing)` merges the
    incoming object OVER the stored policy, so an omitted top-level key is carried forward and only a
    key the client actually sends replaces. `channels` is still rebuilt wholesale inside its own block.
    Note this class of bug is invisible to every gate: the write succeeds and the loss only surfaces
    whenever something next reads the key.
  - This fixed the long-standing bug where Facebook + Instagram Story were enabled-as-output but got
    `0`/disabled cadence (the old hardcoded instagram/linkedin/gbp trio). Phase 2 (engagement-tuned,
    per-tenant cadence from `engagement_snapshots`) is SHIPPED in `api/_lib/cadenceAdaptive.js` and
    wired through `computeCadenceChannels` in `cadenceDefaults.js` (#1628, 2026-06-23). Falls back to
    prior-only when a workspace has < 5 scored posts per channel (MIN_SAMPLE guard).

### Week/day boundary math — tz-aware, with one deliberate UTC exception

Any surface that buckets content by the workspace's WEEK or DAY resolves the boundary in the workspace
timezone, not UTC. `mondayOf(date, tz)` (`api/_lib/strategist.js`) derives the local calendar date via
`Intl.DateTimeFormat` in `tz` BEFORE computing the ISO-Monday; the client mirror (`weekMondayDate` in
YourWeek.jsx) uses the identical algorithm. Without it, a US workspace hits a ~7h window every week
(Pacific: Sun ~5pm–midnight local, after UTC-Monday-00:00) where `/week` shows next week and hides the
running week's posts — an audit P1 (#2138).

- **`mondayOf`'s `tz` is OPTIONAL and defaults to the old UTC behavior.** Callers that pass a bare
  `'YYYY-MM-DD'` for validation/canonicalization (`mondayOf(week) !== week` in `plan-week.js` /
  `week-summary.js`) MUST NOT pass `tz` — a bare Monday has to round-trip unchanged. Pass `tz` only when
  the input is a NOW instant and you want "this week" in local terms. A full-year sweep proved the
  no-tz path is byte-identical to the pre-fix impl, so the ~10 other `mondayOf` callers are unaffected.
- **`recapDerive.js` keeps its OWN UTC `mondayOf` on purpose — do NOT "fix" it to tz.** Its week
  buckets must line up with Postgres `date_trunc('week', …)` under the default UTC session (the Overview
  capture-streak is counted against DB-aggregated weeks). Switching it to the workspace tz would desync
  the streak from the data it counts. Different surface, different (intentional) contract — an
  "audit found a UTC week boundary" sweep must leave this one alone.

### `/week` is driven by the ATOM, not the content_item — (re)scheduling must sync the atom

`week-summary.js` filters `content_plan_atoms` by `plan_week` and lays each card out by the
**atom's** `scheduled_at`; it joins `content_items` only for status/thumbnail/excerpt. So the atom
row — not the content item — decides whether a piece appears on the board and on which day. This
means **any write to `content_items.scheduled_at` must also update the linked atom** (the atom whose
`content_piece_id = <item id>`), setting the atom's `scheduled_at` AND recomputing
`plan_week = mondayOf(scheduledAt, ws.cadence_policy?.timezone)` — with the SAME tz-aware `mondayOf`
the board reads with, or the piece lands in the wrong week bucket. Otherwise the atom stays pinned to
its original `plan_week` and an approved, rescheduled post silently vanishes from Your Week (real user
feedback 2026-07-13; fixed in the `db/content` PATCH handler, #2182 — best-effort, since one-off Posts
have no atom and match 0 rows). Grep for every writer of `content_items.scheduled_at` when touching
scheduling — the user-facing path is `PATCH /api/db/content` (via `useContentWorkflow.publish`);
dispatch-time writes (`buffer.js`, `dispatchContentItem.js`) generally re-write the same value and
rarely cross a week boundary, but are the next place to check if a same-week desync ever surfaces.

### Generated captions are hard-clamped to the platform char cap at GENERATION, not just publish

The per-(platform,angle) `cap` in `socialLengthTargets.js` is only a *prose instruction* to the LLM
("Never exceed N characters") — the model overshoots. So the generation path deterministically clamps:
`draftAtom` (and its GBP per-location variants) runs the returned caption through
`clampToCap(text, platformCap(platform))` (both in `socialLengthTargets.js`) — a sentence-aware trim
(last `.!?` under cap → last word boundary → hard slice, no ellipsis) applied AFTER the voice judge so
fidelity scores the full text. The publish paths (`buffer.js` GBP branches) use the same `clampToCap`
as a final gate for non-atom sources (manual edits, one-off posts, brief-broadcast). Any NEW caption
generation path or NEW capped platform must clamp too — don't rely on the prompt or the blind
`slice(0, N)` that used to be the only enforcement (shipped #2181, user feedback "caption auto
generated over character limit").

## Unified editor shell (carousel + reel)

Both editors — the carousel (`src/components/story-detail/SlideEditor.jsx`) and the clip/reel
(`src/pages/VideoEditor.jsx`) — render through ONE shared shell so editor surfaces stay consistent
(shipped 2026-06-24, #1667–#1676). The pieces:

- **`src/lib/editorArchetype.js` — the single source of truth.** `resolveArchetype(piece)` maps a
  `content_items` row → one of 9 archetypes (carousel · visual · story · storyvid · vvideo · lvideo ·
  doc · email · ad · textad) by platform + media (instagram+video→vvideo, instagram_story+video→
  storyvid). Each archetype declares its `surface` (slides | timeline | variants | none), `rail`
  sections, `canvas` kind, `aspects` (first = default), and `mediaTier` (required | optional | none).
  `needsMediaToPublish(piece)` is the publish gate. **Route by archetype, never ad-hoc platform/media
  flags** — `StoryboardPublish.jsx` does this (`resolveArchetype` replaced the old `isReel`/`isCarousel`
  booleans, verified-equivalent).
- **`src/components/editor/EditorChrome.jsx`** — the shared top bar (back · title · format badge ·
  aspect seg · right-aligned action slot). Both editors render their header through it; per-editor
  buttons (Preview/Save/Schedule/Export/transport) go in `children`. Extracted verbatim from
  SlideEditor's header → adoption was a visual no-op.
- **`src/components/editor/IconRail.jsx`** — the shared left rail. Purely presentational:
  `items=[{key,icon,label}]` + `active` + `onPick`. Each editor passes its archetype's sections.
- **Carousel inspector = one panel per rail tool** (Words / Slide / Media / Text), NOT an accordion.
  Two orthogonal states that SYNC: `tool` drives which inspector panel shows; `selection`
  (`{type:'photo'|'text',idx}`) drives the canvas (photo ring + `TextDragLayer` block drag). Clicking a
  photo/block on the canvas sets the rail tool; picking a tool sets a canvas selection. The Text panel
  is a block list (HOOK/BODY/CTA + Add) → the selected block's `TextInspector`. The slide-thumbnail
  rail is the right-edge "surface"; **Words = the caption editor** (`CaptionPanel`, moved out of the
  old right column into the rail).
- **`PostPreview.jsx` has a `switch` case per platform.** A channel that hits `default` →
  `PlainPreview` raw-dumps its content (the Story `LINK_STICKER_TEXT:` bug class). Every enabled
  channel now has a case; add one for any new channel.

**`UnifiedEditor.jsx` (the non-carousel shell — `doc`/`email`/`textad`/`ad`/`vvideo`/`lvideo`/`storyvid`)
consumes the SAME `editorArchetype.js` rail arrays, but its `RAIL_META` lookup silently drops any key
with no matching entry — no error, the tab just never appears.** Every archetype's `rail: [...]` entries
must have a matching `RAIL_META[key]`. This bit blog for over a month: the `doc` archetype's rail was
`['doc', 'media', 'seo']`, but `RAIL_META` only ever defined `words`/`media`/`photo`/`text`/`grade` — so
`doc` and `seo` both dropped, leaving blog with no Words tab at all (not even a body-edit textarea),
which also orphaned the 3 blog generation actions (Regenerate/style-switch/split-into-series) that PR
#2107 had deleted from the old AssetsPane console with nowhere left to remount. Fixed in #2109 by
renaming the rail key `'doc'` → `'words'` (the key `WordsPanel` actually handles). Before adding a new
rail key to any archetype, add its `RAIL_META` entry in the same PR, or grep `RAIL_META` in
`UnifiedEditor.jsx` to confirm an existing key actually resolves to a panel — don't assume the archetype
config alone means the tab renders.

**The `email` and `'seo'` variants of this same gap were fixed the same day (#2114, #2115, 2026-07-11).**
`email` archetype: rail key `'email'` → `'words'` (email content is a plain string with `---SECTION---`
markers — the exact shape `getNewsletterSystemPrompt` in `prompts.js` emits and `PostPreview.jsx`'s
`parseEmailSections`/`fillTemplate` consume — so the same generic `WordsPanel` textarea works, no new
structured form needed); also dropped `'text'` from `email`'s rail since `OverlayTextEditor` (on-image
overlay) has no meaning for a block-based email template. `'seo'` on `doc` (blog/landing_page): unlike
`doc`/`email`, this had ZERO backing data anywhere — no DB column, nothing. But `api/publish/website.js`
already expects `seoTitle`/`description` in its payload and `useContentWorkflow.js` was 100%
auto-deriving both client-side (`deriveSeoTitle`/`deriveMetaDescription` in `blogOutput.js`) with no way
to override a bad auto-derived value — so a real, scoped feature (migration 174: `content_items.seo_title`
+ `.meta_description`, nullable, manual override wins over auto-derive) was built rather than just
dropping the key. `'seo'` was ALSO dropped from `textad` (Google Ads) — a paid ad has no meta-description/
SERP concept the way a webpage does, no backing data existed, and no clear request existed either, so
that one got the "remove the phantom key" treatment instead of a speculative panel. **Same underlying
lesson as the doc/words fix, but the resolution differs per key depending on whether real backing
data/consumer already exists** (email/doc: yes → build the panel; textad/seo: no → drop the key).

**As of #1690 (2026-06-25) and #1854/#1856 (2026-07-01), `SlideEditor` is not just the carousel
editor** — every `singleSlide`-capable archetype routes through it as a carousel of one slide, not a
separate implementation: `carousel`, `visual` (single-photo LinkedIn/FB/X/GBP/Pinterest/Reddit, via
`singleSlide={true}`), and `story` (photo Instagram Story, via `singleSlide={true}` + a `forcedAspect`
prop that locks the aspect and hides the chrome's aspect switcher). Only `storyvid` (video Story) stays
on the dedicated `StoryComposer` — `SlideEditor` is photo-only, same reason `vvideo`/`lvideo` stay on
the timeline editor. **Lesson (re-confirmed twice now): when the ask is "same editor as X," route to X
— don't build a parallel implementation that re-clones X's panels.** The two-column preview+schedule
page is fully retired for photo/carousel content; it's only where `doc`/`email`/`textad`/`ad` land now.

### Autosave + undo/redo (#1927, 2026-07-07)

`SlideEditor` and `VideoEditor` no longer have a manual Save button — edits autosave (debounced) and
show a passive status via `src/components/editor/SaveStatus.jsx` ("Saving…" / "✓ All changes saved" /
error), with session-only undo/redo (`src/components/editor/UndoRedoButtons.jsx`, bound to ⌘Z/⌘⇧Z via
`src/lib/useUndoRedoShortcut.js`). Two shared hooks power this — reuse them for any future editor
surface rather than hand-rolling another autosave effect:

- **`src/lib/useAutosave.js`** — debounced save of a JSON-serializable snapshot; flushes on unmount so
  navigating away mid-edit doesn't drop the last change. Returns `{status}`. Takes `{ debounceMs,
  enabled, resetKey }`. **Pass `resetKey` (the entity's id) whenever the same hook instance can be
  reused across different entities without an intervening remount** — e.g. a route like
  `/slate/clip/:assetId` doesn't remount its page component on a `:assetId`-only navigation, so without
  `resetKey` the new entity's snapshot looks like an unsaved change relative to the OLD entity's saved
  baseline and fires a spurious autosave on simple navigation (audit finding, 2026-07-07). Both current
  callers pass it: `SlideEditor` → `piece.id`, `VideoEditor` → `assetId`.
- **`src/lib/useUndoHistory.js`** — session-only undo/redo over the same kind of snapshot (in-memory,
  resets on reload — standard editor behavior, not a data-loss risk). Takes an `enabled` option so a
  hydration/restore effect (VideoEditor's server+localStorage draft load) doesn't itself become a
  spurious undo step; flip `enabled` true only once the real baseline has loaded.

VideoEditor originally kept its own hand-rolled localStorage+server dual-write autosave alongside the
new `useUndoHistory`/status UI (it predated `useAutosave` and had an offline-mirror behavior the shared
hook didn't cover). As of #1949 (2026-07-07) it migrated fully onto `useAutosave` for the server PATCH
— the shared hook's unmount-flush was fixing a real bug (edits dropped when navigating away mid-debounce)
that the hand-rolled version didn't have. The localStorage mirror stays as a separate, simple
undebounced `useEffect` writing on every `draftDoc` change — `useAutosave` only owns the debounced
server write. TextPostStudio has no persisted draft (state only ships when "Use this post" bakes it),
so it only got `useUndoHistory`, no autosave.

**React Compiler forbids reading or writing a ref during render** — both new hooks hit this while
being written (`Cannot access refs during render` / `Cannot update ref during render` errors at build
time, not just lint warnings). Any derived value a component reads on every render (e.g. `canUndo`,
`canRedo`) must live in `useState`, not be computed from `ref.current.length` inline — mirror history
arrays into a small `{past, future}` count state and update it wherever the ref arrays change. Likewise,
mirroring a prop/value into a ref for later use in an effect (`saveRef.current = save`) must happen
inside a `useEffect`, never as a bare assignment in the component body. This will recur on the next
hook that needs "current value on demand" semantics — reach for state-mirrored-from-ref, not a raw ref
read, anywhere the value is read during render.

**FIXED (#1971, 2026-07-08) — a piece-reseed effect clobbered `removeSlide`'s toast-undo, not a raw
network race.** `SlideEditor.jsx`'s delete flow (`removeSlide`) shows a Sonner "Slide deleted" toast
with an `Undo` action that restores the removed slide into local `slides` state. The actual mechanism
that lost the undo: a `useEffect` re-seeded local `slides`/`themeId`/`aspect` from the `piece` prop on
every `JSON.stringify(piece?.slides)` change — but `useUpdateContentItem`'s `onSuccess` writes the
saved row straight into the query-cache detail entry (`qc.setQueryData`), so the delete's own save
echoed back and re-triggered that effect. If the echo landed in the window between the undo's local
`setSlides` and the undo's own (later) debounced autosave, the reseed silently overwrote the undo back
down to the deleted state — and since post-clobber state matched the already-saved state, no further
save fired, so the UI reported "All changes saved" while the undo was lost. Reproduced 2026-07-08
testing `SlideFilmstrip`'s delete affordance against a real draft. **Fix:** the reseed effect now
depends only on `piece?.id`, not `piece?.slides` — `StoryboardPublish` already gates rendering until
`piece` is loaded, so slides are never "still loading" by the time `SlideEditor` mounts; once mounted,
local `slides` state is authoritative and autosave is what pushes it to the server, so a reseed on
every server echo was never correct. Re-verified live post-deploy with the exact repro (delete → wait
for the save to land on the server → undo → confirm the undo persists, not just the local UI).

**Single-media archetypes must REPLACE `media_urls` on swap, never append.** Every archetype whose
`surface` isn't SLIDES with room for more than one slide — `visual`, `story`, `vvideo`, `lvideo` — has
exactly ONE media slot at the platform level (Google's Local Post API, Instagram Story frames,
TikTok/YouTube/Reels all hard-reject or silently ignore extra items). The attach/swap handler for these
archetypes (`SlideEditor.jsx`'s `attachPhoto()` for `visual`/`story`/`carousel`-of-one, and
`UnifiedEditor.jsx`'s `MediaPanel.attach()` for `vvideo`/`lvideo`) must gate on the archetype and set
`media_urls: [entry]` outright instead of `[...media, entry]` — an append-always implementation lets
`media_urls` silently accumulate every previously-swapped-out item (each still present, orphaned, no
longer bound to any slide). This is invisible in the editor (only the currently-bound photo renders)
but hard-fails at publish once the array crosses the platform's real limit (GBP: 400 `bundle_gbp_post_failed`
on >1 item, discovered/fixed 2026-07-06). `doc`/`email`/`ad` archetypes correctly keep append-on-attach
— those genuinely support multiple images. When adding a new single-media archetype or a new
attach/swap surface, check whether the platform enforces a hard media-count cap before defaulting to
append.

**Canvas bitmap dimensions must be derived from the archetype's `aspect`, never hardcoded** — a canvas
element's intrinsic `width`/`height` attributes (the pixel buffer `renderFreeformSlide` draws into) are
independent of its CSS box size. If the CSS box is sized per-aspect (`ASPECT_STAGE` in `SlideEditor.jsx`)
but the bitmap stays a fixed `SLIDE_W`/`SLIDE_H` (1080×1350, i.e. always 4:5), the browser non-uniformly
stretches the bitmap to fill the CSS box — invisible at the 4:5 default, but a visibly warped/smeared
photo (especially the blurred cover-fill backdrop) at any other aspect. Bit us when Story's `forcedAspect`
made every single render hit this pre-existing latent bug (#1856). Fix: derive width/height from the same
`AD_CAROUSEL_DIMS[aspect]` table (`src/lib/renderSlides.js`) the publish bake already uses, so editor
preview and published output always agree — never introduce a second aspect→dimension mapping.

**Deliberately NOT unified** (a real object boundary, not missing work): `/publish/:pieceId`
(`content_items`, piece-based) and `/slate/clip/:assetId` (`media_assets`, asset-based, from Moment
Miner) edit DIFFERENT objects at different pipeline stages — they share the chrome/rail components but
are NOT one route. See `memory/project-unified-shell.md`.

### Video timeline — horizontal, optimistic scrub state (#1956/#1959/#1961, 2026-07-08)

`VideoEditor`'s timeline (`HorizontalTimeline`, formerly a vertical right-rail layout) renders trim
handles, overlay bars, and the playhead along the X-axis, pinned full-width under the canvas —
CapCut-style. Trim/overlay drag math is synchronous (mouse position → React state → immediate
re-render); the playhead is not — its position derives from `playClipT`, which only advances once the
`<video>` element fires `timeupdate`/`seeked` for a `seekClip()` call. That event can lag a frame, or
never fire at all on a slow/unbuffered source (a Vercel Blob-served clip can sit at `readyState 0`
indefinitely in some environments — see the matching CLAUDE.md verification note).

**Pattern: optimistic scrub state, lifted to the page level, not owned by the timeline component.**
`VideoEditor` holds `scrubT` (clip-relative seconds, `null` when not scrubbing) and derives
`displayClipT = scrubT ?? playClipT`, passed through `ctx` to any consumer that renders a
media-position-derived value. `HorizontalTimeline`'s scrub handler sets `scrubT` synchronously on every
mousedown/mousemove — so the playhead follows the pointer with zero lag — and also calls the real
`seekClip()`. A `useEffect` clears `scrubT` once `playClipT` converges within 0.08s, handing control
back to the real value with no visible jump; if the video never converges (still buffering), the
optimistic position simply stays authoritative rather than freezing at the pre-scrub position.
`displayClipT` drives both the playhead line AND the transport time readout so they never disagree —
`Canvas`'s caption/overlay-fade timing intentionally stays on the real `playClipT`, since those must
reflect the actually-decoded frame, not the scrub target. Reuse this pattern (page-level optimistic
value + convergence-based handoff) for any future editor UI whose visual position is tied to an async
media element's state.

**Selection model — `sel` is a discriminated union; a null deselect needs a guard (#2045/#2048, 2026-07-09).**
`VideoEditor`'s `sel` state is either an inspector-key string (`'clip'`, `'grade'`, `'caption'`,
`'music'`, `'transcript'`, `'moments'`) OR an overlay object `{ type:'overlay', id }`. Overlay-selection
is detected everywhere with the `isOverlaySel(sel)` helper — **NOT a bare `typeof sel === 'object'`**,
because `typeof null === 'object'` is `true`. Clicking the empty stage backdrop deselects via
`selectKey(null)` (a `Canvas` `<section>` `onClick` guarded by `e.target === e.currentTarget`, so a click
bubbling up from the `<video>`/an overlay handle doesn't fire it). A bare `typeof sel === 'object'` then
treated the deselected `null` as an overlay and crashed reading `sel.id` — the whole editor fell to the
error boundary. The helper `(s) => s != null && typeof s === 'object'` makes `null` a first-class
"nothing selected" state (no inspector, no ring, no rail highlight). **Any editor that both (a) uses a
`typeof x === 'object'` discriminator and (b) can hold a null/deselected state must guard with `!= null`.**
This class of runtime crash passes lint/typecheck/build clean — it only surfaced under the standard
post-deploy Chrome verification (`SlideEditor` uses a different, `window.getSelection()`-based model and
is unaffected).

## Practice-memory RAG — recency + supersession contract

The "practice brain" (`api/_lib/practiceMemoryRag.js` + the `match_practice_memory_chunks` RPC + `practice_memory_chunks` / `practice_memory_supersessions`) is real pgvector retrieval, not a stub. Invariants to preserve:

- **Indexing fires on `approved` OR `published` OR a body edit** — NOT only the `status→'approved'` PATCH. The approval-signal enrichment (concepts/voice-phrases in `api/_routes/db/content.js`) deliberately gates on the approve transition, but RAG indexing (`indexContentItem`) is decoupled and must also cover publish-direct + in-place edits, else chunks silently go missing (the F6 P1 leak). All indexers are `waitUntil`-dispatched and wrapped in `withRetry` so a transient embedding hiccup doesn't strand a chunk.
- **`practice_memory_chunks.source_date` is the SOURCE's authored date, NOT `created_at`** (which is insert time — a backfill stamps weeks-old content "today"). Recency weighting keys off `source_date` (fallback `created_at`). Every indexer must populate it; blogs/drafts use `staff_corpus_documents.doc_date`, not the ingest timestamp.
- **`match_practice_memory_chunks` is retrieve-then-rerank** (migration 150/151): an inner CTE takes top candidates by pure cosine (this is what uses the **HNSW index**), an outer query re-ranks by `similarity * exp(-ln2·age/half_life)`. Do NOT collapse it to a single `ORDER BY <expression>` — that drops the index and full-scans. `p_half_life_days` defaults 365 (gentle); `NULL`/≤0 disables decay — **Author Mode (`searchAuthorCorpus`) passes null** so a clinician's older blogs aren't down-ranked when they author from their own corpus.
- **Supersession only suppresses CONFIRMED edges.** The RPC excludes a chunk only if it's the `old_chunk_id` of a `status='confirmed'` row in `practice_memory_supersessions`; `pending`/`rejected` have zero retrieval effect (recency still gently down-weights). Candidates are clinician-confirmed via `/api/practice-memory/supersessions` — nothing is suppressed silently, nothing deleted.
- **The conflict judge (`supersessionJudge.js`) must stay conservative.** Its hardest job is NOT false-positiving on derivations (a blog and the interview it came from read near-identically) — only a genuine *change of stance* is "supersedes"; derivations/rewrites are "duplicate". Validate any prompt change with `scripts/validate-supersession-judge.mjs` (synthetic positives + real derivation negatives, ≥3 samples) before trusting it — see `memory/feedback-validate-the-validator.md`. Detection runs as the weekly `cron/detect-supersessions`, not per-index (most pairs are derivations; per-index would burn tokens). See `memory/project-f6-practice-brain.md`.
