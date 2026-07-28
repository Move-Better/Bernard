// Pins the on-hand chip state rules (Moments IA ② — mockup §02, verbatim):
// quiet ≥ 4 wks · amber < 4 · red < 1 · "Not started" is ALWAYS quiet.
import { describe, it, expect } from 'vitest'
import { onHandChipState, restockNudgeState } from '../../src/lib/onHand.js'

const base = { usable: 133, weeklySlotDemand: 15, started: true }

describe('onHandChipState', () => {
  it('returns null without a summary payload', () => {
    expect(onHandChipState(null)).toBeNull()
    expect(onHandChipState(undefined)).toBeNull()
  })

  it('not started is ALWAYS quiet — never an alarm before the first capture', () => {
    const s = onHandChipState({ usable: 0, weeklySlotDemand: 15, started: false, runwayWeeks: 0 })
    expect(s).toEqual({ label: 'On hand · Not started', tone: 'quiet' })
  })

  it('healthy stock (≥ 4 wks) is quiet, rounded with a tilde', () => {
    expect(onHandChipState({ ...base, runwayWeeks: 8.9 })).toEqual({ label: 'On hand · ~9 wks', tone: 'quiet' })
    expect(onHandChipState({ ...base, runwayWeeks: 4 })).toEqual({ label: 'On hand · ~4 wks', tone: 'quiet' })
  })

  it('below 4 wks goes amber', () => {
    expect(onHandChipState({ ...base, runwayWeeks: 3.9 })).toEqual({ label: 'On hand · ~4 wks', tone: 'amber' })
    expect(onHandChipState({ ...base, runwayWeeks: 1.9 })).toEqual({ label: 'On hand · ~2 wks', tone: 'amber' })
    expect(onHandChipState({ ...base, runwayWeeks: 1 })).toEqual({ label: 'On hand · ~1 wk', tone: 'amber' })
  })

  it('below 1 wk goes red', () => {
    expect(onHandChipState({ ...base, runwayWeeks: 0.9 })).toEqual({ label: 'On hand · < 1 wk', tone: 'red' })
    expect(onHandChipState({ ...base, runwayWeeks: 0.27 })).toEqual({ label: 'On hand · < 1 wk', tone: 'red' })
  })

  it('started with no cadence demand shows the plain count, quietly', () => {
    expect(onHandChipState({ usable: 29, weeklySlotDemand: 0, started: true, runwayWeeks: null }))
      .toEqual({ label: 'On hand · 29', tone: 'quiet' })
  })
})

// Home restock nudge (Moments IA ⑤ — mockup §04): renders ONLY while
// started && runwayWeeks < 2. All four states, incl. not-started-stays-quiet.
describe('restockNudgeState', () => {
  it('not started stays QUIET — never an alarm before the first capture', () => {
    expect(restockNudgeState({ usable: 0, weeklySlotDemand: 15, started: false, runwayWeeks: 0, gaps: [] })).toBeNull()
    expect(restockNudgeState(null)).toBeNull()
  })

  it('healthy runway shows nothing (movebetter today, ~8.9 wks)', () => {
    expect(restockNudgeState({ ...base, runwayWeeks: 8.9, gaps: [] })).toBeNull()
  })

  it('amber-but-not-low (2 ≤ wks < 4) still shows nothing — the chip carries it', () => {
    expect(restockNudgeState({ ...base, runwayWeeks: 2, gaps: [] })).toBeNull()
    expect(restockNudgeState({ ...base, runwayWeeks: 3.5, gaps: [] })).toBeNull()
  })

  it('low runway (< 2 wks) fires with a day count, gap topics riding along', () => {
    expect(restockNudgeState({ ...base, runwayWeeks: 0.4, gaps: [] })).toEqual({ days: 3, gaps: [] })
    const gaps = [{ id: 'g1', topic: 'knee pain' }]
    expect(restockNudgeState({ ...base, runwayWeeks: 1.9, gaps })).toEqual({ days: 13, gaps })
    // floor at 1 day so it never reads "about 0 days"
    expect(restockNudgeState({ ...base, runwayWeeks: 0.05, gaps: [] })).toEqual({ days: 1, gaps: [] })
  })

  it('no cadence demand (runway null) never fires', () => {
    expect(restockNudgeState({ usable: 29, weeklySlotDemand: 0, started: true, runwayWeeks: null, gaps: [] })).toBeNull()
  })
})
