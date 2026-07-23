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

_(none yet)_

## Chronic / recurring (flagged 2+ audits running, still unresolved)

<!-- Auto-appended by Phase 3 synthesis when a finding matches an entry in "Findings
snapshot" below and wasn't fixed in between. Format:
- [agent] file:line — problem — first flagged YYYY-MM-DD, seen again YYYY-MM-DD (Nx)
Remove an entry once the finding stops appearing (i.e. it got fixed). -->

_(none yet)_

## Findings snapshot (for next run's recurrence check)

<!-- Auto-overwritten every run by Phase 3 synthesis with a flat list of THIS run's P0/P1
findings (file:line + one-line problem + date). Audit reports themselves are gitignored
and don't survive into a fresh worktree, so this snapshot — inside the one force-tracked
file — is what the NEXT run diffs against to detect recurrence. After comparing, the next
run overwrites this section with its own snapshot. -->

Seeded by the 2026-07-22 full sweep (report: 2026-07-22-2035-full.md). Items marked FIXED
were repaired in-session; if one reappears, that's a regression — report at P1 minimum.

- [bug] api/_lib/dispatchContentItem.js:167 — GBP 1500 clamp missing on /week Approve dispatch — 2026-07-22 (FIXED same session)
- [bug] api/_lib/cadenceAdaptive.js:55 — scoreOf double-counts bundle impressions+views (#2283 sibling) — 2026-07-22 (FIXED same session)
- [bug] api/_routes/cron/auto-publish.js:92,129 — GBP clamp missing in dispatchGbp/dispatchGbpBundle — 2026-07-22 (FIXED same session)
- [ui] src/pages/YourWeek.jsx:333,519 — Instagram pink reused as "open slot" status color on the same board — 2026-07-22 (report-only, pending Q)
- [ui] src/pages/YourWeek.jsx:29 — comment promises a status legend that doesn't exist; 7 unexplained status colors — 2026-07-22 (report-only, pending Q)
- [ui] src/pages/StaffProfile.jsx:746,1257 — hover-lift rows with only a 32px chevron click target (#2245 class) — 2026-07-22 (report-only, pending Q)
- [live] agent_actions kind='channel_disconnected' — 0 rows ever, but GBP-walker fix (#2280) merged 7-23 02:49 UTC and cron runs 14:00 UTC — RE-CHECK first: if still 0 after 2026-07-23 14:00 UTC while a GBP stays disconnected, that IS a P1 "never fired"
- [live] watchlist (merged <72h, user-driven, all 0 rows on 7-22): T3 slots config (cadence_policy.slots), T4 reject_reason, T4 edit_diff — flag only if still 0 next audit

## Notes for agents

- If a finding below is listed under "Known false positives," don't re-report it unless
  the cited file has materially changed since the note was written — check `git log
  --oneline -- <file>` for commits after the note's date before trusting the note.
- If a finding is listed under "Chronic," treat it as at least P1 regardless of your own
  read of severity. Recurrence across multiple audits without a fix is itself a signal —
  it means the finding isn't getting picked up, not that it's low priority.
