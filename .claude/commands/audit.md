---
description: Multi-agent deep audit of the Bernard codebase scoped to commits since the last audit — static gates + parallel runs of bug-hunter, tenant-isolation-auditor, and ui-reviewer. Fixes everything it safely can in the same session (bug-hunter + tenant-isolation findings); UI findings stay report-only pending a mockup. For a full-codebase sweep (no scoping), use /auditfull instead.
---

Run a structured multi-agent audit scoped to commits **since the last audit**, then **fix everything it safely can in the same session**, and produce a prioritized punch list. Composes three specialized agents in parallel with the static-check stack. Sister command to `/checkup` (procedural health pass) and `/auditfull` (full-codebase deep audit, no scoping).

**Calibration loop**: every run reads `.claude/audit-history/calibration.md` into each agent's prompt and updates it afterward — settled false positives stop being re-reported, and findings that recur unresolved across 2+ runs get auto-escalated. This one file is force-tracked (`git add -f`) even though `.claude/audit-history/` is otherwise gitignored, so it survives into fresh worktrees. See "Calibration loop" under Notes below.

**Auto-fix**: Phase 4 fixes every P0/P1/P2 `bug-hunter` and `tenant-isolation-auditor` finding inline, tests each fix, and ships it via commit + PR — all in this run, no fix-task chips. `ui-reviewer` findings are the deliberate exception: this project's CLAUDE.md requires a mockup + Q's sign-off before any UI/flow change, so those stay report-only until greenlit. Blast-radius fixes (dozens+ call sites) and anything needing a live-prod migration also get flagged instead of auto-applied.

## Scope

| Agent | Scope |
|---|---|
| `bug-hunter` | Files changed in the diff range below |
| `tenant-isolation-auditor` | API handlers (`api/**/*.js`) in the diff range |
| `ui-reviewer` | Full sweep — visual drift is cumulative, an old PR's color choice can read as inconsistent only when a new page lands |

Approx time: ~10 min. Approx cost: $3–6.

**Diff range**: read `.claude/audit-history/.last-audit` (a single-line file containing the SHA of the last audit's HEAD). The audit reviews commits in `<.last-audit>..HEAD`. If the file is missing or unreadable, fall back to `origin/main~20..HEAD` (last 20 commits on main).

For a **full-codebase sweep** instead, run `/auditfull` (no diff scoping; reviews everything).

---

## Phase 1 — Static gates (blocking, fast)

Run from the repo root (project root or any worktree):

```bash
npm run typecheck && npm run lint && npm run build && npm run verify-bundles
```

If any of these fail, **stop the audit** and surface the failure to the user. No point burning agent tokens on a tree that doesn't compile. Auto-fix scope here is identical to `/checkup` Layer 1 (unused imports, trivial lint warnings); if you can't auto-fix in <2 minutes, stop and report.

If `npm test` is needed to validate recent test additions, run it too — but skip if no test files changed in the diff range.

---

## Phase 2 — Parallel agent review

This is the heart of `/audit`. Send a single message with **three concurrent Agent tool calls** so they run in parallel. Each agent gets a self-contained prompt: it doesn't see this conversation.

**Scoping prep** (run first):

```bash
LAST_AUDIT_SHA="$(cat .claude/audit-history/.last-audit 2>/dev/null || git rev-parse origin/main~20)"
COMMIT_RANGE="${LAST_AUDIT_SHA}..HEAD"
CHANGED_FILES="$(git diff --name-only $COMMIT_RANGE)"
git log --oneline $COMMIT_RANGE 2>/dev/null | head -50
echo "Calibration file present: $([ -f .claude/audit-history/calibration.md ] && echo yes || echo no)"
```

**Read `.claude/audit-history/calibration.md` now** (create it from the template in the repo's PR history if it's somehow missing — it should always be present after the first run of this command, since it's force-tracked). You'll pass its contents into every Phase 2 agent prompt and use it again in Phase 3 synthesis.

Then dispatch the three agents in one message. **Append this calibration block to the end of every one of the three agent prompts below** (substitute the actual contents of `calibration.md`):

> **Calibration from prior audits** — before you report a finding, check it against this:
>
> ```
> <verbatim contents of .claude/audit-history/calibration.md>
> ```
>
> If a finding you're about to report matches something under "Known false positives /
> intentional design," don't report it unless `git log --oneline -- <file>` shows commits
> to that file after the note's date. If a finding matches something under "Chronic /
> recurring," or matches an entry in "Findings snapshot" from last run, report it at
> **at least P1** regardless of your own severity read — repeated silence is the signal.

### Agent 1 — bug-hunter
- **Scope**: only the files in `$CHANGED_FILES`
- **Prompt template**:
  > Hunt for bugs in the Bernard codebase. Look for logic errors, edge cases, race conditions, state bugs, and unsafe assumptions. Do NOT report style or formatting issues.
  >
  > Scope: `<CHANGED_FILES>`
  >
  > Context: this is a multi-tenant SaaS (see CLAUDE.md "Multi-tenant SaaS"). Common bug shapes in this codebase:
  > - useEffect deps that cause double-billing of expensive ops
  > - 401/403 branches checked on err.message string match instead of err.status
  > - Background fetch streams that buffer entire files into memory
  > - Mutation race conditions where saveMessages and updateInterview both PATCH the same row
  > - Stale closures in useCallback over messages/interview refs
  >
  > Output as Markdown with sections P0 (data loss / crashes / security), P1 (broken UX / wrong behavior), P2 (resilience / future-bug). Each finding: `file:line — problem — suggested fix`. Cap at top 15 findings.

### Agent 2 — tenant-isolation-auditor
- **Scope**: only the files in `$CHANGED_FILES` that match `api/**/*.js`
- **Prompt template**:
  > Audit Bernard API handlers for tenant-isolation gaps. Cross-workspace data leaks are 🔴 critical — this is enforced at the API layer (no RLS), so every handler that reads or writes a tenant-scoped table MUST call `workspaceContext(req)` (or `workspaceById(id)` for background paths) and filter by `workspace_id`.
  >
  > Scope: `<changed api/* files>`
  >
  > Reference patterns: see `api/_lib/segmentInterview.js` (single-table CRUD) and `api/collections/items.js` (junction with verifyScope on both sides). See `reference_tenant_isolation_canonical_pattern.md` in memory for the audit baseline.
  >
  > Output as Markdown. For each handler audited: green (filter present + correct) / yellow (filter present but possibly bypassable) / red (missing filter — cross-tenant leak risk). Report ONLY yellow + red findings with file:line.

### Agent 3 — ui-reviewer
- **Scope**: always full sweep — visual drift is cumulative; an old PR's color choice may only show as inconsistent when a new page lands.
- **Prompt template**:
  > Review the Bernard UI screen-by-screen against `.claude/development-roadmap.md` and the competitor-UI memory notes (reference_ui_research_2026_05.md). Focus on usability, visual hierarchy, hover/empty states, brand-color consistency, and the cross-page coherence issues called out in CLAUDE.md "Brand-color refresh checklist".
  >
  > Major screens: Home (`/`), Stories (`/stories`), StoryDetail (`/stories/:id`), Library / MediaHub, Settings (workspace, brand kit, channels, locations), Account, New Interview, Interview Session.
  >
  > Output as Markdown with P0 (broken / unusable), P1 (confusing or off-brand), P2 (polish). Each finding: `<screen> — <issue> — <suggested fix>`. Cap at top 15 findings.

---

## Phase 3 — Synthesis

After all three agents return:

1. **Compose the punch list**. Interleave findings by priority across agents — all P0s first (regardless of source agent), then P1s, then P2s. Tag each finding with its source `[bug]`, `[tenant]`, `[ui]`.

1a. **Recurrence check against calibration.md's "Findings snapshot" section** (skip if it says "none yet" — first run). Compare this run's P0/P1 findings to that snapshot by file:line + problem:
   - Still present → prefix with `🔁(Nx)` in the punch list and bump to at least P1 if N ≥ 2, regardless of the agent's own severity call.
   - Was in the snapshot but doesn't reappear → it was fixed; no action, don't mention it.
   - Skipped because "Known false positives" already covers it → note this in the Summary line so it's visible calibration is doing work, not silently hiding things.

1b. **Update `.claude/audit-history/calibration.md`**:
   - Overwrite the "Findings snapshot" section with this run's P0/P1 findings (file:line + one-line problem + today's date) — this is what the *next* run diffs against.
   - For anything now marked `🔁(Nx)` with N ≥ 2, add/refresh a "Chronic / recurring" line; remove chronic entries that didn't reappear (fixed).
   - Leave "Known false positives" alone unless an agent's own investigation concludes a specific finding is a false positive or intentional — add it there with a one-line reason and today's date. Never auto-populate it just because something didn't reappear (that could mean "fixed," not "not a bug").
   - `git add -f .claude/audit-history/calibration.md` (required — the directory is gitignored) as part of whatever commit/PR Phase 4 produces. If Phase 4 ends up with nothing to fix, still commit + push this file on its own small branch/PR so the update isn't lost.

2. **Write the report** to `.claude/audit-history/<YYYY-MM-DD-HHMM>.md` with this structure:
   ```
   # Audit Report — <date>
   Mode: since-last
   Range: <commit range>
   Branch: <git branch> @ <short sha>
   Static gates: ✓ all green

   ## Punch list (priority order)
   ### P0 — Ship-blocking
   1. [tenant] api/clinicians.js:42 — missing workspace_id filter — add `&workspace_id=eq.${ws.id}` to the select
   2. 🔁(2x) [bug] src/lib/foo.js:10 — still unfixed since last audit — see calibration.md
   …

   ### P1 — Important
   …

   ### P2 — Nice-to-have
   …

   ## Agent reports (raw)
   <Collapsed/inlined verbatim from each agent for traceability>
   ```

3. **Update the last-audit pointer**:
   ```bash
   git rev-parse HEAD > .claude/audit-history/.last-audit
   ```

4. **Console summary** — print to chat (before fixing anything, so the user sees the raw findings first):
   - One-line per priority tier (e.g. "P0: 2 findings (both tenant). P1: 5 findings. P2: 8 findings.")
   - Link to the markdown report
   - Top 3 P0/P1 inlined as bullets
   - Any `🔁` recurring findings called out separately — these are what the calibration loop escalated
   - If the user identifies a finding as a false positive during review, add it to calibration.md's "Known false positives" section yourself and push a small follow-up commit

---

## Phase 4 — Fix everything fixable, in this session

Fix findings directly, in this same session, instead of spawning fix-task chips. Chip-spawning left P1/P2 findings permanently unaddressed (chips were only spawned for P0s, and only sometimes P1s) — that's the gap this phase closes.

**Scope**: every P0/P1/P2 finding from **bug-hunter** and **tenant-isolation-auditor** (Agents 1–2). These are objective code-correctness/security issues.

**Explicitly do NOT auto-fix:**
- **Anything from ui-reviewer** (Agent 3) — this project's CLAUDE.md requires a clickable mockup and Q's explicit sign-off before any UI or flow change ships (see "Mockup-first for non-trivial UI/flow work"). Auto-applying a UI fix would violate that rule. Leave these report-only and surface them in the console summary as "needs a mockup — say the word and I'll build one."
- **Any fix touching dozens+ call sites in one sweep** (e.g., a workspace-filter helper rename across every API handler) — flag the estimated blast radius in the summary instead of applying it broadly in one shot.
- **Any fix requiring a live-prod schema/migration change** — prepare the migration but don't apply it against prod without flagging it first.
- **Anything you're not confident is correct.** If the right fix is genuinely ambiguous, leave it in the punch list rather than guessing.

**How to fix the rest:**

1. Work through P0s, then P1s, then P2s, **serially in this working tree** — not via parallel subagents editing the same files (concurrent edits to overlapping files can silently clobber each other).
2. Fix one finding (or a tightly-related group in the same file) at a time.
3. After each fix or small batch, run `npm run typecheck && npm run lint && npm run build && npm run verify-bundles` (and `npm test` if relevant tests exist). If a fix breaks a gate, back it out and leave that finding in the punch list rather than shipping broken code.
4. Commit each fix (or logical group) separately with a message referencing the finding — small reviewable commits, not one giant commit for the whole audit. Include the `calibration.md` update (`git add -f .claude/audit-history/calibration.md`) in one of these commits.
5. Push and open **one PR** covering the batch. List what was fixed, and separately what was deliberately skipped and why (needs-mockup / blast-radius / needs-migration-confirmation / not-confident).
6. If there's nothing fixable this run but calibration.md still changed (e.g., a chronic entry needs updating), commit and push just that on its own small branch/PR rather than losing the update.
7. For anything skipped, leave it in the punch list at its original priority — the calibration loop already escalates it if it keeps recurring.

---

## When to stop and surface

Same fail-fast rules as `/checkup`, plus:

- Phase 1 static gates fail — abort, surface the lint/build/typecheck error
- A tenant-isolation 🔴 finding lands — flag immediately at the top of the report and fix it first in Phase 4 (security issue, user needs to know now and it shouldn't wait)
- An agent times out or errors — note it in the report, continue with the other two, don't fail the whole audit

---

## Notes

- **Do not run on every commit.** This is a deep audit, billable in agent tokens. Run weekly, or before a release.
- **Pair with `/schedule`** if you want it to run automatically each Monday morning: `/schedule create "Weekly audit" cron="0 9 * * 1" "/audit"`.
- **The since-last pointer is a single SHA** in `.claude/audit-history/.last-audit`. To "reset" the audit baseline manually: `git rev-parse HEAD > .claude/audit-history/.last-audit` from the project root.
- **Agent prompts must be self-contained.** Each agent starts fresh with no conversation context — paste in the relevant CLAUDE.md / memory references inline.
- **Calibration loop** (`.claude/audit-history/calibration.md`, force-tracked despite the gitignored directory): each run feeds it into every agent prompt and updates it in Phase 3. Settled false positives stop being re-reported; findings unresolved across 2+ runs get auto-escalated to at least P1. The false-positive list only grows by explicit judgment (yours or the user's) — never auto-populated just because a finding didn't reappear (that could mean "fixed," not "not a bug").
- **Phase 4 fixes everything it safely can, inline, in the same run** — no more chip-spawning for P0s while P1/P2 sit untouched. Cost and time scale with how many fixable findings turn up, on top of the audit itself. `ui-reviewer` findings and blast-radius/migration-needs-confirmation findings are the deliberate exceptions — they stay report-only until you greenlight them.
