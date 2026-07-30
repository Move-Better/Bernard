import { describe, it, expect } from 'vitest'
import { mergePatchedContentRow } from '../../src/lib/queries.js'

// Regression guard for the caption-revert race (feedback d6b2b24d, movebetter).
//
// The SlideEditor fires INDEPENDENT content_items PATCHes for a caption edit
// ({content}) and a photo swap ({mediaUrls}) with no ordering guarantee. Every
// PATCH echoes the FULL row (select=*). If the photo-swap echo is read
// server-side before the caption commits, its `content` is the PRE-EDIT value.
// The old onSuccess wrote the whole echo into the detail cache, reverting the
// caption; CaptionPanel's re-seed effect then clobbered the textarea back to it.
//
// mergePatchedContentRow writes ONLY the columns the patch touched, so a
// media-only PATCH can never overwrite `content`.

const C0 = 'Long original — with an em-dash — and more writing.' // stale, generated
const C1 = 'Short human edit'                                    // what the user typed

describe('mergePatchedContentRow', () => {
  it('a photo-swap ({mediaUrls}) echo with STALE content does NOT revert the cached caption', () => {
    const prev = { id: 'x', content: C1, media_urls: [{ url: 'old.jpg' }], slides: ['a'] }
    // The concurrent media PATCH echoes the full row read BEFORE the caption
    // commit — so its content is the stale C0.
    const echo = { id: 'x', content: C0, media_urls: [{ url: 'new.jpg' }], slides: ['a'], updated_at: '2026-07-30T00:00:01Z' }
    const next = mergePatchedContentRow(prev, echo, { mediaUrls: [{ url: 'new.jpg' }] })
    expect(next.content).toBe(C1)                       // caption preserved
    expect(next.media_urls).toEqual([{ url: 'new.jpg' }]) // photo swap applied
    expect(next.updated_at).toBe('2026-07-30T00:00:01Z')
  })

  it('MUTATION: a naive whole-row replace WOULD have reverted the caption (proves the guard bites)', () => {
    const prev = { id: 'x', content: C1 }
    const echo = { id: 'x', content: C0, media_urls: [{ url: 'new.jpg' }] }
    // Old behavior: setQueryData(detail, echo) — the exact bug.
    expect(echo.content).toBe(C0)
    // New behavior keeps the edit.
    expect(mergePatchedContentRow(prev, echo, { mediaUrls: [] }).content).toBe(C1)
  })

  it('a caption PATCH ({content}) DOES apply the new caption (Regenerate/edit still works)', () => {
    const prev = { id: 'x', content: C0, media_urls: [{ url: 'p.jpg' }] }
    const echo = { id: 'x', content: C1, media_urls: [{ url: 'p.jpg' }] }
    const next = mergePatchedContentRow(prev, echo, { content: C1 })
    expect(next.content).toBe(C1)
  })

  it('a zoom/theme PATCH ({slides,photo_template_id,aspectRatio}) applies those, preserves content', () => {
    const prev = { id: 'x', content: C1, slides: ['old'], photo_template_id: 't1', aspect_ratio: '1:1' }
    const echo = { id: 'x', content: C0, slides: ['new'], photo_template_id: 't2', aspect_ratio: '4:5' }
    const next = mergePatchedContentRow(prev, echo, { slides: ['new'], photo_template_id: 't2', aspectRatio: '4:5' })
    expect(next.content).toBe(C1)          // aspectRatio → aspect_ratio mapping
    expect(next.slides).toEqual(['new'])
    expect(next.photo_template_id).toBe('t2')
    expect(next.aspect_ratio).toBe('4:5')
  })

  it('full race, both orderings converge: neither edit is lost', () => {
    // Start: user has typed C1 locally and blur has already set it in cache.
    let cache = { id: 'x', content: C1, media_urls: [{ url: 'old.jpg' }] }
    const captionEcho = { id: 'x', content: C1, media_urls: [{ url: 'old.jpg' }] } // stale media
    const mediaEcho   = { id: 'x', content: C0, media_urls: [{ url: 'new.jpg' }] } // stale content
    // Order A: media resolves last
    let a = mergePatchedContentRow(cache, captionEcho, { content: C1 })
    a = mergePatchedContentRow(a, mediaEcho, { mediaUrls: [{ url: 'new.jpg' }] })
    expect(a.content).toBe(C1)
    expect(a.media_urls).toEqual([{ url: 'new.jpg' }])
    // Order B: caption resolves last
    let b = mergePatchedContentRow(cache, mediaEcho, { mediaUrls: [{ url: 'new.jpg' }] })
    b = mergePatchedContentRow(b, captionEcho, { content: C1 })
    expect(b.content).toBe(C1)
    expect(b.media_urls).toEqual([{ url: 'new.jpg' }])
  })

  it('falls back to the echo when there is no prior cache', () => {
    const echo = { id: 'x', content: C1 }
    expect(mergePatchedContentRow(undefined, echo, { content: C1 })).toBe(echo)
  })
})
