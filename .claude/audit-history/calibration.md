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

## Chronic / recurring (flagged 2+ audits running, still unresolved)

<!-- Auto-appended by Phase 3 synthesis when a finding matches an entry in "Findings
snapshot" below and wasn't fixed in between. Format:
- [agent] file:line — problem — first flagged YYYY-MM-DD, seen again YYYY-MM-DD (Nx)
Remove an entry once the finding stops appearing (i.e. it got fixed). -->

_(none yet — the 2026-07-22 snapshot's 3 [bug] items were all confirmed still-fixed this
run, and its 3 [ui] items were all confirmed fixed too; nothing carried forward chronic)_

## Findings snapshot (for next run's recurrence check)

<!-- Auto-overwritten every run by Phase 3 synthesis with a flat list of THIS run's P0/P1
findings (file:line + one-line problem + date). Audit reports themselves are gitignored
and don't survive into a fresh worktree, so this snapshot — inside the one force-tracked
file — is what the NEXT run diffs against to detect recurrence. After comparing, the next
run overwrites this section with its own snapshot. -->

Seeded by the 2026-07-31 full sweep (report: 2026-07-31-2325-full.md). Items marked FIXED
were repaired in-session; if one reappears, that's a regression — report at P1 minimum.
The entire 2026-07-22 snapshot cleared (3 bug items re-verified still fixed, 3 ui items
independently confirmed fixed by this run's ui-reviewer) — none carried forward.

- [bug+ui] 12 sites across 7 files (VideoEditor.jsx, AdminUsage.jsx, AccessMatrix.jsx, ProducerSettings.jsx, ContentPlanPanel.jsx, PackageCard.jsx, FeedbackResolvedBanner.jsx) — bare Tailwind opacity fractions (/6, /8, /12) compiled to nothing, invisible backgrounds in prod — 2026-07-31 (FIXED same session, bracket syntax + new repo-wide guard test tests/lib/opacityFractionsCompile.test.js)
- [bug] api/_lib/producer/coachingNoteGenerator.js:45 — workspaces() query missing status=eq.active, billed AI calls + coaching notes for non-active workspaces — 2026-07-31 (FIXED same session)
- [bug] api/_routes/content-items/copy-to-platforms.js:201 — sibling-fill PATCH had no re-check for a race with a concurrent edit — 2026-07-31 (FIXED same session, mirrors autoAttachMedia's re-read pattern)
- [tenant] api/_routes/cron/agent-tick.js:156-176,265 — claimItem/finishItem/retry-PATCH missing workspace_id scope (not exploitable — defense-in-depth) — 2026-07-31 (FIXED same session)
- [bug] api/_lib/aspectVariants.js:107-180 — saveAspectVariant find-then-insert race can create duplicate variant rows — 2026-07-31 (migration 203_aspect_variant_unique.sql PREPARED, not applied to prod — needs manual apply + review; low-probability/non-destructive so deferred rather than shipped unreviewed)
- [ui] src/components/editor/EditorWorkflowBar.jsx:401-410, src/components/story-detail/AssetsPane.jsx:768-776 — Approve button renders in brand teal (default Button variant → bg-primary), not green — violates the codebase's own documented house rule (comment in VideoEditor.jsx:1992-1993: "approve=green, reject=red, brand teal reads as navigation") and is inconsistent with the correct reference implementation in OnHandTab.jsx's queue Approve button — 2026-07-31 (report-only per policy; near-mechanical fix — add a `success` Button variant matching the existing correct pattern — flagged to Q for fast-track, not a new design decision)
- [ui] src/pages/Analytics.jsx:283-296 — SEO "Total clicks"/"Branded clicks" render smaller than "Non-branded clicks"; may read as a bug rather than deliberate hierarchy on first view — 2026-07-31 (P2 polish, report-only)
- [live] agent_actions kind='channel_disconnected' — STILL 0 rows (re-checked 2026-07-31). Could not confirm a currently-disconnected GBP integration exists to test the precondition against (2 workspaces have gbp credentials, neither's config exposes a status/connected field this query could read) — keep watching, don't escalate to P1 without a confirmed live disconnection to test against.
- [live] T3 slots config (workspaces.cadence_policy ? 'slots') — still 0 workspaces, 9 days later. Genuinely unused, not a bug — a real product-adoption signal worth someone's attention, not an audit finding.
- [live] T4 video_segments.discard_reasons — 0 rows, but the Deny-verdict feature (#2506) shipped SAME DAY as this audit — expected to be 0, not a concern yet. Re-check next audit.
- [live] T4 content_items.edit_diff — RESOLVED: 5 rows now (was 0 on 7-22). Drop from watchlist.

## Notes for agents

- If a finding below is listed under "Known false positives," don't re-report it unless
  the cited file has materially changed since the note was written — check `git log
  --oneline -- <file>` for commits after the note's date before trusting the note.
- If a finding is listed under "Chronic," treat it as at least P1 regardless of your own
  read of severity. Recurrence across multiple audits without a fix is itself a signal —
  it means the finding isn't getting picked up, not that it's low priority.
