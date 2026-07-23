import { describe, it, expect } from 'vitest'
import { selectCoverEntry } from '../../api/_lib/social/bundlePublisher.js'

// media_urls entries as content_items actually stores them.
const VIDEO_ENTRY = { type: 'video', url: 'https://blob/raw/clip.mp4', thumbnailUrl: 'https://blob/thumbs/clip-poster.jpg' }
const VIDEO_NO_POSTER = { type: 'video', url: 'https://blob/raw/clip2.mp4', thumbnailUrl: null }
// A photo whose thumbnailUrl genuinely differs from its url (the normal,
// correct shape after PR #2318 — a real generated thumbnail).
const PHOTO_WITH_REAL_THUMB = { type: 'image', url: 'https://blob/raw/photo.jpg', thumbnailUrl: 'https://blob/thumbs/photo-thumb.jpg' }
// A photo with no thumbnail yet, still carrying its own url as thumbnailUrl
// (the mediaEntry.js fallback shape).
const PHOTO_NO_THUMB = { type: 'image', url: 'https://blob/raw/photo2.jpg', thumbnailUrl: 'https://blob/raw/photo2.jpg' }

describe('selectCoverEntry — picks the video poster, never a photo', () => {
  it('finds the video entry and returns it', () => {
    expect(selectCoverEntry([VIDEO_ENTRY])).toBe(VIDEO_ENTRY)
  })

  it('returns null when the only video entry has no poster yet', () => {
    expect(selectCoverEntry([VIDEO_NO_POSTER])).toBeNull()
  })

  it('returns null for photos only, and for no media at all', () => {
    expect(selectCoverEntry([PHOTO_WITH_REAL_THUMB])).toBeNull()
    expect(selectCoverEntry([])).toBeNull()
    expect(selectCoverEntry(undefined)).toBeNull()
  })

  // The regression this guards: a photo entry with a REAL thumbnailUrl (one
  // that differs from its own url) placed before a video entry must never be
  // mistaken for the video's cover — that was possible under the old
  // `thumbnailUrl !== url` check, and became a live risk once photos started
  // carrying real (non-self) thumbnails.
  it('skips a real-thumbnail photo ahead of the video and picks the video', () => {
    const entry = selectCoverEntry([PHOTO_WITH_REAL_THUMB, VIDEO_ENTRY])
    expect(entry).toBe(VIDEO_ENTRY)
  })

  it('skips a self-thumbnail photo ahead of the video and picks the video', () => {
    const entry = selectCoverEntry([PHOTO_NO_THUMB, VIDEO_ENTRY])
    expect(entry).toBe(VIDEO_ENTRY)
  })

  it('ignores kind-tagged video entries the same as type-tagged ones', () => {
    const kindOnly = { kind: 'video', url: 'https://blob/raw/clip3.mp4', thumbnailUrl: 'https://blob/thumbs/clip3-poster.jpg' }
    expect(selectCoverEntry([kindOnly])).toBe(kindOnly)
  })

  it('skips a null/undefined entry in the array without throwing', () => {
    expect(selectCoverEntry([null, undefined, VIDEO_ENTRY])).toBe(VIDEO_ENTRY)
  })
})
