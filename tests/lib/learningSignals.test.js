import { describe, it, expect } from 'vitest'
import {
  dimensionTrust, trustSentence, stillFlags,
  MIN_SAMPLE, GRADUATION_RATE, GRADUATION_WINDOWS,
} from '../../api/_lib/learningSignals.js'

describe('dimensionTrust — says less than the data allows, on purpose', () => {
  it('reports UNTRACKED when no signal exists — never a flattering 0%', () => {
    // Media was in exactly this state before migration 196. A dimension with no
    // capture must not render as "0% overridden, doing great".
    const t = dimensionTrust({ overrides: 0, observations: 0, instrumented: false })
    expect(t.state).toBe('untracked')
    expect(t.rate).toBeNull()
  })

  it('distinguishes NO DATA from too-few — they need different sentences', () => {
    expect(dimensionTrust({ overrides: 0, observations: 0 }).state).toBe('no_data')
    expect(dimensionTrust({ overrides: 1, observations: 4 }).state).toBe('too_few')
  })

  it('refuses to report a rate below the sample floor', () => {
    const t = dimensionTrust({ overrides: 3, observations: MIN_SAMPLE - 1 })
    expect(t.state).toBe('too_few')
    expect(t.rate).toBeNull()          // the count is kept; the RATE is withheld
    expect(t.overrides).toBe(3)
  })

  it('reports a rate at exactly the floor', () => {
    const t = dimensionTrust({ overrides: 5, observations: MIN_SAMPLE })
    expect(t.state).toBe('checking')
    expect(t.rate).toBeCloseTo(5 / MIN_SAMPLE)
  })

  it('does NOT graduate on one good window — a single window is not evidence', () => {
    const one = dimensionTrust({ overrides: 1, observations: 60, graduatedWindows: 1 })
    expect(one.state).toBe('checking')
    const two = dimensionTrust({ overrides: 1, observations: 60, graduatedWindows: GRADUATION_WINDOWS })
    expect(two.state).toBe('graduated')
  })

  it('does not graduate a dimension above the rate however many windows pass', () => {
    const t = dimensionTrust({ overrides: 30, observations: 60, graduatedWindows: 99 })
    expect(t.state).toBe('checking')
    expect(t.rate).toBeCloseTo(0.5)
  })

  it('clamps nonsense rather than emitting NaN or a >100% rate', () => {
    expect(dimensionTrust({ overrides: 99, observations: 20 }).rate).toBe(1)
    expect(dimensionTrust({ overrides: -5, observations: 20 }).overrides).toBe(0)
    expect(dimensionTrust({ overrides: 'x', observations: 'y' }).state).toBe('no_data')
  })
})

describe('stillFlags — fails toward showing the human', () => {
  it('only a graduated dimension stops being flagged', () => {
    expect(stillFlags(dimensionTrust({ overrides: 1, observations: 60, graduatedWindows: 2 }))).toBe(false)
    for (const t of [
      dimensionTrust({ overrides: 0, observations: 0, instrumented: false }),
      dimensionTrust({ overrides: 0, observations: 0 }),
      dimensionTrust({ overrides: 1, observations: 4 }),
      dimensionTrust({ overrides: 20, observations: 60 }),
    ]) expect(stillFlags(t)).toBe(true)
  })

  it('an unknown/garbage trust still flags', () => {
    // The cost of an unnecessary flag is a glance; the cost of a missed one is
    // unreviewed content going out.
    expect(stillFlags(undefined)).toBe(true)
    expect(stillFlags({})).toBe(true)
  })
})

describe('trustSentence — plain language, never a bare score', () => {
  it('names the thing in the owner\'s words, per dimension', () => {
    const few = dimensionTrust({ overrides: 4, observations: 10 })
    expect(trustSentence('media', few)).toMatch(/photo/i)
    expect(trustSentence('words', few)).toMatch(/caption/i)
    expect(trustSentence('format', few)).toMatch(/format/i)
  })

  it('untracked says Bernard cannot see it — not that it is fine', () => {
    const t = dimensionTrust({ overrides: 0, observations: 0, instrumented: false })
    expect(trustSentence('media', t)).toMatch(/can't see/i)
    expect(trustSentence('media', t)).not.toMatch(/0%/)
  })

  it('too-few admits the gap instead of implying a verdict', () => {
    expect(trustSentence('words', dimensionTrust({ overrides: 4, observations: 10 })))
      .toMatch(/too few to say/i)
  })

  it('never renders a percentage for a state with no reportable rate', () => {
    for (const t of [
      dimensionTrust({ overrides: 0, observations: 0, instrumented: false }),
      dimensionTrust({ overrides: 0, observations: 0 }),
      dimensionTrust({ overrides: 2, observations: 9 }),
    ]) expect(trustSentence('media', t)).not.toMatch(/\d+%/)
  })
})

describe('the thresholds are stated, not hidden', () => {
  it('graduation sits clear of the noise band', () => {
    // At n=20 one correction is 5 points; graduating AT the noise floor would
    // make the state flap between good and shaky on a single edit.
    expect(GRADUATION_RATE).toBeLessThan(1 / MIN_SAMPLE * 2)
    expect(GRADUATION_WINDOWS).toBeGreaterThan(1)
  })
})
