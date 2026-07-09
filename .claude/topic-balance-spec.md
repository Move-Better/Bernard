# Topic-Balance Engine — spec (locked 2026-07-08)

Prevents unintentional topic/body-region flooding in the content feed (the "everything is
foot/ankle" symptom) while letting campaigns intentionally lean into a theme. Decided with Q
via design interview.

## Root cause (grounded in prod)
- Every interview fans out into ~4–8 pieces, each published across up to 3 channels.
- Skew is a **temporal drainage** artifact: two foot interviews drained into the same 10-day
  window → live feed hit ~36% foot, even though over 90 days Spine/Low-back is the biggest
  region (30%) and Foot/Ankle is 16%. → a **rolling-window cap**, not a total cap, is correct.
- No code chooses topic; topic is free-text at interview time. No region concept existed.

## Design (two lanes)
1. **Evergreen lane** — non-campaign content, balanced **by region**: no single region exceeds
   ~30% of a rolling **21-day window, per channel**. Over-budget atoms are **deferred**
   (`content_plan_atoms.held_at` — already exists) and interleaved into later weeks.
2. **Promo lane** — campaign-attributed content draws from a separate **≤40% of feed** budget
   that **ramps toward `event_at`** (a seminar surges in its final week). Multiple campaigns
   share this one capped lane, weighted by days-to-event → composes automatically. Region-less
   campaigns (e.g. Rosehaven community) use promo airtime without touching region balance.
- Campaigns count as "live" by **date window** (`now() BETWEEN start_at AND end_at`), NOT
  `status` — several seminars sit `status='active'` past `end_at` (fix the stale-active hygiene).
- **v1 = balance only.** No input-nudging (don't prompt "record a knee interview") yet.

## Taxonomy (12 buckets — `api/_lib/topicRegion.js`)
foot-ankle · knee · hip · spine-low-back · neck · shoulder · arm · movement-philosophy ·
running · training-principles · events-seminars · general. Primary `region` + optional `theme`.
`general` is exempt from the cap (catch-all, not a real theme). Classifier validated 16/16 on
Move Better's real topics (Gemini flash via AI gateway, temp 0).

## Phases
- **P1 — tagging** ✅ SHIPPED (#2005, LIVE on prod): taxonomy+classifier module, migration 164
  (region/theme on interviews + content_items + index), classify-on-complete hook (waitUntil),
  draft-time inheritance, backfill (movebetter 0 null, verified). `scripts/backfill-content-region.mjs`.
- **P2 — evergreen cap** ✅ SHIPPED (#2011, auto-merge armed): rolling-window region cap in
  `allocateToCadence` (strategist.js) — 30% / 21-day / per-channel; over-budget → deferred (held);
  FLOOR=2/MIN=4 guards; RECENT REGION MIX nudge in `buildStrategistPrompt`. 21-day per-channel
  window query in strategistPlan.js `getWeekInputs`. 6 unit tests.
- **P3 — promo lane / campaign director** ✅ SHIPPED (#2019, auto-merge armed): campaign-attributed
  pieces (interview.campaign_id → live campaign) ride a region-cap-EXEMPT promo lane, reserved
  round(target × promoShare) slots (min 1), promoShare 0.15→0.40 by event proximity via shared
  campaignWeight. Liveness = getActiveCampaigns (date-window, excludes stale-active). promoShare=0
  degrades to evergreen. 3 unit tests. strategist.js allocateToCadence + strategistPlan.js.
  NOTE: 3 expired seminars still read status='active' cosmetically — getActiveCampaigns date-filters
  so no behavior impact; optional cleanup: UPDATE campaigns SET status='archived' WHERE end_at<now().
- **P4 (optional, not built)** — balance readout on Your Week (current mix + deferrals).

## Status: engine COMPLETE (P1+P2+P3 shipped). Flood fixed by P1+P2; intentional lean by P3.

## Insertion points (from pipeline trace)
- Planner: `api/_lib/strategist.js` — `allocateToCadence` (~156), `buildStrategistPrompt` (~212,
  variety line), `assignSlots` (~94). Orchestrated by `strategistPlan.js` `replanWorkspaceWeek`.
- Interview complete hook: `api/_routes/db/interviews.js` (alongside summarizer, `waitUntil`).
- Atom→item topic flow: `api/_lib/producer/draftAtom.js` (writes `topic: interview.topic`).
- Atoms carry `interview_id` + `held_at`; no topic column (join to interviews for region).
