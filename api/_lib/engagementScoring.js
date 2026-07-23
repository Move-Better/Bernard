// Shared engagement_snapshots scoring — one mapping used by every reader
// (top-performers, social-by-week, etc.) so a source's field-name mapping
// never has to be re-derived in a second place and drift out of sync with
// the first (exactly what happened when top-performers.js's bundle mapping
// was written before bundle.social shipped and never updated to match).

// Score a snapshot by its source. Returns { score, reach, pageviews, engagement }.
export function scoreSnapshot(snap) {
  if (snap.source === 'ga4') {
    const pageviews = snap.stats?.pageviews ?? 0
    return { score: pageviews, pageviews, reach: 0, engagement: 0 }
  }
  if (snap.source === 'gbp') {
    // GBP posts report views + actions on the flat stats blob, with no
    // `statistics` object at all — without this branch they fall through to the
    // Buffer shape below and score 0 forever. cadenceAdaptive's scoreOf()
    // already counted them; this keeps the two in agreement.
    const views   = snap.stats?.views ?? 0
    const actions = snap.stats?.actions ?? 0
    return { score: views + actions, reach: views, pageviews: 0, engagement: actions }
  }
  const stats = snap.stats?.statistics ?? {}
  const likes = stats.likes ?? stats.favorites ?? 0
  if (snap.source === 'bundle') {
    // bundle.social has no `reach` field — mirror the mapping used by
    // buffer-analytics.js's mapBundleMetrics (impressionsUnique -> reach,
    // likes+comments+shares+saves -> engagement), or every bundle row scores
    // 0 and gets filtered out as a candidate before it's ever ranked.
    const reach = stats.impressionsUnique ?? 0
    const engagement = likes + (stats.comments ?? 0) + (stats.shares ?? 0) + (stats.saves ?? 0)
    return { score: reach, reach, pageviews: 0, engagement }
  }
  // Buffer — API returns no engagement data today, so this legitimately scores 0.
  const reach = stats.reach ?? 0
  const engagement = likes + (stats.comments ?? 0) + (stats.shares ?? 0)
  return { score: reach, reach, pageviews: 0, engagement }
}

// Rank published items across sources for "what's working" prompts.
//
// Raw scores are NOT comparable across platforms: a GA4 blog pageview count and
// an Instagram reach count are different units with different natural
// magnitudes (on movebetter: IG reach averages ~108, LinkedIn ~9, blog
// pageviews ~3). Sorting on raw score therefore ranks by "which channel has
// bigger numbers," not by "which post did well" — a top-5 list built that way
// is all-one-channel regardless of actual performance.
//
// So rank on relScore = score / that platform's own average. "3x typical for
// its channel" is comparable across channels; the raw score rides along for
// display so prompts can still quote a real number.
//
// Takes raw engagement_snapshots rows (newest first) with an embedded
// content_items object, dedupes to the latest snapshot per item, and returns
// the top `limit` published items.
export function rankTopPerformers(rows, limit = 5) {
  if (!Array.isArray(rows)) return []

  const seen = new Set()
  const scored = []
  for (const row of rows) {
    if (seen.has(row.content_item_id)) continue
    seen.add(row.content_item_id)
    const ci = row.content_items
    if (!ci || ci.status !== 'published') continue
    const { score, reach, pageviews, engagement } = scoreSnapshot(row)
    if (score <= 0) continue
    scored.push({
      topic:    ci.topic || 'Untitled',
      platform: ci.platform,
      score, reach, pageviews, engagement,
    })
  }

  const sumByPlatform = {}
  const countByPlatform = {}
  for (const s of scored) {
    sumByPlatform[s.platform]   = (sumByPlatform[s.platform] ?? 0) + s.score
    countByPlatform[s.platform] = (countByPlatform[s.platform] ?? 0) + 1
  }

  for (const s of scored) {
    const avg = sumByPlatform[s.platform] / countByPlatform[s.platform]
    s.relScore = avg > 0 ? s.score / avg : 0
  }

  // Tie-break on raw score so a single-item platform (relScore always exactly
  // 1.0) doesn't order arbitrarily against other single-item platforms.
  scored.sort((a, b) => (b.relScore - a.relScore) || (b.score - a.score))
  return scored.slice(0, limit)
}
