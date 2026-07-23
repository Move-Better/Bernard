// Canonical (platform, format) → frame registry.
//
// This is the ONE source of truth for what shape a rendered post must be. It
// replaces three drifted tables that each carried their own keys and their own
// dimensions for the same surfaces:
//   • CHANNEL_SPECS       (api/_lib/brandRender.js)      — `*_feed` / `*_still`
//   • VIDEO_CHANNEL_SPECS (api/_lib/brandRenderVideo.js) — `*_video` / bare
//   • EDITORIAL_ASPECTS   (api/_lib/brandRender.js)      — caller-selected ratio
//
// Two rules this encodes, both deliberate:
//
//   1. ASPECT IS DERIVED, NEVER SELECTED. A frame is a property of where the
//      post is going, not a choice the author makes. Offering "1:1" on a surface
//      that renders 9:16 produces a letterboxed post and teaches staff a
//      taxonomy the platform doesn't have.
//   2. THE KEY IS (platform, format), NOT A CHANNEL STRING. One platform hosts
//      several frames — an Instagram post is 4:5 while an Instagram reel and
//      story are both 9:16. A single `instagram` key cannot express that, which
//      is exactly how `instagram_feed: 1:1` survived.
//
// SCOPE — this table is the ratio we RENDER A COMPOSITED ARTIFACT AT. It is not
// a claim about the only ratio a platform will accept. Several platforms accept
// a RANGE and pass anything inside it through untouched: Instagram's feed takes
// everything between 4:5 and 1.91:1 and crops only what falls outside, so a 4:3
// landscape posts at its own ratio rather than being squared. That behaviour is
// modelled in src/lib/instagramFrame.js and governs the RAW-PHOTO path, where
// forcing a photo to the value below would crop it for no reason.
//
// The two paths are complementary, so keep them straight:
//   • raw photo, no compositing  → instagramFrame.js — what the platform does to
//                                  the author's own dimensions; leave them alone
//                                  when they already fit.
//   • composited / baked artifact → this table — we're choosing the shape, so we
//                                  choose the one that wins the most screen.
//
// Ratios verified against current platform guidance 2026-07-22 — do NOT edit a
// value here without re-verifying against the provider, and prefer the
// provider's own vocabulary for format names (see bundlePublisher.js, which
// sends a literal POST | REEL | STORY).
//
// Server mirror: api/_lib/postFrames.js. tests/lib/postFrames.test.js asserts the
// two stay in step — same contract as CAPTION_LIMITS / AUTO_CLAMP_PLATFORMS.

// Pixel dimensions per ratio. Rendering targets the ratio; the pixel pair is the
// master size we rasterise at.
export const FRAME_PIXELS = {
  '4:5':  [1080, 1350],
  '9:16': [1080, 1920],
  '1:1':  [1080, 1080],
  '16:9': [1920, 1080],
  '4:3':  [1200, 900],
}

// (platform, format) → ratio.
//
// Formats use each platform's own noun. `longform` marks the keep-whole
// landscape lane (a teaching video that must never be cropped into a reel) —
// those render with fit:'contain' and letterbox on purpose.
export const POST_FRAMES = {
  // Meta consolidated Facebook Stories, Facebook Reels, Instagram Stories and
  // Instagram Reels onto a single 9:16 safe zone in March 2026, so one vertical
  // master serves all four placements.
  instagram:    { post: '4:5',  reel: '9:16', story: '9:16' },
  facebook:     { post: '4:5',  reel: '9:16', story: '9:16' },

  // Google clips portrait AND 16:9 in the Maps carousel and Search preview card;
  // 4:3 is the only ratio that survives both surfaces uncropped. See
  // GBP_SAFE_ZONE below — GBP also trims the top/bottom of what it does show.
  gbp:          { post: '4:3' },

  // LinkedIn renders 1:1 and 4:5 uncropped; 4:5 is chosen for mobile reach.
  linkedin:     { post: '4:5',  video: '4:5', longform: '16:9' },

  // TikTok accepts 1:1 and 4:5 for photo carousels but letterboxes them on
  // mobile — 9:16 is the only non-letterboxed choice.
  tiktok:       { video: '9:16', photo: '9:16' },

  youtube:      { short: '9:16', longform: '16:9' },
  twitter:      { post: '16:9' },
  threads:      { post: '4:5' },

  // Bluesky publishes no fixed spec (it re-processes uploads, longest side
  // 1000px). 1:1 is a deliberate safe default, not a documented requirement.
  bluesky:      { post: '1:1' },

  mastodon:     { post: '16:9' },
  blog:         { hero: '16:9' },
  landing_page: { hero: '16:9' },
}

// Formats that letterbox on purpose (keep the whole frame) rather than fill.
// Everything else covers the frame edge-to-edge.
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

// The frame used when a (platform, format) pair isn't in the table. 4:5 is the
// most broadly-safe social frame — but reaching this is a gap in the registry,
// not a normal path, so callers should prefer adding the pair.
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

// Bernard's platform namespace folds some formats into the platform key itself
// (`instagram_story` is a distinct content_items.platform value, and a distinct
// entry in CAPTION_LIMITS / PLATFORM_TO_BUNDLE_TYPE). There is no
// content_items.format column, so for those the format IS the suffix — split it
// here rather than making every caller re-derive it.
const COMPOUND_SUFFIXES = ['story', 'reel', 'short', 'video', 'photo']

/**
 * Split a possibly-compound platform key into { platform, format }.
 * `instagram_story` → { platform: 'instagram', format: 'story' }
 * `instagram`       → { platform: 'instagram', format: undefined }
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
  // An explicit format argument wins; otherwise use one encoded in the key.
  format = format || split.format
  const formats = POST_FRAMES[split.platform] || null
  // Fall back to the platform's own `post`/first entry when the caller didn't
  // resolve a format, so a missing format degrades to that platform's primary
  // surface rather than to a global default.
  const ratio =
    (formats && (formats[format] || formats.post || Object.values(formats)[0])) ||
    FALLBACK_RATIO
  const [width, height] = FRAME_PIXELS[ratio] || FRAME_PIXELS[FALLBACK_RATIO]
  return { ratio, width, height, keepWhole: KEEP_WHOLE_FORMATS.has(format) }
}
