// F6 Phase 3 — supersession conflict judge.
//
// Given a NEWER and an OLDER chunk from the SAME clinician on a similar topic,
// classify their relationship. The moat feature is "newer thinking overrides
// older" — but the dominant real signal in this corpus is DERIVATION (a blog
// generated from its own interview; a re-published article), NOT a change of
// position. So the judge's first duty is to NOT false-positive: only a genuine
// CHANGE OF STANCE counts as supersession, because wrongly suppressing valid
// content is the expensive error. Conservative by design.
//
// Never throws — returns a structured result so callers can fire-and-forget.
// Validate with scripts/validate-supersession-judge.mjs before trusting it to
// gate suppression (see memory/feedback-validate-the-validator.md).

import { generateObject } from 'ai'
import { z } from 'zod'

const MODEL = 'anthropic/claude-sonnet-4-6'

export const SUPERSESSION_RELATIONSHIPS = ['supersedes', 'refines', 'duplicate', 'compatible', 'unrelated']

const schema = z.object({
  relationship: z.enum(['supersedes', 'refines', 'duplicate', 'compatible', 'unrelated'])
    .describe('How the NEWER statement relates to the OLDER one.'),
  confidence: z.number().min(0).max(1).describe('0-1 confidence in the relationship call.'),
  rationale: z.string().describe('One sentence: why this relationship, quoting the changed claim if supersedes.'),
})

const SYSTEM = `You compare two statements from the SAME author (a clinician) on a similar topic — a NEWER one and an OLDER one — and classify how the newer relates to the older. Output one relationship.

Definitions (be strict and conservative):
- "supersedes": the author's POSITION HAS CHANGED. The newer statement contradicts, retracts, or replaces the older stance, such that surfacing the older one would now MISLEAD (e.g. old: "I recommend bed rest for back pain"; new: "I no longer recommend bed rest — early movement heals faster"). Requires a real reversal or replacement of a claim, not just newer wording.
- "refines": the newer SHARPENS or EXTENDS the older (more detail, a caveat, a nuance) but the older is still TRUE and not contradicted.
- "duplicate": the same idea re-expressed — including a post DERIVED FROM the other (a blog written from an interview transcript), a re-publication, or a near-verbatim rewrite. No new position.
- "compatible": same broad topic but different facets/angles; both valid, neither updates the other.
- "unrelated": not actually about the same specific claim.

Critical guardrails:
- DERIVATION IS NOT SUPERSESSION. If the newer simply restates, summarizes, or is generated from the older (common: a blog and the interview it came from read near-identically), that is "duplicate", never "supersedes".
- Default to the NON-supersedes label when uncertain. Only choose "supersedes" when you can name the specific older claim that the newer one reverses or replaces. Wrongly flagging supersession suppresses valid content — avoid it.`

/**
 * Judge whether newerText supersedes olderText.
 * @returns {Promise<{relationship:string, confidence:number, rationale:string, error?:string}>}
 */
export async function judgeSupersession({ newerText, olderText, newerLabel = '', olderLabel = '' }) {
  const a = String(newerText || '').trim()
  const b = String(olderText || '').trim()
  if (!a || !b) return { relationship: 'unrelated', confidence: 0, rationale: 'empty input', error: 'empty-input' }

  try {
    const { object } = await generateObject({
      model: MODEL,
      schema,
      system: SYSTEM,
      prompt:
        `NEWER (${newerLabel || 'recent'}):\n"""${a.slice(0, 4000)}"""\n\n` +
        `OLDER (${olderLabel || 'earlier'}):\n"""${b.slice(0, 4000)}"""\n\n` +
        'Classify how the NEWER relates to the OLDER.',
    })
    return object
  } catch (e) {
    console.error(`[supersessionJudge] threw: ${e?.stack || e?.message}`)
    return { relationship: 'unrelated', confidence: 0, rationale: 'judge error', error: e?.message || String(e) }
  }
}

/**
 * Judge a pair N times and return the majority relationship + mean confidence.
 * Single-shot LLM judgments swing; supersession suppresses content, so require
 * a stable majority before acting (validate-the-validator: average >=3 samples).
 */
export async function judgeSupersessionStable({ newerText, olderText, newerLabel, olderLabel, samples = 3 }) {
  const runs = await Promise.all(
    Array.from({ length: samples }, () => judgeSupersession({ newerText, olderText, newerLabel, olderLabel }))
  )
  const tally = {}
  let confSum = 0
  for (const r of runs) {
    tally[r.relationship] = (tally[r.relationship] || 0) + 1
    confSum += r.confidence || 0
  }
  const [winner, votes] = Object.entries(tally).sort((x, y) => y[1] - x[1])[0]
  return {
    relationship: winner,
    votes,
    samples,
    agreement: votes / samples,
    meanConfidence: confSum / samples,
    runs: runs.map((r) => r.relationship),
  }
}
