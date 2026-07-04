---
description: Full-codebase multi-agent deep audit of Bernard — bug-hunter + tenant-isolation-auditor + ui-reviewer review the entire codebase (no since-last scoping), then fixes everything it safely can in the same session (bug-hunter + tenant-isolation findings); UI findings stay report-only pending a mockup. Higher cost and time than /audit; use before a release or for a quarterly baseline.
---

Run a structured multi-agent **full-codebase** audit, then **fix everything it safely can in the same session**, and produce a prioritized punch list. Identical to `/audit` except all three agents sweep the entire codebase — no `.last-audit` scoping. Use this when you want a baseline (before a release, after a long autonomous sprint, or when you suspect a previous since-last run missed something).

**Calibration loop + auto-fix**: same mechanics as `/audit` — see that command's docs for the full explanation. `.claude/audit-history/calibration.md` (force-tracked despite the gitignored directory) is read into every agent prompt and updated in Phase 3; Phase 4 fixes bug-hunter/tenant-isolation findings inline and ships via PR; `ui-reviewer` findings stay report-only pending a mockup + Q's sign-off.

## Scope

| Agent | Scope |
|---|---|
| `bug-hunter` | Full sweep — every file under `src/` and `api/`, skipping `node_modules`, `dist`, `.claude/worktrees` |
| `tenant-isolation-auditor` | Every file under `api/` recursively |
| `ui-reviewer` | Full app, all major screens |

Approx time: ~20 min. Approx cost: $8–15.

For routine cadence (since-last scoping, cheaper), use `/audit` instead.

---

## Phase 1 — Static gates (blocking, fast)

Run from the repo root:

```bash
npm run typecheck && npm run lint && npm run build && npm run verify-bundles
```

If any of these fail, **stop the audit** and surface the failure to the user. Auto-fix scope is identical to `/checkup` Layer 1 (unused imports, trivial lint warnings); if you can't auto-fix in <2 minutes, stop and report.

If test files have changed since the last `main` push, also run:

```bash
npm test
```

---

## Phase 2 — Parallel agent review

Send a single message with **three concurrent Agent tool calls** so they run in parallel. Each agent gets a self-contained prompt: it doesn't see this conversation.

**Scoping prep** (informational only — this is a full sweep, no diff range needed):

```bash
git log --oneline origin/main..HEAD 2>/dev/null | head -50 || echo "(on main, no diff to show)"
echo "Calibration file present: $([ -f .claude/audit-history/calibration.md ] && echo yes || echo no)"
```

**Read `.claude/audit-history/calibration.md` now.** You'll pass its contents into every Phase 2 agent prompt and use it again in Phase 3 synthesis.

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
- **Scope**: full sweep — every file under `src/` and `api/`, skipping `node_modules`, `dist`, `.claude/worktrees`
- **Prompt template**:
  > Hunt for bugs across the entire Bernard codebase. Look for logic errors, edge cases, race conditions, state bugs, and unsafe assumptions. Do NOT report style or formatting issues.
  >
  > Scope: full sweep — every file under `src/` and `api/`, skipping `node_modules`, `dist`, `.claude/worktrees`. Walk the codebase systematically; don't try to read every file but use `grep` for common bug patterns.
  >
  > Context: this is a multi-tenant SaaS (see CLAUDE.md "Multi-tenant SaaS"). Common bug shapes in this codebase:
  > - useEffect deps that cause double-billing of expensive ops
  > - 401/403 branches checked on err.message string match instead of err.status
  > - Background fetch streams that buffer entire files into memory
  > - Mutation race conditions where saveMessages and updateInterview both PATCH the same row
  > - Stale closures in useCallback over messages/interview refs
  >
  > Output as Markdown with sections P0 (data loss / crashes / security), P1 (broken UX / wrong behavior), P2 (resilience / future-bug). Each finding: `file:line — problem — suggested fix`. Cap at top 20 findings (higher than /audit's 15 since this is a baseline run).

### Agent 2 — tenant-isolation-auditor
- **Scope**: every file under `api/` recursively
- **Prompt template**:
  > Audit every Bernard API handler for tenant-isolation gaps. Cross-workspace data leaks are 🔴 critical — this is enforced at the API layer (no RLS), so every handler that reads or writes a tenant-scoped table MUST call `workspaceContext(req)` (or `workspaceById(id)` for background paths) and filter by `workspace_id`.
  >
  > Scope: every file under `api/` recursively. Audit each handler — do not skip files just because they look familiar; this is a baseline pass.
  >
  > Reference patterns: see `api/_lib/segmentInterview.js` (single-table CRUD) and `api/collections/items.js` (junction with verifyScope on both sides). See `reference_tenant_isolation_canonical_pattern.md` in memory for the audit baseline.
  >
  > Output as Markdown. For each handler audited: green (filter present + correct) / yellow (filter present but possibly bypassable) / red (missing filter — cross-tenant leak risk). List EVERY handler with its verdict (not just yellow/red) so the next baseline can diff against this one. File:line for any non-green.

### Agent 3 — ui-reviewer
- **Scope**: full app, all major screens (same as `/audit` — visual drift is always cumulative)
- **Prompt template**:
  > Review the Bernard UI screen-by-screen against `.claude/development-roadmap.md` and the competitor-UI memory notes (reference_ui_research_2026_05.md). Focus on usability, visual hierarchy, hover/empty states, brand-color consistency, and the cross-page coherence issues called out in CLAUDE.md "Brand-color refresh checklist".
  >
  > Major screens: Home (`/`), Stories (`/stories`), StoryDetail (`/stories/:id`), Library / MediaHub, Settings (workspace, brand kit, channels, locations), Account, New Interview, Interview Session.
  >
  > Output as Markdown with P0 (broken / unusable), P1 (confusing or off-brand), P2 (polish). Each finding: `<screen> — <issue> — <suggested fix>`. Cap at top 20 findings (higher than /audit's 15 since this is a baseline run).

---

## Phase 3 — Synthesis

After all three agents return:

1. **Compose the punch list**. Interleave findings by priority across agents — all P0s first (regardless of source agent), then P1s, then P2s. Tag each finding with its source `[bug]`, `[tenant]`, `[ui]`.

1a. **Recurrence check against calibration.md's "Findings snapshot" section** (skip if it says "none yet"). Compare this run's P0/P1 findings to that snapshot by file:line + problem:
   - Still present → prefix with `🔁(Nx)` in the punch list and bump to at least P1 if N ≥ 2.
   - Was in the snapshot but doesn't reappear → fixed; no action, don't mention it.
   - Skipped because "Known false positives" already covers it → note this in the Summary line.

1b. **Update `.claude/audit-history/calibration.md`**: overwrite "Findings snapshot" with this run's P0/P1 findings; refresh "Chronic / recurring" for anything `🔁(Nx)` with N ≥ 2 and remove entries that didn't reappear; leave "Known false positives" alone unless an agent's own investigation concludes something is a false positive. `git add -f` it — the directory is gitignored.

2. **Write the report** to `.claude/audit-history/<YYYY-MM-DD-HHMM>-full.md` (note the `-full` suffix so it doesn't collide with `/audit` reports of the same minute):
   ```
   # Audit Report — <date> (FULL SWEEP)
   Mode: full
   Range: full codebase
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
   This sets the baseline for the next `/audit` since-last run.

4. **Console summary** — print to chat (before fixing anything):
   - One-line per priority tier (e.g. "P0: 2 findings (both tenant). P1: 5 findings. P2: 8 findings.")
   - Link to the markdown report
   - Top 3 P0/P1 inlined as bullets
   - Any `🔁` recurring findings called out separately

---

## Phase 4 — Fix everything fixable, in this session

Fix findings directly, in this same session, instead of spawning fix-task chips — same mechanics as `/audit` Phase 4.

**Scope**: every P0/P1/P2 finding from **bug-hunter** and **tenant-isolation-auditor**. **Do NOT auto-fix `ui-reviewer` findings** (mockup + Q's sign-off required per CLAUDE.md), fixes touching dozens+ call sites, fixes requiring a live-prod migration, or anything you're not confident is correct — flag these in the summary instead.

**How**:
1. Fix P0s, then P1s, then P2s, serially (not via parallel subagents editing the same files).
2. After each fix or small batch: `npm run typecheck && npm run lint && npm run build && npm run verify-bundles` (+ `npm test` if relevant). Back out and leave in the punch list if a gate breaks.
3. Small, separate commits per fix or logical group — include the `calibration.md` update (`git add -f`) in one of them.
4. Push, open one PR covering the batch, listing what was fixed vs. deliberately skipped and why.
5. If nothing's fixable but calibration.md changed, still commit + push it on its own small branch/PR.

---

## When to stop and surface

- Phase 1 static gates fail — abort, surface the lint/build/typecheck error
- A tenant-isolation 🔴 finding lands — flag immediately at the top of the report and fix it first in Phase 4 (security issue, user needs to know now)
- An agent times out or errors — note it in the report, continue with the other two, don't fail the whole audit

---

## Notes

- **Run this sparingly.** Monthly cadence is sensible; before a release is required. Use `/audit` for the routine weekly pass.
- **The last-audit pointer is shared with `/audit`**. Running `/auditfull` resets the baseline for the next `/audit` since-last run.
- **Agent prompts must be self-contained.** Each agent starts fresh with no conversation context.
- **Calibration + auto-fix**: same as `/audit` — see that command's Notes for the full mechanics. Cost/time here scale with fixable findings on top of the $8–15 audit-only estimate above.
