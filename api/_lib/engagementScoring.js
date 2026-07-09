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
