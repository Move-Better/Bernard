// Deterministic post-generation cleanup: replace dashes used as CLAUSE
// CONNECTORS with a comma. The spaced/em-dash-as-connector is a strong AI tell
// (staff have flagged it repeatedly), and a prompt instruction alone is
// unreliable, so this is the belt to the prompt's suspenders. See
// ~/.claude/CLAUDE.md "A target the model IGNORES is not a tuning problem".
//
// Scope is deliberately narrow. Only dashes acting as connectors are touched:
//   - Em-dash (—) between two non-space chars becomes a comma. An em-dash is
//     never a numeric range, so any em-dash joining content is a connector.
//   - En-dash (–) or spaced ASCII hyphen ( - ) becomes a comma when AT LEAST
//     ONE side is a letter. That one-letter rule is what preserves numeric
//     ranges: "30–40" and "3 - 5" are digit on both sides, so neither fires,
//     while "Week 1 – rest" and "2023 – a turning point" (digit/letter) do.
//     The mandatory spaces on the ASCII form keep in-word and hashtag hyphens
//     safe (#Portland-PT, warm-up), which are not AI tells.
//   - A dangling em/en-dash opening or closing the string is REMOVED rather
//     than commafied: "— Book now" is not a connector between two clauses, so
//     ", Book now" would be worse than the tell. A leading ASCII hyphen is
//     left alone because that is a bullet, not a dash.
//
// Markdown is safe by construction: "---" rules and "\n- item" list markers
// have no space-hyphen-space shape, so the ASCII rule cannot reach them.
//
// Idempotent: a second pass finds no connector dashes and is a no-op.
export function stripAiDashes(text) {
  if (typeof text !== 'string' || !text) return text
  return text
    // Dangling opener/closer first, so the connector rules below (which both
    // require content on the far side) can't be fooled by a string-edge dash.
    .replace(/^[ \t]*[—–][ \t]*/, '')
    .replace(/[ \t]*[—–][ \t]*$/, '')
    // Em-dash: any content on both sides is a connector.
    .replace(/(\S)\s*—\s*(?=\S)/g, '$1, ')
    // En-dash: letter on the left, anything on the right...
    .replace(/([A-Za-z])\s*–\s*(?=\S)/g, '$1, ')
    // ...or anything on the left, letter on the right. Digit-on-both-sides
    // matches neither, which is exactly how ranges survive.
    .replace(/(\S)\s*–\s*(?=[A-Za-z])/g, '$1, ')
    // Spaced ASCII hyphen: same one-letter rule, spaces mandatory.
    .replace(/([A-Za-z]) +- +(?=\S)/g, '$1, ')
    .replace(/(\S) +- +(?=[A-Za-z])/g, '$1, ')
}
