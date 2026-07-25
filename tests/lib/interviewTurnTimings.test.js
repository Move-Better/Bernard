// Tests for sanitizeTurnTimings — the guard on interviews.turn_timings
// (migration 188), where client-supplied speech windows become stored jsonb.
//
// Why this is worth a test rather than eyeballing: the consumer of this column
// does arithmetic on startedAt/endedAt to map a conversational turn onto a
// separately-recorded video timeline. A NaN or a reversed window doesn't throw
// anywhere — it silently produces a nonsense clip boundary. The sanitizer is
// the only place that can catch it, so it needs to actually reject, not just
// pass the happy path.
//
// The handler reads SUPABASE_URL / SUPABASE_SERVICE_KEY at module load, so set
// them before the dynamic import (same pattern as topicSignalWebhook.test.js).

import { describe, it, expect } from 'vitest'

process.env.SUPABASE_URL = 'http://supabase.test'
process.env.SUPABASE_SERVICE_KEY = 'service-key'

const { sanitizeTurnTimings } = await import('../../api/_routes/db/interviews.js')

// A realistic pair: Bernard asks (4.1s), a beat of silence, the clinician
// answers (12.4s). Epoch ms, as PhoneCall.jsx records them.
const ASK    = { role: 'assistant', startedAt: 1_800_000_000_000, endedAt: 1_800_000_004_100 }
const ANSWER = { role: 'user',      startedAt: 1_800_000_005_600, endedAt: 1_800_000_018_000 }

describe('sanitizeTurnTimings', () => {
  it('keeps a well-formed ask/answer pair in order', () => {
    const out = sanitizeTurnTimings([ASK, ANSWER])
    // Non-vacuity: if the filter chain ever over-rejects, every other
    // assertion below would still pass against an empty array.
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual(ASK)
    expect(out[1]).toEqual(ANSWER)
  })

  it('preserves ordering rather than sorting or grouping by role', () => {
    // Alignment reads this array as "what happened, in order". Two consecutive
    // user windows (clinician pauses mid-answer past the VAD tail) must stay
    // adjacent and stay after the ask.
    const second = { role: 'user', startedAt: 1_800_000_020_000, endedAt: 1_800_000_025_000 }
    const out = sanitizeTurnTimings([ASK, ANSWER, second])
    expect(out.map((w) => w.role)).toEqual(['assistant', 'user', 'user'])
    expect(out.map((w) => w.startedAt)).toEqual([ASK.startedAt, ANSWER.startedAt, second.startedAt])
  })

  it('drops a window with an unrecognized role', () => {
    const out = sanitizeTurnTimings([ASK, { role: 'system', startedAt: 1, endedAt: 2 }])
    expect(out).toHaveLength(1)
    expect(out[0].role).toBe('assistant')
  })

  it('drops a window whose timestamps coerce to NaN', () => {
    // NOTE: these are caught by the endedAt >= startedAt comparison, not by the
    // isFinite check — every comparison against NaN is false. Kept because the
    // inputs are realistic (a dropped field, a string that failed to parse),
    // but see the next test for what isFinite is actually load-bearing for.
    const out = sanitizeTurnTimings([
      ASK,
      { role: 'user', startedAt: 'not-a-number', endedAt: 5 },
      { role: 'user', startedAt: 1, endedAt: undefined },
      { role: 'user', startedAt: Infinity, endedAt: 9 },
    ])
    expect(out).toEqual([ASK])
  })

  it('drops an infinite window that would pass the ordering check', () => {
    // This is the case the isFinite filter exists for, and the only one that
    // distinguishes it: Infinity >= Infinity is TRUE, so without isFinite these
    // would be stored, and the downstream duration (endedAt - startedAt) would
    // come out NaN instead of erroring anywhere visible.
    const out = sanitizeTurnTimings([
      { role: 'user', startedAt: Infinity, endedAt: Infinity },
      { role: 'assistant', startedAt: -Infinity, endedAt: Infinity },
      ASK,
    ])
    expect(out).toEqual([ASK])
  })

  it('drops a reversed window but keeps a zero-length one', () => {
    // endedAt < startedAt is impossible from the recorder and would produce a
    // negative-duration cut. endedAt === startedAt is legitimate: a very short
    // assistant turn can open and close inside the same millisecond.
    const reversed = { role: 'user', startedAt: 500, endedAt: 100 }
    const instant  = { role: 'assistant', startedAt: 700, endedAt: 700 }
    const out = sanitizeTurnTimings([reversed, instant])
    expect(out).toEqual([instant])
  })

  it('coerces numeric strings, since JSON round-trips can widen the type', () => {
    const out = sanitizeTurnTimings([{ role: 'user', startedAt: '1000', endedAt: '2000' }])
    expect(out).toEqual([{ role: 'user', startedAt: 1000, endedAt: 2000 }])
  })

  it('caps the array so a client cannot push unbounded jsonb', () => {
    const many = Array.from({ length: 2500 }, (_, i) => ({
      role: 'user', startedAt: i * 10, endedAt: i * 10 + 5,
    }))
    expect(sanitizeTurnTimings(many)).toHaveLength(2000)
  })

  it('returns an empty array for null, undefined, and non-array input', () => {
    expect(sanitizeTurnTimings(null)).toEqual([])
    expect(sanitizeTurnTimings(undefined)).toEqual([])
    expect(sanitizeTurnTimings('[]')).toEqual([])
    expect(sanitizeTurnTimings({ role: 'user' })).toEqual([])
  })

  it('survives null and primitive entries inside the array', () => {
    const out = sanitizeTurnTimings([null, undefined, 42, 'x', ASK])
    expect(out).toEqual([ASK])
  })
})
