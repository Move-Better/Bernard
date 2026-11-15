import { describe, it, expect } from 'vitest'
import { keyMatches, shapeItem, CATALOGUE_WORKSPACES } from '../api/_routes/media/catalogue.js'
import { mergeLibraryTags, libraryTagImage, imageMediaType, LIBRARY_TAGS } from '../api/_lib/libraryTags.js'

const KEY = 'k'.repeat(32)

describe('media catalogue key', () => {
  it('accepts the exact bearer key', () => expect(keyMatches(`Bearer ${KEY}`, KEY)).toBe(true))
  it('rejects wrong, missing, short or unset keys', () => {
    expect(keyMatches(`Bearer ${KEY}x`, KEY)).toBe(false)
    expect(keyMatches(undefined, KEY)).toBe(false)
    expect(keyMatches('Bearer short', 'short')).toBe(false)
    expect(keyMatches('Bearer ', undefined)).toBe(false)
  })
  it('is only open to Move Better', () => expect([...CATALOGUE_WORKSPACES]).toEqual(['movebetter']))
})

describe('shapeItem', () => {
  const staff = new Map([['s1', { id: 's1', name: 'Dr. Q' }]])
  it('prefers the web variant for photos and never exposes patient fields', () => {
    const item = shapeItem({ id: 'a', kind: 'photo', blob_url: 'o.jpg', web_blob_url: 'w.jpg', web_width: 2000, web_height: 1500,
      width: 4000, height: 3000, mime_type: 'image/jpeg', staff_id: 's1', tags: ['x'], ai_tags: ['x', 'hinge'],
      captured_at: '2024-04-12T10:00:00Z', patient_pseudonym: 'P1', consent_status: 'obtained' }, staff)
    expect(item.url).toBe('w.jpg')
    expect(item.mime).toBe('image/jpeg')
    expect([item.width, item.height]).toEqual([2000, 1500])
    expect(item.tags).toEqual(['x', 'hinge'])
    expect(item.people).toEqual([{ id: 's1', name: 'Dr. Q' }])
    expect(item.taken).toBe('2024-04-12')
    expect(JSON.stringify(item)).not.toContain('P1')
  })
  it('uses the rendered file and poster for video', () => {
    const item = shapeItem({ id: 'v', kind: 'video', blob_url: 'raw.mov', rendered_url: 'r.mp4', thumbnail_url: 't.jpg' })
    expect(item.url).toBe('r.mp4')
    expect(item.poster_url).toBe('t.jpg')
  })
})

describe('library tags', () => {
  it('merges without duplicates or removals', () => expect(mergeLibraryTags(['a', 'hinge'], ['hinge', 'brace'])).toEqual(['a', 'hinge', 'brace']))
  it('picks web variant, original, or video poster', () => {
    expect(libraryTagImage({ kind: 'photo', web_blob_url: 'w', blob_url: 'o' })).toBe('w')
    expect(libraryTagImage({ kind: 'photo', blob_url: 'o' })).toBe('o')
    expect(libraryTagImage({ kind: 'video', blob_url: 'o' })).toBe(null)
  })
  it('guesses media type from the extension', () => expect(imageMediaType('x/y.webp?z=1')).toBe('image/webp'))
  it('includes every website condition page', () => {
    for (const c of ['concussion-whiplash', 'foot-ankle', 'headaches-migraines', 'knee-pain', 'low-back-pain', 'prenatal-postpartum', 'shoulder-pain']) {
      expect(LIBRARY_TAGS).toContain(c)
    }
  })
})

import { webVideoStatus, webVideoArgs, MAX_WEB_VIDEO_SECONDS } from '../api/_lib/webVideo.js'

describe('web video', () => {
  it('reports status', () => {
    expect(webVideoStatus({ kind: 'photo' })).toBe('not_video')
    expect(webVideoStatus({ kind: 'video', web_blob_url: 'w.mp4' })).toBe('ready')
    expect(webVideoStatus({ kind: 'video', duration_s: MAX_WEB_VIDEO_SECONDS + 1 })).toBe('too_long')
    expect(webVideoStatus({ kind: 'video', duration_s: 30 })).toBe('needs_encode')
  })
  it('encodes H.264 + faststart and drops audio when none decodes', () => {
    const a = webVideoArgs({ inPath: 'i', outPath: 'o', audioMap: null })
    expect(a).toContain('libx264')
    expect(a).toContain('+faststart')
    expect(a).toContain('-an')
    expect(webVideoArgs({ inPath: 'i', outPath: 'o', audioMap: '0:1' })).toContain('0:1')
  })
  it('catalogue prefers the web MP4 for video', () => {
    const item = shapeItem({ id: 'v', kind: 'video', blob_url: 'raw.mov', rendered_url: 'r.mp4', web_blob_url: 'w.mp4', web_width: 1080, web_height: 1920 })
    expect(item.url).toBe('w.mp4')
    expect(item.web_ready).toBe(true)
    expect(item.mime).toBe('video/mp4')
    expect([item.width, item.height]).toEqual([1080, 1920])
  })
})
