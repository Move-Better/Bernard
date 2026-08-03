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
