import { describe, it, expect } from 'vitest'
import { slidePhotos, slidePhotoEntry } from '@/lib/mediaEntry'

const VIDEO   = { url: 'https://blob/clip.mp4', type: 'video', kind: 'video', mediaAssetId: 'v1' }
const PHOTO_A = { url: 'https://blob/a.jpg', type: 'image', kind: 'image', mediaAssetId: 'a' }
const PHOTO_B = { url: 'https://blob/b.jpg', type: 'image', kind: 'image', mediaAssetId: 'b' }
const NO_URL  = { type: 'image', kind: 'image', mediaAssetId: 'broken' }

describe('slidePhotos — the list photo_idx indexes into', () => {
  it('drops videos and url-less entries, preserving order', () => {
    expect(slidePhotos([VIDEO, PHOTO_A, NO_URL, PHOTO_B])).toEqual([PHOTO_A, PHOTO_B])
  })

  it('tolerates null/undefined input', () => {
    expect(slidePhotos(null)).toEqual([])
    expect(slidePhotos(undefined)).toEqual([])
    expect(slidePhotos([null, PHOTO_A])).toEqual([PHOTO_A])
  })

  // Guard on the numbering itself: widening the predicate to also exclude
  // `kind === 'video'` would renumber the filtered list, and every photo_idx
  // already stored on a content_items row is an index into THIS numbering.
  it('keys off `type` only — an entry marked kind:video but type:image still counts', () => {
    const odd = { url: 'https://blob/odd.jpg', type: 'image', kind: 'video' }
    expect(slidePhotos([odd, PHOTO_A])).toEqual([odd, PHOTO_A])
  })
})

describe('slidePhotoEntry — preview, editor and bake must resolve the same photo', () => {
  // The divergence this fixes: PostPreview indexed RAW media_urls while the
  // publish bake indexed the filtered list. With a video sitting first, slide 0
  // previewed the video entry and published photo A.
  it('resolves against the filtered list, not the raw array', () => {
    const media = [VIDEO, PHOTO_A, PHOTO_B]
    expect(slidePhotoEntry({ photo_idx: 0 }, media)).toBe(PHOTO_A)
    expect(slidePhotoEntry({ photo_idx: 1 }, media)).toBe(PHOTO_B)
    // …and specifically is NOT what indexing the raw array would have returned.
    expect(slidePhotoEntry({ photo_idx: 0 }, media)).not.toBe(media[0])
  })

  it('is unaffected when media_urls holds photos only (the common case)', () => {
    const media = [PHOTO_A, PHOTO_B]
    expect(slidePhotoEntry({ photo_idx: 0 }, media)).toBe(PHOTO_A)
    expect(slidePhotoEntry({ photo_idx: 1 }, media)).toBe(PHOTO_B)
  })

  it('returns null for an unbound slide or an out-of-range index', () => {
    expect(slidePhotoEntry({ photo_idx: null }, [PHOTO_A])).toBe(null)
    expect(slidePhotoEntry({}, [PHOTO_A])).toBe(null)
    expect(slidePhotoEntry({ photo_idx: 9 }, [PHOTO_A])).toBe(null)
    expect(slidePhotoEntry(null, [PHOTO_A])).toBe(null)
  })
})
