// Phase 2 adaptive cadence — self-tuning per tenant from engagement_snapshots.
//
// computeAdaptiveCadenceChannels() is a drop-in upgrade to the Phase 1 prior-only
// path in cadenceDefaults.js. It returns null (fall back to prior) whenever the
// workspace has insufficient engagement history, so Phase 1 is the always-safe
// base case. The Phase 2 path is purely additive: it can only fire when real data
// supports it, and it can only MOVE cadence by MAX_STEP posts/wk per cycle — so
// wild swings from one bad week are impossible.
//
// Algorithm (spec: .claude/adaptive-cadence-spec.md §Phase 2):
//   1. Fetch the trailing TRAILING_WEEKS window of engagement_snapshots for the ws.
//   2. Group by atom-platform; score each snapshot with scoreOf() (same logic as
//      the performed_well scorer in cron/refresh-engagement.js).
//   3. Per platform: if < MIN_SAMPLE scored posts → pin to prior (not tuning yet).
//   4. Distribute the adaptive pool (sum of prior targets for data-rich platforms)
//      proportionally to engagement-per-post, then apply guardrails:
//        - Exploration floor: never drop below EXPLORATION_FLOOR posts/wk
//        - Ceiling: never exceed the prior target (prior = best-practice max)
//        - Max step: no single cycle changes cadence by more than MAX_STEP
//   5. Return the same shape as computeAutoCadenceChannels:
//        { [atomPlatform]: { target_per_week, enabled: true, adaptive?: true } }
//      Returns null → caller falls back to prior-only path.

import { scoreSnapshot } from './engagementScoring.js'

const TRAILING_WEEKS    = 8   // engagement window to aggregate over
const MIN_SAMPLE        = 5   // min scored posts before we tune a channel
const MAX_STEP          = 1   // max ±posts/wk change per planning cycle vs prior
const EXPLORATION_FLOOR = 1   // min posts/wk for any enabled channel

// Map output-type platform values (what content_items.platform stores) to
// atom-cadence platform keys (what cadence_policy.channels is keyed by).
const OUTPUT_TO_ATOM = {
  instagram_post:  'instagram',
  instagram_reel:  'instagram',
  instagram_story: 'instagram_story',
  facebook:        'facebook',
  facebook_post:   'facebook',
  linkedin:        'linkedin',
  tiktok:          'tiktok',
  twitter:         'twitter',
  threads:         'threads',
  bluesky:         'bluesky',
  mastodon:        'mastodon',
  gbp:             'gbp',
}
function toAtomPlatform(platform) {
  return OUTPUT_TO_ATOM[platform] ?? platform
}

// Normalize a snapshot's stats JSONB to a single numeric engagement score.
// Mirrors the scoreOf() in cron/refresh-engagement.js so the two sources of
// "engagement quality" use the same formula.
//   Buffer / bundle.social: stats.statistics = { impressions, likes, ... }
//   GA4:                    stats.pageviews, stats.sessions
//   GBP:                    stats.views, stats.actions
function scoreOf(stats) {
  if (!stats || typeof stats !== 'object') return 0
  // bundle's statistics blob carries BOTH `impressions` and `views` for the
  // SAME real number on IG/FB (Meta's impressions→Views rename) — blindly
  // summing every field double-counts it, over-weighting IG/FB vs LinkedIn in
  // the adaptive pool split. Delegate to the shared scorer, same as
  // refresh-engagement.js does since #2283. (bundle snapshots embed
  // source:'bundle' inside the stats blob itself, so no extra select needed.)
  if (stats.source === 'bundle') return scoreSnapshot({ source: 'bundle', stats }).score
  const s = stats.statistics
  if (s && typeof s === 'object') {
    return Object.values(s).reduce((sum, v) => sum + (typeof v === 'number' ? v : 0), 0)
  }
  let score = 0
  for (const [k, v] of Object.entries(stats)) {
    if (['pageviews', 'sessions', 'views', 'actions', 'clicks'].includes(k) && typeof v === 'number') {
      score += v
    }
  }
  return score
}

/**
 * Compute adaptive per-channel cadence from trailing engagement data.
 *
 * @param {string}   wsId           - workspace UUID
 * @param {string[]} enabledOutputs - workspace.enabled_outputs
 * @param {object}   prior          - { [atomPlatform]: target_per_week }
 * @param {Function} sb             - Supabase REST helper (path, init) => Response
 *
 * @returns {object|null}
 *   { [atomPlatform]: { target_per_week, enabled: true, adaptive?: true } }
 *   OR null if no channel has enough data (caller falls back to prior-only).
 */
export async function computeAdaptiveCadenceChannels(wsId, enabledOutputs, prior, sb) {
  if (!wsId || !enabledOutputs?.length) return null

  // Derive the set of atom platforms this workspace actively posts to.
  const enabledAtomPlatforms = new Set(
    enabledOutputs.map(toAtomPlatform).filter((p) => prior[p] != null)
  )
  if (!enabledAtomPlatforms.size) return null

  const cutoff = new Date(Date.now() - TRAILING_WEEKS * 7 * 24 * 60 * 60 * 1000).toISOString()

  let snapshots = []
  try {
    // PostgREST embedding: content_items is referenced via FK content_item_id.
    // We only need the platform from the parent row.
    const r = await sb(
      `engagement_snapshots?workspace_id=eq.${wsId}&fetched_at=gt.${cutoff}` +
      `&select=stats,content_items(platform)&order=fetched_at.desc&limit=5000`
    )
    if (!r.ok) return null
    snapshots = await r.json()
  } catch {
    return null
  }

  // Aggregate engagement per atom-platform.
  const agg = {}  // { [atomPlatform]: { count: int, totalScore: number } }
  for (const snap of snapshots) {
    const rawPlatform = snap.content_items?.platform
    if (!rawPlatform) continue
    const ap = toAtomPlatform(rawPlatform)
    if (!enabledAtomPlatforms.has(ap)) continue
    if (snap.stats == null) continue
    const score = scoreOf(snap.stats)
    if (!agg[ap]) agg[ap] = { count: 0, totalScore: 0 }
    agg[ap].count += 1
    agg[ap].totalScore += score
  }

  // Split platforms into: data-rich (adaptive) vs sparse (pin to prior).
  const adaptivePlatforms = []
  const out = {}

  for (const ap of enabledAtomPlatforms) {
    const priorTpw = prior[ap]
    if (priorTpw == null) continue
    const data = agg[ap]
    if (!data || data.count < MIN_SAMPLE) {
      // Insufficient data — pin to prior, don't try to tune.
      out[ap] = { target_per_week: priorTpw, enabled: true }
    } else {
      adaptivePlatforms.push({ ap, priorTpw, engPerPost: data.totalScore / data.count })
    }
  }

  if (adaptivePlatforms.length === 0) return null   // all channels sparse → prior is fine

  // Distribute the adaptive pool proportionally to engagement-per-post.
  const adaptivePool = adaptivePlatforms.reduce((s, d) => s + d.priorTpw, 0)
  const totalScore   = adaptivePlatforms.reduce((s, d) => s + d.engPerPost, 0)

  for (const { ap, priorTpw, engPerPost } of adaptivePlatforms) {
    const share = totalScore > 0 ? engPerPost / totalScore : 1 / adaptivePlatforms.length
    const raw   = adaptivePool * share

    // Guardrails (spec-mandated, in order):
    //   1. Exploration floor — always keep a channel alive for continued learning.
    //   2. Prior ceiling    — prior represents best-practice max; don't exceed it.
    //   3. Max step         — damp oscillation; cadence moves ≤ MAX_STEP/wk.
    const clamped = Math.max(EXPLORATION_FLOOR, Math.min(priorTpw, raw))
    const stepped = Math.max(priorTpw - MAX_STEP, Math.min(priorTpw + MAX_STEP, clamped))

    out[ap] = { target_per_week: Math.round(stepped), enabled: true, adaptive: true }
  }

  return out
}

// ─── T4 learning loop, part 3 — day/time ("when") learning ──────────────────
//
// The engine above answers "how many"; this answers "when." cadence_policy.
// quiet_days (migration 140) is a frozen author default that can never
// self-correct on its own: no weekend inventory → no weekend engagement data
// → Auto can never learn a weekend works. Two cooperating pieces break the
// loop:
//   1. applyExplorationSlots() — called from strategistPlan.js's
//      getWeekInputs(), NOT from inside assignSlots() in strategist.js (that
//      file is under active work for the format dimension; wrapping the call
//      site keeps the collision surface near zero — see .claude/decisions.md
//      2026-07-21 T4 scoping). PURE: deterministically rotates through a
//      workspace's quiet, not-yet-dismissed days — un-quieting exactly ONE
//      for a given week's plan — so a real post lands there and produces
//      real engagement_snapshots. Rotating (not always the same day) means
//      every quiet day accumulates evidence over time, and dismissing a day
//      (Q's explicit "no") permanently excludes it from rotation.
//   2. computeDayProposal() reads the resulting engagement_snapshots and,
//      once a quiet day has cleared a minimum sample size, reports how it
//      compared to the workspace's normal (non-quiet) days — evidence only,
//      never auto-applied. Surfaced as an Accept/Dismiss card in Settings →
//      Channels → Cadence (src/pages/settings/ChannelsSettings.jsx).
//
// Deliberately workspace-level, not per-platform: cadence_policy.quiet_days
// is one shared set of days across every channel, so the comparison
// aggregates engagement across all platforms rather than fragmenting an
// already-small sample further.

// Exploration data is scarcer by design (one day gets ~1 extra post/week at
// most) — lower than the channel engine's MIN_SAMPLE=5.
const DAY_MIN_SAMPLE = 3
const WEEKDAY_CODES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Rotate through a workspace's quiet, not-dismissed days — one per week — so
 * exploration evidence accumulates for every quiet day instead of repeating
 * the same one. PURE: weekMonday determines the rotation index, so replanning
 * the same week twice always explores the same day.
 *
 * @param {string[]} quietDays     — cadence_policy.quiet_days
 * @param {string[]} dismissedDays — cadence_policy.day_time_dismissed (days Q
 *                                    has explicitly said to keep quiet)
 * @param {string}   weekMonday    — YYYY-MM-DD
 * @returns {{ effectiveQuietDays: string[], exploring: string|null }}
 */
export function applyExplorationSlots(quietDays, dismissedDays, weekMonday) {
  const dismissed = new Set((dismissedDays || []).map((d) => d.toLowerCase()))
  const candidates = (quietDays || []).filter((d) => !dismissed.has(d.toLowerCase()))
  if (!candidates.length) return { effectiveQuietDays: quietDays || [], exploring: null }

  const weekIndex = Math.floor(new Date(`${weekMonday}T00:00:00Z`).getTime() / WEEK_MS)
  const exploring = candidates[((weekIndex % candidates.length) + candidates.length) % candidates.length]
  const effectiveQuietDays = (quietDays || []).filter((d) => d !== exploring)
  return { effectiveQuietDays, exploring }
}

function dayCodeOf(iso, timezone) {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' })
      .format(new Date(iso)).slice(0, 3).toLowerCase()
  } catch {
    return WEEKDAY_CODES[new Date(iso).getUTCDay()]
  }
}

/**
 * Compare a currently-quiet, not-dismissed day's engagement against the
 * workspace's normal (open) days, once exploration has produced enough
 * samples to say anything. Evidence only — the caller decides what to do
 * with it (persist as a proposal, or not).
 *
 * @param {string}   wsId
 * @param {string[]} quietDays     — cadence_policy.quiet_days
 * @param {string[]} dismissedDays — cadence_policy.day_time_dismissed
 * @param {string}   timezone      — cadence_policy.timezone
 * @param {Function} sb            — Supabase REST helper
 * @returns {Promise<null | { day: string, sampleCount: number, avgScore: number, baselineAvgScore: number, baselineCount: number }>}
 */
export async function computeDayProposal(wsId, quietDays, dismissedDays, timezone, sb) {
  if (!wsId) return null
  const dismissed = new Set((dismissedDays || []).map((d) => d.toLowerCase()))
  const quiet = new Set((quietDays || []).map((d) => d.toLowerCase()))
  const candidateDays = [...quiet].filter((d) => !dismissed.has(d))
  if (!candidateDays.length) return null

  const cutoff = new Date(Date.now() - TRAILING_WEEKS * 7 * 24 * 60 * 60 * 1000).toISOString()
  let snapshots = []
  try {
    const r = await sb(
      `engagement_snapshots?workspace_id=eq.${wsId}&fetched_at=gt.${cutoff}` +
      `&select=stats,content_items(published_at)&order=fetched_at.desc&limit=5000`
    )
    if (!r.ok) return null
    snapshots = await r.json()
  } catch {
    return null
  }

  const byDay = {} // { dayCode: { count, totalScore } }
  for (const snap of snapshots) {
    const publishedAt = snap.content_items?.published_at
    if (!publishedAt || snap.stats == null) continue
    const day = dayCodeOf(publishedAt, timezone || 'UTC')
    const score = scoreOf(snap.stats)
    ;(byDay[day] ||= { count: 0, totalScore: 0 })
    byDay[day].count += 1
    byDay[day].totalScore += score
  }

  // Baseline = the workspace's currently-open (non-quiet) days.
  const baselineDays = WEEKDAY_CODES.filter((d) => !quiet.has(d))
  let baselineCount = 0, baselineTotal = 0
  for (const d of baselineDays) {
    if (byDay[d]) { baselineCount += byDay[d].count; baselineTotal += byDay[d].totalScore }
  }
  if (baselineCount === 0) return null // no open-day data yet either — too early to compare anything

  // First candidate quiet day that's cleared the sample floor (stable order —
  // WEEKDAY_CODES order, not candidateDays' Set-iteration order).
  for (const day of WEEKDAY_CODES) {
    if (!candidateDays.includes(day)) continue
    const data = byDay[day]
    if (!data || data.count < DAY_MIN_SAMPLE) continue
    return {
      day,
      sampleCount: data.count,
      avgScore: Math.round((data.totalScore / data.count) * 10) / 10,
      baselineAvgScore: Math.round((baselineTotal / baselineCount) * 10) / 10,
      baselineCount,
    }
  }
  return null
}
