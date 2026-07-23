---
description: Multi-agent deep audit of the Bernard codebase — static gates + parallel runs of bug-hunter, tenant-isolation-auditor, and ui-reviewer, then fixes everything it safely can in the same session. Modes: default (since last audit) | full (whole codebase). UI findings stay report-only pending a mockup.
---

Run a structured multi-agent audit, **fix everything it safely can in the same session**, and produce a prioritized punch list. Composes three specialized agents in parallel with the static-check stack. Sister command to `/bernard-checkup` (procedural health pass).

**Uniquely named on purpose.** Bernard, Deep Thought and Vigil all define audit instruments, and same-named commands across sibling projects can load the *wrong* project's body — a confirmed failure mode, not a theoretical one. The `bernard-` prefix makes that impossible. Plain `/audit` still resolves to the generic global skeleton, which auto-discovers this repo's agents and works fine, just less tuned. See global CLAUDE.md, "Same-named commands/skills collide across sibling projects."

## Mode selection (from arguments)

| Argument | Scope | Approx time | Approx cost |
|---|---|---|---|
| `/bernard-audit` (default) | Commits **since the last audit** | ~10 min | $3–6 |
| `/bernard-audit full` | **Entire codebase**, no diff scoping | ~20 min | $8–15 |

Use the default for routine cadence (weekly). Use `full` for a baseline: before a release, after a long autonomous sprint, or when you suspect a since-last run missed something. If the user passes any other text, treat it as default mode.

**Calibration loop**: every run reads `.claude/audit-history/calibration.md` into each agent's prompt and updates it afterward — settled false positives stop being re-reported, and findings that recur unresolved across 2+ runs get auto-escalated. This one file is force-tracked (`git add -f`) even though `.claude/audit-history/` is otherwise gitignored, so it survives into fresh worktrees. See "Calibration loop" under Notes.

**Auto-fix**: Phase 4 fixes every P0/P1/P2 `bug-hunter` and `tenant-isolation-auditor` finding inline, tests each fix, and ships it via commit + PR — all in this run, no fix-task chips. `ui-reviewer` findings are the deliberate exception: this project's CLAUDE.md requires a mockup + Q's sign-off before any UI/flow change, so those stay report-only until greenlit. Blast-radius fixes (dozens+ call sites) and anything needing a live-prod migration also get flagged instead of auto-applied.

## Scope per agent

| Agent | Default mode | `full` mode |
|---|---|---|
| `bug-hunter` | Files changed in the diff range | Every file under `src/` and `api/`, skipping `node_modules`, `dist`, `.claude/worktrees` |
| `tenant-isolation-auditor` | Changed API handlers (`api/**/*.js`) | Every file under `api/` recursively |
| `ui-reviewer` | **Always a full sweep** — visual drift is cumulative; an old PR's color choice can read as inconsistent only when a new page lands | Same (full app, all major screens) |

**Diff range** (default mode): read `.claude/audit-history/.last-audit` (a single-line file containing the SHA of the last audit's HEAD). The audit reviews commits in `<.last-audit>..HEAD`. If the file is missing or unreadable, fall back to `origin/main~20..HEAD`.

⚠️ **Audit reports + `.last-audit` live in the PRIMARY checkout**, not a session worktree — see the CLAUDE.md note. Write them to the absolute path `/Users/qbook/Claude Projects/Bernard/.claude/audit-history/`, and at audit start check the worktree copy for stranded reports from prior sessions.

---

## Phase 1 — Static gates (blocking, fast)

Run from the repo root (project root or any worktree):

```bash
npm run typecheck && npm run lint && npm run build && npm run verify-bundles
```

If any of these fail, **stop the audit** and surface the failure to the user. No point burning agent tokens on a tree that doesn't compile. Auto-fix scope here is identical to `/bernard-checkup` Layer 1 (unused imports, trivial lint warnings); if you can't auto-fix in <2 minutes, stop and report.

Run `npm test` too if test files changed in the diff range (default mode), or always in `full` mode.

---

## Phase 2 — Parallel agent review

Send a single message with **three concurrent Agent tool calls** so they run in parallel. Each agent gets a self-contained prompt: it doesn't see this conversation.

**Scoping prep** (run first):

```bash
LAST_AUDIT_SHA="$(cat .claude/audit-history/.last-audit 2>/dev/null || git rev-parse origin/main~20)"
COMMIT_RANGE="${LAST_AUDIT_SHA}..HEAD"
CHANGED_FILES="$(git diff --name-only $COMMIT_RANGE)"
git log --oneline $COMMIT_RANGE 2>/dev/null | head -50
echo "Calibration file present: $([ -f .claude/audit-history/calibration.md ] && echo yes || echo no)"
```

In `full` mode, skip the range and sweep everything — the log above is informational only.

**Read `.claude/audit-history/calibration.md` now.** You'll pass its contents into every Phase 2 agent prompt and use it again in Phase 3 synthesis.

**Append this calibration block to the end of every one of the three agent prompts** (substitute the actual contents of `calibration.md`):

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
- **Scope**: `$CHANGED_FILES` (default) / full sweep (`full` mode)
- **Prompt template**:
  > Hunt for bugs in the Bernard codebase. Look for logic errors, edge cases, race conditions, state bugs, and unsafe assumptions. Do NOT report style or formatting issues.
  >
  > Scope: `<CHANGED_FILES or "full sweep">`
  >
  > Context: this is a multi-tenant SaaS (see CLAUDE.md "Multi-tenant SaaS"). Common bug shapes in this codebase:
  > - useEffect deps that cause double-billing of expensive ops
  > - 401/403 branches checked on err.message string match instead of err.status
  > - Background fetch streams that buffer entire files into memory
  > - Mutation race conditions where saveMessages and updateInterview both PATCH the same row
  > - Stale closures in useCallback over messages/interview refs
  >
  > Output as Markdown with sections P0 (data loss / crashes / security), P1 (broken UX / wrong behavior), P2 (resilience / future-bug). Each finding: `file:line — problem — suggested fix`. Cap at top 15 findings (20 in full mode).

### Agent 2 — tenant-isolation-auditor
- **Scope**: changed `api/**/*.js` (default) / all of `api/` recursively (`full` mode)
- **Prompt template**:
  > Audit Bernard API handlers for tenant-isolation gaps. Cross-workspace data leaks are 🔴 critical — this is enforced at the API layer (no RLS), so every handler that reads or writes a tenant-scoped table MUST call `workspaceContext(req)` (or `workspaceById(id)` for background paths) and filter by `workspace_id`.
  >
  > Scope: `<changed api/* files or "all of api/">`
  >
  > Reference patterns: see `api/_lib/segmentInterview.js` (single-table CRUD) and `api/collections/items.js` (junction with verifyScope on both sides). See `reference_tenant_isolation_canonical_pattern.md` in memory for the audit baseline.
  >
  > Output as Markdown. For each handler audited: green (filter present + correct) / yellow (filter present but possibly bypassable) / red (missing filter — cross-tenant leak risk). Report ONLY yellow + red findings with file:line.

### Agent 3 — ui-reviewer
- **Scope**: always a full sweep, in both modes.
- **Prompt template**:
  > Review the Bernard UI screen-by-screen against `.claude/development-roadmap.md` and the competitor-UI memory notes (reference_ui_research_2026_05.md). Focus on usability, visual hierarchy, hover/empty states, brand-color consistency, and the cross-page coherence issues called out in CLAUDE.md "Brand-color refresh checklist".
  >
  > Major screens: Home (`/`), Stories (`/stories`), StoryDetail (`/stories/:id`), Library / MediaHub, Settings (workspace, brand kit, channels, locations), Account, New Interview, Interview Session.
  >
  > Output as Markdown with P0 (broken / unusable), P1 (confusing or off-brand), P2 (polish). Each finding: `<screen> — <issue> — <suggested fix>`. Cap at top 15 findings.

---

## Phase 3 — Synthesis

After all three agents return:

1. **Compose the punch list.** Interleave findings by priority across agents — all P0s first (regardless of source agent), then P1s, then P2s. Tag each finding with its source `[bug]`, `[tenant]`, `[ui]`.

1a. **Recurrence check against calibration.md's "Findings snapshot"** (skip if it says "none yet"). Compare this run's P0/P1 findings to that snapshot by file:line + problem:
   - Still present → prefix with `🔁(Nx)` and bump to at least P1 if N ≥ 2, regardless of the agent's own severity call.
   - Was in the snapshot but doesn't reappear → it was fixed; no action, don't mention it.
   - Skipped because "Known false positives" covers it → note this in the Summary line so it's visible calibration is doing work, not silently hiding things.

1b. **Update `.claude/audit-history/calibration.md`**:
   - Overwrite "Findings snapshot" with this run's P0/P1 findings (file:line + one-line problem + today's date) — this is what the *next* run diffs against.
   - For anything now `🔁(Nx)` with N ≥ 2, add/refresh a "Chronic / recurring" line; remove chronic entries that didn't reappear (fixed).
   - Leave "Known false positives" alone unless an agent's own investigation concludes a specific finding is a false positive or intentional — add it with a one-line reason and today's date. Never auto-populate it just because something didn't reappear (that could mean "fixed," not "not a bug").
   - `git add -f .claude/audit-history/calibration.md` (required — the directory is gitignored). If Phase 4 has nothing to fix, still commit + push this file on its own small branch/PR so the update isn't lost.

2. **Write the report** to `.claude/audit-history/<YYYY-MM-DD-HHMM>.md` (append `-full` in full mode):
   ```
   # Audit Report — <date>
   Mode: since-last | full-codebase
   Range: <commit range, or "full codebase">
   Branch: <git branch> @ <short sha>
   Static gates: ✓ all green

   ## Punch list (priority order)
   ### P0 — Ship-blocking
   1. [tenant] api/clinicians.js:42 — missing workspace_id filter — add `&workspace_id=eq.${ws.id}` to the select
   2. 🔁(2x) [bug] src/lib/foo.js:10 — still unfixed since last audit — see calibration.md
   …

   ### P1 — Important
   ### P2 — Nice-to-have

   ## Agent reports (raw)
   <verbatim per agent, for traceability>
   ```

3. **Update the last-audit pointer** (both modes — a full sweep resets the baseline too):
   ```bash
   git rev-parse HEAD > .claude/audit-history/.last-audit
   ```

4. **Console summary** — print to chat *before* fixing anything, so the user sees raw findings first:
   - One line per priority tier ("P0: 2 findings (both tenant). P1: 5. P2: 8.")
   - Link to the markdown report
   - Top 3 P0/P1 inlined as bullets
   - Any `🔁` recurring findings called out separately — these are what calibration escalated
   - If the user identifies a finding as a false positive during review, add it to calibration.md's "Known false positives" yourself and push a small follow-up commit

---

## Phase 4 — Fix everything fixable, in this session

Fix findings directly in this same session, instead of spawning fix-task chips. Chip-spawning left P1/P2 findings permanently unaddressed — that's the gap this phase closes.

**Scope**: every P0/P1/P2 finding from **bug-hunter** and **tenant-isolation-auditor**. These are objective code-correctness/security issues.

**Explicitly do NOT auto-fix:**
- **Anything from ui-reviewer** — this project's CLAUDE.md requires a clickable mockup and Q's explicit sign-off before any UI or flow change ships. Leave these report-only and surface them as "needs a mockup — say the word and I'll build one."
- **Any fix touching dozens+ call sites in one sweep** — flag the estimated blast radius instead of applying it broadly.
- **Any fix requiring a live-prod schema/migration change** — prepare the migration but flag before applying against prod.
- **Anything you're not confident is correct.** If the right fix is genuinely ambiguous, leave it in the punch list rather than guessing.

**How to fix the rest:**

1. Work through P0s, then P1s, then P2s, **serially in this working tree** — not via parallel subagents editing the same files (concurrent edits to overlapping files can silently clobber each other).
2. Fix one finding (or a tightly-related group in the same file) at a time.
3. After each fix or small batch, re-run the Phase 1 gates (and `npm test` if relevant). If a fix breaks a gate, back it out and leave that finding in the punch list rather than shipping broken code.
4. Commit each fix (or logical group) separately with a message referencing the finding — small reviewable commits, not one giant commit. Include the `calibration.md` update in one of them.
5. Push and open **one PR** covering the batch. List what was fixed, and separately what was deliberately skipped and why (needs-mockup / blast-radius / needs-migration-confirmation / not-confident).
6. If nothing is fixable but calibration.md changed, commit and push just that on its own small branch/PR.
7. For anything skipped, leave it in the punch list at its original priority — the calibration loop escalates it if it keeps recurring.

---

## When to stop and surface

Same fail-fast rules as `/bernard-checkup`, plus:

- Phase 1 static gates fail — abort, surface the lint/build/typecheck error
- A tenant-isolation 🔴 finding lands — flag immediately at the top of the report and fix it first in Phase 4
- An agent times out or errors — note it in the report, continue with the other two, don't fail the whole audit

---

## Notes

- **Do not run on every commit.** This is a deep audit, billable in agent tokens. Default mode weekly; `full` monthly or pre-release.
- **Pair with `/schedule`** for an automated weekly run: `/schedule create "Weekly audit" cron="0 9 * * 1" "/bernard-audit"`.
- **The since-last pointer is a single SHA** in `.claude/audit-history/.last-audit`. Reset manually with `git rev-parse HEAD > .claude/audit-history/.last-audit` from the project root.
- **Agent prompts must be self-contained.** Each agent starts fresh with no conversation context — paste the relevant CLAUDE.md / memory references inline.
- **Calibration loop** (`.claude/audit-history/calibration.md`, force-tracked despite the gitignored directory): each run feeds it into every agent prompt and updates it in Phase 3. Settled false positives stop being re-reported; findings unresolved across 2+ runs get auto-escalated to at least P1. The false-positive list only grows by explicit judgment — never auto-populated because a finding didn't reappear.
- **Phase 4 fixes everything it safely can, inline** — cost and time scale with how many fixable findings turn up, on top of the audit itself.
- **Structure is deliberately aligned with Deep Thought's `/dt-audit`** (Vigil SOP sync, 2026-07-23): same phases, calibration loop, synthesis format, and fix policy. Only the agent lineup, stack doctrine, gates and URLs differ. If you change the *recipe* here, mirror it there — and if you change only Bernard's parameters, don't.
