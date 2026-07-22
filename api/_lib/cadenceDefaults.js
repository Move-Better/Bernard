// Adaptive posting-cadence — Phase 1 (cold-start prior) + Phase 2 (engagement-tuned).
//
// The cadence numbers are NOT hardcoded in app logic: the live prior lives in
// app_config.cadence_defaults (migration 142) and is editable without a deploy.
// In Auto mode the effective per-channel cadence is COMPUTED from a workspace's
// enabled_outputs × this prior — so enabling a channel gives it a sensible
// cadence with no code change, and every enabled channel is covered (not the
// old hardcoded instagram/linkedin/gbp trio).
//
// Phase 2 (see .claude/adaptive-cadence-spec.md) makes this self-tuning per
// tenant from engagement_snapshots; this prior remains the zero-history
// fallback. The FALLBACK_* constant below is only a safety net for a missing
// app_config row (fresh DB / unit tests) — the DB row is the source of truth.

import { atomPlatformsFromEnabledOutputs } from './atomPlan.js'
import { computeAdaptiveCadenceChannels } from './cadenceAdaptive.js'

// Safety net only — used iff app_config.cadence_defaults is absent. Mirrors the
// migration-142 seed so behavior is identical before the row is first read.
// instagram_story is deliberately ABSENT (here and in the app_config row):
// story drafts are born media-less with no auto-attach step, so the lane
// cannot deliver — a prior here re-enables an unhittable target for every
// workspace (a null prior is what excludes a channel from adaptive cadence;
// 0 would still get the exploration floor). See .claude/decisions.md
// 2026-07-21 "Instagram Story lane disabled until T3".
export const FALLBACK_CADENCE_PRIOR = Object.freeze({
  instagram: 4, linkedin: 3, facebook: 3,
  gbp: 2, tiktok: 3, twitter: 4, threads: 4, bluesky: 3, mastodon: 3,
})

let _cache = null
let _cachedAt = 0
const TTL_MS = 60_000 // matches the workspace-context cache TTL

// Read the cold-start prior from app_config (60s in-process cache). Merges over
// FALLBACK so a partial row can't drop a platform. `sb` is the same REST helper
// the callers already use: (path, init) => fetch(...).
export async function getCadencePrior(sb) {
  if (_cache && Date.now() - _cachedAt < TTL_MS) return _cache
  let prior = FALLBACK_CADENCE_PRIOR
  try {
    const r = await sb('app_config?key=eq.cadence_defaults&select=value&limit=1')
    if (r.ok) {
      const rows = await r.json()
      const v = rows?.[0]?.value
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        prior = { ...FALLBACK_CADENCE_PRIOR, ...v }
      }
    }
  } catch {
    // network/DB hiccup — fall back to the safety-net prior, never throw.
    return prior  // don't cache on failure; next request retries immediately
  }
  _cache = prior
  _cachedAt = Date.now()
  return prior
}

// Test seam: drop the cache so a test can re-read after mutating app_config.
export function _resetCadencePriorCache() { _cache = null; _cachedAt = 0 }

// Unified cadence resolver for Auto mode.  Tries the Phase 2 adaptive path
// first; if the workspace doesn't have enough engagement history yet (returns
// null), falls back transparently to the Phase 1 prior-only computation.
// This is the ONLY function callers should use — never call
// computeAutoCadenceChannels() directly from outside cadenceDefaults.
export async function computeCadenceChannels(wsId, enabledOutputs, prior, sb) {
  const adaptive = await computeAdaptiveCadenceChannels(wsId, enabledOutputs, prior, sb)
  if (adaptive) return adaptive
  return computeAutoCadenceChannels(enabledOutputs, prior)
}

// PURE: compute the Auto cadence policy `channels` map from a workspace's
// enabled_outputs and a prior. Returns
//   { [atomPlatform]: { target_per_week, enabled: true, slots? } }
// for every enabled output that maps to a cadence-bearing atom platform.
// Channels with no prior entry (blog / email / youtube / ads / landing_page —
// not per-piece atom-cadence channels) are skipped. Returns {} when there are
// no enabled outputs (caller decides the fallback).
// `existingChannels` (T3): each platform's `.slots` (posting-schedule tiles,
// api/_lib/cadenceSlots.js) is carried forward when present — this function
// materializes fresh target_per_week/enabled, but slots are a separate,
// human/T4-owned concern that recomputing Auto cadence must not wipe. Mirrors
// computeAutoChannels in src/pages/settings/ChannelsSettings.jsx.
export function computeAutoCadenceChannels(enabledOutputs, prior = FALLBACK_CADENCE_PRIOR, existingChannels = {}) {
  const platforms = atomPlatformsFromEnabledOutputs(enabledOutputs)
  const out = {}
  if (!platforms) return out
  for (const p of platforms) {
    const tpw = prior[p]
    if (tpw == null) continue // not an atom-cadence channel — skip
    out[p] = { target_per_week: tpw, enabled: true }
    const slots = existingChannels?.[p]?.slots
    if (Array.isArray(slots) && slots.length) out[p].slots = slots
  }
  return out
}
