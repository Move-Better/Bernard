import { describe, it, expect } from 'vitest'
import { clipToMediaEntry, pickerItemToMediaEntry } from '../../src/lib/mediaEntry.js'

// GUARD — a photo entry's thumbnailUrl must be null, not the full-resolution
// url, when no real thumbnail exists yet. It used to default to `url` ("a
// photo entry's thumbnailUrl is just its own url"), which meant every
// small-tile consumer (e.g. /week's Day-view cards, YourWeek.jsx) decoded a
// multi-MB DSLR original into a 40-64px box (see week-summary.js thumbOf,
// PR #2318). null is what the video branch already did — this makes photos
// consistent with it, and every small-tile consumer already falls back to
// the real source (photoSourceUrl(entry) || entry.url) when thumbnailUrl is
// falsy, so a null here degrades gracefully rather than blanking anything.

describe('clipToMediaEntry — thumbnailUrl defaults to null, not url', () => {
  it('carries a real thumbnailUrl through untouched, for a photo', () => {
    const entry = clipToMediaEntry({ kind: 'photo', blobUrl: 'https://blob/raw/photo.jpg', thumbnailUrl: 'https://blob/thumbs/photo.jpg', assetId: 'a1' })
    expect(entry.thumbnailUrl).toBe('https://blob/thumbs/photo.jpg')
    expect(entry.url).toBe('https://blob/raw/photo.jpg')
  })

  it('defaults a photo with no thumbnail to null, not the full-res url', () => {
    const entry = clipToMediaEntry({ kind: 'photo', blobUrl: 'https://blob/raw/photo.jpg', assetId: 'a1' })
    expect(entry.thumbnailUrl).toBeNull()
    expect(entry.url).toBe('https://blob/raw/photo.jpg')
  })

  it('still defaults a video with no poster to null (unchanged behavior)', () => {
    const entry = clipToMediaEntry({ kind: 'video', blobUrl: 'https://blob/raw/clip.mp4', assetId: 'a1' })
    expect(entry.thumbnailUrl).toBeNull()
  })

  it('carries a real poster through untouched, for a video', () => {
    const entry = clipToMediaEntry({ kind: 'video', blobUrl: 'https://blob/raw/clip.mp4', thumbnailUrl: 'https://blob/thumbs/clip-poster.jpg', assetId: 'a1' })
    expect(entry.thumbnailUrl).toBe('https://blob/thumbs/clip-poster.jpg')
  })
})

describe('pickerItemToMediaEntry — thumbnailUrl defaults to null, not url', () => {
  it('carries a real thumbnail_url through untouched, for a photo asset', () => {
    const entry = pickerItemToMediaEntry({ kind: 'photo', blob_url: 'https://blob/raw/photo.jpg', thumbnail_url: 'https://blob/thumbs/photo.jpg', id: 'a1' })
    expect(entry.thumbnailUrl).toBe('https://blob/thumbs/photo.jpg')
  })

  it('defaults a photo asset with no thumbnail to null, not the full-res url', () => {
    const entry = pickerItemToMediaEntry({ kind: 'photo', blob_url: 'https://blob/raw/photo.jpg', id: 'a1' })
    expect(entry.thumbnailUrl).toBeNull()
    expect(entry.url).toBe('https://blob/raw/photo.jpg')
  })

  it('prefers rendered_url over blob_url for a composed asset, thumbnailUrl still independent', () => {
    const entry = pickerItemToMediaEntry({ kind: 'photo', rendered_url: 'https://blob/web/composed.jpg', blob_url: 'https://blob/raw/photo.jpg', id: 'a1' })
    expect(entry.url).toBe('https://blob/web/composed.jpg')
    expect(entry.thumbnailUrl).toBeNull()
  })

  it('still defaults a video asset with no poster to null (unchanged behavior)', () => {
    const entry = pickerItemToMediaEntry({ kind: 'video', blob_url: 'https://blob/raw/clip.mp4', id: 'a1' })
    expect(entry.thumbnailUrl).toBeNull()
  })
})
