import { describe, it, expect, vi, beforeEach } from 'vitest'

// The real renderer needs a live 2D context; we only care about the dimensions
// it is asked to draw at and how often it is called.
const renderCalls = []
vi.mock('@/lib/overlayTemplates', () => ({
  renderFreeformSlide: vi.fn(async ({ width, height }) => { renderCalls.push({ width, height }) }),
  SIZE: 1080,
  SLIDE_W: 1080,
  SLIDE_H: 1350,
}))

const uploadCalls = []
vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(async (_path, init) => {
    uploadCalls.push(JSON.parse(init.body))
    return { url: `https://blob.example/slide-${uploadCalls.length}.jpg` }
  }),
}))

import { ensureRenderedSlides } from '@/lib/renderSlides'

// Minimal canvas stand-in — ensureRenderedSlides only sets w/h and asks for a
// data URL.
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, toDataURL: () => 'data:image/jpeg;base64,AA' }),
}

const MEDIA = [{ url: 'https://blob.example/photo.jpg', type: 'image', mediaAssetId: 'a1' }]
const SLIDES = [{ photo_idx: 0, template: 'custom', blocks: [{ role: 'hook', text: 'Hello' }] }]
const BASE = { mediaUrls: MEDIA, brandStyle: {}, theme: null, themeId: 'deck', pieceId: 'p1' }

beforeEach(() => {
  renderCalls.length = 0
  uploadCalls.length = 0
})

describe('ensureRenderedSlides — the editor aspect must survive publish', () => {
  it('bakes at the requested aspect, not always 4:5', async () => {
    const out = await ensureRenderedSlides({ ...BASE, slides: SLIDES, aspect: '9:16' })
    expect(out.changed).toBe(true)
    expect(renderCalls).toEqual([{ width: 1080, height: 1920 }])
    expect(out.slides[0].rendered_url).toBe('https://blob.example/slide-1.jpg')
  })

  it('reuses the cached bake when publish passes the SAME aspect', async () => {
    const first = await ensureRenderedSlides({ ...BASE, slides: SLIDES, aspect: '9:16' })
    renderCalls.length = 0
    uploadCalls.length = 0

    const second = await ensureRenderedSlides({ ...BASE, slides: first.slides, aspect: '9:16' })
    expect(second.changed).toBe(false)
    expect(renderCalls).toEqual([])
    expect(uploadCalls).toEqual([])
    expect(second.publishMediaUrls).toEqual([{ url: 'https://blob.example/slide-1.jpg', type: 'photo' }])
  })

  // The bug this PR fixes: publishPiece.js called ensureRenderedSlides with no
  // `aspect`, so the signature was recomputed as 4:5, missed the cached 9:16
  // bake, and silently re-rendered the whole deck at the wrong shape.
  it('re-bakes at 4:5 when the aspect is dropped — the divergence being fixed', async () => {
    const first = await ensureRenderedSlides({ ...BASE, slides: SLIDES, aspect: '9:16' })
    renderCalls.length = 0

    const republished = await ensureRenderedSlides({ ...BASE, slides: first.slides })
    expect(republished.changed).toBe(true)
    expect(renderCalls).toEqual([{ width: 1080, height: 1350 }])
    // …and the published URL is a different image than the approved one.
    expect(republished.slides[0].rendered_url).not.toBe(first.slides[0].rendered_url)
  })

  it('treats 1:1 as its own cache entry too', async () => {
    const square = await ensureRenderedSlides({ ...BASE, slides: SLIDES, aspect: '1:1' })
    expect(renderCalls).toEqual([{ width: 1080, height: 1080 }])
    renderCalls.length = 0
    const again = await ensureRenderedSlides({ ...BASE, slides: square.slides, aspect: '1:1' })
    expect(again.changed).toBe(false)
    expect(renderCalls).toEqual([])
  })
})
