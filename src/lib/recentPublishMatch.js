// Same-author matching for the "Blogs ready to publish" strip on /week
// (feedback c4b8f7c9, follow-up: Q asked whether a rename could create the
// exact overlap he'd been burned by elsewhere — it can't for the identity
// itself, but the DISPLAY NAME on old content_items rows is a snapshot frozen
// at publish time and never backfilled, so the same person can legitimately
// show two different name spellings across rows. Confirmed live on
// movebetter: staff_id 4dc8770f... reads "Zach Cullen" on one published post
// and "Dr. Zachary Cullen" on a queued one).
//
// This is deliberately a byId match, never a name match — see
// api/_lib/approvedBlogs.js for why staff_name can't be trusted for identity.
// The frozen name itself is correct to leave alone: it's the actual published
// byline (useContentWorkflow.js sends piece.staff_name as the blog's author),
// so a rename should NOT retroactively rewrite it — this only bridges the gap
// for the two producer-facing lists that read it side by side.

/**
 * Find the most recent published blog by the same staff member as `blog`,
 * if any. `recentlyPublished` is assumed pre-sorted newest-first (as the
 * week-summary query returns it) — the first id match is therefore the most
 * recent one.
 * @param {{staffId?: string|null, staffName?: string|null}} blog
 * @param {Array<{staffId?: string|null, staffName?: string|null, publishedAt?: string|null}>|null|undefined} recentlyPublished
 * @returns {{publishedAt: string|null, staffName: string|null, sameName: boolean}|null}
 */
export function findRecentPublishMatch(blog, recentlyPublished) {
  if (!blog?.staffId || !Array.isArray(recentlyPublished)) return null
  const match = recentlyPublished.find((p) => p?.staffId && p.staffId === blog.staffId)
  if (!match) return null
  const a = (blog.staffName || '').trim().toLowerCase()
  const b = (match.staffName || '').trim().toLowerCase()
  return {
    publishedAt: match.publishedAt || null,
    staffName: match.staffName || null,
    // When both sides carry the same spelling, "also published as X" would
    // just repeat the row's own name back — sameName lets the caller drop
    // the "as X" clause and say only "also published <date>".
    sameName: !!a && a === b,
  }
}
