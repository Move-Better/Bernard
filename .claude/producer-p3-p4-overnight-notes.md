# Standing Producer P3 + P4 — overnight backend build (handoff)

**Run:** unattended overnight, 2026-07-02. **Both deliverables are DRAFT PRs — nothing merged, nothing deployed, no prod migration, producer stays OFF.**

## The two draft PRs

| PR | # | URL | Base | Status |
|---|---|---|---|---|
| **A — P3 pre-draft the week** | #1886 | https://github.com/Move-Better/Bernard/pull/1886 | `main` | DRAFT, no auto-merge |
| **B — P4 "needs you" (read-only stub)** | #1888 | https://github.com/Move-Better/Bernard/pull/1888 | `feat/producer-p3-backend` (stacked on A) | DRAFT, no auto-merge |

Branches pushed: `feat/producer-p3-backend`, `feat/producer-p4-needs-you`. Both off `origin/main` @ `2b1c7702` (P2A.2). Worktree used: `/Users/qbook/Claude Projects/Bernard-worktrees/producer-p3-backend` (a NEW worktree I created via `scripts/new-session-worktree.sh` — I did NOT touch this session's own worktree beyond writing this one notes file).

**Merge order in the morning:** merge #1886 first, then #1888 auto-retargets/rebases to `main` (or retarget it manually to `main` after A lands). B only imports one file from A (`config.js`).

---

## ⭐ #1 THING TO VERIFY: the draftAtom refactor is behavior-identical

The one real risk in this whole run is the `draftAtom` extraction from `content-plan/draft.js` (PR A). I verified it with a **fixture-diff harness** that intercepts `generateText`, stubs Supabase `fetch` with identical fixtures for both runs, runs the ORIGINAL inline block (sliced verbatim from `origin/main:draft.js` lines 99–336) vs the NEW `draftAtom`, and diffs the recorded model-call args (model output is nondeterministic, so it compares the **prompt + params**, which are deterministic).

**Result — BYTE-IDENTICAL:**
```
BEFORE generateText calls: 4    AFTER generateText calls: 4
[0] IDENTICAL  anthropic/claude-sonnet-4-6  tok=1000  instr=5042  msgs=5   (gen attempt 1)
[1] IDENTICAL  anthropic/claude-haiku-4-5   tok=240   instr=901   msgs=1   (voice judge 1, below-gate)
[2] IDENTICAL  anthropic/claude-sonnet-4-6  tok=1000  instr=5042  msgs=7   (coached regen)
[3] IDENTICAL  anthropic/claude-haiku-4-5   tok=240   instr=901   msgs=1   (voice judge 2)
✅ PASS — BEFORE and AFTER generateText calls are BYTE-IDENTICAL (prompt + params)
```
No sampling params (temperature/top_p) leaked. Same model ids, same maxOutputTokens, same instruction strings (5042/901 chars), same message counts.

**Harness lives in the SCRATCHPAD (session-temp, not committed):**
`/private/tmp/claude-501/.../scratchpad/` → `fixture-diff.mjs`, `ai-stub.mjs`, `ai-loader.mjs`, `ai-loader-register.mjs`, `draft-atom-before.mjs` (auto-assembled by `build-before.py` from `git show origin/main:...draft.js`), `fixture-diff-result.txt`. If you want to re-run it, that temp dir may be gone by morning — regenerate by re-slicing `origin/main:api/_routes/content-plan/draft.js`. The proof is also pasted in PR #1886's body.

**Also cheap to sanity-check the refactor by eye:** `git show origin/main:api/_routes/content-plan/draft.js` and diff the extracted lib against it — the block moved into `draftAtom.js` verbatim; the route now just calls `draftAtom()` + `buildGbpLocationVariants()` and keeps its auth/DB-write/`recordAgentAction` concerns. The voice-score PATCH now uses `draftAtom`'s returned `voiceAudit` (identical computation) instead of recomputing the gate inline.

---

## What each file does

### PR A (P3) — `feat/producer-p3-backend`
- **`api/_lib/producer/config.js`** (new) — `producerActive(config)` (enabled && !paused_at) + `laneEnabled(config, lane)` with the backward-compatible `LANE_DEFAULTS` map: `answer_change_requests:true, auto_repair_captions:true, pre_draft_week:FALSE (opt-in), escalation_email:true`. An existing `{enabled:true}` workspace with no `lanes` object keeps its exact prior behavior. Pure, no I/O.
- **`api/_lib/producer/draftAtom.js`** (new) — `draftAtom({ws, atom, interview})` = the grounding + generate + voice-judge + slide-split + gate core, extracted verbatim. Returns `{caption, slides, voiceScore, voiceAudit, voiceAttempts, gate, staffName, model, aiMessages, gbpContext}`. Does NO DB writes. Also `buildGbpLocationVariants({...})` = the GBP per-location fan-out (also extracted verbatim; returns the `location_overrides` object, caller PATCHes).
- **`api/_lib/producer/predraftWeek.js`** (new) — `predraftWeek({ws, cap})` discovers next-Monday scheduled atoms with no draft yet (+ `interview_id`), and `predraftOneAtom` claims `pending→drafting` (same optimistic guard as draft.js), fetches the interview, calls `draftAtom`, inserts a `status='draft'` content_item with `voice_audit.predrafted=true`, fans out GBP variants, marks the atom drafted, records a `draft_created` action. Idempotent; per-invocation cap; orphan-cleanup on failure (mirrors draft.js).
- **`api/_routes/content-plan/draft.js`** (changed) — now delegates the generation/judge/GBP portion to `draftAtom` + `buildGbpLocationVariants`; keeps req/res/auth/atom-claim/DB-write/`recordAgentAction`. Byte-identical behavior. Removed now-dead imports (generateText, getAtomSystemPrompt, getContextBlock, practiceMemory, tentpole helpers, provenance, fidelity rubric — all moved into draftAtom).
- **`api/_routes/cron/agent-tick.js`** (changed) — added an opt-in pre-draft step AFTER the inbox loop: gated on `laneEnabled(cfg,'pre_draft_week')`, bounded by `min(cfg.predraft_per_tick||2, remaining daily budget)`, skipped past the deadline; decrements `remaining`. Enabled-workspace filter now uses `producerActive()` (pause-aware; semantically identical to the prior inline `enabled && !paused_at`).

### PR B (P4) — `feat/producer-p4-needs-you` (stacked)
- **`api/_routes/producer/needs-you.js`** (new) — `GET`, Node `(req,res)`. `workspaceContext → requireRole(null) → enforceLimit` order; opaque errors; `workspace_id` on all 4 queries. Returns `{enabled: producerActive(config), items, counts, pausedAt}`; disabled OR paused → `{enabled:false, items:[]}`. Three read-only categories: **escalated_caption** (`content_items status='draft' AND voice_audit->>escalated=eq.true`), **publish_failed** (`agent_actions kind='publish_failed'` in the last 24h, minus any superseded by a later `kind='published'` for the same content_item), **plan_gap** (next-week scheduled atoms with `interview_id IS NULL` — can't be drafted, need the human's voice). Marked a STUB with `TODO(morning)` pointing at the approved mockup for final field/copy.
- **`api/_routes/_manifest.generated.js`** (changed) — regenerated (197→198) via `node scripts/build-api-manifest.mjs`; registers `/api/producer/needs-you`. The big line count is just the alphabetical `h<N>` renumber, not hand edits.

---

## Decisions I made where the spec was ambiguous

1. **ZERO new migrations (design goal met).** Verified: `agent_inbox.kind` and `agent_actions.kind` are free text (no CHECK — confirmed in `154_agent_actions.sql` / `156_agent_inbox.sql`), and `producer_config` is free JSONB (`155_producer_config.sql`, no CHECK). So the new `lanes`/`predraft_per_tick`/`daily_spend_cap` config keys and the `voice_audit.predrafted` marker need no schema change. **No migration is flagged for morning application — none is required.**
   - Aside: `agent_inbox.status` CHECK is `('pending','claimed','done','failed','skipped')` — note it's `skipped`, NOT `dismissed` as the sprint-plan draft text said. Didn't matter for P3/P4 (I added no new inbox status), but worth knowing.
   - I did **not** add a `draft_atom` inbox kind. The spec's Phase 3 mentions enqueueing `draft_atom` inbox items from `weekly-plan`, but that couples pre-draft to the strategist's write path and adds a sensor. I instead did **slot-discovery inside the tick** (predraftWeek queries next-week undrafted atoms directly) — simpler, fewer moving parts, no inbox-kind or weekly-plan change, and still idempotent via the `pending→drafting` claim. If you prefer the inbox-driven design later, the discovery query is the seam.

2. **Planned-slot representation** (confirmed from `week-summary.js` / `plan-week.js` / `strategistPlan.js` / `strategist.js`): a planned slot = a `content_plan_atoms` row with `plan_week=<Monday>` and `scheduled_at` set. Strategist atoms DO carry `interview_id` (validated against the week's real interviews — `strategist.js:278`). "Needs a draft" = `status='pending' AND content_piece_id IS NULL AND scheduled_at NOT NULL AND interview_id NOT NULL`. Upcoming week = `mondayOf(now + 7d)` (UTC, matches the codebase's `mondayOf`).

3. **Config retrofit choice (per the spec's optional item):** I did **NOT** retrofit `reviseContentItem`/`regradeContentItem` gating to `laneEnabled(...)`. They currently gate via `producer_config.enabled` (through `agentActions`/the tick's enabled-filter) and default-on behavior is preserved by `LANE_DEFAULTS`. Leaving them as-is is the zero-behavior-change path the spec said to prefer "if in any doubt." The `config.js` helper is wired only where P3/P4 need it (the tick's pre-draft gate + needs-you). If you WANT per-lane on/off for revise/repair later, add `laneEnabled(cfg,'answer_change_requests'|'auto_repair_captions')` checks in the tick's `dispatch()` — safe because they default true.

4. **plan_gap definition** — the spec describes it loosely ("backlog can't fill cadence"). I chose the truest, infra-free signal: upcoming-week scheduled atoms with NO interview (`interview_id IS NULL`) — genuinely un-draftable, the human must capture. If the morning mockup wants a broader "thin coverage" gap, that needs the RAG-coverage read the spec hints at (heavier; deferred).

5. **GBP variant extraction** — I extracted the GBP per-location loop into `buildGbpLocationVariants` (in draftAtom.js) so BOTH the route and pre-draft fan out identically (DRY, no drift). The only observable change: location-variant failure logs now read `[draftAtom]` instead of `[content-plan/draft]`. Harmless.

---

## Verify-carefully-in-the-morning list (priority order)

1. **★ draftAtom behavior-identity** — trust but re-glance: the fixture-diff proof is in PR #1886's body and was byte-identical. If paranoid, diff `api/_lib/producer/draftAtom.js` against `git show origin/main:api/_routes/content-plan/draft.js` lines 99–336 + the GBP loop.
2. **Pre-draft stays OFF for everyone** — confirm no workspace has `producer_config.lanes.pre_draft_week=true` (none should; it's opt-in and I changed no config). To trial: set that lane true on movebetter ONLY, then watch a tick pre-draft next-week slots as `status='draft'` (never approved). Kill switch: unset the lane, or `paused_at`, or `PRODUCER_GLOBAL_DISABLED=1`.
3. **Daily-cap interaction** — pre-draft spends model calls counted in `todaysAiCalls` on the NEXT tick (via the `draft_created` action's `model` field) and decrements `remaining` in-tick. Confirm a pre-drafting workspace doesn't blow the cap: the tick still returns early if `spent >= dailyCap`, and pre-draft only runs while `remaining > 0`.
4. **needs-you against real data** — hit `/api/producer/needs-you` on an enabled workspace (post-merge, via Q's Chrome per CLAUDE.md, or curl the apex → 400 = deployed). It's read-only, safe to probe. Refine fields/copy against the approved mockup (TODO in the file).
5. **Stacked-PR merge order** — merge #1886 before #1888.

---

## Gate results (final, on the full stack = PR B tip which includes PR A)

```
typecheck        → tsc --noEmit           (exit 0)
lint             → eslint … --max-warnings 0   (exit 0, 0 warnings)
build            → vite build             ✓ built in 2.52s
verify-bundles   → 228 passed, 0 failed
verify-api-manifest → ✓ api manifest in sync (198 routes)
```
Also: fixture-diff harness ✅ byte-identical; predraftWeek functional smoke ✅ (3 candidates → 2 drafted at cap, all status=draft+predrafted, none approved); supersession + producerActive gating smoke ✅.

---

## Residual risks / things I could NOT fully verify unattended

- **No live model / DB run.** All verification used stubs (no `AI_GATEWAY_API_KEY`/`OPENAI_API_KEY`/Supabase in the harness). The prompt-construction is proven identical; the *end-to-end* pre-draft against real prod data (real interview transcripts, real GBP locations, real gateway) has NOT run. First live trial should be movebetter-only with the lane on, watching `/producer` + the DB.
- **`recordAgentAction` model tag on the interactive route** is `anthropic/claude-haiku-4-5` (line ~202 of draft.js) — that's the ORIGINAL value from `origin/main` (odd, since drafting is Sonnet). I preserved it exactly for behavior-identity; predraftWeek's own `draft_created` action correctly tags `anthropic/claude-sonnet-4-6`. If the haiku tag on the route was a pre-existing bug, it's out of scope for this run — flagging it, not fixing it.
- **plan_gap semantics** may not match what the morning mockup wants (see decision #4). Easy to adjust the one query in `needs-you.js`.
- **The RAG embedding step** (`resolveOwnHistoryBlock` → `searchPracticeMemory`) threw `OPENAI_API_KEY not set` in the harness but is best-effort (returns `''`), so it didn't affect the prompt diff. In prod it will run normally; just noting the harness couldn't exercise that path with real embeddings.
