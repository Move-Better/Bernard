import { describe, it, expect } from 'vitest'
import { mediaUsage, usageSentence } from '../../src/components/ui/MediaUsageBadge.jsx'

// The counter's whole job is to be trustworthy about "has this been out
// before?", so the cases that matter are the ones where the number is absent
// or partial — a missing usage object must read as zero, never as a crash or
// as a confident wrong count.

describe('mediaUsage', () => {
  it('reads the server shape', () => {
    expect(mediaUsage({ usage: { total: 3, published: 2 } })).toEqual({ total: 3, published: 2 })
  })

  it('treats a missing usage object as zero (degraded lookup / older row)', () => {
    expect(mediaUsage({})).toEqual({ total: 0, published: 0 })
    expect(mediaUsage(undefined)).toEqual({ total: 0, published: 0 })
    expect(mediaUsage(null)).toEqual({ total: 0, published: 0 })
  })

  it('coerces non-numeric or partial payloads rather than rendering NaN', () => {
    expect(mediaUsage({ usage: { total: '4' } })).toEqual({ total: 4, published: 0 })
    expect(mediaUsage({ usage: { total: null, published: undefined } })).toEqual({ total: 0, published: 0 })
  })
})

describe('usageSentence', () => {
  it('distinguishes never-used from used-but-unpublished', () => {
    expect(usageSentence({ usage: { total: 0, published: 0 } })).toBe('Not used in any post yet')
    expect(usageSentence({ usage: { total: 2, published: 0 } })).toBe('Used in 2 posts — none published yet')
  })

  it('singularizes one post', () => {
    expect(usageSentence({ usage: { total: 1, published: 1 } })).toBe('Used in 1 post · 1 published')
  })

  it('reports the published subset', () => {
    // The real prod shape this was built against: the most-reused asset in the
    // movebetter library sits at 9 attachments, only 2 of them published.
    expect(usageSentence({ usage: { total: 9, published: 2 } })).toBe('Used in 9 posts · 2 published')
  })
})
