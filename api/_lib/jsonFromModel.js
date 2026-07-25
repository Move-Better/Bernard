// api/_lib/jsonFromModel.js
//
// Shared "get the JSON object out of a model response" helper for LLM-judge
// parsers. PURE: no env, no network, no side effects.
//
// Why this exists as ONE shared function: captionFidelityRubric.js grew a
// first-{...}-object recovery after the judge started appending prose, but its
// sibling answerFidelityRubric.js never did — so the answer gate returned null
// ~1 in 3 approvals and blocked the clinician with "couldn't check the voice".
// Two copies of the same primitive drift; one import cannot.
//
// Handles, in order: clean JSON, ```json fences, and a JSON object surrounded by
// preamble/trailing prose (a "**Rationale:**" essay after the object is the
// common case — it also blows the token cap, so the response arrives truncated
// mid-prose with the object itself intact and complete).

/**
 * Extract the first complete JSON object from a model response.
 * Brace-balanced and string-aware, so a `}` inside a string value (e.g. a
 * red_flag quoting the answer) can't terminate the scan early, and trailing
 * prose after the object is ignored rather than poisoning the parse.
 *
 * @param {string} rawText
 * @returns {object|null} the parsed object, or null if nothing parseable
 */
export function extractJsonObject(rawText) {
  const raw = String(rawText || '').trim()
  if (!raw) return null

  const tryParse = (s) => {
    try {
      const v = JSON.parse(s)
      return v && typeof v === 'object' && !Array.isArray(v) ? v : null
    } catch {
      return null
    }
  }

  const whole = tryParse(raw)
  if (whole) return whole

  const unfenced = tryParse(raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim())
  if (unfenced) return unfenced

  const start = raw.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < raw.length; i++) {
    const c = raw[i]
    if (escaped) { escaped = false; continue }
    if (c === '\\') { escaped = true; continue }
    if (c === '"') { inString = !inString; continue }
    if (inString) continue
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return tryParse(raw.slice(start, i + 1))
    }
  }
  return null
}
