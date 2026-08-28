// api/_lib/citations/verifyRubric.js
//
// SINGLE SOURCE OF TRUTH for the citation-verification judge prompt + parser.
// Given a claim and a candidate source's REAL fetched content, the judge rules
// whether the source genuinely supports the SPECIFIC claim — not "is this
// source generally about the same topic," which is a much weaker bar that
// would rubber-stamp adjacent-but-wrong papers (the exact bug that shipped
// fabricated citations in the first place, just one layer up: a URL that
// LOOKS plausible for the topic but says something else).
//
// PURE (buildVerifyPrompt / parseVerifyResult): no env, no network. The judge
// NEVER supplies the url/title in its output — verify.js and pipeline.js only
// ever read {support, confidence, why} from the judge and attach that verdict
// to the candidate object retrieval already produced. There is no code path
// through which the judge's response could substitute a different URL; the
// parser here doesn't even define a "url" field, so nothing downstream could
// accidentally read one from it. This is the load-bearing anti-fabrication
// guard — see tests/lib/citationPipelineAntiFabrication.test.js.

import { extractJsonObject } from '../jsonFromModel.js'

export const VERIFY_MODEL = 'anthropic/claude-sonnet-4-6' // judging content-match is a reasoning task; haiku under-performed on subtle mismatches in manual spot checks — see PR description for the tradeoff note

/**
 * Build the verification judge prompt. Pure.
 * @param {{claimText: string, candidateTitle: string, candidateContent: string, sourceType: string}} p
 * @returns {{instructions: string, user: string}}
 */
export function buildVerifyPrompt({ claimText, candidateTitle, candidateContent, sourceType }) {
  const instructions = `You are a strict fact-checker. You are given a CLAIM from a health/chiropractic blog post and the REAL, actual content of a candidate source (fetched directly, not from memory). Decide whether this SPECIFIC source genuinely supports this SPECIFIC claim.

Be strict. "About the same general topic" is NOT enough — the source's actual content must support the specific assertion in the claim. A source that discusses a related but different mechanism, a different population, a different condition, or reaches a different conclusion does NOT support the claim, even if it shares keywords.

${sourceType === 'reputable_health_ed' ? 'This source is a health-education site (not peer-reviewed). Only count it as supporting if the page itself is citing or reflecting primary research, not just general wellness advice.' : ''}

If the provided content is too short, is clearly the wrong page (e.g. a paywall notice, an error page, a login screen, or an unrelated article), rule support:false and say why in one line.

Return ONLY a JSON object of this exact shape, nothing else:
{"support": true or false, "confidence": a number 0 to 1, "why": "one sentence, plain language, quoting or paraphrasing the specific part of the source that supports (or fails to support) the claim"}

Do NOT include a url, title, or source field in your response — you are being asked to judge, not to identify or re-state the source; those come from elsewhere.`

  const user = `CLAIM:\n${claimText}\n\nCANDIDATE SOURCE TITLE: ${candidateTitle || '(no title available)'}\n\nCANDIDATE SOURCE CONTENT (real, fetched):\n${String(candidateContent || '').slice(0, 6000) || '(empty — could not fetch content)'}\n\nReturn the JSON verdict now.`

  return { instructions, user }
}

/**
 * Parse the judge's verdict. Pure. Deliberately narrow: only ever reads
 * support/confidence/why off the parsed object. Any other key the model might
 * hallucinate (including a "url") is silently ignored — there is no code path
 * here that could surface a model-supplied URL.
 * @param {string} rawText
 * @returns {{support: boolean, confidence: number, why: string}|null}
 */
export function parseVerifyResult(rawText) {
  const obj = extractJsonObject(rawText)
  if (!obj || typeof obj.support !== 'boolean') return null
  const confidence = typeof obj.confidence === 'number' && Number.isFinite(obj.confidence)
    ? Math.min(Math.max(obj.confidence, 0), 1)
    : 0
  const why = typeof obj.why === 'string' ? obj.why.trim().slice(0, 500) : ''
  return { support: obj.support, confidence, why }
}
