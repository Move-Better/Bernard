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

// Decay thresholds — calibrated to a small local clinic's real GSC volume
// (the generic impr>=50/pos<=10 default flagged nothing on Move Better's data,
// where non-branded terms all sit under 50 impressions). "Was in reach (top
// ~20), lost ground, on a query with real search volume."
const DECAY_MAX_PREV_POS = 20  // was within striking distance / page 1–2
const DECAY_MIN_DROP     = 3   // positions lost week-over-week to count as slipping
const DECAY_MIN_IMPR     = 10  // prior-week impressions floor — cuts 1–2 impr jitter

// Cannibalization thresholds — a query where 2+ of the workspace's own URLs both
// rank meaningfully and split the clicks. Needs per-URL snapshot rows (page set).
const CANNIBAL_MIN_PAGES = 2
const CANNIBAL_MAX_POS   = 20  // only count pages ranking well enough to matter
const CANNIBAL_MIN_IMPR  = 5

const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10

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

function decayReason(prevPos, curPos) {
  const prev = round1(prevPos)
  const cur  = round1(curPos)
  if (prevPos <= 10) {
    return `You were #${prev} — one push off page 1 — and slid to #${cur} in a week. Refresh or expand the page before it drops further.`
  }
  return `In reach at #${prev}, now falling to #${cur}. Defend it with a focused piece before it leaves page 2 for good.`
}

// Decay classifier — compares two week-over-week query-level snapshots.
//   currentRows / priorRows: [{ query, position, impressions }] (the latest row
//     per query for the current and prior snapshot weeks; page-level rows excluded).
//   opts.dismissed: Set/array of dismissed query strings (filtered out).
//   opts.limit: max cards (default 12).
// Returns ranked (biggest drop first) [{ query, prevPosition, position, drop,
//   impressions, intent, why }]. A query must exist in BOTH weeks to be judged.
export function classifyDecay(currentRows, priorRows, opts = {}) {
  const dismissed = opts.dismissed instanceof Set ? opts.dismissed : new Set(opts.dismissed || [])
  const limit     = opts.limit ?? 12

  const priorByQuery = new Map()
  for (const r of priorRows || []) {
    if (r?.query && !priorByQuery.has(r.query)) priorByQuery.set(r.query, r)
  }

  const out = []
  for (const cur of currentRows || []) {
    if (!cur?.query || dismissed.has(cur.query)) continue
    const prev = priorByQuery.get(cur.query)
    if (!prev) continue

    const prevPos  = prev.position || 0
    const curPos   = cur.position || 0
    const drop     = curPos - prevPos
    const prevImpr = prev.impressions || 0

    if (prevPos <= 0 || prevPos > DECAY_MAX_PREV_POS) continue  // wasn't in reach
    if (drop < DECAY_MIN_DROP) continue                          // didn't slip enough
    if (prevImpr < DECAY_MIN_IMPR) continue                      // too little volume — noise

    out.push({
      query:        cur.query,
      prevPosition: round1(prevPos),
      position:     round1(curPos),
      drop:         round1(drop),
      impressions:  Math.round(prevImpr),
      intent:       classifyIntent(cur.query),
      why:          decayReason(prevPos, curPos),
    })
  }

  out.sort((a, b) => b.drop - a.drop)
  return out.slice(0, limit)
}

// Cannibalization classifier — from per-URL snapshot rows (page set), find
// queries where 2+ of the workspace's own pages both rank meaningfully and split
// the clicks.
//   pageRows: [{ query, page, position, impressions, clicks }] — the latest row
//     per (query, page). Rows with no page are ignored.
// Returns [{ query, pages:[{page,position,impressions,clicks}], intent, why }].
export function classifyCannibalization(pageRows, opts = {}) {
  const limit = opts.limit ?? 12
  const byQuery = new Map()
  for (const r of pageRows || []) {
    if (!r?.query || !r?.page) continue
    if ((r.position || 99) > CANNIBAL_MAX_POS) continue
    if ((r.impressions || 0) < CANNIBAL_MIN_IMPR) continue
    if (!byQuery.has(r.query)) byQuery.set(r.query, new Map())
    // dedup pages per query (keep the best-ranked row for a repeated URL)
    const pages = byQuery.get(r.query)
    const existing = pages.get(r.page)
    if (!existing || (r.position || 99) < (existing.position || 99)) pages.set(r.page, r)
  }

  const out = []
  for (const [query, pagesMap] of byQuery) {
    const pages = [...pagesMap.values()]
    if (pages.length < CANNIBAL_MIN_PAGES) continue
    pages.sort((a, b) => (a.position || 99) - (b.position || 99))
    out.push({
      query,
      pages: pages.map((p) => ({
        page:        p.page,
        position:    round1(p.position || 0),
        impressions: Math.round(p.impressions || 0),
        clicks:      Math.round(p.clicks || 0),
      })),
      intent: classifyIntent(query),
      why:    `${pages.length} of your pages rank for "${query}" and split its clicks — consolidate into one strong page to lift both.`,
    })
  }

  out.sort((a, b) => b.pages.length - a.pages.length)
  return out.slice(0, limit)
}

// How confident are we that a published piece's topic targets a given GSC query?
//   'exact'  — the topic string equals the query (case/space-normalized).
//   'likely' — shares a meaningful word (>= 4 chars), via queryMatchesTopic.
//   false    — no relationship.
export function matchPublishedQuery(topic, query) {
  const norm = (s) => String(s || '').toLowerCase().trim().replace(/\s+/g, ' ')
  const t = norm(topic)
  const q = norm(query)
  if (!t || !q) return false
  if (t === q) return 'exact'
  if (queryMatchesTopic(q, [t])) return 'likely'
  return false
}
