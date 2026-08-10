import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prepareRenderTarget, loadImage, clearImageCache } from '@/lib/overlayTemplates'

// These two guard the fix for the per-keystroke full-screen flash in the slide
// editor (feedback 204706b2, movebetter, 2026-08-10).
//
// The renderer wipes the target canvas and only THEN awaits the photo. If that
// wait crosses a task boundary the browser paints the blank bitmap — once per
// keystroke. The fix has two halves, and each is easy to silently undo later:
//   1. prepareRenderTarget must NOT reassign width/height when the size already
//      matches (reassigning reallocates a ~5.8MB bitmap every keystroke).
//   2. loadImage must serve a decoded image from cache, so a warm re-render
//      resolves on a microtask and no blank frame can be painted at all.

// Minimal canvas stand-in that records every width/height assignment.
function fakeCanvas(w, h) {
  const calls = { widthSets: 0, heightSets: 0, reset: 0, clearRect: 0 }
  const ctx = {
    reset() { calls.reset++ },
    clearRect() { calls.clearRect++ },
    setTransform() {}, setLineDash() {},
  }
  const target = {
    getContext: () => ctx,
    get width() { return w },
    set width(v) { calls.widthSets++; w = v },
    get height() { return h },
    set height(v) { calls.heightSets++; h = v },
  }
  return { target, ctx, calls }
}

describe('prepareRenderTarget', () => {
  it('reassigns width/height when the size differs (fresh or resized canvas)', () => {
    const { target, calls } = fakeCanvas(300, 150) // browser default canvas size
    prepareRenderTarget(target, 1080, 1350)
    expect(calls.widthSets).toBe(1)
    expect(calls.heightSets).toBe(1)
    expect(target.width).toBe(1080)
    expect(target.height).toBe(1350)
  })

  it('does NOT reassign width/height when the size already matches', () => {
    // This is the flash fix. Assigning width/height wipes the bitmap to
    // transparent even when the value is unchanged; the renderer then awaits
    // before drawing, so the browser can paint that blank canvas.
    const { target, calls } = fakeCanvas(1080, 1350)
    prepareRenderTarget(target, 1080, 1350)
    expect(calls.widthSets).toBe(0)
    expect(calls.heightSets).toBe(0)
  })

  it('still clears the reused canvas, so no ghost of the previous slide remains', () => {
    // Not every theme's structure provably covers 100% of the canvas, so the
    // bitmap must be cleared even though it is not reallocated.
    const { target, calls } = fakeCanvas(1080, 1350)
    prepareRenderTarget(target, 1080, 1350)
    expect(calls.reset).toBe(1)
  })

  it('falls back to an explicit state reset + clearRect when ctx.reset is absent', () => {
    const { target, ctx, calls } = fakeCanvas(1080, 1350)
    delete ctx.reset
    prepareRenderTarget(target, 1080, 1350)
    expect(calls.widthSets).toBe(0)
    expect(calls.clearRect).toBe(1)
    // The defaults a resize would have restored.
    expect(ctx.globalAlpha).toBe(1)
    expect(ctx.filter).toBe('none')
    expect(ctx.textAlign).toBe('start')
    expect(ctx.textBaseline).toBe('alphabetic')
    expect(ctx.shadowBlur).toBe(0)
  })

  it('only sizes down to matching dims once — a second call is a no-op resize', () => {
    const { target, calls } = fakeCanvas(300, 150)
    prepareRenderTarget(target, 1080, 1350)
    prepareRenderTarget(target, 1080, 1350)
    expect(calls.widthSets).toBe(1) // not 2
  })
})

// ── loadImage decode cache ───────────────────────────────────────────────────

let built
class StubImage {
  constructor() {
    built.push(this)
    this.naturalWidth = 100
    this.naturalHeight = 100
    this._src = ''
  }
  get src() { return this._src }
  set src(v) {
    this._src = v
    // Resolve on a macrotask, like a real decode.
    setTimeout(() => {
      if (String(v).includes('broken')) this.onerror(new Error('load failed'))
      else this.onload()
    }, 0)
  }
}

describe('loadImage decode cache', () => {
  beforeEach(() => {
    built = []
    clearImageCache()
    globalThis.window = { Image: StubImage }
  })
  afterEach(() => { clearImageCache(); delete globalThis.window })

  it('decodes a given URL once and reuses it (the per-keystroke re-render)', async () => {
    const a = await loadImage('https://blob/photo-a.jpg')
    const b = await loadImage('https://blob/photo-a.jpg')
    expect(built.length).toBe(1)
    expect(b).toBe(a)
  })

  it('resolves a warm hit without yielding to the task queue', async () => {
    // The whole point: a cached hit must settle on a microtask, so the renderer
    // never gives the browser a chance to paint the wiped canvas.
    await loadImage('https://blob/photo-a.jpg')
    let macroRan = false
    const t = setTimeout(() => { macroRan = true }, 0)
    await loadImage('https://blob/photo-a.jpg')
    clearTimeout(t)
    expect(macroRan).toBe(false)
  })

  it('never serves a cached bitmap for a different URL (photo swap)', async () => {
    const a = await loadImage('https://blob/photo-a.jpg')
    const b = await loadImage('https://blob/photo-b.jpg')
    expect(b).not.toBe(a)
    expect(built.length).toBe(2)
    expect(a.src).toBe('https://blob/photo-a.jpg')
    expect(b.src).toBe('https://blob/photo-b.jpg')
  })

  it('shares one in-flight load between concurrent callers', async () => {
    const [x, y] = await Promise.all([
      loadImage('https://blob/photo-a.jpg'),
      loadImage('https://blob/photo-a.jpg'),
    ])
    expect(built.length).toBe(1)
    expect(x).toBe(y)
  })

  it('evicts a failed load so a transient error is retried, not remembered', async () => {
    await expect(loadImage('https://blob/broken.jpg')).rejects.toBeTruthy()
    await expect(loadImage('https://blob/broken.jpg')).rejects.toBeTruthy()
    expect(built.length).toBe(2) // retried rather than replaying the cached failure
  })

  it('bounds the cache so a long editing session cannot grow it without limit', async () => {
    for (let i = 0; i < 40; i++) await loadImage(`https://blob/p${i}.jpg`)
    // Re-requesting the oldest URL must rebuild it (it was evicted)…
    const before = built.length
    await loadImage('https://blob/p0.jpg')
    expect(built.length).toBe(before + 1)
    // …while the most recent is still served from cache.
    const after = built.length
    await loadImage('https://blob/p39.jpg')
    expect(built.length).toBe(after)
  })
})
