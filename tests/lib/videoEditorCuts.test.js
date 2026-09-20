import { describe, it, expect } from 'vitest'
import {
  FILLERS, SILENCE_GAP, fillerKey,
  normCutsCli, totalCutCli, addRange, subRange, inCut, silenceRanges,
} from '@/pages/video-editor/cuts.js'

// Edit-by-transcript cut math, extracted from VideoEditor.jsx (2,663 lines, none
// of this reachable from a test before). Cuts are clip-relative {start,end}
// ranges REMOVED from the clip; the render trims + concats the kept ranges and
// re-times captions onto the compacted timeline. A bug here silently ships the
// wrong seconds of video.

describe('normCutsCli — normalising a cut list', () => {
  it('clamps to the clip and sorts by start', () => {
    expect(normCutsCli([{ start: 5, end: 7 }, { start: -2, end: 1 }], 10))
      .toEqual([{ start: 0, end: 1 }, { start: 5, end: 7 }])
  })

  it('clamps an overrunning end to the duration', () => {
    expect(normCutsCli([{ start: 8, end: 20 }], 10)).toEqual([{ start: 8, end: 10 }])
  })

  it('merges ranges that touch within the 0.01 tolerance', () => {
    expect(normCutsCli([{ start: 1, end: 2 }, { start: 2.005, end: 3 }], 10))
      .toEqual([{ start: 1, end: 3 }])
  })

  it('does NOT merge ranges separated by more than the tolerance', () => {
    // 0.05 apart stays two cuts. Paired with the case above this pins the
    // tolerance itself, not merely "merging happens sometimes".
    expect(normCutsCli([{ start: 1, end: 2 }, { start: 2.05, end: 3 }], 10))
      .toEqual([{ start: 1, end: 2 }, { start: 2.05, end: 3 }])
  })

  it('takes the LONGER end when merging a fully-contained range', () => {
    expect(normCutsCli([{ start: 1, end: 5 }, { start: 2, end: 3 }], 10))
      .toEqual([{ start: 1, end: 5 }])
  })

  it('drops ranges shorter than 0.02s but keeps 0.03s', () => {
    expect(normCutsCli([{ start: 1, end: 1.015 }], 10)).toEqual([])
    expect(normCutsCli([{ start: 1, end: 1.03 }], 10)).toEqual([{ start: 1, end: 1.03 }])
  })

  it('drops inverted ranges', () => {
    expect(normCutsCli([{ start: 5, end: 2 }], 10)).toEqual([])
  })

  it('tolerates null/undefined/garbage input', () => {
    expect(normCutsCli(null, 10)).toEqual([])
    expect(normCutsCli(undefined, 10)).toEqual([])
    expect(normCutsCli([{ start: 'x', end: 'y' }], 10)).toEqual([])
  })

  it('does not mutate its input', () => {
    const input = [{ start: 1, end: 2 }, { start: 2.005, end: 3 }]
    const snapshot = JSON.parse(JSON.stringify(input))
    normCutsCli(input, 10)
    expect(input).toEqual(snapshot)
  })
})

describe('totalCutCli', () => {
  it('sums the normalised cut durations', () => {
    expect(totalCutCli([{ start: 1, end: 2 }, { start: 3, end: 4.5 }], 10)).toBe(2.5)
  })

  it('counts overlapping cuts ONCE, not twice', () => {
    // The whole reason it normalises first: 1-3 and 2-4 remove 3 seconds of
    // video, not 4. Summing raw ranges would over-report and mis-size the
    // trimmed clip.
    expect(totalCutCli([{ start: 1, end: 3 }, { start: 2, end: 4 }], 10)).toBe(3)
  })

  it('is 0 for an empty list', () => {
    expect(totalCutCli([], 10)).toBe(0)
  })
})

describe('addRange / subRange', () => {
  it('addRange folds a new range into the normalised list', () => {
    expect(addRange([{ start: 1, end: 2 }], { start: 4, end: 5 }, 10))
      .toEqual([{ start: 1, end: 2 }, { start: 4, end: 5 }])
  })

  it('addRange merges when the new range abuts an existing one', () => {
    expect(addRange([{ start: 1, end: 2 }], { start: 2, end: 3 }, 10))
      .toEqual([{ start: 1, end: 3 }])
  })

  it('subRange splits a cut when the removed span sits inside it', () => {
    expect(subRange([{ start: 1, end: 5 }], { start: 2, end: 3 }, 10))
      .toEqual([{ start: 1, end: 2 }, { start: 3, end: 5 }])
  })

  it('subRange trims from the left and from the right', () => {
    expect(subRange([{ start: 1, end: 5 }], { start: 0, end: 2 }, 10)).toEqual([{ start: 2, end: 5 }])
    expect(subRange([{ start: 1, end: 5 }], { start: 4, end: 9 }, 10)).toEqual([{ start: 1, end: 4 }])
  })

  it('subRange removes a cut entirely when fully covered', () => {
    expect(subRange([{ start: 1, end: 5 }], { start: 0, end: 9 }, 10)).toEqual([])
  })

  it('subRange leaves untouched cuts alone', () => {
    expect(subRange([{ start: 1, end: 2 }, { start: 6, end: 7 }], { start: 3, end: 4 }, 10))
      .toEqual([{ start: 1, end: 2 }, { start: 6, end: 7 }])
  })

  it('add then sub round-trips back to the original', () => {
    const base = [{ start: 1, end: 2 }]
    expect(subRange(addRange(base, { start: 5, end: 6 }, 10), { start: 5, end: 6 }, 10)).toEqual(base)
  })
})

describe('inCut', () => {
  it('is half-open: inclusive of start, exclusive of end', () => {
    // A frame exactly on a cut's end belongs to the KEPT side, or adjacent cuts
    // would both claim the boundary frame.
    const cuts = [{ start: 1, end: 2 }]
    expect(inCut(1, cuts)).toBe(true)
    expect(inCut(1.5, cuts)).toBe(true)
    expect(inCut(2, cuts)).toBe(false)
    expect(inCut(0.999, cuts)).toBe(false)
  })

  it('is false against an empty cut list', () => {
    expect(inCut(1, [])).toBe(false)
  })
})

describe('silenceRanges', () => {
  it('finds a gap longer than SILENCE_GAP, inset by 0.05s each side', () => {
    expect(silenceRanges([{ start: 0, end: 1 }, { start: 2, end: 3 }], 10))
      .toEqual([{ start: 1.05, end: 1.95 }])
  })

  it('ignores a gap at or under the threshold', () => {
    // 0.5s gap < SILENCE_GAP (0.6): speech pacing, not dead air.
    expect(silenceRanges([{ start: 0, end: 1 }, { start: 1.5, end: 2 }], 10)).toEqual([])
    expect(SILENCE_GAP).toBe(0.6)
  })

  it('drops a range that would extend past the clip duration', () => {
    expect(silenceRanges([{ start: 0, end: 1 }, { start: 9, end: 12 }], 5)).toEqual([])
  })

  it('returns nothing for zero or one word', () => {
    expect(silenceRanges([], 10)).toEqual([])
    expect(silenceRanges([{ start: 0, end: 1 }], 10)).toEqual([])
  })

  it('finds every gap, not just the first', () => {
    const words = [{ start: 0, end: 1 }, { start: 2, end: 3 }, { start: 5, end: 6 }]
    expect(silenceRanges(words, 10)).toHaveLength(2)
  })
})

describe('fillerKey / FILLERS', () => {
  it('strips case and punctuation so spoken fillers match', () => {
    expect(fillerKey('Um,')).toBe('um')
    expect(fillerKey('UH...')).toBe('uh')
    expect(FILLERS.has(fillerKey('Um,'))).toBe(true)
    expect(FILLERS.has(fillerKey('Uhh!'))).toBe(true)
  })

  it('does not match a real word that merely contains a filler', () => {
    expect(FILLERS.has(fillerKey('umbrella'))).toBe(false)
    expect(FILLERS.has(fillerKey('human'))).toBe(false)
  })
})
