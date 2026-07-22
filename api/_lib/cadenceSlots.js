// T3 — posting-schedule slots. A "slot" is a pinned {weekday, hour, format}
// tile on the calendar (e.g. "Tuesday 12:00pm, Instagram Reel"), stored at
// `workspaces.cadence_policy.channels[platform].slots`. This is the resolved
// design fork from .claude/decisions.md 2026-07-22 "T3 slot model": Buffer-
// style FIXED slots, not a bare target_per_week count — so `/week` can render
// an empty pinned tile ("+ open slot") and so T4's future day/time learner has
// a concrete place to write proposed changes.
//
// Two consumers:
//   1. api/_lib/strategistPlan.js getWeekInputs() — attaches slots onto the
//      resolved (Auto/Manual/Adaptive) `cadence` object before composeWeeklyPlan
//      calls assignSlots(), so atoms land IN the defined slots instead of a
//      fresh computation every run.
//   2. api/_routes/content-plan/week-summary.js — attaches slots onto the same
//      `cadence` field already in its response, so the client can diff
//      scheduled atoms against the full slot list and render true empty tiles.
//
// `defaultSlotsForChannel` is the graceful fallback for a channel that has no
// PERSISTED slots yet (a fresh workspace, or a channel just re-enabled — e.g.
// instagram_story reviving per the 2026-07-21 decision). It reuses the exact
// even-spread + BEST_HOUR math strategist.js's assignSlots() has always used,
// so the computed default matches what the legacy path would have scheduled.

import { defaultFormatForPlatform } from './atomPlan.js'

// Sunday-first, matching quiet_days' stored day codes and strategist.js's
// own WEEKDAY convention exactly (kept as a separate copy — importing from
// strategist.js here would create strategist.js -> cadenceSlots.js ->
// strategist.js style coupling once reelFactory.js also depends on this file).
const WEEKDAY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

// Mirrors strategist.js BEST_HOUR exactly — keep both in lockstep. Duplicated
// (not imported) so this module has no dependency on strategist.js.
const BEST_HOUR = { instagram: 12, instagram_story: 8, linkedin: 7, gbp: 8, facebook: 12, tiktok: 18, twitter: 9, threads: 12, bluesky: 10, mastodon: 9 }

// Mirrors reelFactory.js DEFAULT_REEL_SHARE exactly (Q's call 2026-07-21: 3 of
// a 4-post Instagram week ships as Reels). Used only to size the SEEDED slot
// mix so a fresh slot list matches what the reel worker will actually try to
// fill — not a live read of reelFactory's own constant, to avoid a
// reelFactory.js <-> cadenceSlots.js import cycle (reelFactory imports
// assignSlots from strategist.js, which will import this module).
const DEFAULT_REEL_SHARE = 0.75

function openOffsetsFor(quietDays) {
  const quiet = new Set((quietDays || []).map((q) => q.toLowerCase()))
  return [0, 1, 2, 3, 4, 5, 6].filter((off) => !quiet.has(WEEKDAY[(off + 1) % 7]))
}

// Same even-spread-then-wrap algorithm as strategist.js assignSlots(), but
// producing slot TEMPLATES (weekday + hour) rather than stamping a specific
// atom's scheduled_at.
function spreadSlots(count, openOffsets, baseHour, format) {
  if (count <= 0 || !openOffsets.length) return []
  const out = []
  for (let i = 0; i < count; i++) {
    let off, hourBump
    if (count <= openOffsets.length) {
      off = openOffsets[Math.round((i * (openOffsets.length - 1)) / Math.max(1, count - 1))]
      hourBump = 0
    } else {
      off = openOffsets[i % openOffsets.length]
      hourBump = Math.floor(i / openOffsets.length) * 2
    }
    out.push({ weekday: WEEKDAY[(off + 1) % 7], hour: Math.min(baseHour + hourBump, 22), format, enabled: true })
  }
  return out
}

// Two slots at the identical (weekday, hour) collapse two atoms to the same
// scheduled_at instant when both fill — the exact failure mode
// assignEvenSpread's hour-bump exists to avoid (strategist.js). This must run
// ACROSS formats, not just within one spreadSlots() call: Instagram's post
// and reel sequences are each computed independently starting from the same
// base hour, so e.g. a 1-post/3-reel split both naturally start at "Mon
// 12:00" before this pass separates them. Nudge each later collision forward
// an hour (capped at 22).
function dedupeWeekdayHour(slots) {
  const seen = new Set()
  return slots.map((s) => {
    let hour = s.hour
    let key = `${s.weekday}:${hour}`
    while (seen.has(key) && hour < 22) {
      hour += 1
      key = `${s.weekday}:${hour}`
    }
    seen.add(key)
    return hour === s.hour ? s : { ...s, hour }
  })
}

/**
 * Compute a sensible default slot list for one channel from its weekly
 * target — the seed used when a channel has no persisted slots yet. Pure.
 *
 * Instagram is the one platform that carries more than one format (post +
 * reel; story is its own separate atom-platform key, see atomPlan.js), so its
 * target is split using the reel worker's own ratio — a freshly-computed slot
 * list should offer the reel worker somewhere to land, not just post slots.
 */
export function defaultSlotsForChannel(platform, targetPerWeek, quietDays) {
  const openOffsets = openOffsetsFor(quietDays)
  const baseHour = BEST_HOUR[platform] ?? 11
  const target = Math.max(0, Math.round(Number(targetPerWeek) || 0))
  let slots
  if (platform !== 'instagram') {
    slots = spreadSlots(target, openOffsets, baseHour, defaultFormatForPlatform(platform))
  } else {
    const reelCount = target > 0 ? Math.min(target, Math.max(1, Math.round(target * DEFAULT_REEL_SHARE))) : 0
    const postCount = Math.max(0, target - reelCount)
    slots = [
      ...spreadSlots(postCount, openOffsets, baseHour, 'post'),
      ...spreadSlots(reelCount, openOffsets, baseHour, 'reel'),
    ]
  }
  return dedupeWeekdayHour(slots)
}

/**
 * Attach a `.slots` array onto every enabled channel in `cadence` — the
 * persisted list from `policyChannels[platform].slots` when present and
 * non-empty, else a freshly-computed default. `cadence` carries the
 * target_per_week/enabled that may come from Auto/Manual/Adaptive resolution
 * (getWeekInputs); `policyChannels` is always the RAW persisted
 * `workspace.cadence_policy.channels`, the one place slots are actually
 * stored — the two are threaded separately because Auto mode recomputes
 * `cadence` fresh every call and never itself carries slots. Pure.
 */
export function mergeSlotsIntoCadence(cadence, policyChannels, quietDays) {
  const out = {}
  for (const [platform, cfg] of Object.entries(cadence || {})) {
    const persisted = policyChannels?.[platform]?.slots
    const enabledPersisted = Array.isArray(persisted) ? persisted.filter((s) => s?.enabled !== false) : []
    // A persisted list that nets to zero enabled slots (every one toggled off)
    // falls back to the computed default too — a channel must not go
    // invisible on the calendar while its atoms still schedule somewhere via
    // assignSlots' legacy fallback.
    const slots = enabledPersisted.length ? enabledPersisted : defaultSlotsForChannel(platform, cfg?.target_per_week || 0, quietDays)
    out[platform] = slots.length ? { ...cfg, slots } : { ...cfg }
  }
  return out
}

/**
 * Reduce a slots-carrying cadence object to the plain
 * `{ [platform]: [{weekday,hour,format,enabled}] } }` shape assignSlots()
 * consumes, dropping platforms with no slots. Pure.
 */
export function slotsByPlatformFromCadence(cadence) {
  const out = {}
  for (const [platform, cfg] of Object.entries(cadence || {})) {
    if (Array.isArray(cfg?.slots) && cfg.slots.length) out[platform] = cfg.slots
  }
  return out
}

/**
 * T4 tie-in — inject a single, EPHEMERAL exploration slot for the given
 * weekday into the workspace's highest-target enabled channel. Pure, never
 * persisted: called fresh every planning run from the same call site T4's
 * applyExplorationSlots() runs from (strategistPlan.js getWeekInputs).
 *
 * Why this exists: T4's day/time learner (api/_lib/cadenceAdaptive.js)
 * un-quiets one rotating day per week by returning an `effectiveQuietDays`
 * set for that run — a mechanism built around the LEGACY even-spread
 * scheduler (assignEvenSpread in strategist.js), which honors quietDays. But
 * a channel with PINNED slots (the common case after the T3 seed) is placed
 * by assignToPinnedSlots instead, which never consults quietDays at all — so
 * without this, T4's whole exploration mechanism silently no-ops for any
 * channel that has persisted slots. This closes that gap by adding a real
 * slot for the exploring day, matching the signed-off mockup (an "exploration
 * slot" tile on the highest-volume channel — Instagram Reel for movebetter).
 *
 * No-ops if some slot already covers that weekday for the chosen channel
 * (nothing to explore — it's already a normal posting day there).
 */
export function withExplorationSlot(cadence, exploringDay) {
  if (!exploringDay) return cadence
  const entries = Object.entries(cadence || {}).filter(([, cfg]) => cfg?.enabled && cfg.target_per_week > 0)
  if (!entries.length) return cadence
  const [platform, cfg] = entries.reduce((best, cur) => (cur[1].target_per_week > best[1].target_per_week ? cur : best))
  if ((cfg.slots || []).some((s) => s.weekday === exploringDay)) return cadence
  const format = platform === 'instagram' ? 'reel' : defaultFormatForPlatform(platform)
  const explorationSlot = { weekday: exploringDay, hour: BEST_HOUR[platform] ?? 11, format, enabled: true, exploring: true }
  return { ...cadence, [platform]: { ...cfg, slots: [...(cfg.slots || []), explorationSlot] } }
}
