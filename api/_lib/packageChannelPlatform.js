// Which render channels from a Story Slate package become a content_items row
// on approval, and what platform each becomes.
//
// Extracted out of approve-package.js so this is a function the route CALLS
// rather than logic living only inside the request handler — an inline rule
// re-implemented by its own test proves nothing about the real handler (see
// CLAUDE.md "Logic inline behind a request handler is untestable").
//
// A blog post is only ever written from an interview (Q, 2026-08-01).
// blog_hero / blog_hero_video / website_embed are therefore intentionally
// ABSENT from CHANNEL_TO_PLATFORM — this is the package-approval path, which
// has no interview behind it. Before this exclusion, approving a package
// containing one of these channels created a platform:'blog',
// interview_id:null content_items row. Its interview_id:null actually made it
// SAIL PAST checkWordsApproved (a null interview is a documented intentional
// bypass — package approval is the words checkpoint for that pipeline, see
// wordsApprovalGate.js), so this was never blocked by a gate. It was simply
// wrong content in the wrong lane: `content` held a one-paragraph social
// caption, not a real article, filed under a platform the product rule says
// only interviews may populate. It sat invisible until the producer strip
// (#2527) gave approved blogs somewhere to surface — see f32f8ac0, deleted
// 2026-08-03.
export const CHANNEL_TO_PLATFORM = {
  linkedin_feed:         'linkedin',
  linkedin_video:        'linkedin',
  linkedin_native:       'linkedin',   // keep-whole long-form (16:9 landscape video)
  instagram_reel_still:  'instagram',
  instagram_reel:        'instagram',
  instagram_feed:        'instagram',
  tiktok_still:          'tiktok',
  tiktok:                'tiktok',
  youtube_short:         'youtube',
  youtube:               'youtube',     // keep-whole long-form (16:9 landscape video)
  facebook_feed:         'facebook',
  facebook_video:        'facebook',
  gbp_post:              'gbp',
}

/**
 * Group a package's renders by the platform they'll publish content_items
 * rows for, dropping any render on an unmapped channel (logged by the caller).
 *
 * @param {Array<{channel: string, blobUrl?: string}>} renders
 * @returns {{byPlatform: Record<string, {platform: string, renders: any[]}>, skipped: string[]}}
 *   skipped is every render's channel that had no platform mapping, in order —
 *   including duplicates, so a caller can report exactly how many were dropped.
 */
export function groupRendersByPlatform(renders) {
  const byPlatform = {}
  const skipped = []
  for (const render of Array.isArray(renders) ? renders : []) {
    const platform = CHANNEL_TO_PLATFORM[render?.channel]
    if (!platform) {
      skipped.push(render?.channel)
      continue
    }
    if (!byPlatform[platform]) byPlatform[platform] = { platform, renders: [] }
    byPlatform[platform].renders.push(render)
  }
  return { byPlatform, skipped }
}
