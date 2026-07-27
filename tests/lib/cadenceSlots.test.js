import { describe, it, expect } from 'vitest'
import { assignSlots } from '../../api/_lib/strategist.js'
import { defaultSlotsForChannel, distributeEvenSlots, mergeSlotsIntoCadence, slotsByPlatformFromCadence, withExplorationSlot } from '../../api/_lib/cadenceSlots.js'

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

describe('distributeEvenSlots — cross-channel even layout', () => {
  const MOVEBETTER = {
    gbp: { target_per_week: 2, enabled: true },
    facebook: { target_per_week: 3, enabled: true },
    linkedin: { target_per_week: 3, enabled: true },
    instagram: { target_per_week: 6, enabled: true },
    instagram_story: { target_per_week: 0, enabled: false },
  }
  const ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
  const dayLoad = (out) => {
    const load = Object.fromEntries(ORDER.map((d) => [d, 0]))
    for (const slots of Object.values(out)) for (const s of slots) load[s.weekday]++
    return load
  }
  const daySet = (slots) => [...new Set(slots.map((s) => s.weekday))].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))

  it('covers BOTH weekend days when open, even for a sparse two-channel workspace', () => {
    // The whole point of the feature. defaultSlotsForChannel (per-channel spread)
    // leaves Saturday empty here — ig4 lands mon/wed/fri, li3 lands mon/wed/fri —
    // so this asserts the cross-channel deal actually reaches the weekend.
    const out = distributeEvenSlots(
      { instagram: { target_per_week: 4, enabled: true }, linkedin: { target_per_week: 3, enabled: true } },
      [],
    )
    const days = new Set(Object.values(out).flat().map((s) => s.weekday))
    expect(days.has('sat')).toBe(true)
    expect(days.has('sun')).toBe(true)
  })

  it('leaves no open day empty and keeps the week balanced (not Monday-crammed)', () => {
    // Naive per-channel spread piles movebetter onto Monday (5) and leaves
    // Tuesday & Friday empty. A balanced deal fills every day ~evenly.
    const out = distributeEvenSlots(MOVEBETTER, [])
    const load = dayLoad(out)
    const total = Object.values(load).reduce((a, b) => a + b, 0)
    expect(total).toBe(14) // 2+3+3+6
    for (const d of ORDER) expect(load[d]).toBeGreaterThan(0) // every day used
    const cap = Math.ceil(total / ORDER.length) + 1 // 2 avg → no day past 3
    for (const d of ORDER) expect(load[d]).toBeLessThanOrEqual(cap)
  })

  it('never schedules on a quiet day', () => {
    const out = distributeEvenSlots(MOVEBETTER, ['sat', 'sun'])
    const days = new Set(Object.values(out).flat().map((s) => s.weekday))
    expect(days.has('sat')).toBe(false)
    expect(days.has('sun')).toBe(false)
  })

  it('produces exactly target_per_week slots per enabled channel, and skips disabled / zero-target', () => {
    const out = distributeEvenSlots(MOVEBETTER, [])
    expect(out.gbp).toHaveLength(2)
    expect(out.facebook).toHaveLength(3)
    expect(out.linkedin).toHaveLength(3)
    expect(out.instagram).toHaveLength(6)
    expect(out.instagram_story).toBeUndefined() // disabled + target 0
  })

  it('splits instagram into post + reel by the reel ratio', () => {
    const ig = distributeEvenSlots(MOVEBETTER, []).instagram
    expect(ig.filter((s) => s.format === 'reel').length).toBe(5) // round(6*0.75)
    expect(ig.filter((s) => s.format === 'post').length).toBe(1)
  })

  it('is deterministic', () => {
    expect(distributeEvenSlots(MOVEBETTER, [])).toEqual(distributeEvenSlots(MOVEBETTER, []))
  })

  it('returns {} when every day is quiet', () => {
    expect(distributeEvenSlots(MOVEBETTER, ORDER)).toEqual({})
  })

  it('regression: pins the approved movebetter weekend layout (update only on a deliberate retune)', () => {
    const out = distributeEvenSlots(MOVEBETTER, [])
    expect(daySet(out.gbp)).toEqual(['mon', 'thu'])
    expect(daySet(out.facebook)).toEqual(['tue', 'thu', 'sun'])
    expect(daySet(out.linkedin)).toEqual(['mon', 'wed', 'fri'])
    expect(daySet(out.instagram)).toEqual(['mon', 'tue', 'wed', 'fri', 'sat', 'sun'])
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

describe('withExplorationSlot — T4 tie-in', () => {
  const cadence = {
    linkedin: { target_per_week: 3, enabled: true, slots: [{ weekday: 'mon', hour: 7, format: 'post', enabled: true }] },
    instagram: { target_per_week: 4, enabled: true, slots: [{ weekday: 'mon', hour: 12, format: 'post', enabled: true }] },
  }

  it('adds an exploration slot to the highest-target enabled channel', () => {
    const out = withExplorationSlot(cadence, 'sat')
    expect(out.instagram.slots.some((s) => s.weekday === 'sat' && s.exploring)).toBe(true)
    expect(out.linkedin.slots.some((s) => s.weekday === 'sat')).toBe(false)
  })

  it('uses reel format for instagram, matching the signed-off mockup', () => {
    const out = withExplorationSlot(cadence, 'sat')
    const slot = out.instagram.slots.find((s) => s.weekday === 'sat')
    expect(slot.format).toBe('reel')
  })

  it('does not duplicate a slot when the day is already covered', () => {
    const out = withExplorationSlot(cadence, 'mon') // instagram already has a Monday slot
    expect(out.instagram.slots.filter((s) => s.weekday === 'mon')).toHaveLength(1)
  })

  it('is a no-op when there is nothing to explore', () => {
    expect(withExplorationSlot(cadence, null)).toBe(cadence)
  })

  it('is a no-op when no channel is enabled with a positive target', () => {
    const empty = { linkedin: { target_per_week: 0, enabled: true } }
    expect(withExplorationSlot(empty, 'sat')).toBe(empty)
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
