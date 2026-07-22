import { describe, it, expect } from 'vitest'
import { applyExplorationSlots, computeDayProposal } from '../../api/_lib/cadenceAdaptive.js'

describe('applyExplorationSlots', () => {
  it('un-quiets exactly one candidate day, leaving the rest quiet', () => {
    const { effectiveQuietDays, exploring } = applyExplorationSlots(['sat', 'sun'], [], '2026-07-20')
    expect(exploring).not.toBeNull()
    expect(['sat', 'sun']).toContain(exploring)
    expect(effectiveQuietDays).toHaveLength(1)
    expect(effectiveQuietDays).not.toContain(exploring)
  })

  it('is deterministic for the same week (idempotent replan)', () => {
    const a = applyExplorationSlots(['sat', 'sun'], [], '2026-07-20')
    const b = applyExplorationSlots(['sat', 'sun'], [], '2026-07-20')
    expect(a.exploring).toBe(b.exploring)
    expect(a.effectiveQuietDays).toEqual(b.effectiveQuietDays)
  })

  it('rotates across different weeks so both quiet days eventually get explored', () => {
    const seen = new Set()
    for (let w = 0; w < 8; w++) {
      const monday = new Date(Date.UTC(2026, 6, 6 + w * 7)).toISOString().slice(0, 10)
      seen.add(applyExplorationSlots(['sat', 'sun'], [], monday).exploring)
    }
    expect(seen).toEqual(new Set(['sat', 'sun']))
  })

  it('never explores a dismissed day', () => {
    for (let w = 0; w < 8; w++) {
      const monday = new Date(Date.UTC(2026, 6, 6 + w * 7)).toISOString().slice(0, 10)
      const { exploring } = applyExplorationSlots(['sat', 'sun'], ['sat'], monday)
      expect(exploring).not.toBe('sat')
    }
  })

  it('no-ops when there are no quiet days', () => {
    const { effectiveQuietDays, exploring } = applyExplorationSlots([], [], '2026-07-20')
    expect(exploring).toBeNull()
    expect(effectiveQuietDays).toEqual([])
  })

  it('no-ops when every quiet day has been dismissed', () => {
    const { effectiveQuietDays, exploring } = applyExplorationSlots(['sat', 'sun'], ['sat', 'sun'], '2026-07-20')
    expect(exploring).toBeNull()
    expect(effectiveQuietDays).toEqual(['sat', 'sun'])
  })
})

function mockSb(snapshots) {
  return async () => ({ ok: true, json: async () => snapshots })
}

function snap(publishedAt, score) {
  return { stats: { statistics: { impressions: score } }, content_items: { published_at: publishedAt } }
}

describe('computeDayProposal', () => {
  it('returns null with no candidate quiet days', async () => {
    const result = await computeDayProposal('ws-1', [], [], 'UTC', mockSb([]))
    expect(result).toBeNull()
  })

  it('returns null until the quiet day clears the sample floor', async () => {
    // Saturday 2026-07-18 is a Sat; only 2 samples (below DAY_MIN_SAMPLE=3)
    const snapshots = [
      snap('2026-07-18T15:00:00Z', 100),
      snap('2026-07-11T15:00:00Z', 90),
      snap('2026-07-15T12:00:00Z', 50), // a Wed (baseline)
    ]
    const result = await computeDayProposal('ws-1', ['sat'], [], 'UTC', mockSb(snapshots))
    expect(result).toBeNull()
  })

  it('returns evidence once the quiet day clears the sample floor and a baseline exists', async () => {
    const snapshots = [
      snap('2026-07-18T15:00:00Z', 100), // sat
      snap('2026-07-11T15:00:00Z', 90),  // sat
      snap('2026-07-04T15:00:00Z', 110), // sat
      snap('2026-07-15T12:00:00Z', 50),  // wed (open day, baseline)
      snap('2026-07-16T12:00:00Z', 60),  // thu (open day, baseline)
    ]
    const result = await computeDayProposal('ws-1', ['sat'], [], 'UTC', mockSb(snapshots))
    expect(result).not.toBeNull()
    expect(result.day).toBe('sat')
    expect(result.sampleCount).toBe(3)
    expect(result.avgScore).toBeCloseTo(100, 1)
    expect(result.baselineAvgScore).toBeCloseTo(55, 1)
    expect(result.baselineCount).toBe(2)
  })

  it('never proposes a dismissed day even with plenty of evidence', async () => {
    const snapshots = [
      snap('2026-07-18T15:00:00Z', 500),
      snap('2026-07-11T15:00:00Z', 500),
      snap('2026-07-04T15:00:00Z', 500),
      snap('2026-07-15T12:00:00Z', 50),
    ]
    const result = await computeDayProposal('ws-1', ['sat'], ['sat'], 'UTC', mockSb(snapshots))
    expect(result).toBeNull()
  })

  it('returns null when there is no open-day baseline yet', async () => {
    const snapshots = [
      snap('2026-07-18T15:00:00Z', 100),
      snap('2026-07-11T15:00:00Z', 90),
      snap('2026-07-04T15:00:00Z', 110),
    ]
    const result = await computeDayProposal('ws-1', ['sat'], [], 'UTC', mockSb(snapshots))
    expect(result).toBeNull()
  })
})
