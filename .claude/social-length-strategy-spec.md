# Social post-length strategy — build spec

**Status:** decided in planning session 2026-07-16. Awaiting before/after sample sign-off before build.
**Owner decision (Q):** vary + protect a deliberate long lane · per-angle length identity · add a workspace length-lean dial · Move Better ships on **in-depth** · IG hashtags trimmed to 3–5.

## Problem

Generated post text reads as "maxed out." Two distinct mechanisms (confirmed in code):
1. **Short platforms (X, Threads, Bluesky, Mastodon, IG Story)** get *only* a hard ceiling in the prompt ("Hard limit: 280 characters") and no target → the model treats the ceiling as the goal.
2. **Long platforms (IG, FB, LinkedIn, GBP)** get a *fixed* word target on every angle (IG ~175w ×3, FB ~125w ×2, LinkedIn ~200w ×3, GBP ~200w ×2) → identical every time (reads machine-made) and some are simply too long for the medium.
3. **GBP contradicts itself between paths:** atoms path ~200 words (~1,200 chars) vs brief path 150–300 chars — 4–8× apart for the same platform.

**The enemy is uniformity, not length.** Fix = stop making everything the same length; let each post be the length its *job* needs, and keep long-form as a deliberate differentiator (a depth-driven clinic that publishes substantive explainers stands out when most brands post fluff).

## Design

### Three lanes (length follows the message)
- **Short** — brevity IS the job: IG hook, IG cta, IG Story, X, GBP front line.
- **Medium** — the everyday: IG quick_win, FB community, LinkedIn referring/principle, Threads, Bluesky, Mastodon.
- **Long — PROTECTED** — the differentiator: IG clinical_insight, LinkedIn clinical_perspective, GBP expandable body, blog, email (blog/email already varied).

### Length-lean dial (workspace setting)
`social_length_lean ∈ { punchy, balanced, indepth }`, default `balanced`; **Move Better = `indepth`**.
The dial scales lanes **non-uniformly**: the short lane barely moves (a hook stays a hook even for an in-depth clinic), the long lane is the most elastic (that's where the lean shows). Mirrors the existing blog pattern (`src/lib/lengthPresets.js` + staff `preferred_length`).

### Per-angle ranges (balanced baseline → in-depth)

| Platform | Angle | Lane | Unit | Balanced | In-depth (MB) | Hard cap |
|---|---|---|---|---|---|---|
| instagram | hook | short | words | 20–45 | 25–55 | 2200 |
| instagram | quick_win | medium | words | 55–95 | 75–130 | 2200 |
| instagram | clinical_insight | **long** | words | 120–180 | **170–260** | 2200 |
| instagram | cta | short | words | 30–60 | 35–70 | 2200 |
| linkedin | clinical_perspective | **long** | words | 150–220 | **220–320** | 3000 |
| linkedin | referring_provider | medium | words | 90–140 | 120–190 | 3000 |
| linkedin | movement_principle | medium | words | 110–160 | 150–220 | 3000 |
| facebook | community | short | words | 25–55 | 35–70 | — |
| facebook | educational | medium | words | 60–120 | 90–170 | — |
| gbp | local_authority | short/front | chars | 150–320 | 200–450 | 1500 |
| gbp | patient_outcome | long/narrative | chars | 300–600 | 400–800 | 1500 |
| twitter | hook | short | chars | 90–210 | 120–250 | 280 |
| threads | community_take | medium | chars | 130–320 | 180–420 | 500 |
| bluesky | clinical_share | medium | chars | 120–250 | 150–280 | 300 |
| mastodon | educational | medium | chars | 160–360 | 200–440 | 500 |
| tiktok | myth_buster/process | — | — | script ~130w, caption 50–80w (unchanged) | same | — |
| instagram_story | story_teaser | — | words | 5–8 (fixed, lean-independent) | same | — |

### Cross-cutting rules (added in the same pass)
1. **Front-load** on truncated surfaces (IG, FB, LinkedIn, GBP): first sentence must land the whole point on its own — everything past "…more" / the GBP ~100-char fold is a bonus.
2. **Don't pad to fill the range** — added to the shared preamble. Land *within* the range by feel; a sharp point in two lines beats the same point padded to the top of the range.
3. **IG hashtags 8–10 → 3–5** (hashtag wall is its own "AI-run" tell).
4. **Short platforms:** keep the hard cap as an explicit guardrail ("never exceed N"), but the *target* is the range — vary, don't max. Editor already warns via `CAPTION_LIMITS`.
5. **GBP two-part:** always-tight front hook (first ~100 chars) + optional deeper body for expanders. `local_authority` = punchy; `patient_outcome` = the longer narrative.
6. **Facebook spread:** `community` warm/short, `educational` widened so a real myth-bust has substance.

## Architecture

New shared source of truth so the two paths can never drift again (this permanently fixes the GBP inconsistency):

```
api/_lib/socialLengthTargets.js
  export const SOCIAL_LENGTH = { [platform]: { [angle]: { lane, unit, balanced:[lo,hi], cap? } } }
  export const LEAN_BANDS   = { punchy, balanced, indepth }  // per-lane scale factors (short≈fixed, long most elastic)
  export function resolveRange(platform, angle, lean) -> [lo, hi]
  export function lengthLine(platform, angle, lean) -> instruction sentence
        (renders the range + front-load + don't-pad where applicable)
```

Both `api/_lib/atomPrompts.js` and `api/_lib/briefPrompts.js` import `lengthLine()`.

## File-change checklist (the "one pass")
1. **NEW** `api/_lib/socialLengthTargets.js` — map + band math + `lengthLine()`.
2. `api/_lib/atomPrompts.js` — replace every hardcoded "(~N words)" with `lengthLine(platform, angle, lean)`; add front-load + don't-pad to preamble; IG hashtags → 3–5; GBP two-part; FB educational widen. Thread `lean` in (workspace already available in the builder's caller).
3. `api/_lib/briefPrompts.js` — same length source; FB ~200w → lanes; fix short-platform ceiling-as-target; GBP stays char-based (already correct). Thread `lean` through.
4. `api/_lib/producer/draftAtom.js` (+ brief caller) — read `workspace.social_length_lean` and pass to the prompt builders. `ws` is already in scope.
5. **Migration** `supabase/multitenant/migrations/NNN_social_length_lean.sql` — `ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS social_length_lean text DEFAULT 'balanced'` + CHECK constraint (`punchy|balanced|indepth`). Grants already cover `workspaces`. Then `UPDATE workspaces SET social_length_lean='indepth' WHERE slug='movebetter'`. Refresh `supabase/expected-schema.json`.
6. Settings UI — length-lean control on `/settings/workspace` (WorkspaceSettings).
7. *(optional, lower priority — separate marketing surface)* `api/demo/generate.js` — align demo lengths.

## Verification (before merge)
- **Prompt-quality before/after node harness** (per CLAUDE.md "Verifying a prompt-QUALITY change"): import the real builders, build OLD vs NEW across the ~14 platform×angle combos on a **real Move Better interview transcript** (Supabase MCP) via `generateText` through the AI Gateway (key from `.env.bernard.1pw`). Print side by side. Confirm: long lane preserved (clinical_insight / clinical_perspective still substantial at in-depth), short lane short, GBP front-loaded, no voice loss.
- Static gates: `npm run lint` / `build` / `typecheck` / `verify-bundles`.
- Post-deploy: generate a fresh set on prod, verify in Q's Chrome (per the standard authed-verification procedure).

## North star (later phase, not v1)
Once there's enough of Move Better's own engagement signal (bundle.social + GBP insights + PostHog), inform the *defaults* — and eventually per-angle ranges — from what MB's audience actually rewards, replacing platform-average assumptions with clinic-specific evidence. Caveat: single-clinic per-post-length signal is slow to become conclusive, so the human dial stays the primary control near-term.

## Calibration — validated on real data (2026-07-16)

Ran a before/after harness (real MB transcript: Zach Cullen, "Foot pain: Barefoot vs. Orthotics", 41 turns; real `getAtomSystemPrompt` + Sonnet-4-6; only length instructions differed). Findings + Q's decisions:

**Confirmed working:** IG hook 189w→45w (wall-of-text → true scroll-stopper); long lane protected & richer (IG clinical_insight 225w→280w, LinkedIn clinical_perspective 246w→378w) with voice intact ("lo and behold" preserved). The model **overshoots** current point-targets by ~10–30% (CURRENT IG hook came in at 189w vs the ~175w target, FB at 161w vs ~125w) — so ranges need firm upper bounds + the don't-pad line.

**Decisions (supersede the numbers in the table above where they differ):**
- **Depth: PUSH FURTHER** (Q). Long lane leans harder into long-form — depth is MB's signature. Revised in-depth long-lane targets:
  - IG `clinical_insight`: **~230–340w** (was 170–260)
  - LinkedIn `clinical_perspective`: **~340–480w** (was 220–320)
  - LinkedIn `movement_principle`: ~180–260w · `referring_provider`: ~150–210w
- **FB must NOT inflate with the lean** — bug the samples caught (FB 161w→192w, wrong direction). The dial scales **only the long lane**; short + medium lanes (FB, IG hook/quick_win/cta, X/Threads/Bluesky/Mastodon) are ~lean-invariant. FB stays `community` ~25–55w / `educational` ~60–120w at ALL leans, with a firm upper cap.
- **GBP: front-loaded, body can run** (Q). Hook in the first ~100 chars (all Google shows) + body up to **~500–900 chars** for expanders. Drop the tight 200–450 target. `patient_outcome` trends to the longer end, `local_authority` to the shorter.

**Band-math principle (the FB fix):** `LEAN_BANDS` multipliers ≈ 1.0 for short + medium lanes; only > 1 (aggressively, per "push further") for the long lane. The dial changes *how deep the deep posts go* — not how long everything gets.
