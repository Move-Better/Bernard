// Map a content_items.platform value to the media KIND the platform can
// actually publish, so Storyboard never suggests a photo for a video-only
// channel (you can't post a photo to YouTube) or a still for a video lane.
//
//   'video'  — platform takes video only (YouTube, TikTok, Reels, Shorts)
//   'photo'  — platform takes a still image only (blog hero, landing, Google Ads)
//   null     — platform takes either; show both and let the producer choose
//
// content_items.platform uses the atom namespace (instagram, youtube, tiktok,
// …); we also include the OUTPUT_CHANNELS ids (youtube_short, instagram_reel)
// so the map is correct whichever value a row carries. When in doubt we return
// null (show both) — over-showing is recoverable (the producer just doesn't
// pick it); wrongly hiding a valid option is not.

const VIDEO_ONLY = new Set(['youtube', 'youtube_short', 'tiktok', 'instagram_reel'])
const IMAGE_ONLY = new Set(['blog', 'landing_page', 'google_ads'])

// Platforms whose published output is text-dominant — an email renders via the
// TrustDrivenCare template, a blog/landing page is long-form copy with a hero.
// Aspect-ratio framing (9:16 / 4:5 / 1:1) and burned-in lower-third captions are
// social/video concepts that don't apply to these, so the Storyboard editor
// hides those "look" affordances for them.
const TEXT_ONLY = new Set(['email', 'blog', 'landing_page'])

// True when the platform's output has no aspect ratio / caption concept.
export function isTextOnlyPlatform(platform) {
  if (!platform) return false
  return TEXT_ONLY.has(String(platform).toLowerCase())
}

// 'video' | 'photo' | null
export function mediaKindForPlatform(platform) {
  if (!platform) return null
  const p = String(platform).toLowerCase()
  if (VIDEO_ONLY.has(p)) return 'video'
  if (IMAGE_ONLY.has(p)) return 'photo'
  return null
}

// Human label for what a platform accepts — drives the hint next to the
// platform badge so the producer understands why the candidate set is filtered.
export function mediaKindLabel(kind) {
  if (kind === 'video') return 'Videos only'
  if (kind === 'photo') return 'Photos only'
  return 'Photos or video'
}

// True when an attached entry's type is wrong for the platform — used for the
// soft "this platform can't post a photo" hint on manual picks (suggestions are
// already kind-filtered). A null platform-kind means no constraint.
export function isKindMismatch(platform, entryType) {
  const want = mediaKindForPlatform(platform)
  if (!want) return false
  const got = entryType === 'video' ? 'video' : 'photo'
  return want !== got
}
