// The Beehiiv send must pick an image as the blog hero. It took
// media_urls[0] blindly, so a piece whose first entry was a video sent a
// video URL as heroImage (audit 2026-11-18, P2).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { firstPhotoUrl } from '../../src/lib/mediaEntry.js'

describe('firstPhotoUrl', () => {
  it('skips a leading video (by kind or by type)', () => {
    expect(firstPhotoUrl([
      { url: 'https://x/v.mp4', kind: 'video' },
      { url: 'https://x/w.mp4', type: 'video' },
      { url: 'https://x/p.jpg', type: 'photo' },
    ])).toBe('https://x/p.jpg')
  })
  it('returns undefined when there is no photo', () => {
    expect(firstPhotoUrl([{ url: 'https://x/v.mp4', kind: 'video' }])).toBeUndefined()
    expect(firstPhotoUrl(null)).toBeUndefined()
  })
})

describe('sendToBeehiiv uses it', () => {
  it('derives heroImage with firstPhotoUrl, not media_urls[0]', () => {
    const src = readFileSync(fileURLToPath(new URL('../../src/lib/useContentWorkflow.js', import.meta.url)), 'utf8')
    const send = src.slice(src.indexOf('const sendToBeehiiv'), src.indexOf('sendBlogToBeehiiv(payload)'))
    expect(send).toMatch(/heroImage = firstPhotoUrl\(piece\.media_urls\)/)
    expect(send).not.toMatch(/media_urls\[0\]/)
  })
})
