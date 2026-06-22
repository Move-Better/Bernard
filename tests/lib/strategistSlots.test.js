import { describe, it, expect } from 'vitest'
import { assignSlots } from '../../api/_lib/strategist.js'

const WEEK_MONDAY = '2026-06-22' // a Monday

// Build `n` atoms for one platform.
const makeAtoms = (platform, n) =>
  Array.from({ length: n }, (_, i) => ({ id: `${platform}-${i}`, platform }))

// Reduce a stamped atom to its (day, hour, platform) slot tuple.
const slotTuple = (a) => {
  const d = new Date(a.scheduled_at)
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}|${d.getUTCHours()}|${a.platform}`
}

describe('assignSlots — no (day, hour, platform) collisions', () => {
  // sat+sun quiet ⇒ 5 open weekdays. 6 instagram posts is the audit's repro.
  const cases = [
    { target: 6, quiet: ['sat', 'sun'], openDays: 5, label: '6/5' },
    { target: 7, quiet: ['thu', 'fri', 'sat', 'sun'], openDays: 3, label: '7/3' },
    { target: 4, quiet: ['thu', 'fri', 'sat', 'sun'], openDays: 3, label: '4/3' },
  ]

  for (const { target, quiet, openDays, label } of cases) {
    it(`produces ${target} unique slots over ${openDays} open days (${label})`, () => {
      const atoms = assignSlots(makeAtoms('instagram', target), WEEK_MONDAY, quiet, 'UTC')
      // Every atom got a timestamp.
      expect(atoms.every((a) => typeof a.scheduled_at === 'string')).toBe(true)
      // No two atoms share a (day, hour, platform) tuple.
      const tuples = atoms.map(slotTuple)
      expect(new Set(tuples).size).toBe(target)
      // No two atoms share an exact scheduled_at instant either.
      const instants = atoms.map((a) => a.scheduled_at)
      expect(new Set(instants).size).toBe(target)
    })
  }

  it('regression: 6 posts over 5 open days do not double-book a single day+hour', () => {
    const atoms = assignSlots(makeAtoms('instagram', 6), WEEK_MONDAY, ['sat', 'sun'], 'UTC')
    const instants = atoms.map((a) => a.scheduled_at)
    expect(new Set(instants).size).toBe(6)
  })

  it('spreads evenly (distinct days) when target ≤ open days', () => {
    const atoms = assignSlots(makeAtoms('linkedin', 3), WEEK_MONDAY, ['sat', 'sun'], 'UTC')
    const days = atoms.map((a) => new Date(a.scheduled_at).getUTCDate())
    expect(new Set(days).size).toBe(3) // 3 distinct calendar days
  })

  it('stamps instagram_story and mastodon at their own base hours (not the 11am default)', () => {
    const story = assignSlots(makeAtoms('instagram_story', 1), WEEK_MONDAY, [], 'UTC')[0]
    const masto = assignSlots(makeAtoms('mastodon', 1), WEEK_MONDAY, [], 'UTC')[0]
    expect(new Date(story.scheduled_at).getUTCHours()).toBe(8)
    expect(new Date(masto.scheduled_at).getUTCHours()).toBe(9)
  })
})
