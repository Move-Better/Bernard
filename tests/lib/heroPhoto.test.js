import { describe, it, expect } from 'vitest'
import { heroSlide, heroReframed, applyHeroFrame, HERO_ASPECT, HERO_DIMS, HERO_THEME } from '../../src/lib/heroPhoto.js'

// Pure glue between a media_urls HERO entry (blog/landing) and the one-photo
// pseudo-slide the shared renderer draws. These rules decide what the editor
// preview and the publish bake frame — a drift between them is a preview-lies
// bug — so they are pinned here rather than left inline (per the "logic inline
// is untestable" doctrine). The DOM bake (renderAndUploadHero) and the React
// wiring (HeroPhotoPanel) both build the slide through heroSlide(), so this is
// the single source of truth for "how a hero frames".

describe('heroSlide', () => {
  it('is photo-only: blocks is always empty (no text, no scrim)', () => {
    // blocks:[] is load-bearing — it selects the renderer's photo-only path.
    expect(heroSlide({ url: 'a.jpg', photo_fill: 1.4 }).blocks).toEqual([])
    expect(heroSlide({}).blocks).toEqual([])
    expect(heroSlide(null).blocks).toEqual([])
  })

  it('carries only the framing fields that are actually set', () => {
    const bare = heroSlide({ url: 'a.jpg' })
    expect(bare).not.toHaveProperty('photo_fill')
    expect(bare).not.toHaveProperty('photo_offset')
    expect(bare).not.toHaveProperty('grade')
    expect(bare.photo_idx).toBe(0)
  })

  it('passes through fill, offset, and grade when present', () => {
    const s = heroSlide({ url: 'a.jpg', photo_fill: 1.8, photo_offset: { x: 0.1, y: -0.2 }, grade: { brightness: 12 } })
    expect(s.photo_fill).toBe(1.8)
    expect(s.photo_offset).toEqual({ x: 0.1, y: -0.2 })
    expect(s.grade).toEqual({ brightness: 12 })
  })

  it('keeps a fill of 0 (falsy but meaningful) — uses != null, not truthiness', () => {
    // photo_fill 0 is a real zoom value; a `|| ` guard would drop it.
    expect(heroSlide({ url: 'a.jpg', photo_fill: 0 })).toHaveProperty('photo_fill', 0)
  })
})

describe('heroReframed', () => {
  it('false for an untouched hero (nothing to bake — ships as-is)', () => {
    expect(heroReframed({ url: 'a.jpg' })).toBe(false)
    expect(heroReframed({ url: 'a.jpg', thumbnailUrl: 't.jpg', type: 'image' })).toBe(false)
  })

  it('true when any of fill / offset / grade is set', () => {
    expect(heroReframed({ photo_fill: 1.2 })).toBe(true)
    expect(heroReframed({ photo_offset: { x: 0, y: 0.3 } })).toBe(true)
    expect(heroReframed({ grade: { warmth: -4 } })).toBe(true)
  })

  it('true for a fill of 0 (a real zoom, not "unset")', () => {
    expect(heroReframed({ photo_fill: 0 })).toBe(true)
  })

  it('false for null / non-object', () => {
    expect(heroReframed(null)).toBe(false)
    expect(heroReframed(undefined)).toBe(false)
    expect(heroReframed('a.jpg')).toBe(false)
  })
})

describe('applyHeroFrame', () => {
  it('writes set framing fields onto the entry and preserves the rest', () => {
    const entry = { url: 'a.jpg', sourceUrl: 'a.jpg', thumbnailUrl: 't.jpg', type: 'image', alt: 'x' }
    const next = applyHeroFrame(entry, { photo_idx: 0, blocks: [], photo_fill: 1.5, photo_offset: { x: 0, y: 0.2 }, grade: { brightness: 8 } })
    expect(next.photo_fill).toBe(1.5)
    expect(next.photo_offset).toEqual({ x: 0, y: 0.2 })
    expect(next.grade).toEqual({ brightness: 8 })
    // untouched entry fields survive
    expect(next.url).toBe('a.jpg')
    expect(next.sourceUrl).toBe('a.jpg')
    expect(next.alt).toBe('x')
  })

  it('DELETES a field the slide cleared (PhotoInspector "reset"), leaving no stale frame', () => {
    const entry = { url: 'a.jpg', photo_fill: 1.5, photo_offset: { x: 0, y: 0.2 }, grade: { brightness: 8 } }
    const reset = applyHeroFrame(entry, { photo_idx: 0, blocks: [] })
    expect(reset).not.toHaveProperty('photo_fill')
    expect(reset).not.toHaveProperty('photo_offset')
    expect(reset).not.toHaveProperty('grade')
    expect(reset.url).toBe('a.jpg')
    expect(heroReframed(reset)).toBe(false)
  })

  it('never mutates the input entry', () => {
    const entry = { url: 'a.jpg', photo_fill: 1.5 }
    const snapshot = JSON.parse(JSON.stringify(entry))
    applyHeroFrame(entry, { photo_idx: 0, blocks: [], photo_fill: 2.0 })
    expect(entry).toEqual(snapshot)
  })

  it('round-trips: applyHeroFrame → heroSlide reproduces the same framing', () => {
    const entry = { url: 'a.jpg' }
    const edited = applyHeroFrame(entry, { photo_idx: 0, blocks: [], photo_fill: 1.3, photo_offset: { x: -0.1, y: 0 } })
    const slide = heroSlide(edited)
    expect(slide.photo_fill).toBe(1.3)
    expect(slide.photo_offset).toEqual({ x: -0.1, y: 0 })
    expect(slide.blocks).toEqual([])
  })
})

describe('hero constants', () => {
  it('frames at 16:9 to match the published hero crop', () => {
    expect(HERO_ASPECT).toBe('16 / 9')
    const [w, h] = HERO_DIMS
    expect(w / h).toBeCloseTo(16 / 9, 5)
  })

  it('renders with an empty theme (photo-only path — no whoop, no ad-mode)', () => {
    // A non-empty theme with layout/palette would take the WHOOP structure path;
    // an ad-mode theme would suppress blocks differently. {} guarantees the
    // plain drawPhotoFit branch, identical in preview and bake.
    expect(HERO_THEME).toEqual({})
  })
})
