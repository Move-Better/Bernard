// api/_lib/citations/claimExtraction.js
//
// Pulls 1-3 claims worth backing with a real source out of a finished blog
// draft. Same pure-prompt-builder + parser split as captionFidelityRubric.js
// (api/_lib/captionFidelityRubric.js) so the LLM-calling glue (claimExtraction
// pipeline step) stays testable without a live model.
//
// Per the spec: mechanism statements, "imaging correlates poorly with
// pain"-type claims, protocol references — the kind of assertion a clinician
// makes that genuinely benefits from a citation. Personal anecdotes and
// patient stories get nothing (deliberately; PHI + voice-fidelity concerns,
// and a citation on a personal story reads as clinical-washing an anecdote).
//
// PURE (buildClaimExtractionPrompt / parseClaimExtractionResult): no env, no
// network. extractClaims (bottom) is the only network-touching export.

import { extractJsonObject } from '../jsonFromModel.js'

export const CLAIM_EXTRACTION_MODEL = 'anthropic/claude-haiku-4-5' // structured extraction, not creative writing — cheap tier is right per "pick the judge model empirically"

/**
 * Build the claim-extraction prompt. Pure.
 * @param {string} draftBody — the finished blog/series-part markdown
 * @param {string} [subjectContext] — a one-line description of who/what this
 *   content is about (e.g. a workspace's clinic_context), so claim_text search
 *   queries stay subject-appropriate even for a non-human workspace (equine,
 *   small-animal). Optional — when absent, the prompt is IDENTICAL to before
 *   this parameter existed (backward compatible for every existing caller).
 * @returns {{ instructions: string, user: string }}
 */
export function buildClaimExtractionPrompt(draftBody, subjectContext) {
  const subjectBlock = subjectContext
    ? `\nSUBJECT OF THIS CONTENT: ${subjectContext}\n\nWhen phrasing "claim_text" (the search-query version of the claim), make the subject/population explicit whenever the claim is at all population- or species-specific — even if the sentence it's drawn from doesn't spell it out. For example, a mechanism claim written for an equine practice should be phrased as "...in horses", one written for a small-animal practice as "...in dogs" or "...in cats" as appropriate, and one written for human patients should stay about human patients. This keeps the research search aimed at a source about the right subject, not just the right mechanism.\n`
    : ''

  const instructions = `You read a finished blog post written for a chiropractic/health clinic's website and identify which specific claims, if any, would genuinely benefit from a linked, real, verifiable source.
${subjectBlock}
A claim is a candidate ONLY if it is a general clinical/mechanistic assertion a clinician made — how a condition works, what research generally shows, a protocol or guideline reference, a "studies show X" style statement. Do NOT select:
- Personal anecdotes or specific patient stories (never link these — privacy and voice concerns, not a citation gap).
- The clinician's own opinion or clinic-specific claims about what THEY do.
- Anything already so well-established it reads as common knowledge with no real controversy or specificity to back.

Select 0 to 3 claims. Fewer is fine — a post with nothing citation-worthy should return an empty list. Never force 3 just to fill it.

For each selected claim, return:
- "claim_text": the claim in your own words, phrased as something you'd type into a research search engine to find a supporting source (specific and searchable, not a vague topic).
- "quote": the exact sentence or phrase from the post this claim is drawn from (verbatim substring of the post, for traceability).

Return ONLY a JSON object of the shape:
{"claims": [{"claim_text": "...", "quote": "..."}]}
No prose before or after the JSON.`

  const user = `BLOG POST:\n\n${String(draftBody || '').slice(0, 8000)}\n\nReturn the JSON now.`

  return { instructions, user }
}

/**
 * Parse the model's claim-extraction response. Pure. Tolerant of a missing or
 * malformed response — always returns an array (possibly empty), never throws,
 * because "the model didn't return usable JSON" must degrade to "no claims
 * found this run," not crash the enrichment pass.
 * @param {string} rawText
 * @returns {Array<{claim_text: string, quote: string}>}
 */
export function parseClaimExtractionResult(rawText) {
  const obj = extractJsonObject(rawText)
  const claims = Array.isArray(obj?.claims) ? obj.claims : []
  return claims
    .filter((c) => c && typeof c.claim_text === 'string' && c.claim_text.trim())
    .slice(0, 3)
    .map((c) => ({
      claim_text: c.claim_text.trim(),
      quote: typeof c.quote === 'string' ? c.quote.trim() : '',
    }))
}

/**
 * Extract claims from a draft body. Network (calls the model via the AI
 * Gateway). The only impure export in this file.
 * @param {string} draftBody
 * @param {{generateTextFn?: Function, subjectContext?: string}} [deps] — injectable for tests; subjectContext optional, see buildClaimExtractionPrompt
 * @returns {Promise<Array<{claim_text: string, quote: string}>>}
 */
export async function extractClaims(draftBody, { generateTextFn, subjectContext } = {}) {
  const body = String(draftBody || '').trim()
  if (!body) return []

  const { instructions, user } = buildClaimExtractionPrompt(body, subjectContext)
  let generate = generateTextFn
  if (!generate) {
    const { generateText } = await import('ai')
    generate = generateText
  }
  const { text } = await generate({
    model: CLAIM_EXTRACTION_MODEL,
    instructions,
    messages: [{ role: 'user', content: user }],
    maxOutputTokens: 800,
  })
  return parseClaimExtractionResult(text)
}
