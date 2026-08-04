// Output SHAPE for a video clip — the VideoEditor's format picker.
//
// Kept out of VideoEditor.jsx so the preview==bake invariant can be tested
// without pulling the whole editor's module graph into a test. postFrames.js is
// the source of truth for what each render channel ACTUALLY bakes at; the
// `dim` values below are the editor's promise to the user, and
// tests/lib/videoFormats.test.js asserts the two agree for every
// (shape, platform) pair the picker can produce.
//
// History: the picker used to offer Reel 9:16 / Square 1:1 / Portrait 4:5,
// where "Square" pointed at the linkedin_video channel — which renders 4:5.
// You composed square and got a 4:5 post. "Portrait" rendered the identical
// frame, so two of three options were the same shape and one of them lied.

// The three frames the renderer actually produces. Labels are ORIENTATION
// words, not platform names: a 9:16 clip used to be labelled "Reel", which read
// as an Instagram destination even on a Google Business or LinkedIn post
// (reported from the field). The destination is shown separately in the editor
// chrome; these describe only the output shape. Keys are PERSISTED (they ride
// to the render channel), so only the labels changed.
export const FORMATS = {
  reel: { css: '9 / 16', label: 'Vertical',  dim: '9:16' },
  feed: { css: '4 / 5',  label: 'Portrait',  dim: '4:5' },
  wide: { css: '4 / 3',  label: 'Landscape', dim: '4:3' },
}

export const FORMAT_KEYS = ['reel', 'feed', 'wide']

// Shape + platform → render channel. Channel keys are PERSISTED (they ride to
// the render API and land in story_packages.renders), so these come from
// CHANNEL_DESTINATIONS in postFrames.js rather than being invented. The
// per-shape fallback is a channel that renders the SAME frame, so an unlisted
// platform still bakes at the ratio its shape promises.
const SHAPE_CHANNELS = {
  reel: { instagram: 'instagram_reel', tiktok: 'tiktok', youtube_short: 'youtube_short' },
  feed: { linkedin: 'linkedin_video', facebook: 'facebook_video', instagram: 'instagram_carousel_video' },
  wide: { gbp: 'gbp_video' },
}

const SHAPE_FALLBACK_CHANNEL = { reel: 'instagram_reel', feed: 'facebook_video', wide: 'gbp_video' }

/** Render channel for a (shape, platform) pair. Unknown shape falls back to reel. */
export function channelFor(shape, platform) {
  const key = FORMATS[shape] ? shape : 'reel'
  return SHAPE_CHANNELS[key][platform] || SHAPE_FALLBACK_CHANNEL[key]
}

// Platforms whose video lane is vertical (see POST_FRAMES in postFrames.js).
const VERTICAL_VIDEO_PLATFORMS = new Set([
  'instagram', 'instagram_reel', 'instagram_story', 'tiktok', 'youtube_short',
])

/**
 * The shape a piece should OPEN in.
 *
 * This used to be hardcoded to 'reel' for everything, so a LinkedIn or Google
 * Business video post opened in the 9:16 reel editor — reported from the field
 * ("Drafted a linkedin post but reel template and editor came up"). Standalone
 * (Moment Miner / Slate) there is no piece and no platform, and the reel lane
 * is the right default there.
 */
export function defaultFormatFor(platform) {
  if (!platform) return 'reel'
  if (platform === 'gbp') return 'wide'
  return VERTICAL_VIDEO_PLATFORMS.has(platform) ? 'reel' : 'feed'
}

// Saved drafts (localStorage / content_items.video_edit) may carry the retired
// shape names. Both baked 4:5, so both restore as 'feed' — the user's real
// choice is preserved rather than silently reset to the platform default.
const LEGACY_FORMATS = { square: 'feed', portrait: 'feed' }

/** Map a possibly-legacy saved shape onto a current one. */
export const normalizeFormat = (f) => LEGACY_FORMATS[f] || f
