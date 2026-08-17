import { describe, it, expect } from 'vitest'
import { applyCaptionWindow, nearestWithin } from '../../src/lib/captionTimeline.js'

// These pin the reel editor's trim/caption behavior (VideoEditor.jsx), extracted
// so the SILENT bug they guard is actually testable: a trim that re-times captions
// wrong bakes them misaligned against the audio with no error anywhere.
//
// Philip's report (feedback b68d9b19): trimming "shrunk the size / timing of
// captions and messed up timing." Two mechanisms, one test file:
//   - the trim handle now soft-snaps to word boundaries  -> nearestWithin
//   - hand-edited captions re-time to the new window on a trim -> applyCaptionWindow

describe('nearestWithin (trim handle word-boundary snap)', () => {
  it('snaps to the nearest candidate inside the tolerance', () => {
    // A cut dropped at 3.44s with a word starting at 3.50s snaps onto the word.
    expect(nearestWithin(3.44, [1.0, 3.5, 10], 0.2)).toBe(3.5)
  })

  it('picks the NEAREST when two candidates are both within tolerance', () => {
    expect(nearestWithin(3.0, [3.1, 2.95], 0.2)).toBe(2.95)
  })

  it('leaves the value untouched when nothing is close (silent gap = free trim)', () => {
    expect(nearestWithin(5.0, [1, 2, 3], 0.2)).toBe(5.0)
  })

  it('ignores non-finite candidates', () => {
    expect(nearestWithin(3.0, [Number.NaN, undefined, 2.95], 0.2)).toBe(2.95)
    expect(nearestWithin(3.0, null, 0.2)).toBe(3.0)
  })
})

describe('applyCaptionWindow', () => {
  const line = (text, words) => ({ text, words })

  it('is a pass-through (same reference) when the window matches and there are no edits', () => {
    const lines = [line('one two', [{ word: 'one', start: 0, end: 0.4 }, { word: 'two', start: 0.5, end: 0.9 }])]
    const out = applyCaptionWindow(lines, { captionWin: 2, startSec: 2, durationSec: 5 })
    expect(out).toBe(lines) // no new allocation on the hot path
  })

  it('applies a per-word correction keyed by ABSOLUTE source time (word.start + captionWin)', () => {
    const lines = [line('one two', [{ word: 'one', start: 0.2, end: 0.6 }, { word: 'two', start: 1.0, end: 1.4 }])]
    // captionWin 2.0 -> 'one' sits at absolute 2.20s; that is the wordEdits key.
    const out = applyCaptionWindow(lines, { wordEdits: { '2.20': 'ONE' }, captionWin: 2, startSec: 2, durationSec: 5 })
    expect(out[0].words[0]).toMatchObject({ word: 'ONE', edited: true })
    expect(out[0].words[1].word).toBe('two')
    expect(out[0].text).toBe('ONE two')
  })

  it('re-times frozen captions when the trim window moved, dropping what falls outside', () => {
    // Captions edited at startSec 2.0 (captionWin=2.0); user then drags the in-point
    // right to 3.0 (window [3.0, 5.0], dur 2.0). Everything before source 3.0 is gone;
    // everything after shifts one second earlier in clip time.
    const lines = [
      line('one two', [
        { word: 'one', start: 0.2, end: 0.6 }, // abs 2.2-2.6 -> before new in-point -> dropped
        { word: 'two', start: 1.0, end: 1.4 }, // abs 3.0-3.4 -> clip 0.0-0.4
      ]),
      line('three', [{ word: 'three', start: 2.0, end: 2.5 }]), // abs 4.0-4.5 -> clip 1.0-1.5
    ]
    const out = applyCaptionWindow(lines, { captionWin: 2, startSec: 3, durationSec: 2 })
    expect(out).toHaveLength(2)
    expect(out[0].words.map((w) => w.word)).toEqual(['two'])
    expect(out[0].words[0]).toMatchObject({ start: 0, end: 0.4 })
    expect(out[0].text).toBe('two')
    expect(out[1].words[0]).toMatchObject({ word: 'three', start: 1, end: 1.5 })
  })

  it('drops a line entirely when every word falls outside the trimmed window', () => {
    const lines = [
      line('gone', [{ word: 'gone', start: 0.1, end: 0.5 }]),      // abs 2.1-2.5 -> dropped
      line('kept', [{ word: 'kept', start: 1.2, end: 1.6 }]),      // abs 3.2-3.6 -> clip 0.2-0.6
    ]
    const out = applyCaptionWindow(lines, { captionWin: 2, startSec: 3, durationSec: 2 })
    expect(out.map((l) => l.text)).toEqual(['kept'])
  })

  it('clamps a word that straddles the new in-point instead of dropping it', () => {
    const lines = [line('edge', [{ word: 'edge', start: 0.8, end: 1.4 }])] // abs 2.8-3.4
    const out = applyCaptionWindow(lines, { captionWin: 2, startSec: 3, durationSec: 2 })
    // Straddles source 3.0: starts before, ends after -> clamped to clip 0.
    expect(out[0].words[0]).toMatchObject({ word: 'edge', start: 0 })
    expect(out[0].words[0].end).toBeCloseTo(0.4, 5)
  })

  it('keeps a userEdited line’s typed text (no corrections) but still re-times it', () => {
    const lines = [{ text: 'my words', userEdited: true, words: [
      { word: 'my', start: 1.0, end: 1.3 },    // abs 3.0
      { word: 'words', start: 1.3, end: 1.8 }, // abs 3.3
    ] }]
    // A wordEdits key that WOULD match 'my' at abs 3.0 must be ignored (userEdited).
    const out = applyCaptionWindow(lines, { wordEdits: { '3.00': 'MY' }, captionWin: 2, startSec: 3, durationSec: 2 })
    expect(out[0].words[0].word).toBe('my') // correction skipped
    expect(out[0].words[0]).toMatchObject({ start: 0 }) // still re-timed: 1.0 + (2-3)
    expect(out[0].words[1]).toMatchObject({ start: 0.3 })
  })
})
