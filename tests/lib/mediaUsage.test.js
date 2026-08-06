import { describe, it, expect } from 'vitest'
import { mediaUsage, usageSentence } from '../../src/components/ui/MediaUsageBadge.jsx'

// The counter's whole job is to be trustworthy about "has this been out
// before?", so the cases that matter are the ones where the number is absent
// or partial — a missing usage object must read as zero, never as a crash or
// as a confident wrong count.
//
// Feedback bdae4d9d (Philip): the badge/tooltip now leads with PUBLISHED, not
// total, and names the platform(s) it actually shipped to. These cases are
// pinned against the real movebetter usage rows the fix was built against
// (see media_asset_usage migration 206) — not invented shapes.

describe('mediaUsage', () => {
  it('reads the server shape, including the platform rollup', () => {
    expect(mediaUsage({ usage: { total: 3, published: 2, platforms: [{ platform: 'instagram', count: 2 }] } }))
      .toEqual({ total: 3, published: 2, platforms: [{ platform: 'instagram', count: 2 }] })
  })

  it('treats a missing usage object as zero (degraded lookup / older row)', () => {
    expect(mediaUsage({})).toEqual({ total: 0, published: 0, platforms: [] })
    expect(mediaUsage(undefined)).toEqual({ total: 0, published: 0, platforms: [] })
    expect(mediaUsage(null)).toEqual({ total: 0, published: 0, platforms: [] })
  })

  it('coerces non-numeric or partial payloads rather than rendering NaN', () => {
    expect(mediaUsage({ usage: { total: '4' } })).toEqual({ total: 4, published: 0, platforms: [] })
    expect(mediaUsage({ usage: { total: null, published: undefined } })).toEqual({ total: 0, published: 0, platforms: [] })
  })

  it('defaults platforms to [] when the server omits it (a caller that predates the rollup, e.g. a stale cache)', () => {
    expect(mediaUsage({ usage: { total: 1, published: 1 } }).platforms).toEqual([])
    expect(mediaUsage({ usage: { total: 1, published: 1, platforms: 'not-an-array' } }).platforms).toEqual([])
  })
})

describe('usageSentence', () => {
  it('distinguishes never-used from queued-but-unpublished', () => {
    expect(usageSentence({ usage: { total: 0, published: 0 } })).toBe('Not used in any post yet')
    expect(usageSentence({ usage: { total: 2, published: 0 } })).toBe('Queued in 2 posts, not published yet')
    expect(usageSentence({ usage: { total: 1, published: 0 } })).toBe('Queued in 1 post, not published yet')
  })

  it('names the platform when published with no platform breakdown attached', () => {
    expect(usageSentence({ usage: { total: 1, published: 1 } })).toBe('Published on 1 post')
  })

  it('falls back to a plain published count when platforms is empty but drafts remain', () => {
    // The real prod shape this was built against: the most-reused asset in the
    // movebetter library sits at 9 attachments, only 2 of them published.
    expect(usageSentence({ usage: { total: 9, published: 2 } }))
      .toBe('Published on 2 posts — 7 more drafts queued')
  })

  it('names a single platform by its real label, not the raw enum', () => {
    // asset 1d8e9981…: 1 Instagram draft, 1 Instagram rejected, 1 LinkedIn published
    expect(usageSentence({
      usage: { total: 3, published: 1, platforms: [{ platform: 'linkedin', count: 1 }] },
    })).toBe('Published on LinkedIn — 2 more drafts queued')
  })

  it('shows a repeat count for the same platform used more than once', () => {
    // asset 96ff5db1…: published to Instagram 3 separate times, nothing in draft
    expect(usageSentence({
      usage: { total: 3, published: 3, platforms: [{ platform: 'instagram', count: 3 }] },
    })).toBe('Published on Instagram ×3')
  })

  it('lists multiple platforms, no repeat marker for single uses', () => {
    // asset d3d6dc08…: published once each to GBP, Instagram, LinkedIn
    expect(usageSentence({
      usage: {
        total: 3,
        published: 3,
        platforms: [
          { platform: 'gbp', count: 1 },
          { platform: 'instagram', count: 1 },
          { platform: 'linkedin', count: 1 },
        ],
      },
    })).toBe('Published on Google Business, Instagram, LinkedIn')
  })

  it('falls back to the raw platform string for an unrecognized enum value', () => {
    expect(usageSentence({
      usage: { total: 1, published: 1, platforms: [{ platform: 'some_future_platform', count: 1 }] },
    })).toBe('Published on some_future_platform')
  })
})
