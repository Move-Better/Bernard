import { describe, it, expect } from 'vitest'
import { slideMediaEntry, slidePhotoEntry, slidePhotos } from '../../src/lib/mediaEntry.js'
import { normalizeSlide } from '../../src/components/story-detail/slide-editor/shared.js'
import { buildPublishMediaUrls } from '../../src/lib/renderSlides.js'

const P0 = { url: 'https://x/a.jpg', type: 'image', kind: 'image', mediaAssetId: 'a' }
const V1 = { url: 'https://x/v.mp4', type: 'video', kind: 'video', mediaAssetId: 'v', duration_s: 8 }
const P2 = { url: 'https://x/b.jpg', type: 'image', kind: 'image', mediaAssetId: 'b' }
// A mixed deck: photo, VIDEO, photo. This is the arrangement that breaks the
// old photo-only indexing — raw index 2 is a photo, filtered index 2 is nothing.
const MIXED = [P0, V1, P2]

describe('slideMediaEntry — media_idx (raw) with photo_idx (filtered) fallback', () => {
  it('resolves a VIDEO slide, which photo_idx alone never could', () => {
    expect(slideMediaEntry({ media_idx: 1 }, MIXED)).toBe(V1)
  })

  it('resolves photos AFTER a video by raw index', () => {
    // The bug this prevents: photo_idx 1 means "second PHOTO" = P2, but raw
    // index 1 is the video. Only media_idx can say "the third item".
    expect(slideMediaEntry({ media_idx: 2 }, MIXED)).toBe(P2)
  })

  it('falls back to photo_idx (filtered numbering) for legacy rows', () => {
    // No media_idx → photo_idx indexes slidePhotos, so 1 = the SECOND PHOTO.
    expect(slideMediaEntry({ photo_idx: 1 }, MIXED)).toBe(P2)
    expect(slidePhotos(MIXED)).toEqual([P0, P2])
  })

  it('media_idx WINS when both are present', () => {
    // Writers emit both; raw is authoritative because it is the only one that
    // can address every item.
    expect(slideMediaEntry({ media_idx: 1, photo_idx: 0 }, MIXED)).toBe(V1)
  })

  it('legacy rows are unaffected: with no video the two numberings agree', () => {
    // Verified against prod 2026-07-29 — all 86 slide-bearing pieces have zero
    // video/url-less entries, so every stored photo_idx is already a valid raw
    // index and needs no backfill.
    const photosOnly = [P0, P2]
    for (let i = 0; i < photosOnly.length; i++) {
      expect(slideMediaEntry({ photo_idx: i }, photosOnly))
        .toBe(slideMediaEntry({ media_idx: i }, photosOnly))
    }
  })

  it('returns null for an unbound slide', () => {
    expect(slideMediaEntry({}, MIXED)).toBeNull()
    expect(slideMediaEntry({ media_idx: 99 }, MIXED)).toBeNull()
  })
})

describe('slidePhotoEntry — still photo-only, so photo surfaces stay safe', () => {
  it('returns null for a video slide rather than handing back a video', () => {
    // The canvas bake, the ad export and the slide compositor can only draw a
    // still. Handing them a video entry publishes a broken image.
    expect(slidePhotoEntry({ media_idx: 1 }, MIXED)).toBeNull()
  })

  it('still returns the photo for a photo slide', () => {
    expect(slidePhotoEntry({ media_idx: 0 }, MIXED)).toBe(P0)
    expect(slidePhotoEntry({ media_idx: 2 }, MIXED)).toBe(P2)
  })
})

describe('normalizeSlide — media_idx round-trips', () => {
  it('preserves media_idx when stored', () => {
    expect(normalizeSlide({ media_idx: 2, photo_idx: 1 }, 0).media_idx).toBe(2)
  })

  it('omits media_idx entirely when absent (does NOT invent one from the index)', () => {
    // photo_idx defaults to the slide's own index for legacy compatibility, but
    // media_idx must not — a fabricated raw index would silently bind a slide
    // to whatever happens to sit at that position, including a video.
    const n = normalizeSlide({ photo_idx: 0 }, 3)
    expect('media_idx' in n).toBe(false)
    expect(n.photo_idx).toBe(0)
  })
})

describe('buildPublishMediaUrls — what a mixed deck actually publishes', () => {
  // Extracted from ensureRenderedSlides purely so this rule is testable: while
  // it lived inline (behind a DOM canvas + upload endpoint) a mutation deleting
  // the video branch left all 912 tests green. A surviving mutant means the
  // coverage claim was false, so the rule got its own function and this block.
  const baked = (n) => ({ rendered_url: `https://x/slide-${n}.jpg`, rendered_sig: 's' })

  it('ships the REAL video for a video slide, never a bake of it', () => {
    const slides = [
      { media_idx: 0, ...baked(0) },
      { media_idx: 1 },                 // video — deliberately unbaked
      { media_idx: 2, ...baked(2) },
    ]
    expect(buildPublishMediaUrls(slides, MIXED)).toEqual([
      { url: 'https://x/slide-0.jpg', type: 'photo' },
      V1,
      { url: 'https://x/slide-2.jpg', type: 'photo' },
    ])
  })

  it('preserves interleaved SLIDE order, not photos-then-videos', () => {
    const slides = [{ media_idx: 1 }, { media_idx: 0, ...baked(0) }]
    const out = buildPublishMediaUrls(slides, MIXED)
    expect(out[0]).toBe(V1)
    expect(out[1].url).toBe('https://x/slide-0.jpg')
  })

  it('a video slide is NEVER emitted as type:photo even if it somehow got baked', () => {
    // The failure this guards: a baked video slide is a caption over an empty
    // background, and shipping it as a photo silently replaces the clip.
    const slides = [{ media_idx: 1, ...baked(1) }]
    expect(buildPublishMediaUrls(slides, MIXED)).toEqual([V1])
  })

  it('all-photo decks are unchanged (legacy behaviour byte-for-byte)', () => {
    const photos = [P0, P2]
    const slides = [{ photo_idx: 0, ...baked(0) }, { photo_idx: 1, ...baked(1) }]
    expect(buildPublishMediaUrls(slides, photos)).toEqual([
      { url: 'https://x/slide-0.jpg', type: 'photo' },
      { url: 'https://x/slide-1.jpg', type: 'photo' },
    ])
  })

  it('drops an unbaked photo slide rather than emitting a null entry', () => {
    expect(buildPublishMediaUrls([{ photo_idx: 0 }], [P0])).toEqual([])
  })
})
