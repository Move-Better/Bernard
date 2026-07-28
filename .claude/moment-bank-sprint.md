# Moment Bank — sprint spec

**Origin:** planning session with Q, 2026-07-27. This doc is the build spec; the decision record
(with kill criteria) is in `.claude/decisions.md` under the same date. Read both before building.
Phases are sequential PRs/sessions except P1, which is independent and ships first.

## STATUS — 2026-07-28: P1–P4 SHIPPED AND LIVE; only P5 remains (deferred)

Everything below except P5 is built, merged, and live in prod. This doc is now the historical
spec; current truth lives in `.claude/decisions.md` (2026-07-27 entries) and the memory index.

- **P1** ✅ #2402 — `api/_routes/cron/sweep-past-weeks.js` (Mondays 04:00, before weekly-plan).
  Backfill resolved the stranded pile: 0 open drafts in closed weeks across all workspaces.
- **P2** ✅ #2401 + #2405 — migration 191, extraction at completion, backfill of all 23 completed
  interviews (208 moments, avg score 75.3, bar=60 provisional). Extraction zod schema must stay
  permissive; limits live in `sanitizeProposals` (#2405).
- **P3** ✅ #2408 + #2409 + #2410 — migration 192, `momentPlan.js` composes atoms on demand
  (`momentWindow()` feeds generation AND the fidelity judge), bank mode flag-gated then enabled on
  **all 7 workspaces** after Q approved the 2026-08-03 movebetter week (15 slots, 12 distinct
  interviews). Coverage floor calibrated to 0.40 (#2409); #2410 fixed allocateToCadence
  double-planning (applies to legacy mode too).
- **P4** ⚠️ **SUPERSEDED as written, then shipped in its replacement form.** A fresh-session UI
  flow audit with Q (decision #2418, 2026-07-27) replaced the Library-tab + Bank-card plan with
  **one "Moments" concept at `/moments`** ("on hand" phrasing, one runway number, Miner feed as
  intake tab, NO Library tab, NO Overview card). Its build order ①–⑤ ALL SHIPPED 2026-07-28:
  ① provenance-at-review #2421 · ② /week chip+drawer #2425 · ③ /moments unification #2422 ·
  ④ Stories reframe #2420 · ⑤ Home restock nudge #2426; retire/restore wiring #2427.
  `/api/moments/summary` is the runway source of truth.
- **P5** — still deferred; unchanged below. Needs its own challenge gate with Q before any build.

Live pulse at status time: 208 moments on hand, 13 used, 43 moment-composed atoms, 0 retired,
0 `bank_gap` rows (no campaign miss yet). Kill criteria + revisit 2026-09-15 in decisions.md,
plus #2418's own: on-hand browse unused by 9-15 → demote browse depth; a fired restock nudge
producing no capture within 2 weeks → rethink the loop.

## Problem (evidence, not vibes)

- Interview completion batch-generates atoms/drafts (avg 7.1, max 12 per interview). Last 90 days
  on movebetter: 15 interviews → 106 drafts, **38.7% publish rate**, 45 drafts still open past 14
  days. The queue absorbs ~14 pieces/month; capture manufactures ~35/month. At the target scale
  (5 clinicians × 1 interview/month) this becomes ~60/month into the same queue — unworkable.
- Consumption already behaves like a bank: of 41 published pieces, 17 shipped **>4 weeks** after
  their interview. Production is batch; consumption is drip. That mismatch is the bug.
- Demand mismatch: interviews cluster on whatever was captured (4 back-pain interviews) while the
  clinic's current need (knee-pain seminar ad) finds nothing. Content must flex to the clinic's
  needs, not the clinic to the content's.
- Nothing cleans up past weeks: `plan-week.js` makes past weeks read-only, no cron touches
  `content_plan_atoms`, so drafted-but-unpublished pieces strand forever (the 45 stale rows).

## Locked decisions (Q, 2026-07-27 — do not relitigate in build sessions)

1. **One-source anchor.** Every published piece anchors to exactly ONE interview moment. No
   blending across moments/interviews — that's where fabrication risk lives and it breaks the
   fidelity judge's reference model.
2. **Blogs bypass the bank entirely.** Interview → blog drafted and published the same week,
   through the existing longform pipeline (`api/_lib/longformEngine.js`), clinician `in_review`
   flow unchanged. A blog is long-form synthesis of one whole interview; freshness matters
   (SEO/answer graph). The blog is the interview's immediate artifact; moments are its long tail.
3. **Reels = moment × video asset**, two lanes. Lane A: interview clips cut at capture time into
   the media library (footage only exists then), tagged with their moment; afterwards they're
   ordinary library assets. Lane B: composed reels — any banked moment over b-roll with burned
   captions (cloned voice permitted; generative video still banned). Reels are NOT structurally
   tied to interviews.
4. **Capture + top-up, not capture-only.** Interview completion drafts only 1–3 hot pieces (best
   moments, filling THIS week's open slots) instead of the full batch. The rest banks.
5. **Stale drafts: return-to-bank + delete, never roll-forward.** A draft composed for a past
   week's context is stale by construction; the moment persists, regeneration is cheap.
6. **Approve-once (trust ramp) is phase-gated LAST** (P5) and needs its own challenge gate before
   building. Per-piece approval stays until bank quality is proven. Queue relief comes from
   drafting less, not approving less.
7. **Stories reframe:** a story = the interview + its yield (blog, moments, provenance list of
   pieces composed over time). Weekly workflow lives on /week; Stories is the source archive.

## Data model (P2 — refine in build, this is the shape)

```sql
CREATE TABLE public.moments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  interview_id uuid NOT NULL REFERENCES public.interviews(id) ON DELETE CASCADE,
  staff_id uuid REFERENCES public.staff(id),          -- see staff-FK note below
  excerpt text NOT NULL,                               -- VERBATIM from transcript
  anchor jsonb NOT NULL,                               -- {msg_idx,char_start,char_end} or {t_start,t_end}
  clip_asset_id uuid REFERENCES public.media_assets(id), -- Lane A: the cut clip, if video
  topic text, region text, tags text[],
  score int,                                           -- 0-100 at extraction
  embedding vector(1536),
  cluster_id uuid,                                     -- dedup cluster
  is_exemplar boolean NOT NULL DEFAULT true,           -- best-of-cluster; planner only draws exemplars
  status text NOT NULL DEFAULT 'banked'
    CHECK (status IN ('banked','retired')),            -- usage is a counter, not a status
  usage_count int NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  review_by date,                                      -- freshness/expiry pass
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.moments TO service_role;
```

Build-session cautions (all have bitten before, see CLAUDE.md): grants inline in the migration;
apply to prod + refresh `supabase/expected-schema.json` in the same PR; status values need the
CHECK updated via migration if extended; **adding `staff_id` as a FK touches the staff
delete/merge discipline** — decide CASCADE vs SET NULL deliberately and update `merge_staff`
(migration 112) + the 12-table repoint list to include `moments`.

## Phases

### P1 — Past-week cleanup cron (independent; ship first; no dependency on moments)
Weekly cron (pattern: `api/_routes/cron/weekly-plan.js`) that, for each workspace, for weeks
older than the current one: (a) undrafted planned atoms → return to backlog (`held_at` set,
week/slot cleared); (b) drafted-but-unpublished `content_items` → archive/delete the draft and
return the atom to backlog. Never touch published/scheduled-future rows. Idempotent. Log counts.
- Check `content_items`/`content_plan_atoms` status CHECK constraints before inventing an
  'archived' value (grep `_status_check` in migrations).
- Acceptance: after one run on movebetter, zero open drafts anchored to closed weeks; the 45
  current stale rows are resolved; /week past views still render (read-only history intact —
  don't break `week-summary.js`'s 8-weeks-back view).
- Also run once as a manual backfill for the existing pile.

### P2 — Moments table + extraction + scoring + dedup
- Migration above. Extraction on interview completion, hooked where `replanWorkspaceWeek` fires
  today (`api/_routes/db/interviews.js` ~553–570), via `waitUntil` (nested awaits per CLAUDE.md).
- Expect 10–15 usable moments per interview, not 30–50: score at extraction (reuse/extend
  `api/_lib/scoreMoments.js` patterns; video interviews already have segment scoring —
  `segmentDetect.js`, `scoreMomentsVisual.js`) and bank only above a bar.
- **Dedup is the real engineering:** embed, cluster against the workspace's existing moments
  (4 back-pain interviews ⇒ many near-dup moments), keep the best exemplar per cluster,
  non-exemplars stay linked but the planner never draws them. Without this the bank reproduces
  cross-interview sameness — the thing sibling-caption dedup (#2270) fought within one interview.
- Video interviews: link `clip_asset_id` when the per-turn clip exists (video-pipeline roadmap).
- Backfill: extract moments from ALL historical completed interviews (210+ interviews have
  transcripts; transcript_words backfill is complete). `--limit`/dry-run discipline per CLAUDE.md.
- Read-only surface: moments list on StoryDetail (excerpt, score, status, usage) — cheap, and it's
  how Q builds trust in extraction quality before the planner depends on it. No mockup needed for
  a read-only list section IF it follows existing StoryDetail patterns; anything more, mockup first.
- Acceptance: a completed interview yields scored, deduped moments visible on its story within
  ~1 min; backfilled bank exists for movebetter; a written spot-check by Q of one interview's
  extraction quality.

### P3 — Planner composes from the bank
- `getWeekInputs`/`replanWorkspaceWeek` (`api/_lib/strategistPlan.js`): the backlog input becomes
  exemplar moments (topic/region/freshness/usage-aware), and atoms are COMPOSED on demand for the
  week being planned (angle chosen against this week's context: campaigns, cadence gaps, season)
  instead of pre-generated per interview. Atom keeps `interview_id` + gains `moment_id` (or the
  brief embeds the excerpt + anchor) so the fidelity judge gets the tight verbatim window.
- Interview completion stops batch-generating the full atom grid; drafts 1–3 hot pieces for the
  current week's open slots (decision 4). Blogs untouched (decision 2).
- Usage accounting: composing/publishing from a moment bumps `usage_count`/`last_used_at`;
  cooldown so the same moment isn't drawn twice in a window (media reuse counter precedent).
- Campaign pull: campaign planning (`campaign-spin.js`, tentpole context) queries the bank by
  topic; **bank-miss writes a `topic_backlog` row** (source e.g. 'bank_gap') so the next
  interview gets primed — the F16 answer_gap loop, generalized. This is the knee-seminar fix.
- Acceptance: a planned week on movebetter draws from ≥2 different past interviews; a campaign
  topic with zero bank coverage produces a topic_backlog row; per-piece fidelity gate still runs
  and scores against the moment's window; no change to blog behavior.

### P4 — Surfaces [SUPERSEDED by decision #2418 — do NOT build this section; kept for the record]
- Library tab: moments as a third asset kind (search by topic, score, usage, freshness, retire
  action). This later becomes the approval surface for P5.
- Bank card on /week (or Overview): runway per channel (weeks of inventory at current cadence),
  coverage gaps ("gaps: knee, headaches" → links to topic_backlog), expiring-soon count.
  Monitoring lives here — NOT PostHog (it's inventory ops, not user telemetry). Four signals only:
  runway, coverage, freshness, planner hit-rate. No dedicated dashboard page.
- Stories yield column: "14 moments · 9 uses · last used Jul 20" replacing draft-completion
  framing; story stage machine simplifies to captured → processed → yielding.
- Acceptance: mockups signed off before code (`git add -f` the approved mockup per convention);
  post-deploy Chrome verification per CLAUDE.md.

### P5 — Approve-once trust ramp (DEFERRED — not in this sprint's scope)
Do not build without a fresh challenge gate with Q. Sketch for the record: approval object is the
moment ("I said this, it's accurate"), per-moment guardrails (review_by, usage cap, revocation via
the F16 supersession pattern), graduated per channel starting with GBP/carousels, weekly digest
review (engagement-digest precedent), promos-with-dates and patient-adjacent stay per-piece
forever.

## Sequencing & session hygiene

- One phase per session/PR-group; P1 is parallel-safe with anything; P2→P3→P4 strictly sequential.
- Before each phase: `git fetch && git checkout -b <branch> origin/main`; re-read this doc from
  origin/main (sibling sessions may have amended it).
- Prompt changes (atom composition) get an OLD-vs-NEW harness on real transcripts per the
  CLAUDE.md recipe before shipping.
- The planner change (P3) alters what movebetter actually publishes — verify a full planned week
  against real data with Q eyeballing before enabling for all workspaces (workspace-flag the
  cutover if needed).

## Open questions — ALL RESOLVED during the build (answers for the record)

- P1: archive (existing unconstrained `content_items.status` value; no migration needed).
- P2: bar=60, provisional, from the backfill distribution (peaks 70–89; ~16% below).
- P3: one code path — completion chains extract→replan, no grid fallback in bank mode.
- P4: neither — the #2418 audit replaced both options with the /moments home + /week chip.
