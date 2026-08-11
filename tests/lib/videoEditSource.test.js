import { describe, it, expect } from 'vitest'
import { resolveVideoEditSource, shouldUseSourceWindow, isRenderedClipUrl } from '../../src/lib/videoEditSource.js'

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

// A manually-exported broll re-attached to a post: a rendered OUTPUT
// (media/renders or media/clips) with captions burned in, and NO source_clip
// (manual export records no source window). Editing it from its own blob would
// double-bake, so captions must lock.
const bakedBrollNoSource = {
  id: 'baked-broll-id',
  blob_url: 'https://blob/media/renders/ws/asset/instagram_reel-clip.mp4',
  transcript_words: [{ word: 'x', start: 0, end: 1 }],
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
    expect(r).toEqual({ videoUrl: null, transcriptWords: null, assetId: 'x', window: null, captionsBaked: false })
  })
})

describe('captionsBaked fallback (manual broll gap)', () => {
  it('LOCKS captions for a baked broll with no clean source', () => {
    const r = resolveVideoEditSource(bakedBrollNoSource, bakedBrollNoSource.id)
    // No window (edits from its own blob) AND the blob is a rendered output.
    expect(r.captionsBaked).toBe(true)
    expect(r.videoUrl).toBe(bakedBrollNoSource.blob_url)
    expect(r.assetId).toBe(bakedBrollNoSource.id)
    expect(r.window).toBeNull()
  })

  it('does NOT lock an auto-reel — it has a clean raw source instead', () => {
    // The primary path wins: source_clip resolves a media/raw source + window,
    // so captions stay editable and are never locked.
    expect(resolveVideoEditSource(bakedReel, bakedReel.id).captionsBaked).toBe(false)
  })

  it('does NOT lock a raw upload (media/raw is un-captioned)', () => {
    expect(resolveVideoEditSource(manualClip, manualClip.id).captionsBaked).toBe(false)
  })

  it('isRenderedClipUrl distinguishes baked outputs from raw uploads', () => {
    expect(isRenderedClipUrl('https://blob/media/clips/a/b/c.mp4')).toBe(true)
    expect(isRenderedClipUrl('https://blob/media/renders/a/b/c.mp4')).toBe(true)
    expect(isRenderedClipUrl('https://blob/media/raw/x.mov')).toBe(false)
    expect(isRenderedClipUrl('https://blob/media/capture/x.mp4')).toBe(false)
    expect(isRenderedClipUrl(null)).toBe(false)
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
