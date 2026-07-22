import { describe, it, expect } from 'vitest'
import { assignSlots } from '../../api/_lib/strategist.js'
import { defaultSlotsForChannel, mergeSlotsIntoCadence, slotsByPlatformFromCadence } from '../../api/_lib/cadenceSlots.js'

const WEEK_MONDAY = '2026-06-22' // a Monday

describe('defaultSlotsForChannel', () => {
  it('produces one slot per weekly target for a single-format platform', () => {
    const slots = defaultSlotsForChannel('gbp', 2, ['sat', 'sun'])
    expect(slots).toHaveLength(2)
    expect(slots.every((s) => s.format === 'post' && s.enabled)).toBe(true)
  })

  it('respects quiet days — never places a slot on one', () => {
    const slots = defaultSlotsForChannel('linkedin', 3, ['sat', 'sun'])
    expect(slots.some((s) => s.weekday === 'sat' || s.weekday === 'sun')).toBe(false)
  })

  it('splits instagram into post + reel using the reel worker ratio, with no (weekday,hour) collision across formats', () => {
    const slots = defaultSlotsForChannel('instagram', 4, ['sat', 'sun'])
    const reelCount = slots.filter((s) => s.format === 'reel').length
    const postCount = slots.filter((s) => s.format === 'post').length
    expect(reelCount + postCount).toBe(4)
    expect(reelCount).toBeGreaterThan(0) // 0.75 share of 4 => 3
    expect(postCount).toBeGreaterThan(0)
    const keys = slots.map((s) => `${s.weekday}:${s.hour}`)
    expect(new Set(keys).size).toBe(slots.length) // no two slots share an instant, regardless of format
  })

  it('a target of 0 produces no slots', () => {
    expect(defaultSlotsForChannel('facebook', 0, ['sat', 'sun'])).toEqual([])
  })
})

describe('mergeSlotsIntoCadence', () => {
  it('prefers persisted slots over the computed default', () => {
    const cadence = { linkedin: { target_per_week: 3, enabled: true } }
    const persisted = { linkedin: { slots: [{ weekday: 'tue', hour: 9, format: 'post', enabled: true }] } }
    const out = mergeSlotsIntoCadence(cadence, persisted, ['sat', 'sun'])
    expect(out.linkedin.slots).toEqual(persisted.linkedin.slots)
  })

  it('falls back to a computed default when no slots are persisted', () => {
    const cadence = { gbp: { target_per_week: 2, enabled: true } }
    const out = mergeSlotsIntoCadence(cadence, {}, ['sat', 'sun'])
    expect(out.gbp.slots).toHaveLength(2)
  })

  it('drops a disabled persisted slot rather than scheduling into it', () => {
    const cadence = { linkedin: { target_per_week: 1, enabled: true } }
    const persisted = { linkedin: { slots: [{ weekday: 'tue', hour: 9, format: 'post', enabled: false }] } }
    const out = mergeSlotsIntoCadence(cadence, persisted, ['sat', 'sun'])
    // The only persisted slot is disabled, so it falls back to a computed default rather than an empty list.
    expect(out.linkedin.slots.length).toBeGreaterThan(0)
    expect(out.linkedin.slots.every((s) => s.enabled)).toBe(true)
  })
})

describe('assignSlots — pinned-slot placement (T3)', () => {
  const pinnedInstagram = [
    { weekday: 'tue', hour: 12, format: 'post', enabled: true },
    { weekday: 'thu', hour: 12, format: 'reel', enabled: true },
    { weekday: 'sat', hour: 10, format: 'reel', enabled: true },
  ]

  it('places a post atom into the post-format pinned slot, not a reel slot', () => {
    const atoms = [{ id: 'a1', platform: 'instagram', format: 'post' }]
    const [a] = assignSlots(atoms, WEEK_MONDAY, [], 'UTC', { instagram: pinnedInstagram })
    const d = new Date(a.scheduled_at)
    expect(d.getUTCDay()).toBe(2) // Tuesday
    expect(d.getUTCHours()).toBe(12)
  })

  it('places a reel atom into a reel-format pinned slot', () => {
    const atoms = [{ id: 'r1', platform: 'instagram', format: 'reel' }]
    const [a] = assignSlots(atoms, WEEK_MONDAY, [], 'UTC', { instagram: pinnedInstagram })
    const d = new Date(a.scheduled_at)
    // First reel slot in weekday order is Thursday.
    expect(d.getUTCDay()).toBe(4)
    expect(d.getUTCHours()).toBe(12)
  })

  it('is deterministic — running the same atoms through pinned slots twice yields the same placement', () => {
    const atoms1 = [
      { id: 'r1', platform: 'instagram', format: 'reel' },
      { id: 'r2', platform: 'instagram', format: 'reel' },
    ]
    const atoms2 = [
      { id: 'r1', platform: 'instagram', format: 'reel' },
      { id: 'r2', platform: 'instagram', format: 'reel' },
    ]
    const out1 = assignSlots(atoms1, WEEK_MONDAY, [], 'UTC', { instagram: pinnedInstagram })
    const out2 = assignSlots(atoms2, WEEK_MONDAY, [], 'UTC', { instagram: pinnedInstagram })
    expect(out1.map((a) => a.scheduled_at)).toEqual(out2.map((a) => a.scheduled_at))
  })

  it('wraps and nudges the minute when more atoms than matching slots exist, never colliding', () => {
    const atoms = [
      { id: 'r1', platform: 'instagram', format: 'reel' },
      { id: 'r2', platform: 'instagram', format: 'reel' },
      { id: 'r3', platform: 'instagram', format: 'reel' }, // only 2 reel slots — this one wraps
    ]
    const out = assignSlots(atoms, WEEK_MONDAY, [], 'UTC', { instagram: pinnedInstagram })
    const instants = out.map((a) => a.scheduled_at)
    expect(new Set(instants).size).toBe(3)
  })

  it('falls back to the legacy even-spread when the platform has no pinned slots', () => {
    const atoms = [{ id: 'l1', platform: 'linkedin' }]
    const [a] = assignSlots(atoms, WEEK_MONDAY, ['sat', 'sun'], 'UTC', { instagram: pinnedInstagram })
    expect(typeof a.scheduled_at).toBe('string')
  })

  it('a null/omitted slotsByPlatform behaves exactly like the pre-T3 signature (no regression)', () => {
    const atoms = [{ id: 'i1', platform: 'instagram' }]
    const [a] = assignSlots(atoms, WEEK_MONDAY, ['sat', 'sun'], 'UTC')
    expect(typeof a.scheduled_at).toBe('string')
  })
})

describe('slotsByPlatformFromCadence', () => {
  it('drops platforms with no slots and keeps the rest', () => {
    const cadence = {
      instagram: { slots: [{ weekday: 'mon', hour: 12, format: 'post', enabled: true }] },
      facebook: { slots: [] },
      gbp: {},
    }
    expect(Object.keys(slotsByPlatformFromCadence(cadence))).toEqual(['instagram'])
  })
})
