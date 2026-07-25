// Claude sometimes hard-wraps generated prose with a `\n` at every soft
// line-wrap point instead of only at real paragraph breaks. Any UI that
// preserves whitespace (a plain <textarea>) then renders one paragraph as
// several visibly broken lines. Collapse single newlines into spaces while
// leaving real paragraph breaks (blank lines) and markdown structural lines
// (headings, list items) intact.
//
// Shared by every generator whose output lands in a whitespace-preserving
// editor: draftAnswer.js (answer_lead/body), draftAtom.js (caption),
// interviewSummarizer.js (summary_text), reviseContentItem.js /
// regradeContentItem.js (revised caption).
export function joinSoftWraps(text) {
  const raw = String(text || '')
  if (!raw.trim()) return raw
  const withParagraphBreaks = raw
    .replace(/\n(?=\s*#{1,6}\s)/g, '\n\n')
    .replace(/\n(?=\s*(?:[-*+]\s|\d+\.\s))/g, '\n\n')
  return withParagraphBreaks
    .split(/\n{2,}/)
    .map((block) => block.replace(/\n/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n')
}
