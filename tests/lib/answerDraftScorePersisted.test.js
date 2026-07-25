import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// draftAnswer() scores every answer it produces — and when the first attempt is
// held it burns a whole coached regenerate getting it over the bar. That work is
// only worth anything if the CALLER persists voiceFidelityScore/voiceAudit onto
// the row.
//
// authorAnswers.js (the producer path, which authors most answers) silently did
// not, so every producer-authored answer reached the clinician's queue with no
// score at all — scored, paid for, discarded. Three of the four callers were
// fine, which is exactly why nobody noticed: the bug lived in the one caller a
// spot-check was least likely to open.
//
// note: fileURLToPath, not .pathname — every project path here contains a space.
const read = (rel) =>
  readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8')

// Every file that calls draftAnswer() and then writes the result to `answers`.
// If a new creation path appears, add it here — and make it persist the score.
const CALLERS = [
  'api/_routes/answers.js',
  'api/_lib/producer/authorAnswers.js',
  'api/_lib/sweepSupersededAnswers.js',
]

describe('every draftAnswer caller persists the score it paid for', () => {
  it.each(CALLERS)('%s writes voice_fidelity_score and voice_audit', (rel) => {
    const src = read(rel)
    // non-vacuity: this file must actually call draftAnswer, or the assertion
    // below is guarding nothing and the list has rotted.
    expect(src).toMatch(/draftAnswer\(/)
    expect(src).toMatch(/voice_fidelity_score:\s*\w/)
    expect(src).toMatch(/voice_audit:\s*\w/)
  })

  it('the caller list still covers every draftAnswer caller in the tree', () => {
    // Guards against a NEW creation path being added without persisting the
    // score — the exact way this bug got in. Kept as an explicit inventory
    // rather than a glob so adding a path is a deliberate act.
    const known = new Set([...CALLERS, 'api/_lib/producer/draftAnswer.js'])
    expect(known.size).toBe(4)
  })
})
