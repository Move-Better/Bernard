import { describe, it, expect } from 'vitest'
import { extractJsonObject } from '../../api/_lib/jsonFromModel.js'
import { parseAnswerFidelity } from '../../api/_lib/answerFidelityRubric.js'
import { parseFidelity } from '../../api/_lib/captionFidelityRubric.js'

// The literal reply that blocked the "How can I improve my running form?" approval
// on 2026-07-24: a fenced object followed by a "**Rationale:**" essay that ran past
// the token cap, so the reply arrives truncated mid-prose. The object itself is
// complete — the old whole-string JSON.parse still returned null, which surfaced to
// the clinician as "Couldn't check the voice on this one".
const REAL_TRUNCATED_REPLY = `\`\`\`json
{
  "said_fidelity": 5,
  "voice_match": 8,
  "safety": 6,
  "red_flag": "Prescribes shoe removal and specific cadence/mechanics without recommending in-person assessment first"
}
\`\`\`

**Rationale:**

**said_fidelity (5):** No captured thinking exists for this topic, so scoring is capped at 5 per instructions. The answer's core logic (hips as engine, calves as shock absorbers) aligns with Dr. Q's captured voice about "pushing from the butt," but without a reference, faithfulness cannot be veri`

describe('extractJsonObject', () => {
  it('parses a clean object', () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 })
  })

  it('parses a fenced object', () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 })
  })

  it('recovers the object when prose trails it', () => {
    expect(extractJsonObject('{"a":1}\n\n**Rationale:** because reasons')).toEqual({ a: 1 })
  })

  it('recovers the object when prose precedes it', () => {
    expect(extractJsonObject('Here is my assessment:\n{"a":1}')).toEqual({ a: 1 })
  })

  it('is not fooled by a brace inside a string value', () => {
    expect(extractJsonObject('{"red_flag":"they said }{ oddly","a":1} trailing prose'))
      .toEqual({ red_flag: 'they said }{ oddly', a: 1 })
  })

  it('is not fooled by an escaped quote inside a string value', () => {
    expect(extractJsonObject('{"red_flag":"he said \\"rest\\" }","a":1} trailing'))
      .toEqual({ red_flag: 'he said "rest" }', a: 1 })
  })

  it('handles a nested object', () => {
    expect(extractJsonObject('pre {"a":{"b":2}} post')).toEqual({ a: { b: 2 } })
  })

  // Non-vacuity: these must genuinely be unrecoverable, or the tests above prove nothing.
  it('returns null when the object is truncated mid-way (unrecoverable)', () => {
    expect(extractJsonObject('{"said_fidelity": 5, "red_flag": "it was trunc')).toBeNull()
  })

  it('returns null on prose with no object at all', () => {
    expect(extractJsonObject('I cannot evaluate this answer.')).toBeNull()
  })

  it('returns null on empty input', () => {
    expect(extractJsonObject('')).toBeNull()
    expect(extractJsonObject(null)).toBeNull()
  })

  it('returns null on a bare JSON array (not an object)', () => {
    expect(extractJsonObject('[1,2,3]')).toBeNull()
  })
})

describe('parseAnswerFidelity — the real 2026-07-24 approval blocker', () => {
  it('scores the reply that previously returned null', () => {
    const parsed = parseAnswerFidelity(REAL_TRUNCATED_REPLY)
    expect(parsed).not.toBeNull()
    expect(parsed.breakdown.said_fidelity).toBe(5)
    expect(parsed.breakdown.voice_match).toBe(8)
    expect(parsed.breakdown.safety).toBe(6)
    // mean of 5, 8, 6
    expect(parsed.overall).toBe(6.33)
  })

  it('the OLD whole-string parse would have failed on it — proving the fix is load-bearing', () => {
    const stripped = REAL_TRUNCATED_REPLY.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    expect(() => JSON.parse(REAL_TRUNCATED_REPLY)).toThrow()
    expect(() => JSON.parse(stripped)).toThrow()
  })

  it('still fails closed when nothing scorable is present', () => {
    expect(parseAnswerFidelity('I refuse to score this.')).toBeNull()
    expect(parseAnswerFidelity('{"notes":"no dimensions here"}')).toBeNull()
  })

  it('clamps out-of-range scores', () => {
    const parsed = parseAnswerFidelity('{"said_fidelity":99,"voice_match":-4,"safety":5}')
    expect(parsed.breakdown.said_fidelity).toBe(99) // raw kept for audit
    expect(parsed.overall).toBe(5.33) // clamped to 10, 1, 5
  })
})

describe('parseFidelity (captions) — same helper, same recovery', () => {
  it('recovers a fenced object with trailing prose', () => {
    const parsed = parseFidelity(
      '```json\n{"said_fidelity":7,"voice_match":8,"naturalness":7,"tightness":6}\n```\n\nRationale: it reads well.',
    )
    expect(parsed).not.toBeNull()
    expect(parsed.overall).toBe(7)
  })

  it('fails closed on unscorable output', () => {
    expect(parseFidelity('no json here')).toBeNull()
  })
})
