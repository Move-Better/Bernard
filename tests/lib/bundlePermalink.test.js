import { describe, it, expect } from 'vitest'
import { bundlePermalink } from '../../api/_lib/social/bundlePublisher.js'

// Shape taken from the installed SDK's PostGetResponse type (bundlesocial@2.55.0)
// — which is also exactly what the `post.published` webhook delivers as its
// `data`, so the receipt costs no extra API call.
const POSTED_IG = {
  id: 'post_1',
  status: 'POSTED',
  postedDate: '2026-07-21T18:00:00.000Z',
  externalData: {
    INSTAGRAM: { id: '178..', permalink: 'https://www.instagram.com/p/ABC123/', thumbnail: 'https://cdn/t.jpg' },
  },
}

describe('bundlePermalink — the publish receipt', () => {
  it('pulls the network permalink out of a POSTED payload', () => {
    expect(bundlePermalink(POSTED_IG, 'instagram')).toBe('https://www.instagram.com/p/ABC123/')
  })

  it('maps a Bernard platform id to the bundle type key', () => {
    const fb = { externalData: { FACEBOOK: { permalink: 'https://facebook.com/1/posts/2' } } }
    expect(bundlePermalink(fb, 'facebook')).toBe('https://facebook.com/1/posts/2')
    // instagram_story shares the INSTAGRAM key
    const story = { externalData: { INSTAGRAM: { permalink: 'https://instagram.com/stories/x/1' } } }
    expect(bundlePermalink(story, 'instagram_story')).toBe('https://instagram.com/stories/x/1')
  })

  it('falls back to whatever platform is present when none is named', () => {
    expect(bundlePermalink(POSTED_IG)).toBe('https://www.instagram.com/p/ABC123/')
  })

  it('prefers the requested platform when several are present', () => {
    const multi = {
      externalData: {
        FACEBOOK:  { permalink: 'https://facebook.com/p/1' },
        INSTAGRAM: { permalink: 'https://instagram.com/p/2' },
      },
    }
    expect(bundlePermalink(multi, 'instagram')).toBe('https://instagram.com/p/2')
    expect(bundlePermalink(multi, 'facebook')).toBe('https://facebook.com/p/1')
  })

  it('returns null rather than a junk value when there is no permalink yet', () => {
    expect(bundlePermalink(null)).toBe(null)
    expect(bundlePermalink({})).toBe(null)
    expect(bundlePermalink({ externalData: null })).toBe(null)
    expect(bundlePermalink({ externalData: { INSTAGRAM: {} } })).toBe(null)
    expect(bundlePermalink({ externalData: { INSTAGRAM: { permalink: null } } })).toBe(null)
  })

  // The value is rendered straight into an href and is also read by the
  // website-health checker, so a relative or javascript: string must not pass.
  it('rejects anything that is not an absolute http(s) URL', () => {
    expect(bundlePermalink({ externalData: { INSTAGRAM: { permalink: '/p/ABC' } } })).toBe(null)
    expect(bundlePermalink({ externalData: { INSTAGRAM: { permalink: 'javascript:alert(1)' } } })).toBe(null)
    expect(bundlePermalink({ externalData: { INSTAGRAM: { permalink: 42 } } })).toBe(null)
  })

  it('skips a platform entry with no usable URL and keeps looking', () => {
    const mixed = {
      externalData: {
        TIKTOK:    { permalink: null },
        INSTAGRAM: { permalink: 'https://instagram.com/p/real' },
      },
    }
    expect(bundlePermalink(mixed)).toBe('https://instagram.com/p/real')
  })
})
