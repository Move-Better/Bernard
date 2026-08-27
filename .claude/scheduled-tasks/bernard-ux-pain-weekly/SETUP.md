# Bernard weekly UX-pain check — Setup (automated 2026-08-27)

**Supersedes** the reminder-only version of `bernard-ux-pain-weekly` (which only pushed a
"run it manually" nudge because the routine had no way to query PostHog unattended). The
`POSTHOG_PERSONAL_API_KEY` is now provisioned into the Bernard 1Password environment, so the
routine queries PostHog's HogQL API directly — no live browser SSO session required.

## What it does now

Every Monday (cron `0 9 * * 1`, local time) it:
1. Reads `POSTHOG_PERSONAL_API_KEY` from `.env.bernard.1pw` (defensively — bails with a message
   if the mount serves empty, no retry loop).
2. Runs a fixed set of HogQL queries against PostHog project **473748** (frustration signals,
   dead-clicks by route + element, funnel event counts, LCP by route, exception clusters,
   session/user volume) — all validated end-to-end 2026-08-27, reproducing that day's manual
   audit numbers exactly.
3. Maps signals → components by reading `origin/main` (read-only git), applying the documented
   **false-positive filters** so settled noise (textarea focus-only clicks, SlidePickerStrip
   canvas clicks, the resolved #2662 locked-caption theory) is never re-raised.
4. Writes `.claude/audit-history/<date>-posthog-ux.md` in the established report format.
5. Sends the user one summary message.

**Report-only.** No PRs, no code edits, no task chips, no git mutations. A human reviews the
report and decides what to fix. It also can't use a browser (headless), so any finding needing
a live click-test is flagged **"(verify-first)"** rather than asserted.

## Two copies, keep in sync

| Copy | Path | Role |
|---|---|---|
| Committed source of truth | `.claude/scheduled-tasks/bernard-ux-pain-weekly/SKILL.md` (this repo) | reviewable / version-controlled |
| Live scheduler copy | `/Users/qbook/.claude/scheduled-tasks/bernard-ux-pain-weekly/SKILL.md` | what actually executes |

Edit one → mirror the other via `mcp__scheduled-tasks__update_scheduled_task`.

## Prerequisites (all met as of 2026-08-27)

- [x] `POSTHOG_PERSONAL_API_KEY` in the Bernard 1Password env → served in `.env.bernard.1pw`
      (verified: `GET /api/projects/473748/` → 200, HogQL query → 200 with data).
- [x] Task `bernard-ux-pain-weekly` registered, cron `0 9 * * 1`, enabled.
- [x] `.claude/audit-history/` exists (has prior `*-posthog-ux.md` reports).

## Known limitations (accepted)

- **Headless — no live verification.** The routine can't click-test in Chrome; verify-first
  findings must be checked in an interactive session before acting on them.
- **Runs only while the Claude app is open.** A missed Monday runs on next launch.
- **Small-N tool.** Signals are dominated by one core producer; read them as single-power-user
  friction, not mass pain. The routine says so in every report.
- **Cloud/unattended-elsewhere:** if this is ever moved to a Vercel cron / cloud agent (no local
  1Password mount), the key must be supplied via that environment's server env instead.
