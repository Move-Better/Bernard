// SEO opportunity engine — pure classification of Search Console queries into
// actionable content opportunities. No I/O: takes the GSC query rows + the
// workspace's published topics and returns a ranked, typed list. This keeps it
// node-harness testable against real GSC data (see scripts harness) and lets the
// API route stay thin.
//
// Two live types today (both derivable from a single 28-day snapshot):
//   striking_distance  — ranks #8–20: just off page 1, the cheapest wins.
//   demand_no_content  — meaningful impressions but no/weak matching post.
//
// Decay + cannibalization need week-over-week history (gsc_query_snapshots) and
// are surfaced as locked placeholders by the route until that history accrues.

const STRIKING_MIN_POS   = 7.5   // just inside page 1's tail
const STRIKING_MAX_POS   = 20.5  // ~page 2
const GAP_MIN_IMPRESSIONS = 10   // ignore low-signal noise

// Rough topic overlap: does this query share a meaningful word (>= 4 chars)
// with any published post topic? Fast, no model. Mirrors the heuristic the
// existing Insights endpoint uses so the two reads agree.
export function queryMatchesTopic(query, topics) {
  const qWords = String(query || '').toLowerCase().split(/\W+/).filter((w) => w.length >= 4)
  if (qWords.length === 0) return false
  for (const topic of topics || []) {
    const tWords = new Set(String(topic || '').toLowerCase().split(/\W+/).filter((w) => w.length >= 4))
    if (qWords.some((w) => tWords.has(w))) return true
  }
  return false
}

// Coarse search-intent label from the query text. Advisory only — drives the
// little grey "intent" chip and nudges the reason copy.
export function classifyIntent(query) {
  const q = String(query || '').toLowerCase().trim()
  const isLocal = /\bnear me\b/.test(q) || /\b(portland|vancouver|oregon|washington|or|wa)\b/.test(q)
  if (/\bvs\.?\b| versus /.test(q)) return isLocal ? 'Local · comparison' : 'Informational · comparison'
  if (/^(how|why|what|when|where|which|can|is|are|does|do|should|will)\b/.test(q)) {
    return isLocal ? 'Local · question' : 'Informational · question'
  }
  if (/\b(exercise|exercises|stretch|stretches|fix|relief|treat|treatment|prevent)\b/.test(q)) {
    return isLocal ? 'Local · how-to' : 'Informational · how-to'
  }
  if (isLocal) return 'Local · service'
  return 'Service · who/what'
}

function strikingReason(q) {
  const pos = Math.round(q.position * 10) / 10
  return `You rank #${pos} — just off page 1. A focused interview clip or post likely pushes this onto page 1.`
}

function gapReason(q, hasPost) {
  const impr = Math.round(q.impressions)
  if (hasPost) {
    return `${impr.toLocaleString()} impressions and you only partly cover this — a dedicated, focused page would rank far better than the passing mention you have now.`
  }
  return `${impr.toLocaleString()} impressions and nothing written for it yet. High-intent demand your team can answer directly.`
}

// Classify a GSC query list into ranked opportunities.
//   queries: [{ query, clicks, impressions, ctr, position }]
//   opts.topics: published post topics (for hasPost matching)
//   opts.dismissed: Set/array of dismissed query strings (filtered out)
//   opts.limit: max opportunities to return (default 12)
export function classifyOpportunities(queries, opts = {}) {
  const topics    = opts.topics || []
  const dismissed = opts.dismissed instanceof Set ? opts.dismissed : new Set(opts.dismissed || [])
  const limit     = opts.limit ?? 12

  const out = []
  for (const q of queries || []) {
    if (!q || !q.query) continue
    if (dismissed.has(q.query)) continue
    if ((q.impressions || 0) < GAP_MIN_IMPRESSIONS) continue

    const pos     = q.position || 0
    const hasPost = queryMatchesTopic(q.query, topics)

    let type, why, matchLabel, matchHas
    if (pos >= STRIKING_MIN_POS && pos <= STRIKING_MAX_POS) {
      type       = 'striking_distance'
      why        = strikingReason(q)
      matchHas   = hasPost
      matchLabel = hasPost ? 'Existing post is thin — improve it' : 'No post yet'
    } else if (pos > STRIKING_MAX_POS) {
      // Deeper than page 2 — real demand, but a from-scratch / pillar effort.
      type       = 'demand_no_content'
      why        = gapReason(q, hasPost)
      matchHas   = hasPost
      matchLabel = hasPost ? 'Partial coverage — needs a focused page' : 'No post yet'
    } else {
      // Already on page 1 proper (pos < STRIKING_MIN_POS) — not an opportunity
      // to write new content; CTR issues there are handled as website suggestions.
      continue
    }

    out.push({
      type,
      query:       q.query,
      position:    Math.round(pos * 10) / 10,
      impressions: Math.round(q.impressions || 0),
      clicks:      Math.round(q.clicks || 0),
      ctr:         Math.round((q.ctr || 0) * 1000) / 10, // → percent, 1 dp
      intent:      classifyIntent(q.query),
      why,
      match:       { has: matchHas, label: matchLabel },
    })
  }

  // Rank: striking distance first (cheapest wins), then by impressions.
  const typeRank = { striking_distance: 0, demand_no_content: 1 }
  out.sort((a, b) => (typeRank[a.type] - typeRank[b.type]) || (b.impressions - a.impressions))

  return out.slice(0, limit)
}

// GSC-derived website suggestion: a query you ALREADY rank on page 1 for but get
// few clicks → the ranking page's title/meta is under-selling. Advisory only.
// Returns at most one suggestion (the highest-impression offender).
export function gscClickThroughSuggestion(queries) {
  const PAGE1_MAX_POS    = 7.5  // genuinely on page 1
  const LOW_CTR          = 0.02 // < 2% click-through
  const MIN_IMPRESSIONS  = 30
  const candidates = (queries || [])
    .filter((q) => q && q.query && (q.position || 99) <= PAGE1_MAX_POS &&
                   (q.ctr || 0) < LOW_CTR && (q.impressions || 0) >= MIN_IMPRESSIONS)
    .sort((a, b) => (b.impressions || 0) - (a.impressions || 0))
  const top = candidates[0]
  if (!top) return null
  return {
    sev:    'med',
    source: 'Search Console',
    title:  `Rewrite the title/meta on the page ranking for "${top.query}"`,
    why:    `You rank #${Math.round(top.position)} for "${top.query}" (${Math.round(top.impressions).toLocaleString()} impressions) but get very few clicks. A clearer, benefit-led title on that page lifts click-through without needing a higher rank.`,
  }
}
