// Shaping for the producer's "blogs ready to publish" strip (/week).
//
// Extracted rather than left inline in week-summary.js so the route and its
// tests call the SAME function — a test that re-implements a rule sitting
// inside a request handler is testing its own copy, and a mutation to the real
// handler leaves it green (see CLAUDE.md "Logic inline behind a request handler
// is untestable").
//
// Why this strip exists at all: a blog is the one channel with no
// content_plan_atoms row, so it can never appear on the atom-driven week board.
// An approved blog therefore had nowhere to surface, and five finished,
// words-approved posts sat unpublished for 3-8 weeks.

import { pickHero } from './publishImageMirror.js'

/**
 * @param {any} row a content_items row (platform 'blog', status 'approved')
 * @returns {{id: string, topic: string|null, staffName: string|null,
 *            approvedAt: string|null, createdAt: string|null, needsHero: boolean}}
 */
export function shapeApprovedBlog(row) {
  return {
    id: row.id,
    topic: row.topic || null,
    staffName: row.staff_name || null,
    approvedAt: row.approved_at || null,
    createdAt: row.created_at || null,
    // The blog hero IS media_urls[0] — there is no separate hero column; the
    // publish path resolves it with pickHero and sends it as `heroImage`.
    //
    // Deliberately pickHero() and NOT `media_urls.length === 0`: pickHero only
    // accepts an IMAGE entry, so a blog carrying just a video reads as still
    // needing a hero — which is correct, because publish/website.js would
    // resolve no heroImage for that row either. Length alone would call it
    // done and the post would ship with no hero at all.
    needsHero: !pickHero(row.media_urls),
  }
}

// Shaping for the "recently published" author context shown alongside the
// strip above (feedback c4b8f7c9, 2026-09-06: a producer picking the next blog
// off the ready-to-publish list has no visibility into who was published most
// recently, so back-to-back posts from the same clinician are easy to pick
// without noticing).
//
// Deliberately raw and un-deduplicated: two rows by the same clinician in a
// row is exactly the signal this exists to surface (confirmed live on
// movebetter 2026-09-06 — the last two published blogs were both the same
// person), so collapsing repeats would hide the one thing worth showing.
//
// staffName is display-only here — do NOT use it to detect "same author as a
// queued blog" anywhere. staff_name is a denormalized snapshot that drifts
// ("Zach Cullen" vs "Dr. Zachary Cullen" for the identical staff_id, confirmed
// live); any future same-author matching must join on staff_id instead.
/**
 * @param {any} row a content_items row (platform 'blog', status 'published')
 * @returns {{id: string, staffName: string|null, publishedAt: string|null}}
 */
export function shapeRecentlyPublishedBlog(row) {
  return {
    id: row.id,
    staffName: row.staff_name || null,
    publishedAt: row.published_at || null,
  }
}
