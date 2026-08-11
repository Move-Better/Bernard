import { describe, it, expect } from 'vitest'
import { resolveVideoEditSource, shouldUseSourceWindow } from '../../src/lib/videoEditSource.js'

// The invariant these lock: a caption-baked auto-reel (asset.source_clip present)
// is edited from its RAW un-captioned source + source window, never the baked blob
// — otherwise the editor re-captions an already-captioned clip (double karaoke in
// preview, double-baked track on save). feedback 2a1e68c0, 2026-08-10.

const bakedReel = {
  id: 'baked-clip-id',
  blob_url: 'https://blob/media/clips/baked.mp4',       // captions burned in
  transcript_words: [{ word: 'clip', start: 0, end: 1 }], // clip-local (0-based)
  source_clip: {
    assetId: 'raw-src-id',
    blobUrl: 'https://blob/media/raw/interview.mov',     // un-captioned
    startSec: 128,
    endSec: 136,
    transcriptWords: [{ word: 'src', start: 128, end: 129 }],
  },
}

const manualClip = {
  id: 'raw-upload-id',
  blob_url: 'https://blob/media/raw/upload.mov',
  transcript_words: [{ word: 'up', start: 0, end: 1 }],
  source_clip: null,
}

describe('resolveVideoEditSource', () => {
  it('a baked reel edits from the RAW source, not the baked blob', () => {
    const r = resolveVideoEditSource(bakedReel, bakedReel.id)
    // If any of these fell back to the baked clip, the editor would double-bake.
    expect(r.videoUrl).toBe('https://blob/media/raw/interview.mov')
    expect(r.assetId).toBe('raw-src-id')
    expect(r.transcriptWords).toBe(bakedReel.source_clip.transcriptWords)
    expect(r.videoUrl).not.toBe(bakedReel.blob_url)      // NOT the baked blob
    expect(r.assetId).not.toBe(bakedReel.id)             // NOT the baked clip id
    expect(r.window).toEqual({ startSec: 128, endSec: 136 })
  })

  it('a manual clip / raw upload edits from its OWN blob (no window)', () => {
    const r = resolveVideoEditSource(manualClip, manualClip.id)
    expect(r.videoUrl).toBe(manualClip.blob_url)
    expect(r.assetId).toBe(manualClip.id)
    expect(r.transcriptWords).toBe(manualClip.transcript_words)
    expect(r.window).toBeNull()
  })

  it('falls back to the baked blob when source_clip resolution failed (no crash)', () => {
    // Server omits source_clip on a lookup failure — prior behaviour (double
    // preview) beats a broken editor, so it must degrade, not throw.
    const r = resolveVideoEditSource({ ...bakedReel, source_clip: null }, 'baked-clip-id')
    expect(r.videoUrl).toBe(bakedReel.blob_url)
    expect(r.assetId).toBe('baked-clip-id')
    expect(r.window).toBeNull()
  })

  it('rejects a malformed window (end <= start) rather than trusting it', () => {
    const bad = { ...bakedReel, source_clip: { ...bakedReel.source_clip, endSec: 128 } }
    expect(resolveVideoEditSource(bad, bad.id).window).toBeNull()
  })

  it('tolerates a null asset', () => {
    const r = resolveVideoEditSource(null, 'x')
    expect(r).toEqual({ videoUrl: null, transcriptWords: null, assetId: 'x', window: null })
  })
})

describe('shouldUseSourceWindow', () => {
  const win = { startSec: 128, endSec: 136 }
  it('replaces a CLIP-relative draft trim (0 < 128 → true)', () => {
    expect(shouldUseSourceWindow(0, win)).toBe(true)
  })
  it('replaces when the draft has no trim yet (null → true)', () => {
    expect(shouldUseSourceWindow(null, win)).toBe(true)
  })
  it('PRESERVES a genuine source-relative re-trim (130 >= 128 → false)', () => {
    expect(shouldUseSourceWindow(130, win)).toBe(false)
    expect(shouldUseSourceWindow(128, win)).toBe(false)
  })
  it('is a no-op for a normal clip (no window → false)', () => {
    expect(shouldUseSourceWindow(0, null)).toBe(false)
    expect(shouldUseSourceWindow(null, null)).toBe(false)
  })
})
