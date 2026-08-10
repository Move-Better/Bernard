// Publish-layer guardrail for "Make a point" content (Phase 2).
//
// A point interview (interviews.kind='point') is a first-person account of the
// author's OWN experience, not clinical guidance. When its transcript becomes
// content, the non-diagnostic framing is applied HERE — at generation — rather
// than muzzling the interview itself (the host is deliberately kept alive and
// reactive; the guardrail lives at the publish layer). See
// .claude/make-a-point-spec.md.
//
// Channel-aware, because "the caveat is the tail and short formats truncate it":
//   - short (social atoms: IG / FB / LinkedIn / GBP) → strictly experiential,
//     NO mechanism claim (nothing to hedge, nothing to get truncated).
//   - long  (blog / newsletter) → experiential + a lightly-hedged mechanism and
//     a woven n=1 caveat (there's room to do it responsibly).
//
// Single shared helper on purpose: getAtomSystemPrompt (server) and
// getBlogPostSystemPrompt / getNewsletterSystemPrompt (client) must not drift.
// Returns '' when the source is not a point interview, so every non-point path
// stays byte-identical.

/**
 * @param {{ isPoint?: boolean, format?: 'short' | 'long' }} opts
 * @returns {string} a prompt block (leading newlines included) or '' when not a point.
 */
export function pointContentFraming({ isPoint = false, format = 'short' } = {}) {
  if (!isPoint) return ''

  if (format === 'long') {
    return `

POINT CONTENT: this piece is drawn from a personal point the author is making about their OWN lived experience, not clinical guidance:
- Tell it in the first person: their story, their body, the concrete details, the result. Preserve "I"/"my"; do not convert to clinic voice.
- You MAY touch the "why" (a possible mechanism), but frame it as generally-accepted or open ("what the research generally suggests", "one likely explanation"), never as established fact for the reader, and never prescriptive.
- Weave an honest n=1 caveat in naturally (this is one person's experience, not medical advice, results vary). Do NOT tack on a boilerplate disclaimer line.
- The reader takeaway is an invitation to notice or consider, not an instruction to follow.`
  }

  return `

POINT CONTENT: this piece is drawn from a personal point the author is making about their OWN lived experience, not clinical guidance:
- Tell it as first-person lived experience: what happened to them, and the result. Their story, their body. Preserve "I"/"my".
- Do NOT state a mechanism or causal claim ("X improves Y", "this works because…"). On a short format there's no room to hedge it responsibly, so leave it out entirely.
- No prescription, no "you should", no dosing or protocol. It's an observation, not advice.
- The hook is the surprising personal result itself, never a health claim.`
}
