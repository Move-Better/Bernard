import { describe, it, expect } from 'vitest'
import {
  videoEditFingerprint,
  videoEditTarget,
  isVideoEditUnbaked,
  VIDEO_EDIT_HASH_KEY,
} from '../../src/lib/videoEditFingerprint.js'

// Behavioural tests for the unbaked-video-edit detector that keeps /week's
// inline Approve from dispatching a reel's PRE-EDIT render (the server-side
// half of feedback f46a0eec; #2638 fixed only the in-editor commit path).
//
// Watched-it-fail (mutation, one at a time, each reddens ≥1 case here):
//   - drop the key sort in canonicalJson            → key-order case fails
//   - sort arrays in canonicalJson                  → array-order case fails
//   - `return false` from isVideoEditUnbaked        → mismatch case fails
//   - `return true`  from isVideoEditUnbaked        → no-draft + match cases fail
//   - accept any archetype in videoEditTarget       → carousel case fails
//   - drop the mediaAssetId requirement             → no-asset case fails

const draft = () => ({
  format: 'reel',
  startSec: 12.5,
  endSec: 41,
  cuts: [{ start: 3, end: 4 }, { start: 9, end: 10 }],
  caption: { preset: 'karaoke', size: 'md', accent: '#0C7580' },
  overlays: [],
})

const reelPiece = (entry) => ({
  platform: 'instagram',
  format: 'reel',
  media_urls: [entry],
})

const videoEntry = (extra = {}) => ({
  url: 'https://blob/media/clips/baked.mp4',
  type: 'video',
  kind: 'video',
  mediaAssetId: '11111111-2222-3333-4444-555555555555',
  ...extra,
})

describe('videoEditFingerprint', () => {
  it('is stable across object key order — the jsonb round-trip', () => {
    // THE load-bearing case. The browser writes the draft; Postgres jsonb hands
    // it back with keys in its own order. A stringify-based comparison would
    // mismatch on every dispatch, permanently deferring every reel.
    const asWritten = { format: 'reel', startSec: 1, caption: { size: 'md', accent: '#fff' } }
    const asReadBack = { caption: { accent: '#fff', size: 'md' }, startSec: 1, format: 'reel' }
    expect(JSON.stringify(asWritten)).not.toBe(JSON.stringify(asReadBack)) // the trap is real
    expect(videoEditFingerprint(asWritten)).toBe(videoEditFingerprint(asReadBack))
  })

  it('is sensitive to array ORDER — position is meaningful in a draft', () => {
    // Overlay z-order / cut sequence / caption lines are all order-carrying, so
    // canonicalization must not sort them into agreement.
    const a = { overlays: [{ text: 'one' }, { text: 'two' }] }
    const b = { overlays: [{ text: 'two' }, { text: 'one' }] }
    expect(videoEditFingerprint(a)).not.toBe(videoEditFingerprint(b))
  })

  it('changes when any edited value changes', () => {
    const base = videoEditFingerprint(draft())
    expect(videoEditFingerprint({ ...draft(), endSec: 42 })).not.toBe(base)
    expect(videoEditFingerprint({ ...draft(), caption: { preset: 'off', size: 'md', accent: '#0C7580' } })).not.toBe(base)
    expect(videoEditFingerprint({ ...draft(), cuts: [] })).not.toBe(base)
  })

  it('survives a real JSON round-trip unchanged', () => {
    const doc = draft()
    expect(videoEditFingerprint(JSON.parse(JSON.stringify(doc)))).toBe(videoEditFingerprint(doc))
  })

  it('returns null for a missing or non-object draft', () => {
    for (const v of [null, undefined, '', 0, [], 'reel']) expect(videoEditFingerprint(v)).toBeNull()
  })

  it('carries a version prefix so a future encoding change reads as stale', () => {
    expect(videoEditFingerprint(draft())).toMatch(/^v1:/)
  })
})

describe('videoEditTarget — only pieces that actually open the VideoEditor', () => {
  it('finds the video entry on a reel', () => {
    const entry = videoEntry()
    const t = videoEditTarget(reelPiece(entry), 'vvideo')
    expect(t?.assetId).toBe(entry.mediaAssetId)
    expect(t?.entry).toBe(entry)
  })

  it('covers long-video pieces too', () => {
    expect(videoEditTarget(reelPiece(videoEntry()), 'lvideo')).not.toBeNull()
  })

  it('ignores a carousel that merely CONTAINS a clip', () => {
    // /publish/:id opens SlideEditor for these, which has no video bake — so
    // deferring one there would be a dead end for the operator, not a remedy.
    expect(videoEditTarget(reelPiece(videoEntry()), 'carousel')).toBeNull()
    expect(videoEditTarget(reelPiece(videoEntry()), 'visual')).toBeNull()
    expect(videoEditTarget(reelPiece(videoEntry()), 'story')).toBeNull()
  })

  it('ignores a video entry with no mediaAssetId', () => {
    // No asset ⇒ no video_edit_draft can exist ⇒ nothing to defer.
    const t = videoEditTarget(reelPiece({ url: 'https://blob/x.mp4', type: 'video' }), 'vvideo')
    expect(t).toBeNull()
  })

  it('ignores a photo-only piece and an empty media list', () => {
    expect(videoEditTarget({ platform: 'instagram', media_urls: [{ url: 'p.jpg', type: 'image' }] }, 'vvideo')).toBeNull()
    expect(videoEditTarget({ platform: 'instagram', media_urls: [] }, 'vvideo')).toBeNull()
    expect(videoEditTarget({ platform: 'instagram' }, 'vvideo')).toBeNull()
  })
})

describe('isVideoEditUnbaked — the dispatch decision', () => {
  it('NEVER-OPENED auto-reel dispatches untouched (no draft)', () => {
    // The kill-clock case: an auto-reel nobody edited must not gain a click.
    expect(isVideoEditUnbaked(videoEntry(), null)).toBe(false)
    expect(isVideoEditUnbaked(videoEntry(), undefined)).toBe(false)
  })

  it('a baked reel dispatches untouched (stamp matches the draft)', () => {
    const doc = draft()
    const entry = videoEntry({ [VIDEO_EDIT_HASH_KEY]: videoEditFingerprint(doc) })
    expect(isVideoEditUnbaked(entry, doc)).toBe(false)
    // …and still matches after the jsonb key-order shuffle it will really see.
    const shuffled = Object.fromEntries(Object.entries(doc).reverse())
    expect(isVideoEditUnbaked(entry, shuffled)).toBe(false)
  })

  it('DEFERS when the draft moved on after the bake', () => {
    const entry = videoEntry({ [VIDEO_EDIT_HASH_KEY]: videoEditFingerprint(draft()) })
    expect(isVideoEditUnbaked(entry, { ...draft(), endSec: 55 })).toBe(true)
  })

  it('DEFERS when a draft exists but nothing was ever baked', () => {
    // Opened-in-the-editor-and-left. Indistinguishable at this layer from a real
    // edit (the auto-reel was rendered from segment params, not a draft doc), so
    // it errs toward one extra click rather than a post that doesn't match.
    expect(isVideoEditUnbaked(videoEntry(), draft())).toBe(true)
  })

  it('DEFERS when the stamp was dropped by a later media rewrite', () => {
    // Swapping the video rewrites media_urls from scratch; the stamp goes with
    // the artifact it described, and its absence must read as "unproven".
    const entry = videoEntry({ [VIDEO_EDIT_HASH_KEY]: undefined })
    expect(isVideoEditUnbaked(entry, draft())).toBe(true)
  })

  it('does not treat a stale-format stamp as a match', () => {
    expect(isVideoEditUnbaked(videoEntry({ [VIDEO_EDIT_HASH_KEY]: 'v0:abc.def' }), draft())).toBe(true)
  })
})
