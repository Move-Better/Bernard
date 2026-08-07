import { describe, it, expect } from 'vitest'
import { FORMAT_IDS, formatOptions, formatMediaRule, validateFormatMedia, describeFormatViolation, promoteFormatForMedia } from '../../src/lib/platformFormats.js'

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

describe('describeFormatViolation — the human "why + fix" copy (feedback 14ba3329)', () => {
  it('names the count and suggests Carousel for an IG Post with 6 photos', () => {
    const v = describeFormatViolation('instagram', 'post', Array(6).fill(PHOTO))
    expect(v.reason).toBe('too_many_items')
    expect(v.message).toContain('Instagram')
    expect(v.message).toContain('6 photos')
    expect(v.message).toContain('Carousel')
  })

  it('returns null for a valid format+media pair (nothing to block)', () => {
    expect(describeFormatViolation('instagram', 'carousel', [PHOTO, PHOTO])).toBeNull()
  })

  it('returns null when the piece has no explicit format (legacy derived behaviour)', () => {
    expect(describeFormatViolation('instagram', null, Array(6).fill(PHOTO))).toBeNull()
  })

  it('returns null on a platform with no format registry, even if a format leaked onto the row', () => {
    // linkedin has no format choice — 'post' is a no-op field there, must NOT block.
    expect(describeFormatViolation('linkedin', 'post', [PHOTO, PHOTO])).toBeNull()
  })

  it('explains a Facebook mixed album and omits a suggestion when no other format fits', () => {
    const v = describeFormatViolation('facebook', 'post', [PHOTO, VIDEO])
    expect(v.reason).toBe('mixed_not_allowed')
    expect(v.message).toContain('Facebook')
    // No facebook format accepts a photo+video pair, so no "Switch to …" is offered.
    expect(v.message).not.toContain('Switch the format')
  })

  it('tells a Reel it can’t carry a photo', () => {
    const v = describeFormatViolation('instagram', 'reel', [PHOTO])
    expect(v.reason).toBe('image_not_allowed')
    expect(v.message).toContain('can’t carry')
  })
})

describe('promoteFormatForMedia — the root-cause auto-promote (so the bad state never arises)', () => {
  it('promotes an IG Post to Carousel the moment it holds more than one photo', () => {
    expect(promoteFormatForMedia('instagram', 'post', Array(6).fill(PHOTO))).toBe('carousel')
    expect(promoteFormatForMedia('instagram', 'post', [PHOTO, PHOTO])).toBe('carousel')
  })

  it('leaves a still-valid format untouched (returns it by identity)', () => {
    expect(promoteFormatForMedia('instagram', 'post', [PHOTO])).toBe('post')
    expect(promoteFormatForMedia('instagram', 'carousel', [PHOTO, PHOTO, PHOTO])).toBe('carousel')
  })

  it('does NOT promote when no strictly-valid larger format exists (11 photos > carousel max 10)', () => {
    expect(promoteFormatForMedia('instagram', 'post', Array(11).fill(PHOTO))).toBe('post')
  })

  it('does NOT rewrite a KIND mismatch — a video on a photo Post stays Post (block handles it)', () => {
    expect(promoteFormatForMedia('instagram', 'post', [VIDEO])).toBe('post')
  })

  it('does NOT demote — a Carousel trimmed to one photo stays a Carousel', () => {
    expect(promoteFormatForMedia('instagram', 'carousel', [PHOTO])).toBe('carousel')
  })

  it('is a no-op with no explicit format or on a platform with no format registry', () => {
    expect(promoteFormatForMedia('instagram', null, Array(6).fill(PHOTO))).toBeNull()
    expect(promoteFormatForMedia('linkedin', 'post', [PHOTO, PHOTO])).toBe('post')
  })

  it('a Facebook Post that overflows has no larger album format, so it stays put', () => {
    expect(promoteFormatForMedia('facebook', 'post', Array(11).fill(PHOTO))).toBe('post')
  })
})
