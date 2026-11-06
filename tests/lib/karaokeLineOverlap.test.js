import { describe, it, expect } from 'vitest'
import { buildKaraokeAss } from '../../api/_lib/karaokeCaptions.js'

// Two Dialogue events whose windows overlap are drawn at the same time by
// libass — two caption lines stacked on screen. The grouper can produce that
// whenever a line's last word ends after the next line's first word starts
// (plus the 0.12 s linger tail). Seen on a real Scribe transcript in the
// 2026-11 bake-off. buildKaraokeAss must clamp each line's End to the next
// line's Start.
const w = (word, start, end) => ({ word, start, end })
const toSec = (t) => { const [h, m, s] = t.split(':'); return Number(h) * 3600 + Number(m) * 60 + Number(s) }
const dialogues = (ass) => ass.split('\n').filter((l) => l.startsWith('Dialogue:')).map((l) => { const f = l.split(','); return { start: toSec(f[1]), end: toSec(f[2]) } })

describe('karaoke line windows never overlap', () => {
  // Six words → two lines of 5 and 1 (maxWords=5). The fifth word's end (3.0)
  // runs 0.6 s PAST the sixth word's start (2.4), and the 0.12 tail would add more.
  const words = [w('one', 0, 0.3), w('two', 0.4, 0.7), w('three', 0.8, 1.1), w('four', 1.2, 1.5), w('five', 1.6, 3.0), w('six', 2.4, 2.8)]

  it('clamps a line that would run into the next one', () => {
    const d = dialogues(buildKaraokeAss({ words, width: 1080, height: 1920 }))
    expect(d).toHaveLength(2)
    expect(d[0].end).toBeLessThanOrEqual(d[1].start)
    expect(d[0].end).toBeCloseTo(2.4, 1)        // the next line's start (ASS is centisecond-precise), not 3.12
    expect(d[0].end).toBeLessThan(3.0)
  })
  it('still lets the LAST line linger past its final word', () => {
    const d = dialogues(buildKaraokeAss({ words, width: 1080, height: 1920 }))
    expect(d[1].end).toBeCloseTo(2.8 + 0.12, 2)
  })
  it('leaves non-overlapping lines alone', () => {
    const spaced = [w('a', 0, 0.2), w('b', 0.3, 0.5), w('c', 0.6, 0.8), w('d', 0.9, 1.1), w('e', 1.2, 1.4), w('f', 5, 5.2)]
    const d = dialogues(buildKaraokeAss({ words: spaced, width: 1080, height: 1920 }))
    expect(d[0].end).toBeCloseTo(1.4 + 0.12, 2)
  })
  it('keeps a 10 ms span when the next line starts at or before this line starts', () => {
    const stacked = [w('a', 1, 1), w('b', 1, 1), w('c', 1, 1), w('d', 1, 1), w('e', 1, 1), w('f', 1, 1.2)]
    const d = dialogues(buildKaraokeAss({ words: stacked, width: 1080, height: 1920 }))
    expect(d[0].end).toBeGreaterThan(d[0].start)
  })
})
