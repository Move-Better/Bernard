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
    const score = scoreOf(snap.stats)
    if (score === 0) continue
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
    const clamped = Math.min(priorTpw, Math.max(EXPLORATION_FLOOR, raw))
    const stepped = Math.max(priorTpw - MAX_STEP, Math.min(priorTpw + MAX_STEP, clamped))

    out[ap] = { target_per_week: Math.round(stepped), enabled: true, adaptive: true }
  }

  return out
}
