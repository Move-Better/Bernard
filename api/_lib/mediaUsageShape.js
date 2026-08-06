// Shapes a media_asset_usage row's jsonb `published_platforms` column
// ({platform: count}) into the array shape the client renders directly:
// [{platform, count}], highest count first.
//
// Three server call sites read from the media_asset_usage view (migration
// 185/206) — api/_routes/media/list.js, api/_lib/clipSearch.js, and
// api/_routes/content-plan/week-summary.js — and all three need to agree on
// this shape, or the badge/tooltip reads differently depending on which
// surface an asset was fetched through. One copy so they can't drift (see
// CLAUDE.md's "client/server mirror pairs" note — the exact failure mode
// this is written to avoid).
export function shapeUsagePlatforms(publishedPlatforms) {
  return Object.entries(publishedPlatforms || {})
    .map(([platform, count]) => ({ platform, count }))
    .sort((a, b) => b.count - a.count)
}
