// Regression net for the Monday-heavy / Friday-empty week reported on
// /week (movebetter, 2026-08-10): 8 of 15 atoms on Monday, nothing on Friday,
// and two gbp atoms at an identical scheduled_at.
//
// Three independent causes, one per describe block below:
//   1. Format bucketing — Instagram seeds ~75% reel tiles but the Strategist
//      only emits `post` atoms, so every one funnelled into the single Monday
//      post tile.
//   2. No occupancy between placement passes — composeWeeklyPlan calls
//      assignSlots twice (this-week, then promoted backlog) and reelFactory a
//      third time; each restarted at slot 0 (Monday) on top of the others.
//   3. No cross-channel per-day balance — nothing stopped several channels
//      choosing the same day once supply and slot counts diverged.
import { describe, it, expect } from 'vitest'
import { assignSlots, occupancyKey } from '../../api/_lib/strategist.js'
import { mergeSlotsIntoCadence, slotsByPlatformFromCadence } from '../../api/_lib/cadenceSlots.js'

const WEEK = '2026-08-10' // a Monday
const TZ = 'UTC'

const atoms = (platform, format, n) =>
  Array.from({ length: n }, () => ({ platform, format }))

const dayOf = (a) => new Date(a.scheduled_at).getUTCDay()
const distinctDays = (list) => new Set(list.map(dayOf)).size

// movebetter's real shape: one post tile, five reel tiles, Mon..Sun.
const IG_SLOTS = [
  { weekday: 'mon', hour: 12, format: 'post' },
  { weekday: 'tue', hour: 12, format: 'reel' },
  { weekday: 'wed', hour: 12, format: 'reel' },
  { weekday: 'fri', hour: 12, format: 'reel' },
  { weekday: 'sat', hour: 12, format: 'reel' },
  { weekday: 'sun', hour: 12, format: 'reel' },
]

describe('format is a preference, not a partition', () => {
  it('spreads 4 post atoms across the week when the channel has ONE post tile', () => {
    const list = atoms('instagram', 'post', 4)
    assignSlots(list, WEEK, [], TZ, { instagram: IG_SLOTS })
    // The bug placed all four on Monday (12:00/12:05/12:10/12:15).
    expect(distinctDays(list)).toBe(4)
    expect(list.filter((a) => dayOf(a) === 1).length).toBe(1) // 1 = Monday
  })

  it('still prefers a same-format tile when one is free', () => {
    const list = atoms('instagram', 'reel', 2)
    assignSlots(list, WEEK, [], TZ, { instagram: IG_SLOTS })
    // Monday is the only `post` tile — a reel must never take it while five
    // reel tiles sit open.
    expect(list.some((a) => dayOf(a) === 1)).toBe(false)
  })

  it('leaves reel tiles for reels when posts have somewhere else to go', () => {
    const postSlots = [
      { weekday: 'mon', hour: 12, format: 'post' },
      { weekday: 'thu', hour: 12, format: 'post' },
      { weekday: 'fri', hour: 12, format: 'reel' },
    ]
    const list = atoms('instagram', 'post', 2)
    assignSlots(list, WEEK, [], TZ, { instagram: postSlots })
    expect(list.some((a) => dayOf(a) === 5)).toBe(false) // 5 = Friday, the reel tile
  })
})

describe('short supply strides across the week instead of filling the front', () => {
  it('places 2 atoms over Mon/Wed/Fri without clustering at the front', () => {
    const slots = [
      { weekday: 'mon', hour: 8, format: 'post' },
      { weekday: 'wed', hour: 8, format: 'post' },
      { weekday: 'fri', hour: 8, format: 'post' },
    ]
    const list = atoms('gbp', 'post', 2)
    assignSlots(list, WEEK, [], TZ, { gbp: slots })
    const days = list.map(dayOf).sort()
    expect(days).not.toEqual([1, 3]) // Mon+Wed — the old first-N behaviour
    expect(distinctDays(list)).toBe(2)
  })
})

describe('occupancy is threaded between placement passes', () => {
  it('a second pass fills the tiles the first left, not Monday again', () => {
    const slots = [
      { weekday: 'mon', hour: 8, format: 'post' },
      { weekday: 'wed', hour: 8, format: 'post' },
      { weekday: 'fri', hour: 8, format: 'post' },
    ]
    const occupied = new Set()
    const first = atoms('gbp', 'post', 2)
    assignSlots(first, WEEK, [], TZ, { gbp: slots }, occupied)
    const promoted = atoms('gbp', 'post', 1)
    assignSlots(promoted, WEEK, [], TZ, { gbp: slots }, occupied)

    const all = [...first, ...promoted]
    // The live symptom: two gbp atoms at one instant on Monday, Friday empty.
    expect(new Set(all.map((a) => a.scheduled_at)).size).toBe(3)
    expect(distinctDays(all)).toBe(3)
  })

  it('accepts an ISO-seeded ledger, the shape reelFactory builds from DB rows', () => {
    const slots = [
      { weekday: 'mon', hour: 12, format: 'reel' },
      { weekday: 'thu', hour: 12, format: 'reel' },
    ]
    const taken = new Date(Date.UTC(2026, 7, 10, 12)).toISOString() // Mon 12:00
    const occupied = new Set([occupancyKey('instagram', taken)])
    const list = atoms('instagram', 'reel', 1)
    assignSlots(list, WEEK, [], TZ, { instagram: slots }, occupied)
    expect(list[0].scheduled_at).not.toBe(taken)
    expect(dayOf(list[0])).toBe(4) // Thursday
  })

  it('does NOT let one channel block a different channel at the same instant', () => {
    // Facebook and Instagram share a noon best-hour. A bare-instant ledger made
    // Facebook holding Sunday noon push an Instagram reel back onto Monday.
    const occupied = new Set()
    const fb = atoms('facebook', 'post', 1)
    assignSlots(fb, WEEK, [], TZ, { facebook: [{ weekday: 'sun', hour: 12, format: 'post' }] }, occupied)
    const ig = atoms('instagram', 'reel', 1)
    assignSlots(ig, WEEK, [], TZ, { instagram: [{ weekday: 'sun', hour: 12, format: 'reel' }] }, occupied)
    expect(dayOf(ig[0])).toBe(0) // Sunday — not evicted
    expect(ig[0].scheduled_at).toBe(fb[0].scheduled_at)
  })
})

describe('cross-channel per-day balance', () => {
  it('gives every open day coverage on a real movebetter-shaped week', () => {
    const channels = {
      gbp: { enabled: true, target_per_week: 3 },
      facebook: { enabled: true, target_per_week: 3 },
      linkedin: { enabled: true, target_per_week: 3 },
      instagram: { enabled: true, target_per_week: 6 },
    }
    const cadence = mergeSlotsIntoCadence(channels, channels, [], { reel: { target_per_week: 5 } })
    const slotsByPlatform = slotsByPlatformFromCadence(cadence)

    const occupied = new Set()
    const week = [
      ...atoms('instagram', 'post', 4),
      ...atoms('gbp', 'post', 2),
      ...atoms('facebook', 'post', 3),
      ...atoms('linkedin', 'post', 3),
    ]
    assignSlots(week, WEEK, [], TZ, slotsByPlatform, occupied)
    assignSlots(atoms('gbp', 'post', 1), WEEK, [], TZ, slotsByPlatform, occupied)

    const perDay = [0, 1, 2, 3, 4, 5, 6].map((d) => week.filter((a) => dayOf(a) === d).length)
    // Reported symptom: Monday 8, Friday 0. Nothing may run away with the week.
    expect(Math.max(...perDay)).toBeLessThanOrEqual(3)
    expect(perDay.filter((n) => n === 0).length).toBeLessThanOrEqual(1)
  })

  it('never produces two atoms of one channel at the same instant', () => {
    const channels = {
      gbp: { enabled: true, target_per_week: 3 },
      instagram: { enabled: true, target_per_week: 6 },
    }
    const cadence = mergeSlotsIntoCadence(channels, channels, [], { reel: { target_per_week: 5 } })
    const slotsByPlatform = slotsByPlatformFromCadence(cadence)
    // Deliberately over-supply so the overflow path runs.
    const list = [...atoms('instagram', 'post', 9), ...atoms('gbp', 'post', 5)]
    assignSlots(list, WEEK, [], TZ, slotsByPlatform)
    const keys = list.map((a) => occupancyKey(a.platform, a.scheduled_at))
    expect(new Set(keys).size).toBe(list.length)
  })
})
