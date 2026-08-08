# Audit Calibration

Maintained automatically by `/audit` and `/auditfull` (Phase 3 synthesis). This file is
**force-tracked** (`git add -f`) despite living inside the gitignored
`.claude/audit-history/` directory — audit *reports* stay local/ephemeral per-developer
(existing convention), but this one file needs to survive into a fresh worktree so the
audit gets sharper each run instead of re-litigating the same ground. Same pattern as
force-tracking a signed-off mockup out of the otherwise-gitignored `.claude/mockups/`.

Every agent prompt in Phase 2 is given this file's contents before it starts.

## Known false positives / intentional design

<!-- Entries here tell agents "don't re-flag this unless the code changed." Format:
- [agent] file:line — what was flagged — why it's not actually a problem (YYYY-MM-DD)
Add an entry when a finding is reviewed and judged not-a-bug (intentional pattern,
accepted risk, dead code path that can't execute, etc). Remove an entry if the cited
code is later touched in a way that could reintroduce the issue. -->

- [ui-reviewer] src/pages/Usage.jsx:118,141 — `bg-primary/45` flagged as a bare-fraction
  compile failure by ui-reviewer's own (incomplete) safe-fraction list — DISPROVEN by
  direct compiled-CSS check (`grep -o 'bg-primary\/45{...}' dist/assets/*.css` finds it,
  full background-color rule present). `/45` compiles fine; the bug is specifically
  `/6`, `/8`, `/11`, `/12`, `/13` (see the P1 finding). Don't re-flag `/45`, `/55`, `/65`,
  or `/85` — all four were checked against the real build this run and all compile.
  (2026-07-31)

- [ui-reviewer] src/pages/Analytics.jsx:284-304 — SEO "Total clicks"/"Branded clicks"
  rendering smaller than "Non-branded clicks" is DELIBERATE HIERARCHY, confirmed by Q
  (2026-08-08): non-branded organic traffic is the SEO signal that means something;
  total and branded are supporting context and are meant to read as secondary. Flagged
  independently by two audits (07-31, 08-08) before being settled — do not report the
  size difference again. A finding here is only real if the EMPHASIS INVERTS (branded
  or total rendered larger than non-branded) or the non-branded stat loses its
  prominence entirely. (2026-08-08)

## Chronic / recurring (flagged 2+ audits running, still unresolved)

<!-- Auto-appended by Phase 3 synthesis when a finding matches an entry in "Findings
snapshot" below and wasn't fixed in between. Format:
- [agent] file:line — problem — first flagged YYYY-MM-DD, seen again YYYY-MM-DD (Nx)
Remove an entry once the finding stops appearing (i.e. it got fixed). -->

_(none — the Analytics.jsx SEO stat-hierarchy item that reached 2x on 2026-08-08 was
resolved by Q the same day as intentional emphasis and moved to "Known false positives"
above. Nothing else is carrying forward unresolved.)_

## Findings snapshot (for next run's recurrence check)

<!-- Auto-overwritten every run by Phase 3 synthesis with a flat list of THIS run's P0/P1
findings (file:line + one-line problem + date). Audit reports themselves are gitignored
and don't survive into a fresh worktree, so this snapshot — inside the one force-tracked
file — is what the NEXT run diffs against to detect recurrence. After comparing, the next
run overwrites this section with its own snapshot. -->

From the 2026-08-08 since-last run (report: 2026-08-08-0912.md, range 8e6b1c9d..17389ed1).
Items marked FIXED were repaired in-session; if one reappears, that's a regression — report
at P1 minimum. From the 2026-07-31 snapshot: all 4 FIXED bug/tenant items re-verified holding
(agent-tick untouched, copy-to-platforms/coaching/opacity guards intact); the teal-Approve
[ui] item shipped and was confirmed fixed app-wide (EditorWorkflowBar.jsx:412,
AssetsPane.jsx:791, OnHandTab.jsx:305, VideoEditor.jsx:2107, WordsApproval.jsx:167 — all
`variant="success"`); Analytics.jsx hierarchy recurred → moved to Chronic.

- [bug] src/lib/publish.js:257 — dispatchBrief "Schedule" mode created the row pre-set to
  status='scheduled', which the publish route's cross-path double-publish guard
  (social.js:244) read as already-dispatched → returned alreadyDispatched:true and NEVER
  called runBundlePublish. Silent no-op reported as success — 2026-08-08 (FIXED same
  session: create at 'draft', server's dispatchCommitFields is the only terminal-status
  writer)
- [bug] api/_lib/blogTarget.js:93 — "archived rows don't count" checked
  status==='archived', a value that doesn't exist in VALID_STATUSES (archiving is the
  archived_at timestamp); both callers' SELECTs didn't fetch archived_at. Archived blogs
  still counted toward the monthly target and could suppress the nudge — 2026-08-08
  (FIXED same session: check archived_at, SELECTs updated, test now uses the real
  mechanism)
- [bug] api/_routes/db/interviews.js:434-479 — fan-out re-entrancy guard read-then-insert
  race can duplicate per-platform rows under concurrent completion PATCHes — 2026-08-08
  (FIXED same day, migration 209 + per-platform inserts tolerating 23505. The discriminator
  question was settled by measuring prod, not reasoning: a blanket unique index would have
  collided with 40 existing groups — 39 content-plan (instagram/linkedin/facebook/gbp,
  excluded by the platform list) and 1 split-into-series blog group (excluded by
  `series_id IS NULL`). Zero duplicates in the resulting scope. Note PostgREST's
  `on_conflict=` CANNOT infer a partial index, which is why the insert loops per platform
  instead of batching. tests/lib/fanoutUniqueIndexMatchesMap.test.js pins the index
  predicate to OUTPUT_PLATFORM_MAP — if that guard reddens, the two lists have drifted.)
- [tenant] api/_routes/db/content.js PATCH media_urls — no per-asset ownership check on
  client-supplied mediaAssetId (pre-existing, informational; blob URLs public by design,
  no DB-row leak) — 2026-08-08 (record-only)
- [bug] api/_lib/aspectVariants.js:107-180 — saveAspectVariant find-then-insert race —
  carried from 2026-07-31 (migration 203_aspect_variant_unique.sql PREPARED, not applied
  to prod — still needs manual apply + review)
- [ui] WordsApproval.jsx:95 (+ OnboardingInterview.jsx, BrandInterview.jsx) — redundant
  px-4 py-8 double-pads vs Layout's main padding — 2026-08-08 (report-only per UI policy)
- [ui] Analytics.jsx:519 vs :680 — Apple card defaultOpen unconditional while adjacent GBP
  card collapses once configured — 2026-08-08 (report-only)
- [ui] VideoEditor.jsx:1061 — add-overlay "Text" button only control in its row with no
  hover state — 2026-08-08 (report-only)
- [ui] OnHandTab.jsx:74-80 — RowMenu kebab has no resting-state chip; sole Retire/Restore
  entry point in browse mode — 2026-08-08 (report-only)
- [live] agent_actions kind='channel_disconnected' — carried: keep watching, don't
  escalate without a confirmed live disconnection to test against (last checked 07-31)
- [live] T3 slots config — carried: still a product-adoption signal, not an audit finding
- [live] T4 video_segments.discard_reasons — carried from 07-31: was 0 rows same-day as
  the Deny feature shipped; re-check counts next audit

## Notes for agents

- If a finding below is listed under "Known false positives," don't re-report it unless
  the cited file has materially changed since the note was written — check `git log
  --oneline -- <file>` for commits after the note's date before trusting the note.
- If a finding is listed under "Chronic," treat it as at least P1 regardless of your own
  read of severity. Recurrence across multiple audits without a fix is itself a signal —
  it means the finding isn't getting picked up, not that it's low priority.
