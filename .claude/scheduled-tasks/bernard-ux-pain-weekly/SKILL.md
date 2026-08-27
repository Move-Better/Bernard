---
name: bernard-ux-pain-weekly
description: Weekly automated Bernard UX-pain report — pulls PostHog frustration/nav/LCP signals via the personal API key, maps them to components, writes a P0/P1/P2 punch list. Report-only (no PRs, no chips).
---

# Bernard weekly UX-pain check (automated)

You are running **unattended** on a weekly schedule. Produce a repo-aware UX-pain
report from PostHog behavioral signals and write it to a file. This is the
**automated** successor to the old "reminder to run it manually" version — the
`POSTHOG_PERSONAL_API_KEY` needed to query PostHog directly is now provisioned, so
you no longer need a live browser SSO session.

**Posture: REPORT-ONLY.** Do NOT open PRs, do NOT edit app code, do NOT spawn task
chips, do NOT run any git mutation. Write one report file and send one summary
message. That's the whole job. (A human reviews the report and decides what to fix.)

**You cannot use a browser.** This runs headless, so you cannot live-verify a
dead-click in Chrome. Findings that need a live click-test must be *flagged as
"verify-first"* in the report, never asserted as confirmed bugs.

Key facts:
- PostHog project: **Bernard, id 473748** · API host `https://us.posthog.com`
- Report dir (absolute, primary checkout, gitignored): `/Users/qbook/Claude Projects/Bernard/.claude/audit-history/`
- Report filename: `<YYYY-MM-DD>-posthog-ux.md`

---

## Step 0 — Read the PostHog key defensively, or bail cleanly

The key lives in the 1Password mount `/Users/qbook/Claude Projects/Bernard/.env.bernard.1pw`.
That mount is **known to occasionally serve empty or hang** (documented in this repo's
CLAUDE.md). Handle that without looping:

```bash
cd "/Users/qbook/Claude Projects/Bernard"
T=$(mktemp); cat .env.bernard.1pw > "$T" 2>/dev/null
K=$(awk -F= '/^POSTHOG_PERSONAL_API_KEY=/{print substr($0,index($0,"=")+1)}' "$T" | tr -d '\r'); rm -f "$T"
case "$K" in
  phx_*) echo "key ok (len ${#K})";;
  *) echo "KEY_MISSING";;
esac
```

- Do NOT wrap the `cat` in `timeout`/`gtimeout` (not installed on macOS — it exits 127
  and produces a false empty read). A plain `cat` is fine; the harness caps a hang.
- If the check prints `KEY_MISSING` (empty mount, 1Password app closed, or a 0-byte
  hang): **send the user a short message** ("📊 Weekly UX check skipped — couldn't read
  `POSTHOG_PERSONAL_API_KEY` from the 1Password mount; is the 1Password app open?") and
  **STOP**. Do not retry in a loop, do not write a report.
- Never print `$K` itself. Only its length/prefix (`phx_` is the non-secret key type).

Keep `$K` in the shell for the queries below (do the extraction and the queries in the
**same** Bash call, since shell state doesn't persist across calls, and re-reading the
mount repeatedly risks the empty-serve).

## Step 1 — Pull the signals (one Bash call)

Run the validated HogQL queries below through `POST /api/projects/473748/query/`.
`$`-prefixed names (`$dead_click`, `$pathname`, `$web_vitals_LCP_value`) are PostHog
event/property names — keep the backslash-escapes exactly as written inside the
`-d '{...}'` JSON. Route normalization collapses UUIDs → `/:id` and numeric ids → `/:n`.

```bash
q(){ curl -s -X POST -H "Authorization: Bearer $K" -H "Content-Type: application/json" \
  -d "{\"query\":{\"kind\":\"HogQLQuery\",\"query\":\"$1\"}}" \
  "https://us.posthog.com/api/projects/473748/query/" \
  | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('results', d.get('error') or d))"; }
NRM="replaceRegexpAll(replaceRegexpAll(properties.\$pathname,'/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}','/:id'),'/[0-9]+','/:n')"

echo '== A: frustration 7d =='
q "select event, count() from events where timestamp > now() - interval 7 day and event in ('\$dead_click','\$rageclick','\$exception') group by event order by count() desc"
echo '== B: dead clicks by route 7d =='
q "select $NRM as route, count() c from events where event='\$dead_click' and timestamp > now() - interval 7 day group by route order by c desc limit 10"
echo '== C: dead-click element text 7d (None = textarea/canvas, digits = slide-picker thumbs) =='
q "select properties.\$el_text as el, count() c from events where event='\$dead_click' and timestamp > now() - interval 7 day group by el order by c desc limit 10"
echo '== D: funnel event counts 7d =='
q "select event, count() from events where timestamp > now() - interval 7 day and event in ('piece_opened','draft_reviewed','publish_scheduled','published','capture_started','story_generated','clip_approved') group by event order by count() desc"
echo '== E: LCP by route 14d (median/p95 ms, n) =='
q "select $NRM as route, round(median(properties.\$web_vitals_LCP_value)) med, round(quantile(0.95)(properties.\$web_vitals_LCP_value)) p95, count() n from events where event='\$web_vitals' and properties.\$web_vitals_LCP_value>0 and timestamp > now() - interval 14 day group by route order by n desc limit 10"
echo '== F: exceptions 7d (any real error cluster is a P0) =='
q "select properties.\$exception_types as t, $NRM as route, count() c from events where event='\$exception' and timestamp > now() - interval 7 day group by t, route order by c desc limit 10"
echo '== G: session/user volume 7d (frame everything through this) =='
q "select count(distinct \$session_id) sessions, count(distinct person_id) users, count() events from events where timestamp > now() - interval 7 day"
```

If a query returns an `error`/`{}` rather than a list, note it in the report as a data
gap for that section and continue — don't abort the whole run for one failed query.

## Step 2 — Interpret against the repo (ground on origin/main)

Read the components/routes the signals point at to explain each one. **Ground on
`origin/main`, not the local working tree** (the checkout this runs from may be stale, and
sibling sessions merge constantly): `git fetch origin main -q` then read with
`git grep <pat> origin/main -- <path>` / `git show origin/main:<file>`. **Never** run
`git checkout`/`git pull`/`git stash`/`git reset` here — the project root is shared with
other sessions; read-only git only.

**Apply the known false-positive filters — do NOT re-raise these as bugs (they are settled):**

- **`$dead_click` with `el_text = None` on a `<textarea>`** (caption/text fields, class
  `bg-muted/40`) → **focus-only false positive**. Clicking into a textarea produces no DOM
  mutation, so PostHog logs a dead click. Not a defect. (CLAUDE.md: PostHog dead-click
  false-positive shapes.)
- **`$dead_click` with `el_text` = a slide number ("1".."N")** on `/publish/:id` → the
  `SlidePickerStrip` thumbnails / preview `<canvas>`. Re-selecting the already-active slide
  is a correct no-op (0 mutations); a non-active click repaints a `<canvas>` PostHog can't
  see. **Canvas / no-op-reselect false positive**, live-verified 2026-08-27.
- **The `/publish/:id` "editor freezes the caption over a locked piece" theory** → WRONG and
  RESOLVED. A locked (scheduled/published) piece renders the read-only `PublishedReceipt`,
  not the editor; no caption textarea is ever `disabled`. Fixed/verified in #2662. Do NOT
  re-raise. (See memory `moment-publish-deadclick-mechanism-was-wrong`.)

For everything that is NOT one of the above: map selector/route → component (grep the repo),
decide whether it's a real defect or a false positive, and assign severity:
- **P0** — an `$exception` cluster with real N, or a funnel step that dropped to ~0 with
  meaningful N (broken flow). Genuinely on fire.
- **P1** — a real interaction dead-click on a working-looking control that does nothing, or a
  wired handler whose only visible effect PostHog can't see AND that a user would reasonably
  read as broken.
- **P2** — perf (any route in CWV "needs improvement": median LCP > 2500 ms), a `/moments` or
  other disabled-looking field, or a low-N tail signal.

Frame the whole thing through Step-1 query G: this is a **small internal-staff tool** — the
dead-click volume is essentially one core producer. Real, but single-power-user friction, not
mass pain. Say so.

## Step 3 — Write the report

Write to `/Users/qbook/Claude Projects/Bernard/.claude/audit-history/<YYYY-MM-DD>-posthog-ux.md`
(use `date +%F`). Match the format of the most recent existing `*-posthog-ux.md` in that dir
(read the newest one first for the exact shape). Include:

1. Header (date, window: 7d frustration / 14d LCP, source project 473748 via the personal key).
2. **Dataset size** (from query G) — frame all findings through it.
3. **Section A — Frustration** (query A/B/C): the dead-click story, by route + element, with
   the false-positive calls made explicitly (don't just list counts — say which are noise).
4. **Section B — Navigation & perf**: the funnel counts (query D) and the **LCP table**
   (query E), flagging routes in "needs improvement".
5. **Punch list**: P0 / P1 / P2, each with the file(s) and a one-line fix direction. Mark any
   finding that needs a live Chrome click-test as **"(verify-first)"** — you couldn't verify
   it headless.
6. If query F shows any exception cluster, lead with it as P0.

## Step 4 — Notify (one message) and stop

Send the user ONE concise message: dead-click total + top route, any P0, the worst LCP route,
and the report path. Example:

> 📊 Weekly UX check ({date}): {N} dead clicks (top: {route}, mostly {false-positive kind}).
> {P0 line or "No P0s."} Slowest route: {route} LCP {med}ms. Full report:
> `.claude/audit-history/{date}-posthog-ux.md`.

Then STOP. No PRs, no chips, no code edits.

---

## Maintenance notes (for whoever edits this routine)

- This file is the committed source of truth at
  `.claude/scheduled-tasks/bernard-ux-pain-weekly/SKILL.md`. The LIVE scheduler copy is at
  `/Users/qbook/.claude/scheduled-tasks/bernard-ux-pain-weekly/SKILL.md`. **Edit both** (mirror
  via `mcp__scheduled-tasks__update_scheduled_task`), or they drift.
- When a manual Chrome session later confirms a flagged signal is a false positive, add it to
  the Step-2 filter list so it's not re-raised every week.
- If it goes silent: check (1) the 1Password app is open (Step-0 mount read), (2) the key still
  authenticates (`GET /api/projects/473748/` → 200), (3) the report dir still exists.
- The key is Sensitive — never print its value; header-only usage; length/`phx_` prefix are the
  only safe things to echo.
