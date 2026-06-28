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

**Tenant isolation is enforced at the API layer, not the database.** There is no RLS on the
public schema (service_role bypasses it anyway). Every route that reads or writes tenant-scoped
data must call `workspaceContext(req)` and include `workspace_id` in every query filter. Treat
the workspace_id filter the same way you'd treat an authorization check — missing it is a
cross-tenant data leak, not just a bug.

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

### Preview ≠ published artifact
When a feature renders something to a `<canvas>` or any in-memory/preview-only surface, that is
NOT evidence the same artifact ships at publish/export. The render and the publish are different
code paths. Before shipping any feature that renders a derived artifact (overlay image, composited
graphic, baked text), grep the renderer's callers — if it is called only in `*Preview` /
`*Editor` components and never in a publish/upload/export path, the published output is raw.
The renderer needs a real produce-and-upload step on the publish path reusing the SAME renderer
so it stays WYSIWYG.

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

## AI SDK v6 — `maxOutputTokens`, not `maxTokens`

AI SDK v6 (`generateText`/`generateObject`) uses `maxOutputTokens` to cap the completion length.
`maxTokens` is silently ignored (not an error, not a warning) — the call succeeds but uses the
model default, which can be much larger than intended. Any handler that calls `generateText` with a
token budget should use `maxOutputTokens`. Grep check: `grep -rn "maxTokens:" api/` should return 0
— if it returns any (other than `max_tokens` in JSON bodies), revert them to `maxOutputTokens`.

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
  (1) are there atoms with `held_at` set (backlog exists)? (2) does `mondayOf(now)` match what you
  expect — the server may already be in *next* week (Sun PT → Mon UTC flips `plan_week`)? (3) did a
  replan run for that week?
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
  - This fixed the long-standing bug where Facebook + Instagram Story were enabled-as-output but got
    `0`/disabled cadence (the old hardcoded instagram/linkedin/gbp trio). Phase 2 (engagement-tuned,
    per-tenant cadence from `engagement_snapshots`) is SHIPPED in `api/_lib/cadenceAdaptive.js` and
    wired through `computeCadenceChannels` in `cadenceDefaults.js` (#1628, 2026-06-23). Falls back to
    prior-only when a workspace has < 5 scored posts per channel (MIN_SAMPLE guard).

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

**Deliberately NOT unified** (a real object boundary, not missing work): `/publish/:pieceId`
(`content_items`, piece-based) and `/slate/clip/:assetId` (`media_assets`, asset-based, from Moment
Miner) edit DIFFERENT objects at different pipeline stages — they share the chrome/rail components but
are NOT one route. Thin-edit channels (FB/LinkedIn/GBP) stay on the two-column preview+schedule page;
the full-bleed canvas shell is for rich carousel/reel editing only. See `memory/project-unified-shell.md`.

## Practice-memory RAG — recency + supersession contract

The "practice brain" (`api/_lib/practiceMemoryRag.js` + the `match_practice_memory_chunks` RPC + `practice_memory_chunks` / `practice_memory_supersessions`) is real pgvector retrieval, not a stub. Invariants to preserve:

- **Indexing fires on `approved` OR `published` OR a body edit** — NOT only the `status→'approved'` PATCH. The approval-signal enrichment (concepts/voice-phrases in `api/_routes/db/content.js`) deliberately gates on the approve transition, but RAG indexing (`indexContentItem`) is decoupled and must also cover publish-direct + in-place edits, else chunks silently go missing (the F6 P1 leak). All indexers are `waitUntil`-dispatched and wrapped in `withRetry` so a transient embedding hiccup doesn't strand a chunk.
- **`practice_memory_chunks.source_date` is the SOURCE's authored date, NOT `created_at`** (which is insert time — a backfill stamps weeks-old content "today"). Recency weighting keys off `source_date` (fallback `created_at`). Every indexer must populate it; blogs/drafts use `staff_corpus_documents.doc_date`, not the ingest timestamp.
- **`match_practice_memory_chunks` is retrieve-then-rerank** (migration 150/151): an inner CTE takes top candidates by pure cosine (this is what uses the **HNSW index**), an outer query re-ranks by `similarity * exp(-ln2·age/half_life)`. Do NOT collapse it to a single `ORDER BY <expression>` — that drops the index and full-scans. `p_half_life_days` defaults 365 (gentle); `NULL`/≤0 disables decay — **Author Mode (`searchAuthorCorpus`) passes null** so a clinician's older blogs aren't down-ranked when they author from their own corpus.
- **Supersession only suppresses CONFIRMED edges.** The RPC excludes a chunk only if it's the `old_chunk_id` of a `status='confirmed'` row in `practice_memory_supersessions`; `pending`/`rejected` have zero retrieval effect (recency still gently down-weights). Candidates are clinician-confirmed via `/api/practice-memory/supersessions` — nothing is suppressed silently, nothing deleted.
- **The conflict judge (`supersessionJudge.js`) must stay conservative.** Its hardest job is NOT false-positiving on derivations (a blog and the interview it came from read near-identically) — only a genuine *change of stance* is "supersedes"; derivations/rewrites are "duplicate". Validate any prompt change with `scripts/validate-supersession-judge.mjs` (synthetic positives + real derivation negatives, ≥3 samples) before trusting it — see `memory/feedback-validate-the-validator.md`. Detection runs as the weekly `cron/detect-supersessions`, not per-index (most pairs are derivations; per-index would burn tokens). See `memory/project-f6-practice-brain.md`.
