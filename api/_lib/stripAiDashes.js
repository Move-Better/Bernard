// Deterministic post-generation cleanup: replace dashes used as CLAUSE
// CONNECTORS with a comma. The spaced/em-dash-as-connector is a strong AI tell
// (staff have flagged it repeatedly), and a prompt instruction alone is
// unreliable — the model is shown em-dashed CTA/example lines it emulates, so
// this is the belt to the prompt's suspenders. See ~/.claude/CLAUDE.md
// "A target the model IGNORES is not a tuning problem".
//
// Scope is deliberately narrow — only dashes acting as connectors are touched:
//   - Em-dash (—) between two non-space chars → comma. Em-dashes are never a
//     numeric range, so any em-dash joining content is a connector.
//   - En-dash (–) or spaced ASCII hyphen ( - ) flanked by LETTERS → comma.
//     Letter-flanking preserves numeric ranges (30–40, "3 - 5") and in-word /
//     hashtag hyphens (#Portland-PT, warm-up), which are not AI tells.
//
// Idempotent: a second pass finds no connector dashes and is a no-op.
export function stripAiDashes(text) {
  if (typeof text !== 'string' || !text) return text
  return text
    .replace(/(\S)\s*—\s*(?=\S)/g, '$1, ')
    .replace(/([A-Za-z])\s*–\s*(?=[A-Za-z])/g, '$1, ')
    .replace(/([A-Za-z]) +- +(?=[A-Za-z])/g, '$1, ')
}
