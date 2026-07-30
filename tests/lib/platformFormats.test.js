import { describe, it, expect } from 'vitest'
import { FORMAT_IDS, formatOptions, formatMediaRule, validateFormatMedia } from '../../src/lib/platformFormats.js'

// media_urls entries as the normalizers write them (clipToMediaEntry /
// pickerItemToMediaEntry set both type and kind).
const PHOTO = { url: 'https://x/p.jpg', type: 'image', kind: 'image' }
const VIDEO = { url: 'https://x/v.mp4', type: 'video', kind: 'video' }

describe('formatOptions — which platforms get a format choice', () => {
  it('instagram offers post, carousel and reel', () => {
    expect(formatOptions('instagram')).toEqual(['post', 'carousel', 'reel'])
  })

  it('facebook offers post, reel and story — never a mixed carousel', () => {
    expect(formatOptions('facebook')).toEqual(['post', 'reel', 'story'])
    expect(formatMediaRule('facebook', 'carousel')).toBeNull()
  })

  it('single-format platforms return no choice at all (picker never renders)', () => {
    expect(formatOptions('linkedin')).toEqual([])
    expect(formatOptions('gbp')).toEqual([])
    expect(formatOptions('youtube')).toEqual([])
  })

  it('every registry format id is in the shared vocabulary', () => {
    for (const platform of ['instagram', 'instagram_story', 'facebook']) {
      for (const id of formatOptions(platform)) expect(FORMAT_IDS).toContain(id)
    }
  })
})

describe('validateFormatMedia — Instagram', () => {
  it('accepts a mixed photo+video carousel (the once-impossible case)', () => {
    expect(validateFormatMedia('instagram', 'carousel', [PHOTO, VIDEO])).toEqual({ ok: true })
  })

  it('accepts all-photo and all-video carousels alike', () => {
    expect(validateFormatMedia('instagram', 'carousel', [PHOTO, PHOTO]).ok).toBe(true)
    expect(validateFormatMedia('instagram', 'carousel', [VIDEO, VIDEO]).ok).toBe(true)
  })

  it('rejects a 1-item carousel and an 11-item carousel', () => {
    expect(validateFormatMedia('instagram', 'carousel', [PHOTO]))
      .toEqual({ ok: false, reason: 'too_few_items' })
    expect(validateFormatMedia('instagram', 'carousel', Array(11).fill(PHOTO)))
      .toEqual({ ok: false, reason: 'too_many_items' })
  })

  it('reel takes exactly one video — no photos, no seconds', () => {
    expect(validateFormatMedia('instagram', 'reel', [VIDEO])).toEqual({ ok: true })
    expect(validateFormatMedia('instagram', 'reel', [PHOTO]))
      .toEqual({ ok: false, reason: 'image_not_allowed' })
    expect(validateFormatMedia('instagram', 'reel', [VIDEO, VIDEO]))
      .toEqual({ ok: false, reason: 'too_many_items' })
  })

  it('post is photo-only — video intent routes through reel', () => {
    expect(validateFormatMedia('instagram', 'post', [PHOTO])).toEqual({ ok: true })
    expect(validateFormatMedia('instagram', 'post', [VIDEO]))
      .toEqual({ ok: false, reason: 'video_not_allowed' })
  })
})

describe('validateFormatMedia — Facebook', () => {
  it('rejects a mixed post ("must have only photos or only videos", verified live)', () => {
    expect(validateFormatMedia('facebook', 'post', [PHOTO, VIDEO]))
      .toEqual({ ok: false, reason: 'mixed_not_allowed' })
  })

  it('accepts all-photo albums, all-video sets, and text-only posts', () => {
    expect(validateFormatMedia('facebook', 'post', [PHOTO, PHOTO, PHOTO]).ok).toBe(true)
    expect(validateFormatMedia('facebook', 'post', [VIDEO, VIDEO]).ok).toBe(true)
    expect(validateFormatMedia('facebook', 'post', []).ok).toBe(true)
  })

  it('reel takes exactly one video', () => {
    expect(validateFormatMedia('facebook', 'reel', [VIDEO]).ok).toBe(true)
    expect(validateFormatMedia('facebook', 'reel', [PHOTO]))
      .toEqual({ ok: false, reason: 'image_not_allowed' })
  })
})

describe('validateFormatMedia — edges', () => {
  it('an unsupported platform+format pair is refused outright', () => {
    expect(validateFormatMedia('linkedin', 'carousel', [PHOTO, PHOTO]))
      .toEqual({ ok: false, reason: 'format_not_supported' })
  })

  it('url-less entries are ignored, not counted', () => {
    const broken = { type: 'image', kind: 'image' } // no url — never publishable
    expect(validateFormatMedia('instagram', 'carousel', [PHOTO, broken]))
      .toEqual({ ok: false, reason: 'too_few_items' })
  })
})
