// Server mirror of src/lib/postFrames.js — the canonical (platform, format) →
// frame registry. See that file for the full rationale.
//
// Why a mirror and not an import: api/* handlers bundle from the project root
// and must not pull the client module graph into a function bundle. This is the
// same arrangement CAPTION_LIMITS (src/lib/contentMeta.js) has with
// socialLengthTargets.js. tests/lib/postFrames.test.js asserts the two copies
// stay byte-equivalent — if you edit one, edit both, and the test will tell you
// if you forgot.
//
// SCOPE — the ratio we RENDER A COMPOSITED ARTIFACT AT, not the only ratio a
// platform accepts. Instagram's feed passes anything between 4:5 and 1.91:1
// through untouched (modelled in src/lib/instagramFrame.js, which governs the
// raw-photo path). Use this table when WE choose the shape; leave an author's
// own dimensions alone when they already fit.
//
// Ratios verified against current platform guidance 2026-07-22.

export const FRAME_PIXELS = {
  '4:5':  [1080, 1350],
  '9:16': [1080, 1920],
  '1:1':  [1080, 1080],
  '16:9': [1920, 1080],
  '4:3':  [1200, 900],
}

export const POST_FRAMES = {
  // Meta consolidated FB Stories, FB Reels, IG Stories and IG Reels onto a
  // single 9:16 safe zone in March 2026.
  instagram:    { post: '4:5',  reel: '9:16', story: '9:16' },
  facebook:     { post: '4:5',  reel: '9:16', story: '9:16' },

  // Google clips portrait AND 16:9 in Maps/Search previews; 4:3 is the only
  // ratio that survives both. Also see GBP_SAFE_ZONE.
  gbp:          { post: '4:3' },

  linkedin:     { post: '4:5',  video: '4:5', longform: '16:9' },

  // TikTok letterboxes 1:1 and 4:5 photo carousels on mobile.
  tiktok:       { video: '9:16', photo: '9:16' },

  youtube:      { short: '9:16', longform: '16:9' },
  twitter:      { post: '16:9' },
  threads:      { post: '4:5' },

  // Bluesky publishes no fixed spec; 1:1 is a deliberate safe default.
  bluesky:      { post: '1:1' },

  mastodon:     { post: '16:9' },
  blog:         { hero: '16:9' },
  landing_page: { hero: '16:9' },
}

export const KEEP_WHOLE_FORMATS = new Set(['longform'])

// KNOWN GAP, not yet enforced (a comment, not an export, so nothing can import
// it and imply otherwise): GBP trims ~10–20% off the top and bottom of a post
// image in its previews, and the 4:3 editorial render currently puts the byline
// at ~93% height — inside that band. Fixing it is an overlay-geometry change,
// tracked separately from this frame fix.

export const FALLBACK_RATIO = '4:5'

// Bernard folds some formats into the platform key itself (`instagram_story` is
// a distinct content_items.platform value; there is no content_items.format
// column). Split it here rather than in every caller.
const COMPOUND_SUFFIXES = ['story', 'reel', 'short', 'video', 'photo']

/**
 * Split a possibly-compound platform key into { platform, format }.
 * `instagram_story` → { platform: 'instagram', format: 'story' }
 */
export function splitPlatformKey(key) {
  const k = String(key || '').toLowerCase()
  for (const suffix of COMPOUND_SUFFIXES) {
    const stem = k.slice(0, -(suffix.length + 1))
    if (k.endsWith(`_${suffix}`) && POST_FRAMES[stem]) {
      return { platform: stem, format: suffix }
    }
  }
  return { platform: k, format: undefined }
}

/**
 * Resolve the frame for a destination.
 *
 * @param {string} platform  content_items.platform (instagram, instagram_story, gbp, …)
 * @param {string} [format]  post | reel | story | video | photo | short | longform | hero
 * @returns {{ ratio: string, width: number, height: number, keepWhole: boolean }}
 */
export function frameFor(platform, format) {
  const split = splitPlatformKey(platform)
  format = format || split.format
  const formats = POST_FRAMES[split.platform] || null
  const ratio =
    (formats && (formats[format] || formats.post || Object.values(formats)[0])) ||
    FALLBACK_RATIO
  const [width, height] = FRAME_PIXELS[ratio] || FRAME_PIXELS[FALLBACK_RATIO]
  return { ratio, width, height, keepWhole: KEEP_WHOLE_FORMATS.has(format) }
}
