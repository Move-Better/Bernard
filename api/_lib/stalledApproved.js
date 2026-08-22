// Selection + shaping for the /week "approved, but never published" strip.
//
// Extracted rather than left inline in week-summary.js so the route and its
// tests call the SAME function (see CLAUDE.md "Logic inline behind a request
// handler is untestable"). The route's PostgREST query is deliberately broad
// (status + workspace + unscheduled); every judgment call lives here where a
// unit test can redden it.
//
// Why this strip exists: approve → schedule/publish is a two-click flow, and
// the second click can silently never come. The first reel approval in product
// history (content_items f172b617, 2026-08-17) stalled exactly there —
// approved, unscheduled, unpublished, no publish_error — and NO surface
// flagged it (2026-08 outcome review, week 3, gap 2). Blogs already have
// their own strip (approvedBlogs.js); this covers the social lanes.

// Channels whose approved work has its own lane/strip — never counted here.
// blog → the "Blogs ready to publish" strip; email / landing_page / googleAds
// publish off the social path entirely (an approved one sitting still is a
// lane gap, not a missed click — flagging it here would be a permanent,
// un-actionable alarm).
const EXCLUDED_PLATFORMS = new Set(['blog', 'email', 'landing_page', 'googleAds'])

// A fresh approval is normal workflow — approve → schedule usually happens in
// the same sitting, and the current week's board already shows those cards
// with a live Schedule control. Only a row older than this grace period reads
// as "the last click never came" rather than "mid-flow".
export const STALL_GRACE_MS = 24 * 60 * 60 * 1000

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * @param {any} row a content_items row
 * @param {number} nowMs
 * @returns {{id: string, platform: string|null, format: string|null,
 *            topic: string|null, staffName: string|null, approvedAt: string|null,
 *            daysStalled: number, hasVideo: boolean}}
 */
export function shapeStalledApproved(row, nowMs = Date.now()) {
  const media = Array.isArray(row.media_urls) ? row.media_urls : []
  return {
    id: row.id,
    platform: row.platform || null,
    format: row.format || null,
    topic: row.topic || null,
    staffName: row.staff_name || null,
    approvedAt: row.approved_at || null,
    daysStalled: row.approved_at ? Math.max(0, Math.floor((nowMs - Date.parse(row.approved_at)) / DAY_MS)) : 0,
    hasVideo: media.some((m) => m && (m.type === 'video' || m.kind === 'video')),
  }
}

/**
 * Filter a broad approved-rows query down to the genuinely stalled ones.
 * Belt-and-suspenders re-checks status/scheduled/published even though the
 * route's query already constrains them — the rule must hold on its own.
 *
 * @param {any[]} rows content_items rows (any platform)
 * @param {number} nowMs
 */
export function filterStalledApproved(rows, nowMs = Date.now()) {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) =>
      r &&
      r.status === 'approved' &&
      !r.scheduled_at &&
      !r.published_at &&
      !EXCLUDED_PLATFORMS.has(r.platform) &&
      r.approved_at &&
      nowMs - Date.parse(r.approved_at) >= STALL_GRACE_MS)
    .map((r) => shapeStalledApproved(r, nowMs))
}
