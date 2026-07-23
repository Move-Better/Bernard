// media_urls entry ← media_assets.thumbnail_url write-back.
//
// media_urls is a snapshot: each entry carries its own thumbnailUrl, so a poster
// written after the draft was created leaves the entry stuck at null and every
// surface that reads it (the /week tile, StoryComposer) degrades to a placeholder.
// applyEntryThumbnail is the transform that brings a stale snapshot back in step.
//
// Fixtures are REAL media_urls arrays captured from prod (workspace movebetter,
// 2026-07-23) rather than invented shapes — the edge cases that matter here are
// exactly the ones real rows have drifted into, e.g. the published reel whose
// entry has no thumbnailUrl KEY at all rather than an explicit null.

import { describe, it, expect } from 'vitest'
import { applyEntryThumbnail } from '../../api/_lib/thumbnail.js'

const POSTER = 'https://blob.example/media/thumbs/ws/asset-new.jpg'

// Auto-drafted reel (piece c1807671) — thumbnailUrl explicitly null.
const REEL_NULL_THUMB = [{
  url: 'https://blob.example/media/clips/ws/src/seg-Melanie_Final_Cut.mp4',
  kind: 'video',
  name: 'Melanie_Final_Cut.mp4',
  type: 'video',
  duration_s: 25,
  mediaAssetId: 'eb336f26-5a7d-4ad6-a95e-2c6e2cda3a8c',
  thumbnailUrl: null,
}]

// Published reel (piece 2dae6eb3) — no thumbnailUrl KEY at all.
const REEL_ABSENT_THUMB = [{
  url: 'https://blob.example/media/renders/ws/asset/instagram_reel-IMG_5326.mp4',
  kind: 'video',
  type: 'video',
  mediaAssetId: 'b280d2c6-bd1c-4521-be9e-9875303015fe',
}]

// Multi-photo carousel (piece 3fdeba78) — every entry is an image whose
// thumbnailUrl is deliberately its own image URL or a thumbs/ blob.
const PHOTO_CAROUSEL = [
  {
    url: 'https://blob.example/media/raw/people/a.jpg',
    kind: 'image', type: 'image',
    mediaAssetId: '747e1d1f-5131-413b-8f19-732347b1150d',
    thumbnailUrl: 'https://blob.example/media/thumbs/747e1d1f.jpg',
  },
  {
    url: 'https://blob.example/media/web/b.jpg',
    kind: 'image', type: 'image',
    mediaAssetId: '2ede6503-3b0b-4cc2-8ba6-4bcd4d6228d7',
    thumbnailUrl: 'https://blob.example/media/web/b.jpg',
  },
]

describe('applyEntryThumbnail', () => {
  it('fills a null thumbnailUrl on the matching video entry', () => {
    const { changed, next } = applyEntryThumbnail(
      REEL_NULL_THUMB, 'eb336f26-5a7d-4ad6-a95e-2c6e2cda3a8c', POSTER,
    )
    expect(changed).toBe(true)
    expect(next[0].thumbnailUrl).toBe(POSTER)
  })

  it('fills an ABSENT thumbnailUrl key, not just an explicit null', () => {
    const { changed, next } = applyEntryThumbnail(
      REEL_ABSENT_THUMB, 'b280d2c6-bd1c-4521-be9e-9875303015fe', POSTER,
    )
    expect(changed).toBe(true)
    expect(next[0].thumbnailUrl).toBe(POSTER)
  })

  it('preserves every other field on the entry it rewrites', () => {
    const { next } = applyEntryThumbnail(
      REEL_NULL_THUMB, 'eb336f26-5a7d-4ad6-a95e-2c6e2cda3a8c', POSTER,
    )
    expect(next[0]).toEqual({ ...REEL_NULL_THUMB[0], thumbnailUrl: POSTER })
  })

  it('overwrites a STALE poster — the old blob is deleted on regen, so an entry left holding it would 404', () => {
    const stale = [{ ...REEL_NULL_THUMB[0], thumbnailUrl: 'https://blob.example/old-deleted.jpg' }]
    const { changed, next } = applyEntryThumbnail(
      stale, 'eb336f26-5a7d-4ad6-a95e-2c6e2cda3a8c', POSTER,
    )
    expect(changed).toBe(true)
    expect(next[0].thumbnailUrl).toBe(POSTER)
  })

  it('reports no change when the poster already matches (avoids a pointless PATCH)', () => {
    const already = [{ ...REEL_NULL_THUMB[0], thumbnailUrl: POSTER }]
    const { changed } = applyEntryThumbnail(
      already, 'eb336f26-5a7d-4ad6-a95e-2c6e2cda3a8c', POSTER,
    )
    expect(changed).toBe(false)
  })

  it('never touches photo entries — their thumbnailUrl is the image itself', () => {
    const { changed, next } = applyEntryThumbnail(
      PHOTO_CAROUSEL, '747e1d1f-5131-413b-8f19-732347b1150d', POSTER,
    )
    expect(changed).toBe(false)
    expect(next).toEqual(PHOTO_CAROUSEL)
  })

  it('leaves sibling entries in a mixed array untouched', () => {
    const mixed = [...PHOTO_CAROUSEL, ...REEL_NULL_THUMB]
    const { next } = applyEntryThumbnail(
      mixed, 'eb336f26-5a7d-4ad6-a95e-2c6e2cda3a8c', POSTER,
    )
    expect(next.slice(0, 2)).toEqual(PHOTO_CAROUSEL)
    expect(next[2].thumbnailUrl).toBe(POSTER)
  })

  it('is a no-op when no entry matches the asset id', () => {
    const { changed, next } = applyEntryThumbnail(REEL_NULL_THUMB, 'ffffffff-0000-0000-0000-000000000000', POSTER)
    expect(changed).toBe(false)
    expect(next).toEqual(REEL_NULL_THUMB)
  })

  it('tolerates a non-array / null media_urls without throwing', () => {
    expect(applyEntryThumbnail(null, 'eb336f26-5a7d-4ad6-a95e-2c6e2cda3a8c', POSTER)).toEqual({ changed: false, next: [] })
    expect(applyEntryThumbnail([null], 'eb336f26-5a7d-4ad6-a95e-2c6e2cda3a8c', POSTER).changed).toBe(false)
  })
})
