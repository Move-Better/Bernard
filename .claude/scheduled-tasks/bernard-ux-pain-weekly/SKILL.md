---
name: bernard-ux-pain-weekly
description: Weekly Bernard UX-pain check — pulls PostHog frustration/nav/LCP signals via the personal API key, maps them to components, LIVE-VERIFIES the survivors in Q's logged-in Chrome (read-only), writes a P0/P1/P2 punch list, and spawns a one-click fix chip for each finding that verifies as a real bug. Never auto-edits code or opens PRs.
---

# Bernard weekly UX-pain check (automated, browser-verified)

You run on a weekly schedule **on Q's Mac**. Pull PostHog behavioral signals, map them to
components, **drive Q's logged-in Chrome to live-verify** the candidate issues against prod
(read-only), write a report, and **spawn a one-click fix chip for each finding that verifies
as a real bug**. A human then clicks the chip to start the fix.

**Posture: SUGGEST, don't ship.**
- ✅ DO: query PostHog, read the repo (read-only git), drive Q's logged-in Chrome **read-only**
  to verify, write the report, and `spawn_task` (`mcp__ccd_session__spawn_task`) a fix chip per
  **CONFIRMED-real** finding.
- ❌ NEVER: open PRs, edit app code, or run any git mutation.
- ❌ NEVER spawn a chip for a false positive. The browser step exists precisely so a finding only
  becomes a chip *after* Chrome confirms it's real. A settled/confirmed false positive is noise,
  not a fix.
- ❌ NEVER click a mutating control in Chrome (Approve / Publish / Schedule / Delete / Send) — this
  is Q's real authenticated session. Navigate + read_page + screenshot + DOM asserts only.

**Browser dependency (unattended reality).** This fires whether or not Q's Chrome is open, logged
in, and the extension connected. If the browser is not reachable, **DEGRADE — do not fail the run:**
do the analysis, mark surviving findings **(verify-first — browser was down)**, and still spawn
chips for them, with the chip prompt telling the fix session to live-verify first. Never block the
whole report on a missing browser.

Key facts:
- PostHog project: **Bernard, id 473748** · API host `https://us.posthog.com`
- Authed prod host: `https://<slug>.withbernard.ai` — the flagship live-data workspace is
  **`movebetter`** (`https://movebetter.withbernard.ai`). Clerk's session cookie is shared across
  Q's Chrome profile, so a logged-in tab is already past the gate.
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
echo '== C2: dead-click route x element 7d (needed to place each cluster) =='
q "select $NRM as route, properties.\$el_text as el, count() c from events where event='\$dead_click' and timestamp > now() - interval 7 day group by route, el order by c desc limit 20"
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

## Step 2 — Interpret against the repo → a CANDIDATE list (ground on origin/main)

Read the components/routes the signals point at to explain each one. The output of this step is
a **candidate list**: findings that survive the false-positive filters below and go on to live
Chrome verification in Step 4. **Ground on `origin/main`, not the local working tree** (the
checkout this runs from may be stale, and sibling sessions merge constantly): `git fetch origin
main -q` then read with `git grep <pat> origin/main -- <path>` / `git show origin/main:<file>`.
**Never** run `git checkout`/`git pull`/`git stash`/`git reset` here — the project root is shared
with other sessions; read-only git only.

**Apply the known false-positive filters — do NOT carry these into the candidate list (they are settled):**

- **`$dead_click` with `el_text = None` on a `<textarea>`** (caption/text fields, class
  `bg-muted/40`) → **focus-only false positive**. Clicking into a textarea produces no DOM
  mutation, so PostHog logs a dead click. Not a defect. (CLAUDE.md: PostHog dead-click
  false-positive shapes.)
- **`$dead_click` with `el_text` = a slide number ("1".."N") on `/publish/:id`** → the
  `SlidePickerStrip` thumbnails / preview `<canvas>`. Re-selecting the already-active slide
  is a correct no-op (0 mutations); a non-active click repaints a `<canvas>` PostHog can't
  see. **Canvas / no-op-reselect false positive**, live-verified 2026-08-27.
- **`$dead_click` on `/publish/:id` editor rail tabs (`el_text` = `Words`/`Slide`/`Media`/`Text`/`Logo`)**
  → `EditorIconRail` `onPick={pickTool}`; re-clicking the already-active tool (`tool===key`) is a
  no-op with no re-render. Same family as the thumbnails. **False positive**, confirmed 2026-09-07.
- **The `/publish/:id` "editor freezes the caption over a locked piece" theory** → WRONG and
  RESOLVED. A locked (scheduled/published) piece renders the read-only `PublishedReceipt`,
  not the editor; no caption textarea is ever `disabled`. Fixed/verified in #2662. Do NOT
  re-raise. (See memory `moment-publish-deadclick-mechanism-was-wrong`.)
- **Purely descriptive text nodes** (`el_text` that is a sublabel/insight sentence, e.g.
  MediaUploader's "Clinic, team, equipment, before/after, social", or a one-off insight line) →
  clicks on non-interactive copy. False positive unless the count is large and single-element.

For everything that is NOT filtered above, map selector/route → component (grep the repo) and put
it on the candidate list with a provisional severity:
- **P0** — an `$exception` cluster with real N, or a funnel step that dropped to ~0 with
  meaningful N (broken flow). Genuinely on fire. (P0s skip verification — report immediately.)
- **P1** — a real interaction dead-click on a working-looking control that does nothing, or a
  wired handler whose only visible effect PostHog can't see AND that a user would reasonably
  read as broken.
- **P2** — perf (any route in CWV "needs improvement": median LCP > 2500 ms with n ≥ ~5), a
  disabled-looking field, a `None`-element cluster on a route where a clickable-looking region
  may do nothing (e.g. `/library` media tiles, `/week` cards, `/ads` preview), or a low-N tail.

Frame the whole thing through Step-1 query G: this is a **small internal-staff tool** — the
dead-click volume is essentially one core producer. Real, but single-power-user friction, not
mass pain. Say so, and weight severity by real N (a 1-user, 1-click tail item is not worth a chip).

## Step 3 — Open Q's logged-in Chrome (or degrade)

Load the browser tools (they are deferred), then attach to Q's real, logged-in Chrome:

- ToolSearch: `select:mcp__claude-in-chrome__list_connected_browsers,mcp__claude-in-chrome__select_browser,mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__javascript_tool`
- `list_connected_browsers` → `select_browser` (Q's device, typically **"DrQ"**) → `tabs_context_mcp`.
- Sanity-check the session is authed: `navigate` to `https://movebetter.withbernard.ai/` and confirm
  a signed-in surface renders (not the Clerk sign-in page).

**If no browser connects, or the tab shows the Clerk gate (not logged in):** set `BROWSER_DOWN`,
skip Step 4, and go straight to Steps 5–6 with the degrade behavior (candidates stay
**verify-first**, chips still spawn but flagged "browser was down — live-verify first"). Do not
loop trying to connect.

## Step 4 — Live-verify each surviving candidate in Chrome (READ-ONLY)

For each candidate from Step 2 (skip P0 exceptions — those report immediately), reproduce it
against prod in the logged-in Chrome and assign a verdict: **CONFIRMED / FALSE POSITIVE /
INCONCLUSIVE**. Read-only always — navigate, read_page, screenshot, DOM asserts; never a
mutating click.

Navigate to `https://movebetter.withbernard.ai/<route>`. For a `/:id` route, get a real id from
the page (or a read-only PostHog/DB read) rather than guessing. **Apply the documented gotchas
(all in the Bernard project CLAUDE.md — don't rediscover them):**
- **PWA service-worker cache**: if the UI looks stale after deploy, the SW is serving an old
  bundle — clear `caches` + unregister SW, then cache-busted reload; a `/api/*` probe returning
  **401** (or **400** on the bare apex) means "deployed", **404** means "not yet".
- **Blank `<main>` with the shell still rendering** = you deep-linked a route that doesn't exist;
  get the real route from the in-app nav link's `href`, don't chase a chunk bug.
- **`javascript_tool` returns `{}` for an async/Promise result** — assign to `window.__x` and read
  it back in a SECOND synchronous call; React state updates are batched, so read a post-click DOM
  value in a separate call (or after a ~100ms wait).
- **rAF/NumberTicker freezes in a backgrounded tab** — front the tab (a screenshot raises it)
  before trusting animated values.
- Prefer **DOM assertions** over screenshots: `getBoundingClientRect`, computed style,
  `elementFromPoint`, and a `MutationObserver` over `main`.

**Dead-click verdict:** reproduce the flagged element's click and watch `main` with a
MutationObserver for ~800ms.
- 0 mutations because it was a **re-click of an already-active control** (tab/thumbnail) or a
  **canvas repaint** the heuristic can't see → **FALSE POSITIVE** (record it; add to the Step-2
  filter list per maintenance).
- A visibly-clickable region that produces **no nav, no mutation, no canvas repaint** → **CONFIRMED**
  real affordance gap.
- A coordinate click that "lands nowhere" → retry once (timing) and use a `ref`/`elementFromPoint`
  before concluding anything.

**Perf verdict:** for an LCP finding, `fetch()` the route warm 3–4× from the authed tab and read
the real timing (`responseStart - requestStart` server vs `requestStart - startTime` queue) — a
cold single sample is not the number. `/week` is documented as **already at floor** (memory:
`week-summary.js` optimized) — do NOT re-investigate it; verify the OTHER slow routes.

## Step 5 — Write the report

Write to `/Users/qbook/Claude Projects/Bernard/.claude/audit-history/<YYYY-MM-DD>-posthog-ux.md`
(use `date +%F`). Match the format of the most recent existing `*-posthog-ux.md` in that dir
(read the newest one by DATE — `ls -t` can lie; sort by the date in the name). Include:

1. Header (date, windows 7d/14d, source project 473748 via the personal key, and whether the
   browser was reachable this run).
2. **Dataset size** (query G) — frame all findings through it.
3. **Section A — Frustration** (queries A/B/C/C2): the dead-click story by route + element, each
   cluster labeled with its **live verdict** (CONFIRMED / FALSE POSITIVE / verify-first-browser-down),
   not just a count.
4. **Section B — Navigation & perf**: funnel counts (D) and the LCP table (E), with the verified
   verdict on any slow route.
5. **Punch list**: P0 / P1 / P2, each with the file(s), a one-line fix direction, and its verdict.
   Note which findings got a chip (and which were de-duped against an open prior chip).
6. If query F shows any exception cluster, lead with it as P0.

## Step 6 — Spawn a fix chip per CONFIRMED-real finding

For each finding whose Step-4 verdict is **CONFIRMED** (or, if `BROWSER_DOWN`, each surviving
candidate), spawn ONE chip with `mcp__ccd_session__spawn_task`:
- **title** — imperative, < 60 chars (e.g. "Fix dead click on /library media tiles").
- **tldr** — 1–2 plain sentences: what the weekly check noticed + what the fix session will do.
  No file paths in the tldr.
- **prompt** — self-contained (the spawned session has none of this context): the route + element,
  the PostHog evidence (count, window, #users), the file(s) from Step 2, the **live verdict from
  Step 4** (or "browser was down — live-verify first"), and the standing rules the fix must follow:
  **mockup-first for any UI change**, ship via **branch → PR → prod → Chrome-verify**, and
  **NEVER game the dead-click metric** by adding a throwaway DOM mutation (a canvas repaint or a
  correct no-op re-select is not a bug).

Hard rules:
- **NEVER** spawn a chip for a settled/confirmed false positive.
- **DE-DUP**: before spawning, scan the last ~2 `*-posthog-ux.md` reports for the same finding
  signature (route + element). If it was already chipped and isn't resolved, do NOT re-spawn —
  note "chip still open from {date}" in the report instead.
- **No chips at all if nothing is CONFIRMED.** That is the normal, healthy weekly outcome — say so.
- A 1-user / 1-click tail item is not worth a chip even if technically real; use judgment on N.

## Step 7 — Notify (one message) and stop

Send the user ONE concise message: dead-click total + top route, any P0, the worst *verified* LCP
route, **how many fix chips you spawned and for what** (or "no chips — nothing verified as real"),
whether the browser was reachable, and the report path. Example:

> 📊 Weekly UX check ({date}): {N} dead clicks (top: {route}, mostly {false-positive kind}).
> {P0 line or "No P0s."} Live-verified in Chrome → spawned {M} fix chip(s): {what}. Slowest real
> route: {route} LCP {med}ms. Report: `.claude/audit-history/{date}-posthog-ux.md`.

Then STOP. No PRs, no code edits, no git mutations — only the report + chips.

---

## Maintenance notes (for whoever edits this routine)

- This file is the committed source of truth at
  `.claude/scheduled-tasks/bernard-ux-pain-weekly/SKILL.md`. The LIVE scheduler copy is at
  `/Users/qbook/.claude/scheduled-tasks/bernard-ux-pain-weekly/SKILL.md`. **Edit both** (this copy
  via a normal edit, the live copy via `mcp__scheduled-tasks__update_scheduled_task`), or they drift.
- **Browser dependency**: live verification (Step 4) needs Q's Chrome open, the claude-in-chrome
  extension connected, and a tab logged into the Bernard subdomains at fire time. When it's down the
  run degrades to headless (verify-first) rather than failing — that's intended.
- When live verification confirms a flagged signal is a false positive, add it to the Step-2 filter
  list so it's not re-verified every week (that list is the routine's growing memory of settled noise).
- **Chip discipline**: a chip is only ever for a CONFIRMED-real finding (or a browser-down survivor);
  never for a false positive, and de-dup against open chips from prior reports.
- If it goes silent: check (1) the 1Password app is open (Step-0 mount read), (2) the key still
  authenticates (`GET /api/projects/473748/` → 200), (3) the report dir still exists, (4) Q's Chrome
  is connected + logged in (Step 3).
- The key is Sensitive — never print its value; header-only usage; length/`phx_` prefix are the
  only safe things to echo.
