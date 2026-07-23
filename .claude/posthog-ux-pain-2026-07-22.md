# Bernard UX pain check — 2026-07-22

**Window:** last 7 days (2026-07-15 → 2026-07-22), prod `*.withbernard.ai`
**Population:** 3 distinct users (internal/dogfood — Move Better). Treat all counts as directional, not statistical.
**Grounding:** all code read from `origin/main` @ `2e1f81e8` via `git show` (local primary checkout was 10 behind; not used for reads).

## Volume

| Signal | Count |
|---|---|
| `$dead_click` | ~85 |
| `$rageclick` | 7 |
| `$exception` | 0 (not captured in this project) |

Rage clicks are negligible — frustration is concentrated entirely in dead clicks, and `/week` owns the bulk of it (22 dead clicks / 51 pageviews = **0.43 per view**).

---

## P1 — real bugs, worth fixing

### P1-1 · `/week` piece cards promise interactivity they don't have

`PlanCard` (YourWeek.jsx:207) and `DayPlanCard` (YourWeek.jsx:328) both render their root as a plain `<div>` with `transition-shadow hover:shadow-md` — a hover-lift that reads as "this card is clickable" — but neither has an `onClick`. Only the inner Draft / Approve / Open buttons do anything.

**Evidence (7-22):** headline text `div.text-2xs.font-semibold...line-clamp-3` → 4 dead clicks; category tag "Clinical Perspective" → 2; card-body/empty-state divs → several more. Roughly **9+ of the 22 `/week` dead clicks**.

**Fix:** either make the card body open the piece (`/publish/:contentPieceId` when it exists, matching the existing "Open" button target), or drop `hover:shadow-md` so the card stops advertising a behavior it doesn't have. Opening is the better call — it's what the user is reaching for.

### P1-2 · `/week` automation-mode ladder is a status display dressed as a toggle

YourWeek.jsx:837–851 renders `div[role="group"][aria-label="Current automation mode"]` containing one `<span>` per LADDER stage, with the active one styled `bg-primary text-primary-foreground shadow-sm`.

Directly below it, the day/week View control uses real `<button aria-pressed>` elements with the **identical** active styling and the same `inline-flex items-center rounded-lg border p-0.5 text-xs` wrapper. So two visually-identical segmented controls sit inches apart — one interactive, one inert.

**Evidence:** "Auto-approve routine" → 2 dead clicks, "Run by goals" → 2. Users are trying to change their automation mode by clicking the stage they want.

**Fix:** differentiate it visually (it's a progress ladder, not a picker — chevrons/steps rather than segmented pills), or wire it to actually set the mode. The current design teaches the wrong affordance.

---

## P2 — worth queuing

### P2-1 · `/` (Home) is now the slowest route
p95 LCP **7.22s**, p50 2.58s (n=9 — noisy). Home fires 3 `useQuery` hooks including `/api/content-plan/week-summary` and `/api/answers`.

Last week's #2170 `Promise.all` in `week-summary.js` **held** (still at line 117) and `/week` improved **6.4s → 5.54s p95**. Home didn't benefit as much because its cost is spread across three independent client queries plus bundle. Worth a look, but sample size is small enough that I'd re-measure before investing.

### P2-2 · `/week` per-platform cadence tiles aren't clickable
YourWeek.jsx:951 — per-platform progress (`got/target`) rendered as plain divs. 3 dead clicks. No hover affordance is promising anything here, so this is a missing-feature signal ("show me my Instagram posts") rather than a broken promise. Low priority.

---

## P3 — correct as built, minor polish

### `Draft` button dead clicks (6 across 7-21/7-22)
**#2170's `draftBusy` fix is live and working** (YourWeek.jsx:242–243, 380–381, 1027, 1083). The remaining dead clicks are users clicking a *correctly disabled* Draft button while another draft is in flight. The only weakness is that the "please wait" signal is a native `title` tooltip — slow to appear, invisible on touch. Consider an inline hint instead. Not a bug.

---

## False positives — no action

Verified against the handlers; all are the known FP shapes:

- **`/capture`, `/library`, `/new/brief` → `input.hidden` clicks.** File-picker buttons that call `.click()` on a hidden input. The OS dialog opens; the DOM doesn't mutate → dead click fires. Expected.
- **`/capture` → "Pick existing files From Photos, SD card, or downloads".** Same — a real `<button>` opening the native picker.
- **`/library` → "approved" filter pill.** `bg-primary...border-primary` = already-active filter; re-clicking re-applies identical state.
- **`/week` → "day" / "week" toggle** with `aria-pressed="true"`. Already-active tab.

## Navigation

Mild ping-pong between `/producer` ↔ `/week` and `/producer` ↔ `/stories` (n=2 each direction), and `/new` ↔ `/new/brief` backtracking (n=2). All below the threshold where I'd trust it with 3 users. Re-check next week.

---

---

## Outcome (same session)

| Item | Resolution |
|---|---|
| P1-1 piece cards | Handed to a separate session (chip `task_a3ddda8b`) |
| P1-2 automation ladder | Handed to a separate session (chip `task_42eb5aa2`) |
| P2-1 Home LCP | **No fix — not a real regression.** Both slow samples (7.54s, 6.76s) are from 7-15 alone; every sample since is ≤3.11s and today's is 1.31s. `useStories` already parallelizes staff+content via `Promise.all` with slim `view=card` payloads and 5min staleTime — there's no waterfall to remove. Re-measure next week. |
| P2-2 cadence tiles | **Shipped** — #2236 (link to `/stories?platform=`) + #2239 (label-color regression fix). Prod-verified. |
| P3 Draft tooltip | **No fix — see below.** |

### Why P3 got no code change

The proposed fix (drop `disabled`, toast on click when busy) would touch 8 sites across `YourWeek.jsx` including both component signatures — maximum conflict surface with the two live sessions — and it would trade a *correct* affordance for a worse one. A disabled button accurately communicates "not now"; removing that to make a metric go green is the fix-the-metric trap.

The dead clicks are a symptom of something more useful: **you can't batch-draft the week.** A user with 7 undrafted posts clicks Draft, waits ~20-30s for the LLM, and finds every other Draft button greyed. The single-flight lock is working as designed — the missing capability is a draft queue. That's a feature needing a challenge-gate brief, not a tooltip tweak.

## Recurring lesson confirmed

The hidden-file-input and already-active-pill clusters would both have read as real bugs without the handler read. The `<textarea>`/`<canvas>`/file-input/active-tab family stays the standing false-positive list — keep reading the handler before writing a fix.
