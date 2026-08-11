// Pure-logic coverage for the reel-render throughput fix (2026-08-11).
// generateRenderProxy's actual IO (ffmpeg, network, Blob) is not unit-tested
// here — same as acquireSourceFile/renderVideoChannel in brandRenderVideo.js,
// which carry no test file either. Verified live instead (PR description).
import { describe, it, expect } from 'vitest'
import { shouldGenerateRenderProxy, resolveRenderSourceUrl } from '../../api/_lib/videoRenderProxy.js'
import { MAX_VIDEO_BYTES } from '../../api/_lib/brandRenderVideo.js'

const videoAsset = (overrides = {}) => ({
  id: 'a1', kind: 'video', blob_url: 'https://blob/orig.mp4',
  size_bytes: MAX_VIDEO_BYTES + 1, render_proxy_url: null,
  ...overrides,
})

describe('shouldGenerateRenderProxy', () => {
  it('true for a large video with no existing proxy', () => {
    expect(shouldGenerateRenderProxy(videoAsset())).toBe(true)
  })

  it('false once a proxy already exists', () => {
    expect(shouldGenerateRenderProxy(videoAsset({ render_proxy_url: 'https://blob/proxy.mp4' }))).toBe(false)
  })

  it('false for a source already at or under the threshold', () => {
    expect(shouldGenerateRenderProxy(videoAsset({ size_bytes: MAX_VIDEO_BYTES }))).toBe(false)
    expect(shouldGenerateRenderProxy(videoAsset({ size_bytes: 100 }))).toBe(false)
  })

  it('true for an unknown size (0) — mirrors acquireSourceFile treating unknown as large', () => {
    expect(shouldGenerateRenderProxy(videoAsset({ size_bytes: 0 }))).toBe(true)
    expect(shouldGenerateRenderProxy(videoAsset({ size_bytes: null }))).toBe(true)
  })

  it('false for a non-video asset regardless of size', () => {
    expect(shouldGenerateRenderProxy(videoAsset({ kind: 'photo' }))).toBe(false)
  })

  it('false for a missing/null asset', () => {
    expect(shouldGenerateRenderProxy(null)).toBe(false)
    expect(shouldGenerateRenderProxy(undefined)).toBe(false)
  })
})

describe('resolveRenderSourceUrl', () => {
  it('prefers the proxy when one exists', () => {
    const a = videoAsset({ render_proxy_url: 'https://blob/proxy.mp4' })
    expect(resolveRenderSourceUrl(a)).toBe('https://blob/proxy.mp4')
  })

  it('falls back to the original when no proxy exists', () => {
    expect(resolveRenderSourceUrl(videoAsset())).toBe('https://blob/orig.mp4')
  })

  it('null for a missing asset, not a throw', () => {
    expect(resolveRenderSourceUrl(null)).toBe(null)
    expect(resolveRenderSourceUrl(undefined)).toBe(null)
  })
})

// Regression net for the write-only-column trap this codebase has hit
// before (#2467/#2468): a SELECT that omits a column a writer depends on is
// silently inert, not broken-loud. Both real callers of renderSegmentToReel
// must select render_proxy_url and size_bytes on the joined source asset, or
// ensureRenderProxy always sees `undefined` and regenerates a proxy on every
// single render instead of ever reusing one — defeats the whole PR with zero
// visible symptom.
describe('render_proxy_url is selected everywhere renderSegmentToReel is called from', () => {
  it('reelFactory.js selectReelCandidates includes render_proxy_url + size_bytes', async () => {
    const fs = await import('node:fs/promises')
    const src = await fs.readFile(new URL('../../api/_lib/reelFactory.js', import.meta.url), 'utf8')
    const m = src.match(/source_asset:media_assets![^`]*`/)
    expect(m, 'source_asset select not found — did the query shape change?').toBeTruthy()
    expect(m[0]).toContain('render_proxy_url')
    expect(m[0]).toContain('size_bytes')
  })

  it('render-segments.js (the manual trigger) includes render_proxy_url + size_bytes', async () => {
    const fs = await import('node:fs/promises')
    const src = await fs.readFile(new URL('../../api/editorial/render-segments.js', import.meta.url), 'utf8')
    const m = src.match(/source_asset:media_assets![^`]*`/)
    expect(m, 'source_asset select not found — did the query shape change?').toBeTruthy()
    expect(m[0]).toContain('render_proxy_url')
    expect(m[0]).toContain('size_bytes')
  })
})
