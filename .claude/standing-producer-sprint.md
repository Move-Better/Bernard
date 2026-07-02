# The Standing Producer — Build-Sprint Plan

**Status:** Planning-phase deliverable, greenlit by Q 2026-07-02. Source vision: `.claude/frontier-panel.md` §Run 2026-07-02 (frontier bet F2, "Bernard takes the seat").
**Scope discipline:** every phase ships independently, is trial-able by Q on the live app, and never touches the sacred constraints (below).
**Migration numbering note:** 153 was claimed by `153_seo_citation_tracking.sql` (citation scoreboard, shipped 2026-07-02) — this plan's migrations are numbered 154+.

---

## 0. Verified code reality (what the plan is built on)

Every load-bearing claim was re-verified against the working tree before writing this plan.

| Claim | Verdict | Evidence |
|---|---|---|
| ~14 stateless crons | **True — exactly 14** (15 with probe-citations) | `vercel.json` `crons[]`; handlers in `api/_routes/cron/*.js`. Mix of actors (auto-publish, weekly-plan, campaign-tune, regenerate-stale-books), sensors-that-discard (refresh-engagement, gsc-snapshot), and self-heal sweepers (sweep-stuck-seminars, resume-longform-renders). All auth via `verifyCronSecret` (Bearer `CRON_SECRET`, timing-safe). |
| Judge soft-gates the draft path | **True** | `api/_routes/content-plan/draft.js:216–287` — Haiku (`anthropic/claude-haiku-4-5`) scores vs transcript, `GATE = 6.5`, one coached regenerate on the red flag, score persisted as `voice_fidelity_score = Math.round(overall*10)` (0–100 int) + `voice_audit` JSONB via `waitUntil`. Below-gate output still ships as a normal draft — the score decorates, never blocks. |
| `approve.js` only flips status; client dispatches | **True, plus a wrinkle** | `api/_routes/content-plan/approve.js` validates + PATCHes `status='approved'` only; its own header comment documents client-side dispatch. **The wrinkle: nothing calls it** — `YourWeek.jsx:322–341` `handleApprove` bypasses it via `useUpdateContentItemStatus` (generic `/api/db/content` PATCH), and batch-schedule (`YourWeek.jsx:394–436`) runs `publishPieceToBuffer` client-side (`src/lib/publishPiece.js` → bake slides → POST `/api/publish/buffer` → PATCH `status='scheduled'`). |
| `change_request` comments are written but never consumed | **True** | `api/_routes/content-item-comments.js` — GET/POST only, `kind='change_request'` accepted and stored; no reader anywhere in `api/` acts on them. |
| Producer tier exists and is vacant | **True** | `api/_lib/roles.js` `TIER_PRODUCER='producer'` (in `clinicians.permission_tier` / `staff.permission_tier`), `src/lib/usePermissionTier.js` drives producer-restricted UX; `engagement-digest.js:193` already targets `permission_tier=eq.producer` recipients. `Members.jsx` is a thin Clerk `<OrganizationProfile />` mount — a Bernard row must be custom-rendered, not a Clerk user. |
| Idempotency reference | **Confirmed** | `api/_lib/autoPublishRetry.js` — monotonic append-only posted-set in `story_packages.auto_publish_state.published_channels[ch].locations`, `unpostedTargets`/`mergePostedLocations`/`isChannelComplete`/`decideClaimDisposition`, 6-retry cap. This is the pattern every producer dispatch must copy. |
| Publish gate | **Confirmed** | `api/_lib/autoPublishGate.js` — pure 4-signal evaluator (voice ≥7.0 on 1–10 scale, similarity ≥0.65, consent, QC flags), GBP-only live channel. Applies to `story_packages`, not `content_items` — note the **two score scales**: packages store 1–10 float, content_items store 0–100 int. |
| RAG/brain is live | **Confirmed** | `practiceMemoryRag.js` (chunk/embed/`match_practice_memory_chunks` retrieve-then-rerank, recency half-life, confirmed-supersession suppression), `practiceMemory.js` (`resolveOwnHistoryBlock`, already injected in draft.js), weekly `detect-supersessions` cron. |
| AI Gateway wiring | **Confirmed** | ARCHITECTURE.md §Model provider — no `ANTHROPIC_API_KEY` in prod; all calls `generateText` with `'anthropic/claude-sonnet-4-6'` / `'anthropic/claude-haiku-4-5'` strings via `AI_GATEWAY_API_KEY`. AI SDK: `maxOutputTokens`, never `maxTokens`. |
| Tenant isolation | **Confirmed model** | No RLS; isolation enforced at API layer — `workspaceContext(req)` / `workspaceById(id)` + `workspace_id` filter on every query; eslint rule `bernard/require-workspace-scope` (crons carry a justified disable). Migration convention: `GRANT SELECT, INSERT, UPDATE, DELETE ON public.<table> TO service_role;` (see `151_practice_memory_supersession.sql`). Last migration: **153** (note historical number collisions at 138/141/147/148 — claim numbers carefully). |
| Slide baking is client-only | **True, with an out** | `renderFreeformSlide` is canvas/DOM-bound (ARCHITECTURE.md); **but** `ensureRenderedSlides` (`src/lib/renderSlides.js`) persists `rendered_url` + `rendered_sig` per slide, so any piece previously baked in the editor is server-dispatchable. Server Buffer dispatch already exists at `api/_routes/publish/buffer.js` (GraphQL, per-tenant credential). |

---

## 1. Architecture decision — where does "persistence" live?

A literally-persistent agent session **cannot run on the current substrate**: Vercel functions are request-scoped, 300s max (`maxDuration: 300` is already the ceiling used by the heaviest crons). The three realistic architectures:

**A — Event-driven logical persistence (RECOMMENDED for this sprint).**
`agent_inbox` table as the durable queue + a frequent cron tick (`/api/cron/agent-tick`, every 5 min) that wakes a *fresh* agent per event batch. Continuity is state, not process: the inbox, `agent_actions` ledger, `producer_state` JSONB, and the practice brain (RAG + supersessions + voice phrases) ARE the memory. Each work unit is bounded (revise one piece, draft one atom, reply to one thread — all comfortably inside the 120–300s envelope `draft.js` already proves out).
*Why:* zero new infra, zero new secret surface, identical auth (`CRON_SECRET`), identical tenant-isolation discipline (iterate workspaces, scope every query), and every existing self-heal/idempotency pattern transfers directly. The "persistent agent" the user perceives is the sum of (durable state × frequent ticks × full-corpus grounding) — which is exactly what the vision needs for phases 0–4.

**B — Vercel Queues / Workflow (the upgrade path, not the sprint).**
Queues is public beta; Workflow gives durable multi-step execution. The inbox schema below is deliberately queue-shaped: `dedupe_key`, `status`, `attempts`, optimistic claim. When Queues/Workflow matures, the cron tick is replaced by a queue consumer/workflow **with no schema change** — the inbox stays the source of truth (and keeps its audit value). Adopt when a single work unit genuinely exceeds 300s (multi-piece campaign revisions, read-back verification sweeps) — nothing in Phases 0–4 does.

**C — External long-running runner (Railway/Fly + Claude Agent SDK sessions).**
The only option that makes the session *literally* persistent (Fable 5 compaction + memory tool per workspace). Rejected for the sprint: exports `SUPABASE_SERVICE_KEY` + `AI_GATEWAY_API_KEY` off-Vercel, adds a deploy/monitor surface Q doesn't have, and creates a second place tenant-isolation bugs can live. Revisit at the SIP-outbound phase (a live voice call is the one workload that truly needs a long-lived process); even then, prefer the runner to *call back into* Bernard's routes rather than hold the service key.

**Decision: A**, with the inbox designed as B's future queue. Record in the code that the tick is a consumer implementation detail.

---

## 2. Cross-cutting invariants (every phase, non-negotiable)

1. **The human approval gate on `/week` is sacred.** Nothing reaches `status='approved'|'scheduled'|'published'` on a `content_items` row without a human action, except the *existing* `auto-publish` cron path for `story_packages`, which keeps `autoPublishGate.js` as its sole authority. The producer creates drafts, revises drafts, replies, and escalates. It never approves its own work.
2. **No ambient/treatment-audio capture. No synthetic video.** (Standing constraints, Q rulings 2026-06-27 / 2026-06-21.) The producer never proposes these either — keep them out of its prompt toolbox.
3. **Tenant isolation absolute.** The tick loops workspaces from a `producer_config`-enabled list; every Supabase query inside carries `workspace_id=eq.<id>`; every new `_routes` file calls `workspaceContext(req)`; new cron files carry the standard justified eslint-disable. LLM-echoed ids are normalized + validated against known-good input sets before any write (ARCHITECTURE.md strategist lesson).
4. **Idempotency = the `autoPublishRetry` pattern.** Monotonic append-only done-sets recorded in the *same* PATCH that releases a claim; optimistic claims guarded on current status (`status=eq.pending` PATCH, the `draft.js:78` pattern); attempt caps with terminal `exhausted` states; sweepers rescue stranded claims (the `sweep-stuck-seminars` cooperative-cancel pattern).
5. **Models via gateway only.** Drafting/revision: `anthropic/claude-sonnet-4-6`. Judging: `anthropic/claude-haiku-4-5`. Decision/triage in the tick: Haiku where classification suffices, Sonnet where writing happens. A Sonnet-5-tier swap is a one-line gateway-string change — treat as an *optional* A/B (compare judge-score distributions before/after), never a dependency. `maxOutputTokens` on every call.
6. **Best-effort ledger writes never block work** (the `audit.js` / `notifyAdmin.js` posture: never throw, log and continue).
7. New `_routes` files ⇒ regenerate the manifest (`node scripts/build-api-manifest.mjs`; prebuild also runs it). New crons ⇒ `vercel.json` entry.

---

## 3. Phases

### Phase 0 — Make Bernard visible (member row + workday feed from what already happens)

**Goal.** Bernard exists as a *seen* colleague before it acts as one: a named member card and a standup-style feed of the work the system already does invisibly. Zero new autonomy; pure instrumentation + rendering. This also lands the observability substrate every later phase writes into.

**User-visible change.**
- `/settings/members`: a "Bernard — Producer" card (avatar, role chip, "employed since" = enable date) rendered above the Clerk `<OrganizationProfile />`.
- A "Bernard's workday" feed: new `/producer` page + a compact latest-3 strip on `/week`. Entries read as standup lines: "Scored the sciatica reel draft 8.2 — shipped to review", "Weekly plan composed: 6 slots from backlog", "GBP post confirmed live on Buffer".

**Files touched (existing).**
- `api/_routes/content-plan/draft.js` — record `draft_created` + `judge_scored` actions (score, attempts, gate result).
- `api/_lib/strategistPlan.js` — record `week_planned` (atoms promoted, channels).
- `api/_routes/cron/auto-publish.js`, `api/_routes/cron/sync-buffer-published.js` — record `publish_dispatched` / `publish_confirmed` / `publish_failed`.
- `api/_lib/notifyPublishFailure.js` — record `escalation`.
- `src/pages/Members.jsx` — Bernard card (presentational, driven by workspace flag; **do not** insert a fake `staff` row — it would pollute `workspace_usage()` stats and every staff-scoped query).
- `src/pages/YourWeek.jsx` — feed strip; `src/App.jsx` — `/producer` route; `src/lib/api.js` — fetch helper.

**Files new.**
- `api/_lib/agentActions.js` — `recordAgentAction({ workspaceId, kind, title, detail, refs })`, best-effort, never throws (clone the `audit.js` posture).
- `api/_routes/producer/feed.js` — GET, `workspaceContext` + `requireRole(req, null, …)` (any member), paged by `created_at`.
- `src/pages/Producer.jsx`, `src/components/producer/WorkdayFeed.jsx`.

**Data model.**
- Migration `154_agent_actions.sql`:
  `agent_actions (id uuid pk default gen_random_uuid(), workspace_id uuid not null, actor text not null default 'bernard', kind text not null, title text not null, detail jsonb, content_item_id uuid, atom_id uuid, interview_id uuid, package_id uuid, inbox_item_id uuid, model text, input_tokens int, output_tokens int, created_at timestamptz not null default now())`; index `(workspace_id, created_at desc)`; `GRANT SELECT, INSERT, UPDATE, DELETE … TO service_role;`. Token columns land now so `/usage` wiring later is a query, not a migration.
- Migration `155_producer_config.sql`: `ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS producer_config jsonb NOT NULL DEFAULT '{}'::jsonb;` — shape `{ enabled: bool, enabled_at, paused_at, daily_ai_call_cap: int (default 40), max_items_per_tick: int (default 3) }`. Expose via `workspace/me.js` so `useWorkspace()` sees it.

**Model calls / cost.** None. Phase 0 is free.

**Risks.** Feed noise (mitigate: `kind` allowlist, collapse repeats); the Members card implying Clerk membership (it's presentational — label it "AI teammate"); action writes slowing hot paths (mitigate: `waitUntil` + never-throw).

**Q trials it.** Enable `producer_config.enabled` on the movebetter workspace (SQL or a settings toggle), run a normal capture→draft→approve week, watch `/producer` fill with the standup narration of things that already happened. Success = the feed reads like a colleague's log, not a syslog.

---

### Phase 1 — `agent_inbox` + first sensor→action loop: the revision agent answers `change_request`

**Goal.** The dead channel comes alive. A `change_request` comment becomes a task Bernard executes: revise through the existing generation grounding, re-judge, reply in-thread with what changed, return the piece to review. First real autonomy, smallest possible blast radius (drafts only — nothing near publish).

**User-visible change.** Q writes "Request changes: too clinical, lead with the patient story" on a `/week` piece. Within ~5 minutes: the piece body is revised (original kept in `ai_original_content`), a Bernard reply appears in the thread ("Rewrote the open around the patient story; kept your 'motion is lotion' phrasing; re-scored 8.4 → back in review"), status is back to `in_review`, and the workday feed logs it.

**Files touched (existing).**
- `api/_routes/content-item-comments.js` — on POST of `kind='change_request'`: `waitUntil`-insert an inbox row (`dedupe_key = 'change_request:'+comment.id`). Also: sensor must ignore comments authored by Bernard (loop guard — Bernard's replies are always `kind='comment'` and `user_id='bernard-producer'`).
- `vercel.json` — add `{ "path": "/api/cron/agent-tick", "schedule": "*/5 * * * *" }`.
- Comment-thread UI — render Bernard-authored comments with the producer identity.

**Files new.**
- Migration `156_agent_inbox.sql`:
  `agent_inbox (id uuid pk, workspace_id uuid not null, kind text not null, dedupe_key text not null, payload jsonb not null default '{}', content_item_id uuid, status text not null default 'pending' check (status in ('pending','claimed','done','failed','dismissed')), attempts int not null default 0, claimed_at timestamptz, processed_at timestamptz, result jsonb, created_at timestamptz not null default now(), UNIQUE (workspace_id, dedupe_key))`; index `(workspace_id, status, created_at)`; service_role GRANTs. The UNIQUE dedupe key is the sensor-idempotency primitive: any sensor can fire twice, the queue can't.
- `api/_routes/cron/agent-tick.js` — `maxDuration: 300`, `verifyCronSecret`. Loop: workspaces where `producer_config->>'enabled'='true'` and not paused → backfill-sweep unconsumed `change_request` comments into the inbox (catches any missed `waitUntil`) → claim up to `max_items_per_tick` pending items via `status=eq.pending` PATCH (optimistic claim) → dispatch by `kind` → record action → mark `done`/release with `attempts+1`. Stranded `claimed` rows older than 15 min are swept back to `pending` (or `failed` at attempt cap 3, with an `escalation` action).
- `api/_lib/producer/reviseContentItem.js` — the revision agent: load piece + full comment thread + source interview transcript + `resolveOwnHistoryBlock` (RAG) + voice phrases + brand guidelines → one Sonnet call ("revise per these change requests; preserve voice; here is what the clinician actually said…") → judge with the *exact* `buildFidelityPrompt`/`parseFidelity` pair from `draft.js` → PATCH `content` (+ `voice_fidelity_score`, `voice_audit`) **guarded on `status=in.(draft,in_review)`** (cooperative-cancel: never clobber a piece a human approved mid-flight) → insert Bernard's reply comment (direct Supabase insert with `workspace_id`, `user_id='bernard-producer'`, `user_email='producer@withbernard.ai'`, `kind='comment'`).

**Model calls / cost.** Per revision: 1× Sonnet (~3–5k in / ~1k out ≈ $0.03) + 1× Haiku judge (~$0.005). Attempt cap 3 bounds worst case per comment at ~$0.10.

**Risks / failure modes.**
- *Runaway loop*: Bernard's own comment re-triggering the sensor — killed by author guard + `kind='comment'` replies + dedupe key on the *human's* comment id.
- *Double-acting vs crons*: none — no cron touches change_requests today; this lane is net-new.
- *Clobbering human edits*: the guarded PATCH + claim pattern; additionally skip revision if `updated_at` changed since the comment (human already edited).
- *Cost runaway*: per-tick item cap + daily `daily_ai_call_cap` check against today's `agent_actions` count before any model call.

**Q trials it.** On the enabled workspace, leave a change request on a live draft; verify the 5-min loop end-to-end; leave a second, contradictory one; verify thread coherence. Kill switch drill: set `paused_at`, confirm the item sits `pending` untouched.

---

### Phase 2 — Judge hard-gate + server-side approve completion

**Goal.** Close the two half-finished loops the code itself argues for: (a) the judge stops decorating — a below-gate draft is not presented as ready, it becomes producer work; (b) approval finishes the job server-side, so `/week` approval is one action, not "approve, then hope the browser tab completes the dispatch."

**Part A — hard gate.**
- `api/_routes/content-plan/draft.js`: keep the existing 1-regenerate loop; after final score, if still `< GATE`, insert an `agent_inbox` item `kind='judge_low_score'` and set `voice_audit.gate='failed'`. The piece stays `status='draft'` but `/week` renders it as "Bernard is still working on this" (grade chip red, approve affordance de-emphasized — **never removed**: the human can always override and approve; the gate binds *Bernard's presentation*, not the human's authority).
- `agent-tick` handler for `judge_low_score`: one *differently-strategized* regenerate (Sonnet, with the full breakdown fed back + a stricter verbatim-anchoring instruction + RAG re-grounding), re-judge, cap 2 producer attempts, then `escalation` action ("I couldn't get the disc-herniation post above the voice bar — it needs 3 minutes of your actual words"). Move `GATE` to `app_config` (the migration-142 pattern) so tuning needs no deploy.
- Surface the grade on `/week` cards (the score is already on the row; today the card doesn't show it — verified in `YourWeek.jsx` meta pills).

**Part B — approve completes server-side.**
- Extract the dispatch core of `api/_routes/publish/buffer.js` into `api/_lib/publishContentItem.js` (per-tenant credential via `getCredential`, `prepareMediaForBuffer`, `PLATFORM_TO_SERVICE`, GBP `target_locations` fan-out), callable without an HTTP request.
- Extend `api/_routes/content-plan/approve.js`: after the status flip, if the piece is **server-dispatchable** — text-only platform, or every slide carries a fresh `rendered_sig` (the `ensureRenderedSlides` persistence), or `media_urls` video — dispatch with `useQueue`/`scheduled_at` semantics identical to the client path, PATCH to `scheduled`, record the action, return `{ dispatched: true }`. If a fresh client bake is required, return `{ dispatched: false, needs_client_bake: true }` and the client runs today's path. **Do not port canvas baking to the server in this sprint** — that's a rabbit hole; the `rendered_sig` coverage grows naturally because every editor touch bakes.
- Wire `YourWeek.jsx` `handleApprove` + batch-schedule to POST `/api/content-plan/approve` (finally giving the endpoint its caller) and only fall back to client dispatch on `needs_client_bake`.
- **Idempotency**: migration `157_content_items_dispatch_state.sql` — `dispatch_state jsonb` on `content_items`, mirroring the `autoPublishRetry` shape (per-channel/per-location monotonic posted-set + `retry_count`); `unpostedTargets`/`mergePostedLocations` imported as-is (they're pure). A retried approve can only *add* postings, never duplicate one.

**Data model.** Migration `157` above; `app_config` row for `voice_gate`.

**Model calls / cost.** Part A adds ≤1 Sonnet + 1 Haiku per below-gate draft (historically the minority of drafts). Part B adds zero model calls.

**Risks.** *Double-dispatch client+server* — the response contract (`dispatched: true` ⇒ client must not call `publishPieceToBuffer`) plus `dispatch_state` posted-set makes even a buggy client harmless. *Gate too strict* ⇒ drafts pile up in producer-working state — the escalation cap (2 attempts) guarantees everything terminates in either "ready" or "needs you", never limbo; tune via `app_config`. *Two score scales* (packages 1–10 float vs content_items 0–100 int) — `publishContentItem` and the gate check must convert explicitly; note it in code.

**Q trials it.** Approve a text GBP piece on `/week` with the network tab open — one POST, row goes `approved→scheduled`, Buffer queue shows it, feed logs it. Then force a low score (draft from a thin interview) and watch the gate → producer retry → escalation chain.

---

### Phase 3 — Proactive drafting: the producer pre-drafts the week

**Goal.** Invert the on-demand posture. Today `weekly-plan`/`replanWorkspaceWeek` promote backlog atoms into `/week` but captions only exist when a human clicks Draft. The producer drafts the promoted week ahead of Monday, fully grounded, judged, and gate-filtered — so Monday's `/week` is a review session, not a workbench.

**User-visible change.** Monday 6am: `/week` already holds drafted, graded pieces; the feed reads "Pre-drafted 6 of 6 slots for the week of Jul 6 — 5 ready for review, 1 below the voice bar (working on it)". Weekly digest email gets a one-line producer standup.

**Files touched (existing).**
- `api/_routes/content-plan/draft.js` — **extract the generation core** into `api/_lib/producer/draftAtom.js` (everything between atom-claim and response: interview fetch, voice substrate, concept block, campaign context, GBP variants, judge loop, insert, cleanup). The HTTP route becomes a thin authed wrapper; the tick calls the lib directly. This is the highest-risk refactor of the sprint — keep it behavior-identical, and keep the atom `pending→drafting` claim + orphan-cleanup semantics exactly (they're the existing idempotency story).
- `api/_lib/strategistPlan.js` / `api/_routes/cron/weekly-plan.js` — after promotion, insert one inbox item per promoted atom (`kind='draft_atom'`, `dedupe_key='draft_atom:'+atom.id`).
- `api/_routes/cron/agent-tick.js` — `draft_atom` handler with a per-workspace-per-tick drafting cap (default 2) so a 6-slot week drains over ~3 ticks, smoothing spend and the 300s budget.

**Data model.** None new (atoms + inbox + actions cover it). Optionally `content_items.created_by_producer boolean` for analytics — defer unless Q wants the split on `/usage`.

**Model calls / cost.** The sprint's real spend: per atom ≈ 1–2 Sonnet + 1–2 Haiku ≈ $0.04–0.08; a 6-slot week ≈ $0.30–0.50/workspace/week (GBP location variants add 1 Sonnet each). Bounded by `daily_ai_call_cap` and the drip cap. Trivial in dollars; the caps exist for the failure modes, not the unit economics.

**Risks.** *Double-acting with the human*: an atom Q drafts manually flips `pending→drafting→drafted` — the inbox item then no-ops on its status guard (same claim filter), which is exactly the existing concurrent-click defense. *Bulk slop*: the hard gate from Phase 2 is the antidote — below-gate pre-drafts never present as ready. *Timing*: `weekly-plan` runs Mon 05:00 UTC (Sunday evening PT) — pre-drafting completes before the US Monday; note the `mondayOf` UTC-flip gotcha from ARCHITECTURE.md when verifying. *Refactor regression*: gate on a fixture run — draft the same atom via HTTP route and via lib in a branch env; diff the row shapes.

**Q trials it.** Flip pre-drafting on Friday; Monday, count clicks-to-first-approval vs the prior week. One number: minutes from opening `/week` to a fully approved week.

---

### Phase 4 — Initiative: escalation, weekly standup, controls (SIP later)

**Goal.** The producer notices and reaches out — inside channels that already exist (feed, email). Also the full control surface: pause, budget, autonomy level.

**Ships.**
- New sensors → inbox: `publish_failure` (from `notifyPublishFailure`'s once-per-transition hook), `stale_approved` (approved >48h, never scheduled), `plan_gap` (backlog can't fill cadence → "I need 10 minutes of your voice on X" — topic chosen from thin RAG coverage areas), `judge_repeat_failure` (Phase 2 escalations aggregated).
- Severity routing, deliberately boring: feed entry → line in the existing weekly digest (`engagement-digest.js` gains a "Bernard's week" section) → immediate email via `sendEmail` (`notifyAdmin.js`) to owner/producer-tier humans for blocking items only. No new vendors, no push/SMS this sprint.
- `/producer` page controls (owner-gated via `usePermissionTier().isOwner`): pause/resume (writes `producer_config.paused_at`), daily-cap editor, per-lane toggles (revisions / pre-drafting / escalation emails).
- `/usage` (`src/pages/Usage.jsx` + `workspace_usage` read path) gains "Bernard's work": actions, model calls, token totals from `agent_actions`; `/admin` (`AdminUsage.jsx` / `platform-usage.js`) gains the cross-tenant sum — the platform spend cap watchtower.

**Data model.** None new (all reads off `agent_actions` + `producer_config`).

**Risks.** Escalation fatigue — cap immediate emails at 1/day/workspace, everything else digests. Sensor sprawl — every sensor must map to an action the producer or Q can actually take, else it's noise.

**Q trials it.** Disconnect Buffer on a test workspace, approve a piece: watch failure → inbox → feed → email chain. Then pause the producer from `/producer` and confirm total silence.

**Later phase (explicitly out of this sprint):** SIP-outbound weekly call (`cadence_policy` as the initiative clock, GPT-Realtime-2 mint upgrade in `api/realtime-session.js`, remote MCP) — this is where Architecture option C gets re-evaluated.

---

## 4. Double-acting matrix (producer vs the crons)

Rule: for any one decision, exactly one actor. Crons keep acting where they act today; the producer only takes lanes that are currently *nobody's*.

| Lane | Today's actor | Producer's role this sprint |
|---|---|---|
| change_request revisions | nobody | **producer acts** (Phase 1) |
| below-gate drafts | nobody (score decorates) | **producer acts** (Phase 2) |
| approve→dispatch | human's browser | **server acts on human's approval** (Phase 2) |
| atom caption drafting | human click | **producer acts** (Phase 3) |
| week planning/promotion | `weekly-plan` + completion trigger | unchanged — producer consumes its output as sensor |
| story_packages auto-publish | `auto-publish` cron + gate | unchanged — untouched all sprint |
| engagement scoring, GSC, citations, supersessions, books, corpus sync, sweepers, backup | respective crons | unchanged — Phase 0/4 add feed/sensor taps only |

Demoting crons to pure sensors is *end-state* direction, not sprint work — no cron is rewired away from its action this sprint.

## 5. Observability & kill-switch story

- **Per-workspace enable**: `producer_config.enabled` (default **off** for every workspace; Q flips movebetter first). Every producer entry point (tick, comment sensor, approve dispatch extension, gate escalation) checks it.
- **Pause ≠ disable**: `paused_at` stops processing but sensors keep queueing — resume drains the backlog with nothing lost. Surfaced as a one-click on `/producer`.
- **Global kill**: `app_config` key `producer_global_enabled` checked once per tick — one SQL statement stops every workspace without a deploy.
- **Spend caps**: `daily_ai_call_cap` enforced in the tick against today's `agent_actions` model-call count *before* each call; exhaustion logs a feed entry ("hit my budget, resuming tomorrow"), never silent. Token columns on `agent_actions` feed `/usage` + `/admin`.
- **Runaway protection stack**: per-item attempt caps → per-tick item caps → per-day call caps → dedupe-key uniqueness → author-guard on the comment sensor → monotonic posted-sets on anything irreversible.
- **Audit**: `agent_actions` is append-only and doubles as the standup feed — observability and product surface are the same table, so it can't rot.

## 6. Non-goals for this sprint (separate tracks)

- **SIP / outbound calling, realtime mint upgrade** (F1 apex) — later phase, explicitly not front-loaded.
- **Patient-facing anything** (F12) and the **Practice Answer Graph** (F16) — separate track.
- **Promise Ledger / read-back verification as a system** (F17) — only its idempotency pattern is reused.
- **Ambient/treatment-audio capture** — permanently shelved (Q, 2026-06-27). **Synthetic video/avatars** — rejected (Q, 2026-06-21).
- Cross-practice intelligence (F14); replacing Clerk membership with a real agent identity; server-side canvas baking; auto-approval of any kind; Vercel Queues/Workflow migration (upgrade path only).

## 7. Suggested build order & PR slicing

P0: `154`+`155` migrations + `agentActions.js` + instrumentation (1 PR), feed route + UI + Members card (1 PR). P1: `156` + tick skeleton + sensor (1 PR), revision agent (1 PR). P2: hard gate + `judge_low_score` lane (1 PR), dispatch-lib extraction (1 PR, behavior-identical), approve extension + `157` + YourWeek wiring (1 PR). P3: `draftAtom.js` extraction (1 PR, behavior-identical), pre-draft lane (1 PR). P4: sensors+routing (1 PR), controls+usage (1 PR). Each PR leaves prod shippable.

---

*Keep file (planning doc — treat like source per the `.claude/` scratch-vs-keep convention). Companion: `.claude/frontier-panel.md` (vision), `.claude/mockups/answer-graph-v1.html` (signed-off mockup, screen 3 = Phase 0's visual spec).*
