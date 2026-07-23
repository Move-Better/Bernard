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

// How much of the frame the destination CROPS OFF in its own preview surfaces,
// as a fraction of height. Google Business Profile trims roughly 10–20% off the
// top and bottom of a post image in the Maps carousel and the Search preview
// card, so a footer laid out flush to the bottom edge is clipped in the only
// place customers see it. 0.12 is the conservative middle of that range.
//
// This is NOT the frame — the frame decides the shape, this decides how far in
// from the edge content has to stay to survive. Everything absent from this map
// shows the whole frame and needs no inset.
export const SAFE_INSETS = {
  gbp: { top: 0.12, bottom: 0.12 },
}

/**
 * Bottom safe inset for a destination, as a fraction of height (0 when none).
 * @param {string} platform
 * @returns {number}
 */
export function safeInsetBottomFor(platform) {
  return SAFE_INSETS[splitPlatformKey(platform).platform]?.bottom || 0
}

export const FALLBACK_RATIO = '4:5'

// Legacy render-channel key → the destination it actually targets.
//
// These keys are PERSISTED (story_packages.channels / .renders hold them on live
// rows) and are threaded through renderClipCore, renderPackageChannels,
// generate-package, approve-package, ads/render-video and the VideoEditor. So
// they cannot be renamed or dropped — but they no longer need to carry their own
// copy of the dimensions. CHANNEL_SPECS and VIDEO_CHANNEL_SPECS now derive
// width/height/aspect through this map, which is what stops the two tables
// drifting apart the way they had (the photo table said `instagram_feed: 1:1`
// while Instagram's feed renders 4:5).
//
// Render BEHAVIOUR that isn't the frame — captionPos, fit:'contain', longform —
// stays on the channel tables, because it varies per channel rather than per
// destination (website_embed and blog_hero_video share a frame but not a fit).
export const CHANNEL_DESTINATIONS = {
  // Photo channels (CHANNEL_SPECS)
  linkedin_feed:        { platform: 'linkedin',  format: 'post' },
  instagram_reel_still: { platform: 'instagram', format: 'reel' },
  instagram_feed:       { platform: 'instagram', format: 'post' },
  facebook_feed:        { platform: 'facebook',  format: 'post' },
  blog_hero:            { platform: 'blog',      format: 'hero' },
  tiktok_still:         { platform: 'tiktok',    format: 'photo' },
  youtube_short_still:  { platform: 'youtube',   format: 'short' },
  // Video channels (VIDEO_CHANNEL_SPECS)
  linkedin_video:       { platform: 'linkedin',  format: 'video' },
  instagram_reel:       { platform: 'instagram', format: 'reel' },
  tiktok:               { platform: 'tiktok',    format: 'video' },
  youtube_short:        { platform: 'youtube',   format: 'short' },
  blog_hero_video:      { platform: 'blog',      format: 'hero' },
  facebook_video:       { platform: 'facebook',  format: 'post' },
  youtube:              { platform: 'youtube',   format: 'longform' },
  linkedin_native:      { platform: 'linkedin',  format: 'longform' },
  website_embed:        { platform: 'blog',      format: 'hero' },
}

/**
 * Build a render-channel spec from the registry, merging in the channel's own
 * render behaviour. The single place channel dimensions come from.
 *
 * @param {string} channel  key in CHANNEL_DESTINATIONS
 * @param {Object} [extra]  captionPos / fit / longform — behaviour, not frame
 */
export function channelSpec(channel, extra = {}) {
  const dest = CHANNEL_DESTINATIONS[channel]
  const { width, height, ratio } = frameFor(dest?.platform, dest?.format)
  return { width, height, aspect: ratio, ...extra }
}

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
