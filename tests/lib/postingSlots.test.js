import { describe, it, expect } from 'vitest'
import { computeEmptySlots, localSlotParts } from '../../src/lib/postingSlots.js'

const TZ = 'America/Los_Angeles'

describe('localSlotParts', () => {
  it('extracts weekday and local hour from an ISO instant', () => {
    // 2026-06-23 (Tue) 19:00 UTC = 12:00 PM Pacific (PDT, UTC-7)
    const { weekday, hour } = localSlotParts('2026-06-23T19:00:00.000Z', TZ)
    expect(weekday).toBe('tue')
    expect(hour).toBe(12)
  })
})

describe('computeEmptySlots', () => {
  const cadence = {
    instagram: {
      target_per_week: 4,
      enabled: true,
      slots: [
        { weekday: 'mon', hour: 12, format: 'post', enabled: true },
        { weekday: 'wed', hour: 12, format: 'reel', enabled: true },
      ],
    },
    linkedin: {
      target_per_week: 3,
      enabled: true,
      slots: [{ weekday: 'mon', hour: 7, format: 'post', enabled: true }],
    },
  }

  it('returns every pinned slot when nothing is scheduled', () => {
    const empty = computeEmptySlots(cadence, [], TZ)
    expect(empty).toHaveLength(3)
  })

  it('excludes a slot with a matching scheduled atom (same platform/weekday/hour/format)', () => {
    // 2026-06-22 (Mon) 19:00 UTC = 12:00 PM Pacific
    const scheduled = [{ platform: 'instagram', format: 'post', scheduled_at: '2026-06-22T19:00:00.000Z' }]
    const empty = computeEmptySlots(cadence, scheduled, TZ)
    expect(empty).toHaveLength(2)
    expect(empty.some((s) => s.platform === 'instagram' && s.weekday === 'mon' && s.format === 'post')).toBe(false)
  })

  it('does NOT exclude a slot when the format differs (a post does not fill a reel slot)', () => {
    // A post lands Wednesday noon — but the pinned Wednesday slot wants a REEL.
    const scheduled = [{ platform: 'instagram', format: 'post', scheduled_at: '2026-06-24T19:00:00.000Z' }]
    const empty = computeEmptySlots(cadence, scheduled, TZ)
    expect(empty.some((s) => s.platform === 'instagram' && s.weekday === 'wed' && s.format === 'reel')).toBe(true)
  })

  it('skips a disabled channel entirely', () => {
    const disabled = { ...cadence, linkedin: { ...cadence.linkedin, enabled: false } }
    const empty = computeEmptySlots(disabled, [], TZ)
    expect(empty.every((s) => s.platform !== 'linkedin')).toBe(true)
  })

  it('skips an individually-disabled slot', () => {
    const withDisabledSlot = {
      instagram: { enabled: true, slots: [{ weekday: 'mon', hour: 12, format: 'post', enabled: false }] },
    }
    expect(computeEmptySlots(withDisabledSlot, [], TZ)).toEqual([])
  })

  it('is empty when cadence has no channels', () => {
    expect(computeEmptySlots({}, [], TZ)).toEqual([])
    expect(computeEmptySlots(null, [], TZ)).toEqual([])
  })

  it('carries the exploring flag through untouched', () => {
    const withExploration = {
      instagram: { enabled: true, slots: [{ weekday: 'sat', hour: 12, format: 'reel', enabled: true, exploring: true }] },
    }
    const empty = computeEmptySlots(withExploration, [], TZ)
    expect(empty[0].exploring).toBe(true)
  })
})
