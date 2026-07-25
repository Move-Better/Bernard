import { describe, it, expect } from 'vitest'
import { buildAnswerFidelityPrompt } from '../../api/_lib/answerFidelityRubric.js'

// The safety dimension is drawn at GENERAL TEACHING vs INDIVIDUAL INSTRUCTION.
// The first version said only "NEVER prescribe treatment", so the judge scored
// ordinary public guidance ("short, quick steps keep you over your feet") as a
// safety breach and held a sound answer at 6.0 — see the calibration note in
// answerFidelityRubric.js.
//
// These assert the CONTRACT SENT TO THE JUDGE, which is what actually moves the
// score. They are the tripwire against someone re-tightening the line without
// re-running the old-vs-new comparison on the real queue.
const prompt = () =>
  buildAnswerFidelityPrompt({
    question: 'How can I improve my running form?',
    condition: 'Running',
    answerLead: 'Short, quick steps tend to keep you over your feet.',
    body: 'A lot of the runners I see are in very cushioned shoes.',
    reference: 'Dr. Q on running: power comes from the hips, the calf absorbs.',
    phrases: [{ phrase: 'we watch you move' }],
    voiceNotes: 'warm, plain, first-person plural',
    staffName: 'Dr. Q',
    workspaceName: 'Move Better',
  })

describe('answer safety rubric — general teaching vs individual instruction', () => {
  it('names the general-vs-individual distinction explicitly', () => {
    const { instructions } = prompt()
    expect(instructions).toMatch(/GENERAL TEACHING.*INDIVIDUAL INSTRUCTION/s)
  })

  it('tells the judge that general guidance is NOT a safety problem', () => {
    const { instructions } = prompt()
    expect(instructions).toMatch(/NOT safety problems/i)
    // the exact phrasing the clinician flagged as guidance, not prescription
    expect(instructions).toContain('short, quick steps')
    expect(instructions).toMatch(/Do NOT penalize/i)
  })

  it('still instructs the judge to fail the genuinely unsafe cases', () => {
    const { instructions } = prompt()
    for (const unsafe of [
      /diagnosing the reader/i,
      /dosing/i,
      /fabricating a study/i,
      /bowel\/bladder/i,
    ]) {
      expect(instructions).toMatch(unsafe)
    }
  })

  it('does not penalize a missing disclaimer', () => {
    const { instructions, user } = prompt()
    expect(instructions).toMatch(/not as a ritual disclaimer|not repeating a "see a professional"/i)
    expect(user).toMatch(/Do NOT mark down[\s\S]*missing disclaimer/i)
  })

  it('anchors the safety scale so 1 is reserved for real harm, not guidance', () => {
    const { user } = prompt()
    // 1 must mean diagnosing/prescribing/fabricating — not "gave advice"
    expect(user).toMatch(/1 = diagnoses the reader/i)
    expect(user).toMatch(/individualized treatment plan or dosing/i)
  })

  it('keeps red_flag from citing guidance or a missing disclaimer', () => {
    const { user } = prompt()
    expect(user).toMatch(/Do NOT cite[\s\S]*general guidance/i)
  })

  // Non-vacuity: these assertions must be able to fail. If the safety block were
  // ever dropped wholesale, the checks above would go red rather than pass on an
  // empty string.
  it('the safety block is actually present and substantial', () => {
    const { instructions } = prompt()
    const start = instructions.indexOf('(3) SAFETY')
    const end = instructions.indexOf('CRITICAL — you are NOT')
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    expect(end - start).toBeGreaterThan(800)
  })
})
