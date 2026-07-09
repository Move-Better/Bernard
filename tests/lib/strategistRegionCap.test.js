import { describe, it, expect } from 'vitest'
import { allocateToCadence, REGION_CAP } from '../../api/_lib/strategist.js'

// Fresh candidate for a channel with a given region.
const c = (platform, region, i = 0) => ({ interview_id: `iv-${region}-${i}`, platform, angle: 'a', region })
// Backlog atom (held) with a held_at for FIFO ordering.
const b = (platform, region, heldAt) => ({ id: `${region}-${heldAt}`, platform, region, held_at: heldAt })

const CAD = { instagram: { enabled: true, target_per_week: 3 } }

describe('allocateToCadence — region balance cap', () => {
  it('empty window: does not police a thin feed (behaves like pre-P2 cadence)', () => {
    const fresh = [c('instagram', 'foot-ankle', 1), c('instagram', 'foot-ankle', 2), c('instagram', 'foot-ankle', 3), c('instagram', 'foot-ankle', 4), c('instagram', 'foot-ankle', 5)]
    const { thisWeek, held, promoted } = allocateToCadence(fresh, CAD, [], {})
    expect(thisWeek).toHaveLength(3)     // filled to cadence target
    expect(held).toHaveLength(2)         // surplus banked, none deferred by region
    expect(promoted).toHaveLength(0)
  })

  it('seeded-heavy window: defers over-represented region, admits others', () => {
    // foot already dominates the rolling window for this channel.
    const window = { instagram: { 'foot-ankle': 9, knee: 1 } }
    const fresh = [
      c('instagram', 'foot-ankle', 1),
      c('instagram', 'foot-ankle', 2),
      c('instagram', 'knee', 1),
      c('instagram', 'spine-low-back', 1),
      c('instagram', 'foot-ankle', 3),
    ]
    const { thisWeek, held } = allocateToCadence(fresh, CAD, [], window)
    const regions = thisWeek.map((x) => x.region).sort()
    // Only the non-foot pieces get in; all three foot pieces are deferred (held).
    expect(regions).toEqual(['knee', 'spine-low-back'])
    expect(held.filter((x) => x.region === 'foot-ankle')).toHaveLength(3)
  })

  it('general / unclassified is exempt from the cap', () => {
    const window = { instagram: { general: 50 } }
    const fresh = [c('instagram', 'general', 1), c('instagram', 'general', 2), c('instagram', 'general', 3)]
    const { thisWeek, held } = allocateToCadence(fresh, CAD, [], window)
    expect(thisWeek).toHaveLength(3)
    expect(held).toHaveLength(0)
    // null region is exempt too.
    const nullFresh = [c('instagram', null, 1), c('instagram', null, 2), c('instagram', null, 3)]
    expect(allocateToCadence(nullFresh, CAD, [], window).thisWeek).toHaveLength(3)
  })

  it('backlog top-up is cap-checked and prefers an under-represented region', () => {
    const window = { instagram: { 'foot-ankle': 9 } }
    // No fresh candidates; drip from backlog. FIFO order: foot (oldest), then knee, spine.
    const backlog = [
      b('instagram', 'foot-ankle', '2026-07-01T00:00:00Z'),
      b('instagram', 'knee', '2026-07-02T00:00:00Z'),
      b('instagram', 'spine-low-back', '2026-07-03T00:00:00Z'),
    ]
    const { thisWeek, promoted } = allocateToCadence([], CAD, backlog, window)
    expect(thisWeek).toHaveLength(0)
    const promotedRegions = promoted.map((x) => x.region).sort()
    // foot is over budget so it's skipped despite being oldest; knee + spine promote.
    expect(promotedRegions).toEqual(['knee', 'spine-low-back'])
  })

  it('exposes the cap constant', () => {
    expect(REGION_CAP).toBe(0.3)
  })
})

// Promo candidate/backlog with an explicit isPromo flag.
const cp = (platform, region, id, promo) => ({ interview_id: `iv-${id}`, platform, angle: 'a', region, isPromo: promo })

describe('allocateToCadence — P3 promo lane', () => {
  it('promo piece bypasses the region cap; evergreen same-region defers', () => {
    const window = { instagram: { 'foot-ankle': 9 } } // foot already heavy
    const fresh = [
      cp('instagram', 'foot-ankle', 'promo-foot', true),
      cp('instagram', 'foot-ankle', 'ever-foot', false),
      cp('instagram', 'knee', 'ever-knee', false),
    ]
    const { thisWeek, held } = allocateToCadence(fresh, CAD, [], window, 0.40)
    // promo foot rides the lane despite the cap; knee fills evergreen; evergreen foot defers.
    expect(thisWeek.map((x) => x.interview_id).sort()).toEqual(['iv-ever-knee', 'iv-promo-foot'])
    expect(held.map((x) => x.interview_id)).toEqual(['iv-ever-foot'])
  })

  it('promo lane is bounded by promoShare — excess promo is deferred', () => {
    const fresh = [
      cp('instagram', 'knee', 'p1', true),
      cp('instagram', 'knee', 'p2', true),
      cp('instagram', 'knee', 'p3', true),
    ]
    // target 3 × 0.15 → round(0.45)=0 → floor to 1 reserved promo slot.
    const { thisWeek, held } = allocateToCadence(fresh, CAD, [], {}, 0.15)
    expect(thisWeek).toHaveLength(1)
    expect(held).toHaveLength(2)
  })

  it('promoShare 0: a stray promo flag is treated as evergreen (region-capped, not held)', () => {
    const fresh = [cp('instagram', 'knee', 'p1', true), cp('instagram', 'knee', 'p2', true)]
    const { thisWeek, held } = allocateToCadence(fresh, CAD, [], {}, 0)
    // No promo lane → both flow through evergreen; small window → both admitted.
    expect(thisWeek).toHaveLength(2)
    expect(held).toHaveLength(0)
  })
})
