import { describe, it, expect } from 'vitest'
import { sliceWordsToWindow, buildKaraokeAss } from '../../api/_lib/karaokeCaptions.js'

// Whisper quantises word timestamps to a 20ms frame hop, so a fast function
// word ("to", "the") or a clipped syllable legitimately comes back with
// end === start. Those are REAL spoken words. A guard written as `end > start`
// silently deletes them, which downstream reads as duplicated or reordered
// speech rather than as missing words — the failure mode that made captions
// render as nonsense.
//
// Real regression case, asset 50307030 (IMG_5690):
//   spoken   "…how to do, how fast to do high knees…"
//   stored   "…how do how fast…"        ← zero-duration "to" deleted
//
// These tests pin the whole chain against that. Each one fails on the old
// `end > start` / `we <= s` / `wEnd > start` predicates.

const w = (word, start, end) => ({ word, start, end })

describe('sliceWordsToWindow — zero-duration words survive', () => {
  it('keeps a zero-duration word inside the window', () => {
    const words = [w('how', 1.0, 1.2), w('to', 1.48, 1.48), w('do', 1.5, 1.7)]
    const out = sliceWordsToWindow(words, 0, 5)
    expect(out.map((x) => x.word)).toEqual(['how', 'to', 'do'])
  })

  it('reproduces the real IMG_5690 phrase without dropping words', () => {
    // Verbatim shape of the spoken disfluency that broke.
    const words = [
      w('how', 2.80, 2.94), w('to', 2.96, 2.96), w('do', 2.98, 3.10),
      w('how', 3.20, 3.36), w('fast', 3.38, 3.60),
    ]
    const out = sliceWordsToWindow(words, 0, 10)
    expect(out.map((x) => x.word).join(' ')).toBe('how to do how fast')
    // The exact corruption this fix exists to prevent.
    expect(out.map((x) => x.word).join(' ')).not.toBe('how do how fast')
  })

  it('treats a zero-duration word as a POINT at the window start (inside)', () => {
    const out = sliceWordsToWindow([w('to', 5, 5)], 5, 3)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ word: 'to', start: 0, end: 0 })
  })

  it('still excludes a zero-duration word at the window end (half-open)', () => {
    expect(sliceWordsToWindow([w('to', 8, 8)], 5, 3)).toHaveLength(0)
  })

  it('still excludes a zero-duration word before the window', () => {
    expect(sliceWordsToWindow([w('to', 4.9, 4.9)], 5, 3)).toHaveLength(0)
  })

  it('still rejects genuinely invalid geometry (end before start)', () => {
    expect(sliceWordsToWindow([w('bad', 3, 1)], 0, 10)).toHaveLength(0)
  })

  it('still rejects non-finite timings and empty words', () => {
    expect(sliceWordsToWindow([w('x', NaN, 1)], 0, 10)).toHaveLength(0)
    expect(sliceWordsToWindow([w('  ', 1, 1)], 0, 10)).toHaveLength(0)
  })

  it('preserves source order', () => {
    const words = [w('a', 0.1, 0.1), w('b', 0.2, 0.4), w('c', 0.5, 0.5)]
    expect(sliceWordsToWindow(words, 0, 5).map((x) => x.word)).toEqual(['a', 'b', 'c'])
  })
})

describe('buildKaraokeAss — zero-duration words reach the burn', () => {
  const ass = (words) => buildKaraokeAss({ words, width: 1080, height: 1920 })

  it('renders a zero-duration word into the ASS document', () => {
    const doc = ass([w('how', 0, 0.2), w('to', 0.24, 0.24), w('do', 0.26, 0.4)])
    expect(doc).toBeTruthy()
    expect(doc).toContain('to')
    // \k durations are centiseconds and floor at 1, so a point word still gets
    // a highlight beat instead of vanishing from the line.
    expect(doc).toMatch(/\\k1\b/)
  })

  it('does not return null when EVERY word is zero-duration', () => {
    expect(ass([w('to', 1, 1), w('the', 1.02, 1.02)])).toBeTruthy()
  })

  it('still returns null for an empty or fully invalid word list', () => {
    expect(ass([])).toBeNull()
    expect(ass([w('bad', 3, 1)])).toBeNull()
  })
})
