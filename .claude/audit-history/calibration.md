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

_(none yet — first run seeds it)_

## Notes for agents

- If a finding below is listed under "Known false positives," don't re-report it unless
  the cited file has materially changed since the note was written — check `git log
  --oneline -- <file>` for commits after the note's date before trusting the note.
- If a finding is listed under "Chronic," treat it as at least P1 regardless of your own
  read of severity. Recurrence across multiple audits without a fix is itself a signal —
  it means the finding isn't getting picked up, not that it's low priority.
