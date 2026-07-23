// Map a draft to the media KIND it can actually publish, so nothing ever
// suggests a photo for a video-only channel (you can't post a photo to YouTube)
// or a still for a video lane.
//
//   'video'  — takes video only (YouTube, TikTok, Reels, Shorts)
//   'photo'  — takes a still image only (blog hero, landing, Google Ads, email)
//   null     — takes either; show both and let the producer choose
//
// THIS MODULE IS THE SINGLE SOURCE OF TRUTH for both sides. `api/_lib/
// platformMedia.js` re-exports it rather than keeping its own copy — the two
// used to be independent maps and had already drifted (the server set carried
// 'email' and a dead 'reels', the client set carried neither), which is exactly
// how the reel bug below survived a previous fix.
//
// content_items.platform uses the atom namespace (instagram, youtube, tiktok,
// …); we also include the OUTPUT_CHANNELS ids (youtube_short, instagram_reel)
// so the map is correct whichever value a row carries. When in doubt we return
// null (show both) — over-showing is recoverable (the producer just doesn't
// pick it); wrongly hiding a valid option is not.

// Relative, NOT the '@/lib/…' alias: this module is imported by the serverless
// API (api/_lib/platformMedia.js) where Vite's '@' alias does not exist. Every
// src/lib module the API cross-imports keeps its graph alias-free for the same
// reason — mediaEntry.js itself has no imports at all.
import { isVideoEntry } from './mediaEntry.js'

// NOTE: 'youtube_short' and 'instagram_reel' are OUTPUT_CHANNELS / atom-registry
// ids ONLY — they are never written to content_items.platform (a Reel is stored
// as platform:'instagram' with a video attached; see mediaKindForDraft). They
// stay here so a row carrying a registry id is still classified correctly, but
// do NOT read their presence as "reels are covered" — platform alone cannot
// identify a Reel. A dead 'reels' entry also used to sit here; it is not an id
// in outputChannels.js and never appeared in the column, so it was removed.
const VIDEO_ONLY = new Set(['youtube', 'youtube_short', 'tiktok', 'instagram_reel'])
const IMAGE_ONLY = new Set(['blog', 'landing_page', 'google_ads', 'email'])

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

/**
 * The media kind a specific DRAFT can use — platform constraint plus the
 * media-aware refinement that platform alone cannot express.
 *
 * A Reel is stored as platform:'instagram' with a video attached — never as
 * platform:'instagram_reel' (that value lives only in the atom/OUTPUT_CHANNELS
 * namespace and is never written to the column; verified against prod, where
 * content_items.platform only ever holds instagram / instagram_story / blog /
 * linkedin / facebook / gbp). So mediaKindForPlatform('instagram') correctly
 * returns null — "either kind" — and a Reel draft was getting photos ranked
 * alongside videos on pure similarity, which is what the producer saw as
 * "format is reels but it's suggesting photos".
 *
 * The refinement mirrors resolveArchetype() in src/lib/editorArchetype.js: any
 * dual-kind platform with a video already attached IS a video post (instagram →
 * vvideo/Reel, instagram_story → storyvid, facebook/linkedin/gbp/… → lvideo),
 * so only video is a valid suggestion. Keeping the two in one place is the
 * point — the server previously had no equivalent refinement and could not know
 * the draft was a Reel, which is how this survived the last fix in this area.
 *
 * Deliberately NOT consulted: content_plan_atoms.format === 'reel'. It would
 * cost an extra query on the suggest hot path for zero coverage — a reel atom
 * is only ever inserted by the reel worker AFTER a clip renders (see
 * ATOM_FORMATS in api/_lib/atomPlan.js), so its piece always already has the
 * video attached. All 5 reel atoms in prod confirm this. If that ever changes,
 * this resolver still catches the piece the moment a video lands on it.
 *
 * @param {{platform?: string, media_urls?: unknown}|null|undefined} piece
 * @returns {'video'|'photo'|null}
 */
export function mediaKindForDraft(piece) {
  const platformKind = mediaKindForPlatform(piece?.platform)
  if (platformKind) return platformKind
  const media = Array.isArray(piece?.media_urls) ? piece.media_urls : []
  return media.some(isVideoEntry) ? 'video' : null
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
