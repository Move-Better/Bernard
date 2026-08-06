// Deterministic post-generation cleanup: rejoin a hashtag the model split with a
// stray space (`#MovementIsM edicine` → `#MovementIsMedicine`). This is a raw
// model artifact in the generated caption — the space is baked into the stored
// content, then shipped verbatim to the live post. A prompt rule alone is
// unreliable (the model still slips a space in mid-tag), so this is the belt to
// the prompt's suspenders, same pattern as stripAiDashes.js.
//
// Reported live 2026-08-04: an Instagram post shipped
// "#MoveBetter #MovementIsM edicine #PhysicalTherapy …" — the broken "#MovementIsM"
// plus stray plain text "edicine".
//
// Scope is deliberately narrow — it only touches lines that are a HASHTAG CLUSTER
// (a line dominated by "#tag" tokens, which is how captions carry their tag block),
// so it can never rejoin legitimate prose like "Follow #MoveBetter online". Within
// such a line it rejoins a "#Tag" that is immediately followed by ` <word-run>`
// where that run is itself followed by another hashtag or the end of the line — the
// signature of a split, whether mid-word ("#MovementIsM edicine") or at a CamelCase
// boundary ("#Move Better"). A following token that starts with "#" (e.g.
// "#MovementIsMedicine #physicaltherapy") is never a continuation, so a normal
// lowercase final tag is left alone. A "#Tag word word" (two bare words) is
// ambiguous, so it is left alone rather than guessed at.
//
// Idempotent: a second pass finds no split tags and is a no-op.

// A line is a hashtag cluster when it starts with a hashtag and its tokens are
// mostly hashtags (≥60%) with at least two "#" tokens. A prose line that merely
// mentions a hashtag or two falls well below the threshold and is skipped.
function isHashtagLine(line) {
  const tokens = line.trim().split(/\s+/).filter(Boolean)
  if (tokens.length < 2) return false
  if (!tokens[0].startsWith('#')) return false
  const hashTokens = tokens.filter((t) => t.startsWith('#')).length
  return hashTokens >= 2 && hashTokens / tokens.length >= 0.6
}

export function fixBrokenHashtags(text) {
  if (typeof text !== 'string' || !text) return text
  return text
    .split('\n')
    .map((line) => {
      if (!isHashtagLine(line)) return line
      // Rejoin "#Word <run>" only when the run is followed by another hashtag or
      // the end of the line — i.e. it's a split-off tag tail, not a real word the
      // author meant to keep. Global so multiple independent splits on one line all
      // rejoin. A run followed by a non-hashtag token (e.g. "#A b c") is ambiguous
      // and the trailing lookahead deliberately leaves it untouched.
      return line.replace(/(#[A-Za-z0-9]+) +([A-Za-z]+)(?= *#| *$)/g, '$1$2')
    })
    .join('\n')
}
