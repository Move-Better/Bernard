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
import { isVideoEntry } from './mediaEntry.js'

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

// Validate a media_urls array against an explicit format choice. Returns
// { ok: true } or { ok: false, reason } with a stable machine key — callers
// turn reasons into UI copy (picker disable hints) or publishError keys.
export function validateFormatMedia(platform, format, mediaUrls) {
  const rule = formatMediaRule(platform, format)
  if (!rule) return { ok: false, reason: 'format_not_supported' }

  const entries = Array.isArray(mediaUrls) ? mediaUrls.filter((m) => m && m.url) : []
  const videos = entries.filter(isVideoEntry).length
  const images = entries.length - videos

  if (entries.length < rule.min) return { ok: false, reason: 'too_few_items' }
  if (entries.length > rule.max) return { ok: false, reason: 'too_many_items' }
  if (videos > 0 && !rule.kinds.includes('video')) return { ok: false, reason: 'video_not_allowed' }
  if (images > 0 && !rule.kinds.includes('image')) return { ok: false, reason: 'image_not_allowed' }
  if (!rule.mixed && videos > 0 && images > 0) return { ok: false, reason: 'mixed_not_allowed' }
  return { ok: true }
}
