import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { isHeicBuffer, isHeicMime, decodeBase, encodeVariant } from '../../api/_lib/imagePipeline.js'

// Helper — synthesize an ISO-BMFF "ftyp" box with the given major brand.
// Mirrors the first 12 bytes of a real HEIF/HEIC file. Anything beyond byte
// 12 is irrelevant to the detector.
function ftypBytes(brand) {
  const buf = Buffer.alloc(16)
  buf.writeUInt32BE(16, 0)          // box size
  buf.write('ftyp', 4, 4, 'ascii')  // box type
  buf.write(brand, 8, 4, 'ascii')   // major brand
  return buf
}

describe('isHeicMime', () => {
  it('matches the four HEIC/HEIF mime variants case-insensitively', () => {
    expect(isHeicMime('image/heic')).toBe(true)
    expect(isHeicMime('image/heif')).toBe(true)
    expect(isHeicMime('IMAGE/HEIC')).toBe(true)
    expect(isHeicMime('image/heic-sequence')).toBe(true)
    expect(isHeicMime('image/heif-sequence')).toBe(true)
  })

  it('returns false for browser-safe mimes and missing values', () => {
    expect(isHeicMime('image/jpeg')).toBe(false)
    expect(isHeicMime('image/png')).toBe(false)
    expect(isHeicMime('')).toBe(false)
    expect(isHeicMime(null)).toBe(false)
    expect(isHeicMime(undefined)).toBe(false)
  })
})

describe('isHeicBuffer', () => {
  it('matches all documented HEIC/HEIF major brands', () => {
    for (const brand of ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'heim', 'heis', 'hevm', 'hevs']) {
      expect(isHeicBuffer(ftypBytes(brand))).toBe(true)
    }
  })

  it('rejects non-HEIF brands and non-BMFF data', () => {
    // mp4 ftyp box — sanity check that the detector doesn't false-positive
    // on video files that share the same ftyp box structure.
    expect(isHeicBuffer(ftypBytes('isom'))).toBe(false)
    expect(isHeicBuffer(ftypBytes('mp42'))).toBe(false)
    // JPEG SOI marker
    expect(isHeicBuffer(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(false)
    // PNG magic
    expect(isHeicBuffer(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(false)
  })

  it('returns false for short or empty buffers', () => {
    expect(isHeicBuffer(null)).toBe(false)
    expect(isHeicBuffer(Buffer.alloc(0))).toBe(false)
    expect(isHeicBuffer(Buffer.alloc(8))).toBe(false)  // too short for brand
  })
})

// Integration smoke for the resize side of the pipeline — calls the actual
// decodeBase/encodeVariant functions processImageUpload uses (not a
// hand-copied parallel pipeline), so a real regression here fails the test.
describe('decodeBase/encodeVariant — the resize path used by processImageUpload', () => {
  it('web variant: produces a JPEG within the 2000px ceiling, thumbnail: within the 400px ceiling — from ONE decoded source', async () => {
    // 3000×1500 red rectangle — wider than both ceilings.
    const src = await sharp({
      create: { width: 3000, height: 1500, channels: 3, background: { r: 255, g: 0, b: 0 } },
    }).jpeg().toBuffer()

    const base = decodeBase(src)
    const web = await encodeVariant(base, { longEdge: 2000, mime: 'image/jpeg', quality: 80 })
    const thumb = await encodeVariant(base, { longEdge: 400, mime: 'image/jpeg', quality: 78 })

    expect(web.mime).toBe('image/jpeg')
    expect(web.width).toBe(2000)
    expect(web.height).toBe(1000)
    expect(web.buffer.length).toBeLessThan(src.length) // resize must shrink, not grow

    expect(thumb.mime).toBe('image/jpeg')
    expect(thumb.width).toBe(400)
    expect(thumb.height).toBe(200)
    expect(thumb.buffer.length).toBeLessThan(web.buffer.length) // thumbnail must be smaller than the web variant
  })

  it('preserves PNG transparency for the web variant; thumbnail is still forced JPEG', async () => {
    const src = await sharp({
      create: { width: 800, height: 600, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    }).png().toBuffer()

    const base = decodeBase(src)
    const web = await encodeVariant(base, { longEdge: 2000, mime: 'image/png', quality: 80 })
    const thumb = await encodeVariant(base, { longEdge: 400, mime: 'image/jpeg', quality: 78 })

    expect(web.mime).toBe('image/png')
    // withoutEnlargement keeps the smaller source untouched
    expect(web.width).toBe(800)
    expect(web.height).toBe(600)

    expect(thumb.mime).toBe('image/jpeg')
    expect(thumb.width).toBe(400)
    expect(thumb.height).toBe(300)
  })

  it('withoutEnlargement keeps a source smaller than the thumbnail ceiling untouched', async () => {
    const src = await sharp({
      create: { width: 200, height: 150, channels: 3, background: { r: 0, g: 128, b: 255 } },
    }).jpeg().toBuffer()

    const base = decodeBase(src)
    const thumb = await encodeVariant(base, { longEdge: 400, mime: 'image/jpeg', quality: 78 })

    expect(thumb.width).toBe(200)
    expect(thumb.height).toBe(150)
  })
})
