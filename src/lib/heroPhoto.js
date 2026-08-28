// Blog / landing-page HERO photo reframe.
//
// A single-visual doc (blog, landing_page) carries its hero as one image entry
// in content_items.media_urls. Philip's feedback (#692e60b0): once a hero is
// chosen there was no way to crop, move, or colour-edit it — and the published
// post crops the hero to a wide band (16:9, object-fit:cover in site.css), so an
// off-centre or portrait shot loses its subject with nothing the author can do.
//
// The fix reuses the SAME editor every other photo already gets (PhotoInspector)
// and the SAME renderer the carousel bakes with (renderFreeformSlide). The only
// difference is the aspect: a hero frames at 16:9, not the carousel's 4:5.
//
// This module is the pure glue between "a media_urls hero entry" and "a
// one-photo pseudo-slide the shared renderer understands". Keeping it pure (no
// DOM, no imports beyond the entry contract) makes the framing rules testable —
// the DOM/upload bake lives in renderSlides.renderAndUploadHero, the React
// wiring in UnifiedEditor.HeroPhotoPanel, and the live preview in
// PostPreview.BlogPreview. All three build the pseudo-slide through heroSlide()
// so the editor preview and the publish bake can never frame the hero
// differently (preview == publish).

// Heroes bake and preview at 16:9 — the published blog hero renders at
// object-fit:cover inside a ≤960px-wide, ≤540px-tall figure (public/site.css
// .upost-hero-figure), so 1600×900 is wide enough that the served image is
// never upscaled.
export const HERO_ASPECT = '16 / 9'
export const HERO_DIMS = [1600, 900]

// Empty theme ⇒ the shared renderer takes its plain-photo path (drawPhotoFit +
// grade), with no WHOOP structure, no ad-mode, and — because blocks is [] — no
// text and no legibility scrim. Passed to BOTH the preview canvas and the bake
// so they render byte-for-byte the same hero.
export const HERO_THEME = {}

// Build the one-photo pseudo-slide the shared renderer (renderFreeformSlide)
// draws. blocks:[] is load-bearing: it selects photo-only (no text, no scrim).
// photo_idx:0 is inert for the hero (SlideCanvas resolves the photo from the
// entry it is handed, not from this index) but keeps the slide shape valid.
export function heroSlide(entry) {
  const e = entry && typeof entry === 'object' ? entry : {}
  const slide = { photo_idx: 0, blocks: [] }
  // Carry only the framing fields that are actually set, so an unframed hero
  // renders a straight fill (photo_fill ?? null ⇒ fills the frame).
  if (e.photo_fill != null) slide.photo_fill = e.photo_fill
  if (e.photo_offset) slide.photo_offset = e.photo_offset
  if (e.grade) slide.grade = e.grade
  return slide
}

// Has the author actually reframed or colour-graded the hero? A straight fill
// with no grade is byte-identical to shipping the raw photo, so there is nothing
// to bake and publish can skip the render entirely.
export function heroReframed(entry) {
  if (!entry || typeof entry !== 'object') return false
  return entry.photo_fill != null || !!entry.photo_offset || !!entry.grade
}

// Write the framing fields from an edited pseudo-slide back onto the hero entry.
// Deletes a field when the slide cleared it (the PhotoInspector "reset" drops
// photo_fill / photo_offset / grade), so an entry never carries a stale frame.
// Returns a new entry; never mutates the input.
export function applyHeroFrame(entry, slide) {
  const next = { ...(entry && typeof entry === 'object' ? entry : {}) }
  const s = slide || {}
  if (s.photo_fill != null) next.photo_fill = s.photo_fill
  else delete next.photo_fill
  if (s.photo_offset) next.photo_offset = s.photo_offset
  else delete next.photo_offset
  if (s.grade) next.grade = s.grade
  else delete next.grade
  return next
}
