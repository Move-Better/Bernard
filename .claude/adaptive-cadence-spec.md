# Adaptive Posting Cadence — design spec

**Created:** 2026-06-21 · **Owner:** Q · **Status:** Phase 1 shipped; Phases 2–3 awaiting sign-off

## Why this exists

The "Posting cadence" card on `/settings/workspace/channels` (Presence) had a hardcoded
default that only knew about Instagram/LinkedIn/GBP, and the "Auto" toggle did not
compute anything — it just locked a static stored map from editing. Symptoms Q hit:

- Channels the workspace had enabled (Facebook, Instagram Story) showed `0 posts/wk`
  and disabled under Auto, and the weekly Strategist never scheduled them.
- The defaults (4/3/3) were arbitrary and frozen in code.

Q's framing, which drives this spec: *"Shouldn't the Strategist handle this
automatically? What if a tenant enables every output? What happens when best practices
change, or LinkedIn blows up in popularity? This should be adaptive, not hardcoded
forever."*

## The principle: the algorithm lives in code; the numbers live in data

| Layer | What it is | Where it lives | Phase |
|---|---|---|---|
| Cold-start prior | Default posts/wk per atom platform for a tenant with no history | `app_config.cadence_defaults` (DB row, editable without deploy) | **1 (shipped)** |
| Per-tenant tuning | Each channel's cadence learned from *that tenant's* engagement | Computed at plan time by the Strategist | 2 |
| Supply budget | Total weekly posts scaled to the tenant's content velocity | Computed | 2 |
| Fleet-derived prior | The cold-start prior itself recomputed from cross-tenant aggregates | Scheduled job rewrites `app_config.cadence_defaults` | 3 |

Nothing about the *cadence values* is permanently hardcoded: Phase 1 moves them to an
editable DB row; Phase 2 makes them per-tenant data-driven; Phase 3 lets the prior
itself track reality. The only thing that stays in code is the tuning algorithm.

## Phase 1 — SHIPPED (this PR)

- **Migration 142** `app_config(key, value jsonb, updated_at)` — a global (non-tenant)
  config table. Seeded `cadence_defaults` = best-practice posts/wk per atom platform
  (organic, local/clinic, 2025–26 consensus): instagram 4, instagram_story 5,
  linkedin 3, facebook 3, gbp 2, tiktok 3, twitter 4, threads 4, bluesky 3, mastodon 3.
  Edit a number → re-tunes the cold-start default for every tenant instantly.
- **`api/_lib/cadenceDefaults.js`** — `getCadencePrior(sb)` (60s cache, FALLBACK safety
  net) + pure `computeAutoCadenceChannels(enabledOutputs, prior)`.
- **Auto = computed, not stored.** In Auto (`provenance !== 'user'`), the Strategist
  (`strategistPlan.js getWeekInputs`) and the settings UI compute the per-channel
  cadence from `enabled_outputs × prior`. Every enabled channel is covered; enabling a
  channel gives it a cadence with no code change. `weekly-plan.js` + `interviews.js`
  now SELECT `enabled_outputs` so the compute has its input.
- **Manual** (`provenance: 'user'`) uses the operator's stored targets verbatim; the
  Auto→Manual toggle seeds the editable values from the current computed numbers.
- **Instagram** appears as one row "Instagram (feed + reels)" + "Instagram Story",
  because the atom plan has exactly those two capacity buckets (post + reel share the
  `instagram` namespace). True per-format Reel throttling = the namespace split below.
- Settings save materializes the computed channels into the stored policy so the
  week-view consumers (`week-summary.js`, `YourWeek.jsx`) read consistent values.
- New tenants: `onboarding/claim.js` seeds `channels` from chosen outputs × prior
  (no hardcoded trio).

### Phase 1 follow-up (optional, needs Q consent — mass prod write)
One-time backfill of existing Auto workspaces' stored `cadence_policy.channels` to the
computed values, so the week-view is immediately consistent instead of healing on next
settings save. Guarded to `provenance != 'user'`. Preview confirmed correct for all 7
active workspaces. Not required for correctness (Strategist + settings compute live).

## Phase 2 — the self-tuning loop (proposed)

**Signal (already collected):** `engagement_snapshots` (per `content_item` + platform,
`stats` JSONB: impressions/likes/reach…) populated daily by `cron/refresh-engagement.js`
from Buffer, bundle.social, GA4, GBP; plus `content_items.performed_well`.

**Loop (runs in the weekly-plan cron / completion trigger):**
1. Aggregate trailing-window (e.g. 8 weeks) engagement per channel for the tenant →
   an engagement-per-post score + trend per channel.
2. Distribute the weekly **budget** across enabled channels proportional to score,
   capped by the per-platform prior (the prior becomes a ceiling, not the target).
3. **Guardrails (non-negotiable):**
   - *Exploration floor* — never let a channel drop to 0 while enabled; keep posting a
     little everywhere so you keep learning (explore/exploit).
   - *Max weekly step* — cap how far cadence can move in one cycle so it can't swing.
   - *Min sample* — fall back to the prior for a channel until it has N posts with stats.
4. "LinkedIn blows up" → its engagement-per-post rises → next cycle it earns more slots,
   automatically, no code change. Best practices shift in the world → reflected via
   realized engagement; no table to edit.

**Budget from supply:** `weekly_budget = f(recent interviews/atoms produced)` so a tenant
enabling every channel gets a sane plan instead of an aspirational max (banking already
prevents oversupply; this makes the *distribution* sane).

**Transparency (ships WITH the loop, not after):** surface *why* — "Bernard raised
LinkedIn to 4/wk: your LinkedIn engagement is up 60% over 8 weeks." A silent black box
that also risks chasing vanity metrics over content quality is a non-starter. The
explanation is a feature.

## Phase 3 — fleet-derived prior (later)

A scheduled job recomputes `app_config.cadence_defaults` from cross-tenant aggregate
engagement, so the cold-start prior for *new* tenants reflects what's currently working
across the fleet — the prior stops being a human guess too.

## Open questions for Q
1. Trailing window length (8 weeks?) and min-sample threshold per channel.
2. Where does the weekly **budget** come from — purely supply-derived, or a tenant-set
   "max posts/week" ceiling, or both?
3. True per-format Instagram Reel ceiling — worth the atom-namespace split
   (`instagram` → `instagram` + `instagram_reel` across ATOM_DEFINITIONS, the Strategist,
   `content_plan_atoms.platform`, caption prompts, + a migration), or is the combined
   feed+reels bucket fine?
4. How visible should the tuning be — a settings readout, a weekly digest line, both?
