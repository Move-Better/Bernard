// T4 learning loop, part 2 — edit-diff mining.
//
// content_items.ai_original_content (migration 025) already captures the
// AI-drafted body alongside the staff-edited `content`, but the diff between
// them was never computed — the richest free signal Bernard has (what staff
// actually change before approving) was discarded. computeEditDiff() turns
// the pair into a small structured summary: length delta, a handful of the
// biggest changed phrases (word-level diff via the `diff` package already a
// project dependency — see src/components/DraftDiffView.jsx for the existing
// client-side use of diffWordsWithSpace), and hashtag/link adds+removes.
//
// Grounded against real movebetter rows (2026-07-21, Supabase MCP) before
// writing this: real edits observed were whole-sentence trims, phrase-level
// word swaps ("retract" → "move"), an I→we pronoun voice fix, and — the
// clearest CTA signal — a stray unrelated link removed before publish.
//
// Scope (see .claude/decisions.md 2026-07-21 T4 scoping): capture + surface
// in the weekly digest ONLY. Not read by any generation/prompt-weighting path.

import { diffWordsWithSpace } from 'diff'

const HASHTAG_RE = /#[A-Za-z0-9_]+/g
const URL_RE = /https?:\/\/\S+/g

// Ignore lone-punctuation diff chunks (a comma, an em-dash) — noise, not
// signal. Deliberately low: a real grounding pass (2026-07-21) found staff
// making meaningful short single-word corrections (e.g. "retract" → "move"),
// which a higher threshold would silently drop as "too small to matter."
const MIN_PHRASE_CHARS = 3
// Cap stored phrases so a full rewrite can't balloon the jsonb column.
const MAX_PHRASES = 8

function extractTokens(text, re) {
  return [...(text || '').matchAll(re)].map((m) => m[0])
}

function tokenDiff(before, after) {
  const beforeSet = new Set(before)
  const afterSet = new Set(after)
  return {
    removed: before.filter((t) => !afterSet.has(t)),
    added: after.filter((t) => !beforeSet.has(t)),
  }
}

const EMPTY_DIFF = Object.freeze({
  changed: false,
  lengthDelta: 0,
  lengthDeltaPct: 0,
  removedPhrases: [],
  addedPhrases: [],
  hashtags: { removed: [], added: [] },
  links: { removed: [], added: [] },
})

/**
 * @param {string} original — ai_original_content (the AI's first draft)
 * @param {string} edited   — content (what staff approved)
 * @returns {{changed:boolean, lengthDelta:number, lengthDeltaPct:number,
 *   removedPhrases:string[], addedPhrases:string[],
 *   hashtags:{removed:string[],added:string[]},
 *   links:{removed:string[],added:string[]}}}
 */
export function computeEditDiff(original, edited) {
  const before = typeof original === 'string' ? original : ''
  const after = typeof edited === 'string' ? edited : ''
  if (!before || !after || before === after) return EMPTY_DIFF

  const parts = diffWordsWithSpace(before, after)
  const removedPhrases = []
  const addedPhrases = []
  for (const part of parts) {
    const text = part.value.trim()
    if (!text || text.length < MIN_PHRASE_CHARS) continue
    if (part.removed && removedPhrases.length < MAX_PHRASES) removedPhrases.push(text)
    else if (part.added && addedPhrases.length < MAX_PHRASES) addedPhrases.push(text)
  }

  const hashtags = tokenDiff(extractTokens(before, HASHTAG_RE), extractTokens(after, HASHTAG_RE))
  const links = tokenDiff(extractTokens(before, URL_RE), extractTokens(after, URL_RE))

  const lengthDelta = after.length - before.length
  const lengthDeltaPct = before.length ? Math.round((lengthDelta / before.length) * 100) : 0

  return { changed: true, lengthDelta, lengthDeltaPct, removedPhrases, addedPhrases, hashtags, links }
}

/** One-line human summary for the weekly digest. Returns null if nothing changed. */
export function summarizeEditDiff(diff) {
  if (!diff?.changed) return null
  const bits = []
  if (diff.lengthDelta !== 0) {
    const sign = diff.lengthDelta > 0 ? '+' : ''
    bits.push(`${sign}${diff.lengthDelta} chars (${sign}${diff.lengthDeltaPct}%)`)
  }
  const phraseCount = diff.removedPhrases.length + diff.addedPhrases.length
  if (phraseCount > 0) bits.push(`${phraseCount} phrase${phraseCount === 1 ? '' : 's'} changed`)
  if (diff.links.removed.length) bits.push(`${diff.links.removed.length} link${diff.links.removed.length === 1 ? '' : 's'} removed`)
  if (diff.links.added.length) bits.push(`${diff.links.added.length} link${diff.links.added.length === 1 ? '' : 's'} added`)
  if (diff.hashtags.removed.length) bits.push(`${diff.hashtags.removed.length} hashtag${diff.hashtags.removed.length === 1 ? '' : 's'} removed`)
  if (diff.hashtags.added.length) bits.push(`${diff.hashtags.added.length} hashtag${diff.hashtags.added.length === 1 ? '' : 's'} added`)
  return bits.join(', ') || null
}
