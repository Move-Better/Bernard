import { describe, it, expect } from 'vitest'
import {
  acceptedBaseline,
  shouldRequeue,
  isEligible,
  RECHECK_DAYS,
  MATERIAL_DROP,
} from '../../api/_lib/sweepDriftedAnswers.js'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 6, 25)
const daysAgo = (n) => new Date(NOW - n * DAY).toISOString()

describe('drift sweep — cadence', () => {
  it('does not re-check an answer the clinician just published', () => {
    expect(isEligible({ published_at: daysAgo(1) }, NOW)).toBe(false)
    expect(isEligible({ published_at: daysAgo(RECHECK_DAYS - 1) }, NOW)).toBe(false)
  })

  it('re-checks once the cadence has elapsed', () => {
    expect(isEligible({ published_at: daysAgo(RECHECK_DAYS) }, NOW)).toBe(true)
    expect(isEligible({ published_at: daysAgo(400) }, NOW)).toBe(true)
  })

  it('paces off the last sweep once one has run, not the original publish', () => {
    // Published long ago but swept yesterday — must not be re-checked again.
    const row = { published_at: daysAgo(400), voice_rechecked_at: daysAgo(1) }
    expect(isEligible(row, NOW)).toBe(false)
  })

  it('ignores an answer that was never published', () => {
    expect(isEligible({ published_at: null }, NOW)).toBe(false)
  })
})

describe('drift sweep — respecting an accepted flag', () => {
  it('re-queues a flagged answer the clinician never signed off on', () => {
    expect(shouldRequeue(6.5, null)).toBe(true)
  })

  it('never re-queues an answer that passes', () => {
    expect(shouldRequeue(9, null)).toBe(false)
    expect(shouldRequeue(7.5, 7.0)).toBe(false) // exactly at the bar
  })

  it('does NOT re-raise the same flag the clinician already accepted', () => {
    // They published at 7.0 knowing it was flagged; it still scores ~7.0.
    expect(shouldRequeue(7.0, 7.0)).toBe(false)
    expect(shouldRequeue(6.8, 7.0)).toBe(false) // ordinary judge noise
  })

  it('re-queues once it falls materially below what they accepted', () => {
    expect(shouldRequeue(7.0 - MATERIAL_DROP, 7.0)).toBe(true)
    expect(shouldRequeue(5.0, 7.0)).toBe(true)
  })

  it('tolerates judge sampling noise just under the material threshold', () => {
    // ±0.33 is the observed run-to-run spread on identical input; a re-queue
    // triggered by that would be indistinguishable from nagging.
    expect(shouldRequeue(7.0 - 0.33, 7.0)).toBe(false)
  })
})

describe('drift sweep — the accepted baseline survives re-scoring', () => {
  it('prefers the explicit snapshot', () => {
    expect(acceptedBaseline({ voice_audit: { accepted_score: 7.2 }, voice_fidelity_score: 55 })).toBe(7.2)
  })

  it('derives it for rows overridden before the snapshot existed', () => {
    expect(acceptedBaseline({ voice_audit: { published_over_flag: true }, voice_fidelity_score: 73 })).toBe(7.3)
  })

  it('is null when they never accepted a flag', () => {
    expect(acceptedBaseline({ voice_audit: { gate: 'passed' }, voice_fidelity_score: 90 })).toBe(null)
    expect(acceptedBaseline({ voice_audit: null })).toBe(null)
    expect(acceptedBaseline({})).toBe(null)
  })

  // The failure this guards: a re-score overwrites voice_fidelity_score, so if the
  // baseline weren't carried forward the NEXT sweep would see accepted=null and
  // re-queue a flag the clinician had already stood behind — the exact nagging
  // loop the rule exists to prevent.
  it('a carried-forward baseline still suppresses the re-queue after a re-score', () => {
    const afterRescore = { voice_audit: { accepted_score: 7.0 }, voice_fidelity_score: 69 }
    expect(shouldRequeue(6.9, acceptedBaseline(afterRescore))).toBe(false)
  })
})
