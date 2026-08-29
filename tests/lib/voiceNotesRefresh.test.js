import { test, expect } from 'vitest'
import {
  shouldRefreshVoiceNotes,
  selectEditPairs,
  buildAnalysisPrompt,
  VOICE_NOTES_COOLDOWN_MS,
} from '../../api/_lib/voiceNotesRefresh.js'

// The edit-learning loop now fires automatically on approve (Q, 2026-08-29),
// so these two rules decide how often a paid model call happens and what it
// learns from. Both were previously implicit in a route nobody ever called.

const NOW = Date.parse('2026-08-29T12:00:00.000Z')

test('a clinician who has never been analyzed is due — the 0-of-20 case', () => {
  expect(shouldRefreshVoiceNotes({ voice_notes_refreshed_at: null }, NOW)).toBe(true)
  expect(shouldRefreshVoiceNotes({}, NOW)).toBe(true)
})

test('inside the cooldown it does NOT re-run — this is the cost guard', () => {
  // Approving several pieces in one sitting must not bill a model call each.
  const yesterday = new Date(NOW - 24 * 60 * 60 * 1000).toISOString()
  expect(shouldRefreshVoiceNotes({ voice_notes_refreshed_at: yesterday }, NOW)).toBe(false)
})

test('past the cooldown it runs again', () => {
  const old = new Date(NOW - VOICE_NOTES_COOLDOWN_MS - 1000).toISOString()
  expect(shouldRefreshVoiceNotes({ voice_notes_refreshed_at: old }, NOW)).toBe(true)
})

test('the cooldown boundary is inclusive', () => {
  const exactly = new Date(NOW - VOICE_NOTES_COOLDOWN_MS).toISOString()
  expect(shouldRefreshVoiceNotes({ voice_notes_refreshed_at: exactly }, NOW)).toBe(true)
  const justInside = new Date(NOW - VOICE_NOTES_COOLDOWN_MS + 1000).toISOString()
  expect(shouldRefreshVoiceNotes({ voice_notes_refreshed_at: justInside }, NOW)).toBe(false)
})

test('an unreadable timestamp is treated as stale, not as fresh', () => {
  // Failing "fresh" would silently disable learning forever for that row.
  expect(shouldRefreshVoiceNotes({ voice_notes_refreshed_at: 'not-a-date' }, NOW)).toBe(true)
})

test('no staff row is never due (and never throws)', () => {
  expect(shouldRefreshVoiceNotes(null, NOW)).toBe(false)
  expect(shouldRefreshVoiceNotes(undefined, NOW)).toBe(false)
})

test('only genuinely edited drafts count as teaching signal', () => {
  const pairs = selectEditPairs([
    { ai_original_content: 'a', content: 'a' },              // untouched
    { ai_original_content: '  same  ', content: 'same' },     // whitespace only
    { ai_original_content: 'orig', content: 'rewritten' },    // real edit
    { ai_original_content: null, content: 'x' },              // no original
    { ai_original_content: 'y', content: null },              // no content
    null,                                                     // malformed row
  ])
  expect(pairs.length).toBe(1)
  expect(pairs[0].content).toBe('rewritten')
})

test('selectEditPairs caps the batch and tolerates junk input', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ ai_original_content: `o${i}`, content: `e${i}` }))
  expect(selectEditPairs(many).length).toBe(12)
  expect(selectEditPairs(null)).toEqual([])
  expect(selectEditPairs(undefined)).toEqual([])
})

test('the prompt carries both sides of each edit', () => {
  const p = buildAnalysisPrompt('Zach Cullen', 'Move Better', [
    { platform: 'blog', topic: 'breathing', ai_original_content: 'THE-ORIGINAL', content: 'THE-EDIT' },
  ])
  expect(p).toMatch(/THE-ORIGINAL/)
  expect(p).toMatch(/THE-EDIT/)
  expect(p).toMatch(/Move Better/)
  expect(p).toMatch(/ZACH CULLEN/)
})

test('buildAnalysisPrompt does not throw on a missing staff name', () => {
  expect(() =>
    buildAnalysisPrompt(null, 'Move Better', [
      { platform: 'blog', topic: 't', ai_original_content: 'a', content: 'b' },
    ])).not.toThrow()
})
