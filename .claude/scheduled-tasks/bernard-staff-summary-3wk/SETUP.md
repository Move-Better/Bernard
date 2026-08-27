# Bernard Staff Summary — Setup (rebuilt 2026-08-27)

**Supersedes:** `bernard-weekly-staff-summary` (deleted from the scheduler; its taskId
directory has been renamed to this one so the old prompt/history is still visible in git
blame). The old routine went silent after 2026-08-20 — its next run produced no PDF and no
error anyone saw. See the "Rebuild note" at the top of `SKILL.md` for the two suspected
causes (a `git checkout` in the shared project root, and a self-triggered screenshot-capture
step depending on a 1Password mount known to hang) and how this version avoids both.

---

## What changed vs. the old routine

1. **Cadence: every ~3 weeks instead of weekly.** Cron still fires weekly (`35 9 * * 4`,
   same slot as before) because that's the reliable clock primitive available, but
   `SKILL.md` step 0 gates on a marker file
   (`/Users/qbook/.claude/scheduled-tasks/bernard-staff-summary-3wk/.last-sent`) and only
   does real work when 19+ days have passed since the last successful PDF. Most weekly
   firings are now a fast no-op.
2. **No more `git checkout`/`git pull` in the project root.** The old routine ran
   `git checkout main -q && git pull --ff-only`, which can fail outright if the shared
   project root (used by other sessions too) has uncommitted work or is on another branch —
   a routine bit of parallel-session state in this repo. The rebuilt routine only reads
   `origin/main`'s history via `git fetch origin main -q` + `git log origin/main`, which
   needs no clean working tree and can't collide with anyone else's checkout.
3. **No more self-triggered screenshot capture.** The old routine could invoke
   `scripts/capture-screenshot.mjs` itself, which needs a 1Password `.env.bernard.1pw`
   mount read (documented elsewhere in this repo as occasionally hanging indefinitely with
   no timeout) plus a local headless Playwright run. The rebuilt routine only reads
   existing entries from `.staff-update-screenshots/captions.jsonl` — screenshot capture
   stays a ship-time responsibility for whoever merges a UI PR, per this repo's `CLAUDE.md`.
4. **PDF filename changed** from `bernard-weekly-update-<date>.pdf` to
   `bernard-staff-update-<date>.pdf`, and the header now states the actual date range
   covered (e.g. "August 6 – August 27, 2026") rather than implying a single week.
5. **Gmail draft recipient default** is `drq@movebetter.co` (matches what was actually
   live in the deployed scheduled-task copy, which had drifted from the older
   `drquasney@gmail.com` placeholder documented in the original SETUP.md — this rebuild
   keeps the value that was actually in production use).

## How it works now

### Every Thursday (cron fires)
1. Read the marker file. If it's been under 19 days since the last successful PDF, stop —
   no git, no build, no Gmail. This is the common case (happens ~2 out of every 3 weeks).
2. Otherwise, run the full pipeline:
   - `git fetch origin main -q` + `git log origin/main --since=...` (read-only)
   - Filter to user-visible changes, write plain-language bullets
   - Match against existing `captions.jsonl` entries only (no new captures)
   - Build the paginated PDF with Python + Pillow
   - Verify every page renders legibly (`pdftoppm`)
   - Create a Gmail draft pointing at the PDF (best-effort — a Gmail failure doesn't block
     the rest)
   - Write today's date to the marker file — **only after the PDF is built and verified**

### Ship-time responsibility (unchanged, manual, as UI changes ship)
Screenshot capture is still documented in this repo's `CLAUDE.md` →
"Weekly staff-update routine — capturing screenshots for the PDF" (title kept for grep
continuity even though the summary itself is no longer weekly). Use
`scripts/capture-screenshot.mjs` at merge time, add the entry to `captions.jsonl`. This
routine never does that step itself.

---

## First-run checklist

- [x] `.staff-update-screenshots/` directory exists (carried over, has PDFs back to 2026-07-16)
- [x] `.gitignore` includes `.staff-update-screenshots/`
- [x] `captions.jsonl` exists with entries
- [ ] Confirm the scheduled task `bernard-staff-summary-3wk` is registered with cron
      `35 9 * * 4` and `enabled: true`
- [ ] Confirm no marker file exists yet at
      `/Users/qbook/.claude/scheduled-tasks/bernard-staff-summary-3wk/.last-sent` — so the
      very next Thursday firing runs for real (first-run-since-rebuild case in step 0.2),
      rather than waiting a further 19 days
- [ ] After that first real run, confirm the PDF looks right and the marker file was
      written with that day's date

**Known limitations (accepted, same as before):**
- No programmatic file attachment to Gmail draft. User must drag/attach the PDF manually
  before sending.
- Staff email recipient is a single default (`drq@movebetter.co`). Distribution list is a
  manual step — user customizes the `to:` field before sending.
- If a run is skipped by the step-0 gate for more than one cycle in a row (e.g. the app was
  closed on the day it was due), the next real run's lookback window grows accordingly
  (capped at 35 days) so nothing falls through a coverage gap — but the PDF for that catch-up
  run will be larger than usual.

---

## Files & locations

```
Bernard/
├── .claude/
│   └── scheduled-tasks/
│       └── bernard-staff-summary-3wk/
│           ├── SKILL.md              ← Routine definition (executable)
│           └── SETUP.md              ← This file
├── CLAUDE.md                         ← References the routine's screenshot-capture guide
├── .gitignore                        ← Unchanged, still excludes .staff-update-screenshots/
└── .staff-update-screenshots/        ← Local-only folder (gitignored)
    ├── README.md
    ├── captions.jsonl
    └── [screenshots + PDFs go here]
```

The live scheduler copy lives at
`/Users/qbook/.claude/scheduled-tasks/bernard-staff-summary-3wk/SKILL.md` (outside the
repo) — that's what actually executes each firing. This repo copy is kept in sync as the
committed source of truth; if you edit one, edit the other the same way.

---

## Maintenance

- **Captions.jsonl**: Update whenever you capture a new screenshot at ship time (add one
  JSON line with file, date, PR, caption).
- **SKILL.md**: Update if the output format, cadence, PDF layout, or Gmail integration
  changes — and mirror the change into the live scheduler copy via
  `mcp__scheduled-tasks__update_scheduled_task`.
- **If this routine goes silent again**: check (1) whether the marker file's date makes
  sense — a stuck/very old marker means the gate is skipping runs it shouldn't; (2) whether
  `git fetch origin main -q` still works cleanly from the project root; (3) whether the
  Gmail MCP is still authorized in the headless scheduled-task environment.
