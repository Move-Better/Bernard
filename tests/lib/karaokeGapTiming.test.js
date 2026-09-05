import { describe, it, expect } from 'vitest'
import { buildKaraokeAss, karaokeLineText } from '../../api/_lib/karaokeCaptions.js'

// The karaoke bake must light each word up when it is SPOKEN, honouring the
// silences between words — the same thing the editor's live preview does
// (VideoEditor.jsx: a word is "spoken" when playClipT >= w.start). ASS \k fills
// syllables back-to-back from the line's Dialogue Start, so a naive
// {\k<dur>}word per word runs the highlight AHEAD of the audio wherever a word
// follows a pause. On a real Move Better reel (content_item 703f953b, asset
// 8d783c00) a within-line pause of ~3.94s made the last word fill ~4s early —
// "the post went out with different pacing than the editing preview" (Philip,
// feedback 9cf6b3d1). karaokeLineText now prepends a \k gap on the separator
// space so the fill waits through the silence.
//
// Every assertion here fails on the pre-fix packed-\k logic.

const w = (word, start, end) => ({ word, start, end })

// Walk a Dialogue line's {\k..} tokens and return, per visible word, the
// absolute time (line Dialogue Start + cumulative \k centiseconds) at which its
// fill BEGINS — i.e. when it lights up on screen.
function fillStarts(line) {
  const text = karaokeLineText(line)
  const lineStart = line[0].start
  const re = /\{\\k(\d+)\}([^{]*)/g
  const out = []
  let m
  let cum = 0
  while ((m = re.exec(text))) {
    const word = m[2].trim()
    if (word) out.push({ word, fillStart: lineStart + cum })
    cum += Number(m[1]) / 100
  }
  return out
}

describe('karaokeLineText — highlight tracks the spoken timeline', () => {
  it('delays a word that follows a silence (the force→Great 3.94s gap)', () => {
    const line = [w('force', 12.20, 12.50), w('Great', 16.44, 16.98)]
    const starts = fillStarts(line)
    const great = starts.find((s) => s.word === 'Great')
    // The pre-fix bake packed \k, lighting "Great" at ~12.50 — ~4s early.
    expect(great.fillStart).toBeGreaterThan(16.4)
    expect(great.fillStart).toBeCloseTo(16.44, 1)
    // The concrete regression the fix closes.
    expect(great.fillStart).not.toBeCloseTo(12.5, 1)
  })

  it('emits a \\k gap token equal to the silence before the word', () => {
    // 12.50 → 16.44 is 3.94s = 394 centiseconds.
    expect(karaokeLineText([w('force', 12.20, 12.50), w('Great', 16.44, 16.98)]))
      .toContain('{\\k394}')
  })

  it('every word fills at its real spoken start (within rounding)', () => {
    const line = [
      w('Stick', 0, 0.46), w('the', 0.46, 1.06),
      w('landing', 1.06, 1.06), w('Good', 1.66, 1.84), // 0.60s pause before "Good"
    ]
    for (const { word, fillStart } of fillStarts(line)) {
      const real = line.find((x) => x.word === word).start
      expect(fillStart).toBeCloseTo(real, 1)
    }
  })

  it('the total fill duration equals last.end - first.start (no early finish)', () => {
    const line = [w('a', 3, 3.2), w('b', 5, 5.4)] // 1.8s gap between a and b
    const text = karaokeLineText(line)
    const total = [...text.matchAll(/\{\\k(\d+)\}/g)].reduce((s, m) => s + Number(m[1]), 0) / 100
    expect(total).toBeCloseTo(line[1].end - line[0].start, 2) // 5.4 - 3 = 2.4s
  })

  it('does not add a leading gap before the first word', () => {
    // The Dialogue Start already equals line[0].start, so the first token is the
    // word itself — not a gap filler.
    expect(karaokeLineText([w('hi', 4, 4.3), w('there', 4.5, 4.9)]))
      .toMatch(/^\{\\k30\}hi/)
  })

  it('keeps single spaces between visible words (no double-spacing)', () => {
    const visible = karaokeLineText([w('a', 0, 0.2), w('b', 1, 1.2), w('c', 2, 2.2)])
      .replace(/\{[^}]*\}/g, '')
    expect(visible).toBe('a b c')
  })

  it('clamps a negative gap (overlapping words) to zero', () => {
    // b starts before a ends — no negative \k.
    const text = karaokeLineText([w('a', 0, 0.5), w('b', 0.3, 0.8)])
    expect(text).toContain('{\\k0} ')
    expect(text).not.toMatch(/\{\\k-/)
  })
})

describe('buildKaraokeAss — the gap timing reaches the burned ASS', () => {
  it('carries the silence gap into the Dialogue line', () => {
    const doc = buildKaraokeAss({
      words: [w('force', 12.20, 12.50), w('Great', 16.44, 16.98)],
      width: 1080, height: 1920, accentColor: '#E36525', style: 'bold',
    })
    const dialogue = doc.split('\n').find((l) => l.startsWith('Dialogue:'))
    expect(dialogue).toContain('{\\k394}')
    // Line still starts at the first word and runs to last.end + 0.12 tail.
    expect(dialogue).toContain('0:00:12.19') // start (12.20 floored to cs)
    expect(dialogue).toContain('0:00:17.10') // end (16.98 + 0.12 tail)
  })

  it('leaves the fade path (no per-word \\k) untouched', () => {
    const doc = buildKaraokeAss({
      words: [w('force', 12.20, 12.50), w('Great', 16.44, 16.98)],
      width: 1080, height: 1920, anim: 'fade',
    })
    const dialogue = doc.split('\n').find((l) => l.startsWith('Dialogue:'))
    expect(dialogue).not.toContain('\\k')
    expect(dialogue).toContain('force Great')
  })
})
