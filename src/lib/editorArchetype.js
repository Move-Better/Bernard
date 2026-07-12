// Editor archetype resolver — the single source of truth for the unified editor
// shell. Every channel Bernard could publish collapses into one of a handful of
// EDITING ARCHETYPES; the shell adapts to the archetype (surface + rail +
// canvas), while the channel only changes the format badge, aspect default,
// caption rules, and publish/export action.
//
// See .claude/unified-shell-architecture.md for the full design + research.
//
// Three axes drive the shell:
//   1. post type (platform, + the photo/video/carousel distinction)  → archetype
//   2. media type of the active layer (photo | video | none)          → rail tools
//   3. selected element (slide | photo | text | overlay | clip)       → inspector
//
// This module owns axis 1 (archetype) and the media-tier gate. Axes 2–3 are the
// inspector's job and live in the editor.

import { isVideoEntry } from '@/lib/mediaEntry'

// The side surface that mounts beside the canvas. A carousel gets a SLIDE RAIL
// (spatial); a clip gets a TIMELINE (temporal, disclosed only when there's
// timed media); an ad gets SIZE VARIANTS; everything else gets NONE.
export const SURFACE = Object.freeze({
  SLIDES: 'slides',
  TIMELINE: 'timeline',
  VARIANTS: 'variants',
  NONE: 'none',
})

// The canvas kind — what the center renders.
export const CANVAS = Object.freeze({
  VISUAL: 'visual',   // image/video artifact (social, story, reel, ad)
  DOC: 'doc',         // long-form document (blog, landing, article)
  EMAIL: 'email',     // block-based email template
  TEXTAD: 'textad',   // copy-only ad preview (no creative)
})

// Media tier — whether the channel needs media to publish.
//   required : won't post without media (the "needs media" gate stays)
//   optional : text-only is a VALID finished post; media one click away
//   none     : no media slot at all (Google search ads)
export const MEDIA_TIER = Object.freeze({
  REQUIRED: 'required',
  OPTIONAL: 'optional',
  NONE: 'none',
})

// The 9 archetypes. `rail` is the ordered icon-rail section set; `aspects` is the
// allowed aspect list (first = default). `mediaTier` is the default for the
// archetype (a platform may override — e.g. Pinterest visual is required).
export const ARCHETYPES = Object.freeze({
  carousel: {
    label: 'Carousel', surface: SURFACE.SLIDES, canvas: CANVAS.VISUAL,
    rail: ['words', 'slide', 'photo', 'text', 'grade'],
    aspects: ['4:5', '1:1', '9:16'], mediaTier: MEDIA_TIER.REQUIRED,
  },
  visual: {
    label: 'Single visual', surface: SURFACE.NONE, canvas: CANVAS.VISUAL,
    rail: ['words', 'media', 'text', 'grade'],
    aspects: ['1:1', '4:5', '16:9'], mediaTier: MEDIA_TIER.OPTIONAL,
  },
  story: {
    label: 'Story frame', surface: SURFACE.NONE, canvas: CANVAS.VISUAL,
    rail: ['media', 'text', 'link'],
    aspects: ['9:16'], mediaTier: MEDIA_TIER.REQUIRED,
  },
  storyvid: {
    label: 'Story · video', surface: SURFACE.TIMELINE, canvas: CANVAS.VISUAL,
    rail: ['media', 'trim', 'caption', 'overlay', 'link', 'grade'],
    aspects: ['9:16'], mediaTier: MEDIA_TIER.REQUIRED,
  },
  vvideo: {
    label: 'Vertical video', surface: SURFACE.TIMELINE, canvas: CANVAS.VISUAL,
    rail: ['media', 'trim', 'caption', 'overlay', 'grade'],
    aspects: ['9:16'], mediaTier: MEDIA_TIER.REQUIRED,
  },
  lvideo: {
    label: 'Landscape video', surface: SURFACE.TIMELINE, canvas: CANVAS.VISUAL,
    rail: ['media', 'trim', 'caption', 'overlay', 'grade'],
    aspects: ['16:9', '1:1'], mediaTier: MEDIA_TIER.REQUIRED,
  },
  doc: {
    label: 'Long-form doc', surface: SURFACE.NONE, canvas: CANVAS.DOC,
    rail: ['words', 'media', 'seo'],
    aspects: [], mediaTier: MEDIA_TIER.OPTIONAL,
  },
  email: {
    label: 'Rich email', surface: SURFACE.NONE, canvas: CANVAS.EMAIL,
    rail: ['email', 'text', 'media'],
    aspects: [], mediaTier: MEDIA_TIER.OPTIONAL,
  },
  ad: {
    label: 'Ad creative', surface: SURFACE.VARIANTS, canvas: CANVAS.VISUAL,
    rail: ['words', 'media', 'text', 'variants'],
    aspects: ['1:1', '4:5', '9:16', '16:9'], mediaTier: MEDIA_TIER.REQUIRED,
  },
  textad: {
    label: 'Text ad', surface: SURFACE.NONE, canvas: CANVAS.TEXTAD,
    rail: ['words', 'seo'],
    aspects: [], mediaTier: MEDIA_TIER.NONE,
  },
})

// content_items.platform → base archetype (before the photo/video refinement
// that splits instagram into carousel/reel and instagram_story into frame/video).
const PLATFORM_ARCHETYPE = Object.freeze({
  instagram: 'carousel',          // refined to vvideo when a video is attached
  instagram_story: 'story',       // refined to storyvid when a video is attached
  instagram_reel: 'vvideo',
  facebook: 'visual',
  linkedin: 'visual',
  twitter: 'visual',
  threads: 'visual',
  bluesky: 'visual',
  mastodon: 'visual',
  pinterest: 'visual',
  reddit: 'visual',
  gbp: 'visual',
  discord: 'visual',
  slack: 'visual',
  tiktok: 'vvideo',
  youtube_short: 'vvideo',
  youtube: 'lvideo',
  blog: 'doc',
  landing_page: 'doc',
  email: 'email',
  google_ads: 'textad',
  ig_ads: 'ad',
  instagram_ads: 'ad',
  meta_ads: 'ad',
})

// Platform media-tier overrides (when the platform differs from its archetype's
// default). Pinterest is a `visual` archetype but media is REQUIRED there.
const PLATFORM_MEDIA_TIER = Object.freeze({
  instagram: MEDIA_TIER.REQUIRED,
  pinterest: MEDIA_TIER.REQUIRED,
})

const asArray = (m) => (Array.isArray(m) ? m : [])

// Resolve a content_items row to its archetype key. Applies the media-aware
// refinements: an Instagram piece with a video is a Reel (vvideo); an
// instagram_story with a video is a video story (storyvid).
export function resolveArchetype(piece) {
  const platform = piece?.platform || ''
  const media = asArray(piece?.media_urls)
  const hasVideo = media.some(isVideoEntry)
  let key = PLATFORM_ARCHETYPE[platform] || 'visual'

  if (platform === 'instagram' && hasVideo) key = 'vvideo'
  else if (platform === 'instagram_story' && hasVideo) key = 'storyvid'

  return key
}

// The archetype config object for a piece (never null — falls back to visual).
export function archetypeFor(piece) {
  return ARCHETYPES[resolveArchetype(piece)] || ARCHETYPES.visual
}

// Media tier for a piece's platform (platform override → archetype default).
export function mediaTierFor(piece) {
  const platform = piece?.platform || ''
  if (PLATFORM_MEDIA_TIER[platform]) return PLATFORM_MEDIA_TIER[platform]
  return archetypeFor(piece).mediaTier
}

// True when this piece cannot be published until media is attached.
export function needsMediaToPublish(piece) {
  return mediaTierFor(piece) === MEDIA_TIER.REQUIRED && asArray(piece?.media_urls).length === 0
}

// The side surface kind for a piece.
export function surfaceFor(piece) {
  return archetypeFor(piece).surface
}

// The ordered icon-rail section list for a piece.
export function railFor(piece) {
  return archetypeFor(piece).rail
}
