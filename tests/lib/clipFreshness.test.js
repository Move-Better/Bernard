import { describe, it, expect } from 'vitest'
import { freshnessMultiplier } from '../../api/_lib/clipSearch.js'

// The freshness discount decides which photo Bernard picks on its own
// (generate-package takes top-1), so the properties that matter are the ones
// that keep it from swinging too far in either direction: it must actually
// demote a tired asset, must never demote so hard that a much better match
// loses, and must not punish a draft as if it had been published.

describe('freshnessMultiplier', () => {
  it('leaves an unused asset completely untouched', () => {
    expect(freshnessMultiplier({ total: 0, published: 0 })).toBe(1)
    expect(freshnessMultiplier(undefined)).toBe(1)
    expect(freshnessMultiplier({})).toBe(1)
  })

  it('costs a single use almost nothing', () => {
    // One prior use should not meaningfully reorder anything — reuse is normal.
    expect(freshnessMultiplier({ total: 1, published: 1 })).toBeCloseTo(0.95, 5)
  })

  it('decreases monotonically as usage climbs', () => {
    const xs = [0, 1, 2, 3, 4, 5, 6, 7].map((n) => freshnessMultiplier({ total: n, published: n }))
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeLessThanOrEqual(xs[i - 1])
  })

  it('floors the penalty so a much stronger match still wins', () => {
    // The cap is the guard against over-correcting into irrelevant picks.
    const worst = freshnessMultiplier({ total: 99, published: 99 })
    expect(worst).toBeCloseTo(0.7, 5)
    // A heavily-used 0.9-similarity asset still beats a fresh 0.6 one.
    expect(0.9 * worst).toBeGreaterThan(0.6)
  })

  it('counts an unpublished draft as half a use', () => {
    // Four drafts have not been in front of the audience four times.
    const fourDrafts = freshnessMultiplier({ total: 4, published: 0 })
    const fourPublished = freshnessMultiplier({ total: 4, published: 4 })
    expect(fourDrafts).toBeGreaterThan(fourPublished)
    expect(fourDrafts).toBeCloseTo(0.9, 5)
  })

  it('demotes the real worst case below a fresh rival', () => {
    // The actual movebetter library: IMG_1139small at 0.431 similarity, used 7x
    // (2 published), was beating a fresh 0.382 photo on every plantar-fasciitis
    // pick. After the discount it must not.
    const tired = 0.431 * freshnessMultiplier({ total: 7, published: 2 })
    expect(tired).toBeLessThan(0.382)
  })
})
