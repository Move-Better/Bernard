---
description: End the session cleanly — commit/PR/merge, verify prod, clean up worktree, capture lessons + memory + moments
---

Wrap up **this session** cleanly. Walk the steps below **in order** — each one is gated on *real, checked state*, not assumptions. Do not batch them into one parallel blast; later steps depend on earlier results (per the "don't batch dependent ship steps" rule in `~/.claude/CLAUDE.md`). Run read-only checks first, act, then report.

Operate under the user's **Git autonomy policy** and **Mechanical execution policy** (`~/.claude/CLAUDE.md`): commit, push, open PRs, and merge green PRs without asking; still confirm before prod deploys, force-pushes, destructive ops, and removing a worktree that holds unaccounted-for work.

At the end, produce a single **Session Wrap Report** (format at the bottom). If a step has nothing to do, say so in one line and move on — don't pad.

---

## 1. Git state — nothing left on the floor

```
git status --short && git log --oneline origin/main..HEAD 2>/dev/null
```

- **Uncommitted changes to tracked files** → review the diff (`git diff --stat`, confirm the changed-file list matches intent), then commit at logical checkpoints with descriptive messages. Use the Co-Authored-By trailer.
- **Untracked files** → classify before doing anything. Scratch with a committed generator can be ignored; a human-authored `*-spec.md` / `*-plan.md` / mockup `.html` is *keep* (see `.claude/` scratch-vs-keep rule). Never `rm` an untracked file you can't name a regenerator for.
- **Unpushed commits** → push the feature branch (`-u` on first push).
- If on a feature branch with WIP that isn't ready, leave it committed-and-pushed but unmerged, and flag it in the report as a parked branch.

**Never commit or push directly to `main`.** If `git branch --show-current` shows `main` in a worktree, something went wrong — stop and flag it.

## 2. PR state

```
gh pr status
```

- **Branch has commits but no PR** and the work is meaningful + tested → open one: `gh pr create` then `gh pr merge <num> --auto --squash`.
- **Open PR exists** → check CI: `gh pr checks <num>`. Green → it'll auto-merge (or merge it). Pending → note it. **Failing → do NOT merge; surface the failure** in the report and either fix it or hand off.
- **More than 3 unmerged PRs in flight** from this context → flag the pile-up.

## 3. Production — confirm what actually shipped

**This is the step the user cares about most — "did it actually reach production?" is a recurring failure here. Do NOT end the session leaving a merged PR un-deployed. This step is a blocking gate, not a one-shot check.**

Runs whenever **anything merged to `main` this session** — including a PR you opened earlier in this same `/wrap` run that has since auto-merged. Re-check `gh pr status` first; a PR that was "pending" in step 2 may now be merged, which means it falls into this gate.

### a. Establish the target SHA

```
git fetch origin main -q && echo "origin/main HEAD: $(git rev-parse --short origin/main)"
```

That short SHA is what MUST be live on prod before the session can close.

### b. Poll prod until it matches — don't check once and move on

```
curl -s "https://narraterx.ai/version.json" | grep -oE '"sha": *"[^"]*"'
```

- **Matches `origin/main`** → confirmed live. Done with this step.
- **Doesn't match** → a deploy is either in flight or was skipped. Distinguish:

  ```
  gh api "repos/Move-Better/NarrateRx/deployments?environment=Production&per_page=2" --jq '.[].sha' 2>/dev/null
  ```

  - **A deploy record exists for the target SHA** → it's building (~2 min). **Poll, don't abandon.** Re-curl `version.json` every ~60–90s until it flips, up to ~5 minutes. Use `ScheduleWakeup` (60–90s) or a short `sleep`+re-curl loop rather than declaring "should be live shortly" and walking away. Report only once it's confirmed.
  - **NO deploy record for the target SHA** → the GitHub→Vercel auto-deploy was **skipped** (the rapid-back-to-back-merge coalescing bug — `~/.claude/CLAUDE.md`). This is the exact failure the user is worried about. It will NOT self-heal until the next push to `main`. Recover it:
    1. Tell the user prod is stuck one commit behind and why.
    2. Offer to ship it: from the **project root** (`/Users/qbook/Claude Projects/NarrateRx`), on `main`, synced — `cd "/Users/qbook/Claude Projects/NarrateRx" && git pull && npm run deploy:prod`. A prod deploy needs **explicit confirmation at that step** (Mechanical execution policy) — present the command, get the go-ahead, then run it.
    3. After it deploys, re-curl `version.json` and confirm the SHA matches before calling it done.

### c. The gate

Do **not** write "shipped / live" in the report, and do **not** clean up the worktree in step 4, until `version.json` returns the `origin/main` SHA. If the user wants to leave before a confirmed deploy, say so explicitly in **Loose ends** as `⚠️ PROD NOT CONFIRMED — origin/main is <sha>, prod is <sha>` so it can't be missed.

## 4. Worktree cleanup

Only if running inside a session worktree (`git rev-parse --git-common-dir` differs from `.git`, or the path is under `.claude/worktrees/` or `NarrateRx-worktrees/`).

- **This session's PR is merged, prod is confirmed live (step 3 gate passed), + nothing unaccounted-for in the tree** → remove it as routine cleanup (the user has standing authorization for the *session's own* merged worktree): `git worktree remove <path>`. Use `--force` only when the sole blocker is confirmed-regenerable scratch.
- **Unmerged commits, uncommitted work you can't account for, or a `locked` worktree** → do NOT remove. Flag it for the user.
- **Never** remove another session's worktree.
- The project root (`/Users/qbook/Claude Projects/NarrateRx`) is not a worktree — never "clean it up."

## 5. Lessons

Run the `/lessons` review over this session (invoke the lessons skill, or apply its logic): capture genuinely new, recurring footguns into the right `CLAUDE.md`, strictly filtered. Most sessions yield nothing — that's fine. Report what was added or "no new lessons."

## 6. Memory

- Capture any durable new facts surfaced this session (user preferences, project decisions, references) into the auto-memory dir per the memory rules — one fact per file, one-line index entry in `MEMORY.md`. Don't save what the repo/git already records.
- Archive any `project_*` memory whose work **shipped this session** into the MEMORY.md ARCHIVE rollup (collapse to file stem, drop the hook) — keeps the index under its ~24KB cap.
- Check index size: `wc -c "/Users/qbook/.claude/projects/-Users-qbook-Claude-Projects-NarrateRx/memory/MEMORY.md"`. If near/over ~22KB, suggest (or run) `/consolidate-memory`.

## 7. Moments worth capturing

Surface 0–3 genuinely notable things from the session a future-you would want flagged — a hard-won debugging insight, a product decision, a shipped milestone, a near-miss. These aren't lessons (process rules) or routine memory (facts) — they're the "remember when we figured out X" moments. Offer to save the keepers to memory or a project doc; don't auto-save. If nothing rises above routine, say so.

## 8. Out-of-scope threads

If the session drifted into a second unrelated area, name it and suggest `/idea` to park it or noting it as a next session (per the Session Focus rule). Surface any `mcp__ccd_session__spawn_task` candidates you noticed but didn't flag.

---

## Session Wrap Report

Output exactly this structure, omitting any section that's genuinely empty:

```
## Session Wrap — <today's date>

**Shipped:** <PRs merged + live SHA confirmation, or "nothing merged">
**Git:** <clean / committed N / pushed branch X / parked branch Y>
**PRs in flight:** <none / #NNN auto-merging / #NNN FAILING — needs attention>
**Prod:** <live SHA matches / deploy skipped — flag / n/a>
**Worktree:** <removed / kept (reason) / n/a>
**Lessons:** <added "title" to FILE / none — routine>
**Memory:** <captured X, archived Y / index NN KB / no change>
**Moments:** <0–3 bullets, or "routine session">

**Loose ends:** <anything the user must do — failing CI, unconfirmed deploy, parked WIP, a deferred decision — or "none, clean exit">
```

Lead with **Loose ends** in your spoken summary if any exist — that's the one thing the user needs before walking away.
