# Moments IA — overnight build plan (2026-07-27)

**Authority:** `.claude/decisions.md` 2026-07-27 "UI flow audit: one Moments concept" (#2418) and the
signed-off mockup `.claude/mockups/moment-ia-direction.html` (tracked; artifact mirror
`82095745-e1ec-4fae-b78d-4a6025294538`). The mockup is the spec — build what it draws, including its
empty/quiet states. Read both from `origin/main` before writing code; do NOT re-litigate the
direction. Sprint spec background: `.claude/moment-bank-sprint.md`.

**Sprint shape:** three parallel sessions, split so no two touch the same files.

| Lane | Steps | Owns (files) |
|---|---|---|
| A | ① provenance → ② /week chip+drawer+copy → ⑤ Home nudge | `YourWeek.jsx`, `Home.jsx`, `week-summary.js`, NEW `api/_routes/moments/summary.js`, NEW `src/components/MomentProvenance.jsx`, `StoryboardPublish.jsx` + review-slice components |
| B | ③ /moments unification | `MomentMiner.jsx` (→ tabs), NEW bank-tab components, `api/_routes/db/moments.js` (PATCH), `components/moments/*` |
| C | ④ Stories reframe | `Stories.jsx`, `stories/*` views, `StoryDetail.jsx`, `stageTokens.js`, stories list API |

Each step ships as its own PR with auto-merge; ≤3 open PRs per session; every PR rebased on current
`origin/main` at open time. `_manifest.generated.js` conflicts are expected across lanes — resolve by
`git checkout --theirs` + `node scripts/build-api-manifest.mjs`, never by hand.

## Shared contract — the on-hand summary endpoint (Lane A builds it; B reads it if merged)

`GET /api/moments/summary` (Node handler shape, full checklist: `workspaceContext` → `requireRole` →
`enforceLimit`; no `detail:` in errors):

```json
{
  "usable": 133,                  // banked AND is_exemplar
  "weeklySlotDemand": 15,         // sum of cadence targets (blogs excluded)
  "runwayWeeks": 8.9,             // usable / weeklySlotDemand; null when demand 0
  "started": true,                // any moments OR any completed interview ever
  "newestInterviewAt": "2026-07-10",
  "gaps": [],                     // open topic_backlog rows with source='bank_gap' → [{id, topic}]
  "composition": { "momentSlots": 13, "legacySlots": 2, "openSlots": 1 }  // current week
}
```

Chip/nudge state rules (mockup §02/§04 — verbatim, do not improvise):
quiet ≥ 4 wks · amber < 4 · red < 1 · **"Not started" is always quiet** (never an alarm before the
first capture) · Home nudge renders ONLY while `started && runwayWeeks < 2`.
Runway is ONE number — never per-channel. Composition is a bar, never a hit-rate %.
Freshness copy keys on **interview date**, never `moments.created_at` (backfill timestamps are all identical).

If Lane B needs summary data before Lane A's PR merges: `git fetch && git log origin/main --oneline
-- api/_routes/moments/summary.js`; if absent, build the header from direct queries and leave a
`ponytail:` note to converge on the endpoint — do not create a second summary route.

## Step specs

### ① Provenance at review (Lane A, first — smallest, highest trust-per-line)
- API: `week-summary.js` items gain `moment: {excerpt, score, interviewTopic, interviewDate}` when
  the atom has `moment_id` (one joined select — no N+1). Same field on the piece-detail read the
  editor/review inbox use.
- UI: one shared `MomentProvenance` component (mockup §02 card: "FROM DR. Q'S WORDS · SCORED 85" +
  verbatim quote + interview + date, spruce left-rail tint). Render in: /week card review/expanded
  state, StoryboardPublish editor, clinician review slice. Absent `moment` → render nothing (legacy
  pieces stay clean).
- Acceptance: the live GBP piece composed from the "car mechanic" moment (Jun 5 interview, score 85)
  shows its quote in all three surfaces, proven by `scripts/capture-screenshot.mjs` crops.

### ② /week chip + drawer + copy sweep (Lane A, after ①)
- Chip: `Backlog · 73` → `On hand · ~9 wks` (states above; count from summary endpoint). Not-started
  workspaces show `On hand · Not started`, quiet.
- Drawer (mockup §02 right): title "What's on hand"; composition bar + legend; Gaps section (real
  empty state today: "No gaps — every planned slot found a matching moment"); Strongest on hand
  (top 5 by score, "Browse all N →" links `/moments`); **Legacy backlog · N** collapsed section =
  the EXISTING BacklogRow list unchanged, with the drain note; section renders only while N > 0.
- Copy sweep (exact stale strings, grep to zero): `"banked as backlog"`, `"from your backlog"`,
  banner `"in backlog"` → on-hand phrasing per mockup. Keep `heldCount` mechanics for the legacy section.
- Acceptance: chip ~9 wks on movebetter; drawer renders all four sections; stale-string grep of
  `src/` returns 0; screenshot crops of chip + drawer.

### ⑤ Home restock nudge (Lane A, after ② — reuses the summary endpoint)
- Mockup §04: one amber block inside the existing interview CTA card. Copy: "Running low — about
  N days of content on hand. A 20-minute conversation restocks roughly a month." Gap topics as
  suggested subjects when present. Renders per the rule above; movebetter today must show NOTHING.
- Acceptance: unit test the render rule (all four states incl. not-started-quiet); live screenshot
  proves absence on movebetter. Groovechiro visual (the one real red) can't be reached by the e2e
  fixture — verify its summary payload numbers instead and leave the visual for Q.

### ③ /moments unification (Lane B)
- Page retitles "Moments" (kill "Moment Miner" identity); tabs `On hand · N` (default) |
  `New from video · N` (the ENTIRE existing miner feed + its Uncut-footage/Has-clips pills,
  functionally unchanged inside the tab) | `Coverage` (existing CoveragePanel + planner topic-gaps
  from `topic_backlog` where `source='bank_gap'`, each with an "ask about this next interview" note).
- On-hand tab per mockup §01: header stats row (runway · newest capture · gaps · Capture CTA),
  search + type/staff/sort filters, moment list rows (score chip, verbatim excerpt, type · topic ·
  linked story · used ×N · clip chip only when `clip_asset_id` set). List, never a grid.
- Row ⋯ menu: **Open story**, **Retire** (quiet — confirm dialog states "stops future use; N planned
  pieces keep their drafts"), retired rows show status + **Restore**. Add `PATCH /api/db/moments`
  (status banked|retired only; UUID_RE on id; workspace-scoped) if not present.
- Route compat: `/moments/clip/:id` and `/slate` deep links keep working; nav match already covers both.
- Acceptance: land on bank list (133 on movebetter); miner feed intact under its tab; retire→restore
  round-trip verified on ONE low-score (≤65) movebetter moment, restored immediately, both states
  screenshot; `usage_count`/planner untouched by the round-trip.

### ④ Stories reframe (Lane C)
- Stage DISPLAY mapping (no DB migration; `story_stage` stays for filters): **Captured** = no banked
  moments yet · **Processed** = moments banked, no uses AND no published pieces · **Yielding** = ≥1
  use or ≥1 published piece. New tokens in `stageTokens.js` (yielding = spruce tint per mockup §03).
  Quick-filter pills (Needs words / In Review / Published) unchanged — they gate piece work, not story identity.
- Table: `Pieces` column → `Yield`: "7 moments · blog ready · no uses yet" / "12 moments · 1 use ·
  last Jul 28" / "13 moments · 8 pieces published" (real shapes from mockup §03). Stories list API
  gains per-story moment aggregates (count, uses, last_used) in ONE query — no N+1.
- StoryDetail: remove the 4-step `PipelineStepper`; Moments section moves above the posts pane and
  defaults OPEN, subtitle "N on hand — this is what your week gets composed from"; Retire here uses
  Lane B's PATCH (if unmerged, ship read-only and note it).
- Empty state rewrite (kills "a cluster of publish-ready drafts") — bank-era copy per direction.
- **Grep `tests/e2e/` for every label/heading you change** (`/stories` is a covered route) and update
  specs in the same PR.
- Acceptance: hip-extension row reads Yielding + "7 moments"; StoryDetail order proven by screenshot;
  e2e stories spec green.

## Overnight hazards (all lanes)

- **Tonight is Sunday→Monday: the `0 4 * * 1` UTC crons fire mid-sprint** (sweep-past-weeks, then
  weekly-plan). The /week board and atom rows WILL change under you around 9pm Pacific. Don't
  diagnose that as your bug; re-query before/after comparisons around the cron window.
- Verify on prod post-merge with `scripts/capture-screenshot.mjs` (fixture user) — Q's Chrome is
  unavailable overnight. PWA: confirm the live SHA via `/version.json` and cache-bust before screenshots.
- Mutation discipline: the retire→restore round-trip in ③ is the ONLY intended data mutation in this
  sprint. No test rows, no seed data, nothing fabricated.
- Full-bleed rule applies to every touched page root. Lint ratchet stays 0. DoD checklist applies per PR.
- If a lane finds its scoped files changed by a sibling PR: rebase, regenerate the manifest, continue —
  the lane split above is the collision map, trust it over improvised scope changes.
