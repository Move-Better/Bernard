import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { metaFeedFrame, instagramFeedFrame } from '@/lib/instagramFrame'

const raw = readFileSync(fileURLToPath(new URL('../../src/components/PostPreview.jsx', import.meta.url)), 'utf8')
// Live code only — a commented-out prop must not satisfy these (same hollow
// source-guard trap as tests/lib/contentRouteEnforcesPublishLock.test.js).
const src = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const FB_LINE = src.split('\n').find((l) => l.includes('<MediaCarousel') && l.includes('Facebook'))

describe('the frame model is shared, not duplicated per surface', () => {
  it('exposes the Meta name and keeps the Instagram alias pointing at it', () => {
    expect(instagramFeedFrame).toBe(metaFeedFrame)
  })

  it('leaves a true 4:5 portrait uncropped', () => {
    const f = metaFeedFrame(1600, 2000) // 0.80 — exactly the tallest allowed
    expect(f.croppedPct).toBe(0)
    expect(f.trims).toBe(null)
  })

  // The real Sciatica photo. It is 3:4 (0.75), slightly TALLER than 4:5, so the
  // feed does trim a little — the new preview says so instead of implying the
  // 58% loss the old 16:9 box drew.
  it('reports the small real trim on a 3:4 photo', () => {
    const f = metaFeedFrame(1500, 2000)
    expect(f.croppedPct).toBe(6)
    expect(f.trims).toBe('the top and bottom')
  })
})

// The published Facebook artifact is the BAKED slide (photo + text blocks,
// slides[].rendered_url), not the raw media_urls file. Previewing media_urls
// showed a post with no on-photo text while claiming it was what shipped —
// found on a live post whose Facebook copy carried a headline and a footer the
// preview did not show.
describe('FacebookPreview shows the baked slide, not the raw photo', () => {
  const DISPATCH = src.split('\n').find((l) => l.includes("case 'facebook'"))

  it('receives slides from the dispatch, like Instagram does', () => {
    expect(DISPATCH).toContain('slides={slides}')
  })

  it('receives the theme and aspect the bake used', () => {
    expect(DISPATCH).toContain('photoTemplateId={photoTemplateId}')
    expect(DISPATCH).toContain('aspectRatio={aspectRatio}')
  })

  it('declares the slides prop rather than silently dropping it', () => {
    const sig = src.split('\n').find((l) => l.includes('function FacebookPreview'))
    expect(sig).toContain('slides')
  })

  it('renders SlidesCarousel when slides exist', () => {
    const fb = src.slice(src.indexOf('function FacebookPreview'))
    const body = fb.slice(0, fb.indexOf('\nfunction '))
    expect(body).toContain('<SlidesCarousel')
    expect(body).toContain('hasSlides')
  })

  // Instagram was already correct; this pins that the fix did not regress it.
  it('leaves the Instagram dispatch passing slides too', () => {
    const ig = src.split('\n').find((l) => l.includes("case 'instagram':"))
    expect(ig).toContain('slides={slides}')
  })
})

describe('FacebookPreview renders the true frame', () => {
  it('has a live MediaCarousel for Facebook', () => {
    expect(FB_LINE).toBeTruthy()
  })

  it('passes trueFrame so the photo is not forced into a fixed box', () => {
    expect(FB_LINE).toContain('trueFrame')
  })

  it('names Facebook in the crop advisory rather than Instagram', () => {
    expect(FB_LINE).toContain('platformLabel="Facebook"')
    expect(src).toContain('{platformLabel} will trim about')
  })

  it('no longer squeezes Facebook photos into 16:9', () => {
    expect(FB_LINE).not.toContain('aspect-video')
  })

  // The regression this fixes, stated as arithmetic: a 1500x2000 photo in the
  // old 16:9 box kept only a thin middle band. Pin the magnitude so nobody
  // "tidies" the placeholder back to aspect-video without seeing the cost.
  it('quantifies what the old 16:9 frame discarded from a 4:5 photo', () => {
    const shown = (1500 / (16 / 9)) / 2000 // visible height fraction
    expect(Math.round((1 - shown) * 100)).toBe(58)
  })
})
