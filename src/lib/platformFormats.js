// Post-format capability registry — which FORMATS each platform can publish,
// and what media each format accepts. Single source of truth for the format
// picker (phase 2), the /week drafter (phase 3), and the publish validation in
// api/_lib/social/bundlePublisher.js (phase 1).
//
// Every rule here was verified EMPIRICALLY against bundle.social's live API on
// 2026-07-29 (DRAFT posts against the movebetter team — see the mixed-carousel
// session): Instagram accepts photo-only, video-only AND mixed carouselItems
// (aspect-normalized via autoFitImage/autoCropImage); Facebook rejects mixed
// outright ("Facebook Post must have only photos or only videos") but accepts
// REEL as a real explicit type. Don't loosen a rule from docs alone — probe.
//
// Format is an EXPLICIT choice stored on content_items.format ('post' |
// 'carousel' | 'reel' | 'story', nullable). A null format means legacy derived
// behavior (any video on an instagram piece → Reel — see isInstagramReel in
// mediaEntry.js). The registry governs explicit choices only.
//
// content_items.format_source ('bernard' | 'human') journals WHO chose the
// format — the raw material for the per-dimension confidence loop (teach →
// run → check-in). db/content.js stamps 'human' on any client PATCH that sets
// format; server-side drafters stamp 'bernard'.
//
// Alias-free imports only — this module is cross-imported by the serverless
// API (same rule as mediaEntry.js / platformMediaKind.js).
import { isVideoEntry, publishMediaForFormat } from './mediaEntry.js'

export const FORMAT_IDS = ['post', 'carousel', 'reel', 'story']

// Per-platform format capabilities. media rules:
//   kinds — media kinds the format accepts ('image' | 'video')
//   mixed — may one payload contain BOTH kinds?
//   min/max — item count bounds (min 0 = text-only allowed)
//
// Platforms not listed here have no format choice — they publish exactly as
// today (a generic post) and the picker never renders for them.
const REGISTRY = {
  instagram: {
    // A single feed video is a Reel on today's Instagram — so 'post' is
    // photo-only and one item; any video intent routes through 'reel'.
    post:     { kinds: ['image'],          mixed: false, min: 1, max: 1 },
    carousel: { kinds: ['image', 'video'], mixed: true,  min: 2, max: 10 },
    reel:     { kinds: ['video'],          mixed: false, min: 1, max: 1 },
  },
  instagram_story: {
    story:    { kinds: ['image', 'video'], mixed: false, min: 1, max: 1 },
  },
  facebook: {
    // Facebook albums take multiple photos OR multiple videos — never both in
    // one post (verified live, see header). min 0: text-only FB posts are fine.
    post:     { kinds: ['image', 'video'], mixed: false, min: 0, max: 10 },
    reel:     { kinds: ['video'],          mixed: false, min: 1, max: 1 },
    // bundle supports FACEBOOK STORY; no Bernard drafting lane exposes it yet
    // (that arrives with the /week format work) but the publish floor is ready.
    story:    { kinds: ['image', 'video'], mixed: false, min: 1, max: 1 },
  },
}

// The formats a platform can publish, in display order. Length <= 1 means "no
// choice to offer" — the picker should not render.
export function formatOptions(platform) {
  const entry = REGISTRY[platform]
  return entry ? Object.keys(entry) : []
}

// The media rule for one platform+format, or null when the platform doesn't
// support that format at all.
export function formatMediaRule(platform, format) {
  return REGISTRY[platform]?.[format] || null
}

// Human labels for the picker. Kept next to the registry so a new format can't
// ship with a machine key leaking into the UI.
const FORMAT_LABELS = {
  post: 'Post', carousel: 'Carousel', reel: 'Reel', story: 'Story',
}

// Why a format is unavailable, in the producer's words. Keys mirror
// validateFormatMedia's reasons exactly.
const REASON_COPY = {
  too_few_items:      (r) => `Needs at least ${r.min} items`,
  too_many_items:     (r) => `Takes at most ${r.max} items`,
  video_not_allowed:  () => 'Photos only — a video posts as a Reel',
  image_not_allowed:  () => 'Video only — remove the photos',
  mixed_not_allowed:  () => 'This channel can’t mix photos and video in one post',
  format_not_supported: () => 'Not available on this channel',
}

/**
 * The format choices to render for a piece, each with whether the CURRENT media
 * can satisfy it and why not.
 *
 * Disabled rather than hidden on purpose: the full set teaches what the channel
 * actually offers, and the tooltip says what to change. Hiding "Reel" from a
 * photo carousel would leave a producer with no way to learn it exists.
 *
 * Validates what actually SHIPS, not the raw media_urls pool: a carousel with a
 * slide deck posts one card per SLIDE, so a 4-slide deck drawing from a 12-photo
 * pool is a valid 4-item carousel, not an over-cap "12 items" one. Counting the
 * pool disabled the Carousel option on exactly that shape — the picker's twin of
 * the publish-gate bug (feedback a473c03a). publishMediaForFormat is
 * format-independent (it mirrors publishPieceToSocial's own media choice from
 * slides + video presence), so one effective-media computation gates every
 * option, exactly as the publish gate does via describeFormatViolation.
 *
 * @param {{platform?: string, media_urls?: unknown, slides?: unknown}|null} piece
 * @returns {Array<{id:string,label:string,disabled:boolean,title:string|null}>}
 */
export function formatChoicesFor(piece) {
  const platform = piece?.platform || ''
  const media = publishMediaForFormat(piece)
  return formatOptions(platform).map((id) => {
    const check = validateFormatMedia(platform, id, media)
    const rule = formatMediaRule(platform, id) || {}
    return {
      id,
      label: FORMAT_LABELS[id] || id,
      disabled: !check.ok,
      title: check.ok ? null : (REASON_COPY[check.reason]?.(rule) || null),
    }
  })
}

// Human platform names for the full-sentence violation copy below. Kept local
// (not imported from contentMeta.js) so this module stays lean and serverless-
// safe — it's cross-imported by api/_lib/social/bundlePublisher.js.
const PLATFORM_LABELS = {
  instagram: 'Instagram',
  instagram_story: 'Instagram Story',
  facebook: 'Facebook',
}

// Validate a media_urls array against an explicit format choice. Returns
// { ok: true } or { ok: false, reason } with a stable machine key — callers
// turn reasons into UI copy (picker disable hints) or publishError keys.
export function validateFormatMedia(platform, format, mediaUrls) {
  const rule = formatMediaRule(platform, format)
  if (!rule) return { ok: false, reason: 'format_not_supported' }

  const entries = Array.isArray(mediaUrls) ? mediaUrls.filter((m) => m && m.url) : []
  const videos = entries.filter(isVideoEntry).length
  const images = entries.length - videos

  // KIND before COUNT, deliberately. Both can fail at once, and only one reason
  // reaches the producer as a tooltip — so the more fundamental one has to win.
  // Two photos against Reel fails both (2 > max 1, and photos aren't video);
  // reporting "takes at most 1 item" implies deleting a photo would fix it, and
  // it would not. Reporting "video only" names the actual problem.
  if (videos > 0 && !rule.kinds.includes('video')) return { ok: false, reason: 'video_not_allowed' }
  if (images > 0 && !rule.kinds.includes('image')) return { ok: false, reason: 'image_not_allowed' }
  if (!rule.mixed && videos > 0 && images > 0) return { ok: false, reason: 'mixed_not_allowed' }
  if (entries.length < rule.min) return { ok: false, reason: 'too_few_items' }
  if (entries.length > rule.max) return { ok: false, reason: 'too_many_items' }
  return { ok: true }
}

// Noun for a media count, so the sentence reads "6 photos" / "2 videos" /
// "3 items" rather than a bare "items".
function mediaNoun(images, videos, n) {
  if (videos === 0) return n === 1 ? 'photo' : 'photos'
  if (images === 0) return n === 1 ? 'video' : 'videos'
  return n === 1 ? 'item' : 'items'
}

/**
 * A full, human-readable explanation of why the CURRENT media can't publish
 * under the chosen format — plus which format WOULD accept it — or null when
 * the combination is valid (or the platform has no format choice at all).
 *
 * Single source of truth so the publish-blocked hint (client, before the
 * round-trip) and the 400 passthrough (server, in api/_routes/publish/social.js)
 * say the SAME thing. The recurring publish-path-divergence bug class is why the
 * copy lives here once rather than being re-authored on each surface.
 *
 * @param {string} platform
 * @param {string|null|undefined} format explicit content_items.format
 * @param {unknown} mediaUrls the piece's media_urls array
 * @returns {{reason:string, message:string}|null}
 */
export function describeFormatViolation(platform, format, mediaUrls) {
  // No explicit format, or a platform with no format registry at all: 'format'
  // is a no-op field there (legacy derived behaviour), so there's nothing to
  // validate and nothing to block. Guards non-registry platforms (linkedin,
  // gbp, …) from a spurious 'format_not_supported' block.
  if (!format || formatOptions(platform).length === 0) return null
  const check = validateFormatMedia(platform, format, mediaUrls)
  if (check.ok) return null

  const rule = formatMediaRule(platform, format) || {}
  const entries = Array.isArray(mediaUrls) ? mediaUrls.filter((m) => m && m.url) : []
  const n = entries.length
  const videos = entries.filter(isVideoEntry).length
  const noun = mediaNoun(n - videos, videos, n)
  const pLabel = PLATFORM_LABELS[platform] || platform
  const fLabel = FORMAT_LABELS[format] || format

  // Suggest the first OTHER format on this platform the current media satisfies.
  const alt = formatOptions(platform).find(
    (id) => id !== format && validateFormatMedia(platform, id, mediaUrls).ok,
  )
  const suggestion = alt ? ` Switch the format to ${FORMAT_LABELS[alt] || alt} to publish ${n > 1 ? 'them all' : 'it'}.` : ''

  let why
  switch (check.reason) {
    case 'too_many_items':
      why = `has ${n} ${noun}, but a ${fLabel} fits ${rule.max === 1 ? 'just 1' : `at most ${rule.max}`}`
      break
    case 'too_few_items':
      why = `has ${n} ${noun}, but a ${fLabel} needs at least ${rule.min}`
      break
    case 'video_not_allowed':
      why = `includes a video, which a ${fLabel} can’t carry`
      break
    case 'image_not_allowed':
      why = `includes a photo, which a ${fLabel} can’t carry`
      break
    case 'mixed_not_allowed':
      why = `mixes photos and video, which a ${fLabel} can’t combine`
      break
    default: // format_not_supported
      why = `can’t publish as a ${fLabel}`
  }
  return { reason: check.reason, message: `This ${pLabel} post ${why}.${suggestion}` }
}

/**
 * The format a piece SHOULD carry once `mediaUrls` is attached, auto-promoting
 * when the media has outgrown the current format — so the invalid state
 * (a single-photo "Post" holding six photos) never arises in the first place.
 *
 * Deliberately narrow: it promotes ONLY a genuine count overflow
 * (`too_many_items` → the next format that fits, e.g. Instagram Post → Carousel).
 * It does NOT rewrite a KIND mismatch (a video on a photo Post, a mixed album)
 * — those are real intent changes, left to the editor's block + message. It also
 * never demotes (a Carousel trimmed to one photo stays a Carousel; the block
 * handles that edge), and returns the format unchanged whenever there is no
 * strictly-valid larger format to move to.
 *
 * @param {string} platform
 * @param {string|null|undefined} format the piece's current explicit format
 * @param {unknown} mediaUrls the media_urls array being attached
 * @returns {string|null|undefined} the format to store — the input format when
 *   nothing should change (so a caller can compare by identity)
 */
export function promoteFormatForMedia(platform, format, mediaUrls) {
  if (!format || formatOptions(platform).length === 0) return format
  const check = validateFormatMedia(platform, format, mediaUrls)
  if (check.ok) return format
  // Only a count overflow is unambiguous enough to rewrite silently.
  if (check.reason !== 'too_many_items') return format
  const promoted = formatOptions(platform).find(
    (id) => id !== format && validateFormatMedia(platform, id, mediaUrls).ok,
  )
  return promoted || format
}
