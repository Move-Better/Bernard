import { describe, it, expect } from 'vitest'
import {
  CAPTION_BASE_FS_PCT, CAPTION_SIZE_SCALE, CAPTION_STYLE_OPTS,
  ringShadow, captionCss, sliceWords, groupLines, normCaptionText,
} from '@/pages/video-editor/captions.js'
import { sliceWordsToWindow, groupWordsIntoLines } from '../../api/_lib/karaokeCaptions.js'
import { normCaptionText as serverNormCaptionText } from '../../api/_lib/captionOverlayDedup.js'
import { CAPTION_BASE_FS } from '../../api/_lib/brandRenderVideo.js'
import { WORKSPACE_DEFAULT_ACCENT } from '@/lib/brandSwatches'

// Caption preview logic, extracted from VideoEditor.jsx. Every function here is
// one half of a client/server mirror pair whose agreement was previously
// asserted only by a code comment. A preview that styles or times a clip
// differently from the bake teaches the user the wrong thing.

const WORDS = [
  { word: 'one', start: 0, end: 0.5 },
  { word: 'two', start: 0.6, end: 1.1 },
  { word: 'three', start: 1.2, end: 1.9 },
  { word: 'four', start: 2, end: 2.4 },
  { word: 'five', start: 2.5, end: 3 },
  { word: 'sixsixsix', start: 3.1, end: 3.6 },
]

describe('MIRROR PAIR: sliceWords vs server sliceWordsToWindow', () => {
  it('agrees across a range of windows', () => {
    for (const [start, dur] of [[0, 10], [0.5, 2], [1, 1], [2.2, 1.5], [0, 0.4], [3, 5]]) {
      expect(sliceWords(WORDS, start, dur), `window ${start}+${dur}`)
        .toEqual(sliceWordsToWindow(WORDS, start, dur))
    }
  })

  it('agrees on zero-duration (point) words, the documented edge case', () => {
    // Whisper's 20ms frame hop produces words where start === end. They are a
    // POINT, kept when s <= t < end — a different rule from spans.
    const pts = [{ word: 'a', start: 1, end: 1 }, { word: 'b', start: 2, end: 2 }]
    for (const [start, dur] of [[0, 3], [1, 1], [2, 1], [1, 0.5]]) {
      expect(sliceWords(pts, start, dur), `pts ${start}+${dur}`)
        .toEqual(sliceWordsToWindow(pts, start, dur))
    }
  })

  it('agrees on malformed input', () => {
    const junk = [null, { word: 'ok', start: 0, end: 1 }, { word: '', start: 1, end: 2 }, { word: 'x', start: 'a', end: 'b' }]
    expect(sliceWords(junk, 0, 5)).toEqual(sliceWordsToWindow(junk, 0, 5))
  })

  it('rebases to 0 and is not the identity', () => {
    // Guards against the mirror test passing because both sides are trivial.
    const out = sliceWords(WORDS, 0.5, 2)
    expect(out.length).toBeGreaterThan(0)
    expect(out.length).toBeLessThan(WORDS.length)
    expect(out[0].start).toBeLessThan(WORDS[1].start)
  })

  it('returns [] for non-array input', () => {
    expect(sliceWords(null, 0, 5)).toEqual([])
    expect(sliceWords(undefined, 0, 5)).toEqual([])
  })
})

describe('MIRROR PAIR: groupLines vs server groupWordsIntoLines', () => {
  it('groups words identically (the client adds start/end/text on top)', () => {
    expect(groupLines(WORDS).map((l) => l.words)).toEqual(groupWordsIntoLines(WORDS))
  })

  it('agrees on the 5-word cap', () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ word: 'a', start: i, end: i + 0.1 }))
    expect(groupLines(six).map((l) => l.words)).toEqual(groupWordsIntoLines(six))
    expect(groupLines(six)).toHaveLength(2)
  })

  it('agrees on the 26-char cap', () => {
    const long = [
      { word: 'abcdefghij', start: 0, end: 1 },
      { word: 'klmnopqrst', start: 1, end: 2 },
      { word: 'uvwxyz', start: 2, end: 3 },
    ]
    expect(groupLines(long).map((l) => l.words)).toEqual(groupWordsIntoLines(long))
  })

  it('derives line start/end from its first and last word', () => {
    const [first] = groupLines(WORDS)
    expect(first.start).toBe(first.words[0].start)
    expect(first.end).toBe(first.words[first.words.length - 1].end)
    expect(first.text).toBe(first.words.map((w) => w.word).join(' '))
  })

  it('returns [] for no words', () => {
    expect(groupLines([])).toEqual([])
  })
})

describe('MIRROR PAIR: normCaptionText vs the server copy', () => {
  it('agrees on every shape the dedup relies on', () => {
    for (const s of ['  A  B ', 'Hello   World', '', '\tTabbed\nText\t', 'ALREADY lower', 'a', null, undefined, 42]) {
      expect(normCaptionText(s), `input ${JSON.stringify(s)}`).toBe(serverNormCaptionText(s))
    }
  })

  it('actually trims, lowercases and collapses (not a no-op)', () => {
    expect(normCaptionText('  Hello   World  ')).toBe('hello world')
  })
})

describe('MIRROR PAIR: caption sizing constants', () => {
  it('CAPTION_BASE_FS_PCT is the server CAPTION_BASE_FS as a percentage', () => {
    expect(CAPTION_BASE_FS_PCT).toBeCloseTo(CAPTION_BASE_FS * 100, 10)
  })

  it('CAPTION_SIZE_SCALE matches OVERLAY_SIZE_SCALE in brandRenderVideo.js', () => {
    // That const is not exported, so this pins the values rather than importing
    // them. If the bake's scale changes, change both.
    expect(CAPTION_SIZE_SCALE).toEqual({ small: 0.75, medium: 1.0, large: 1.35 })
  })

  it('medium is exactly 1.0, so Size=medium previews at the base size', () => {
    expect(CAPTION_SIZE_SCALE.medium).toBe(1)
  })

  it('the three sizes are distinct — a control that previews one size and bakes another is worse than none', () => {
    const vals = Object.values(CAPTION_SIZE_SCALE)
    expect(new Set(vals).size).toBe(vals.length)
  })
})

describe('captionCss', () => {
  const ACCENT = '#E36525'

  it('gives every offered preset a style', () => {
    expect(CAPTION_STYLE_OPTS.length).toBeGreaterThan(0)
    for (const { id } of CAPTION_STYLE_OPTS) {
      const css = captionCss(id, ACCENT)
      expect(css, id).toHaveProperty('active')
      expect(css, id).toHaveProperty('base')
      expect(css, id).toHaveProperty('wrap')
    }
  })

  // word_box is a KNOWN DRIFT (see the dedicated test below), so it is excluded
  // here by name rather than by weakening the rule for everyone.
  const DRIFTED = ['word_box']

  it('never renders the spoken and upcoming word identically', () => {
    // Karaoke works by swapping base -> active per word. If a preset made them
    // equal, the per-word timing would be computed and thrown away.
    const checked = CAPTION_STYLE_OPTS.filter(({ id }) => !DRIFTED.includes(id))
    expect(checked.length).toBeGreaterThan(0) // non-vacuity
    for (const { id } of checked) {
      expect(JSON.stringify(captionCss(id, ACCENT).active), id)
        .not.toBe(JSON.stringify(captionCss(id, ACCENT).base))
    }
  })

  // ── KNOWN PREVIEW/BAKE DRIFT, pinned rather than fixed ──────────────────────
  // This PR is a verbatim extraction; changing captionCss changes rendered
  // output and is a design decision, so the bug is recorded here instead.
  //
  // On the BAKE (api/_lib/karaokeCaptions.js buildKaraokeAss), word_box has
  // neither `whiteText` nor a `secondary` override, so:
  //     primary   (spoken)   = assColor(accentColor)   -> the ACCENT
  //     secondary (upcoming) = white
  // i.e. the exported video DOES light each word up in the accent colour.
  //
  // The preview below returns white for BOTH states, so the editor shows no
  // per-word highlight at all and shows the spoken word in the wrong colour.
  // This is the same shape as the accent_fill bug the server already fixed.
  //
  // The fix is almost certainly `active: { color: a, ... }`. When someone makes
  // it, this test fails and points at DRIFTED above — delete both.
  it('word_box preview does NOT match the bake (known drift)', () => {
    const css = captionCss('word_box', ACCENT)
    expect(css.active.color).toBe('#fff')   // bake paints this ACCENT
    expect(css.base.color).toBe('#fff')     // bake paints this white (correct)
    expect(css.active.color).not.toBe(ACCENT)
  })

  it('accent_fill uses a DARK base, not white, inside its accent wrap', () => {
    // The spoken word is white here, so a white base erases the highlight.
    const css = captionCss('accent_fill', ACCENT)
    expect(css.active.color).toBe('#fff')
    expect(css.base.color).toBe('#1A1A1A')
    expect(css.wrap.background).toBe(ACCENT)
  })

  it('glow draws a DARK halo, never an accent one', () => {
    // An accent halo around an accent-filled spoken word is the same hue on
    // itself: no contrast at any alpha.
    const css = captionCss('glow', ACCENT)
    expect(css.active.color).toBe(ACCENT)
    expect(css.active.textShadow).not.toContain(ACCENT)
    expect(css.base.textShadow).not.toContain(ACCENT)
  })

  it('word_box carries its own contrast treatment on both states', () => {
    const css = captionCss('word_box', ACCENT)
    expect(css.active.background).toBe('rgba(0,0,0,.72)')
    expect(css.base.background).toBe('rgba(0,0,0,.72)')
  })

  it('falls back to the tenant default accent, never a Bernard product color', () => {
    // Putting app chrome into tenant content is a standing prohibition.
    expect(captionCss('bold', null).active.color).toBe(WORKSPACE_DEFAULT_ACCENT)
    expect(captionCss('bold', undefined).active.color).toBe(WORKSPACE_DEFAULT_ACCENT)
    expect(captionCss('bold', '').active.color).toBe(WORKSPACE_DEFAULT_ACCENT)
  })

  it('treats an unknown preset as bold', () => {
    expect(captionCss('not-a-style', ACCENT)).toEqual(captionCss('bold', ACCENT))
  })

  it('applies the outline ring to the plain-outline styles only', () => {
    // bold / underline / pop rely on the ring; box + halo styles must not have
    // it stacked on top of their own treatment.
    for (const id of ['bold', 'underline', 'pop']) {
      expect(captionCss(id, ACCENT).active.textShadow, id).toContain('em 0 #000')
    }
    for (const id of ['word_box', 'accent_fill']) {
      expect(captionCss(id, ACCENT).active.textShadow, id).toBeUndefined()
    }
  })
})

describe('ringShadow', () => {
  it('scales with the multiplier so the ring tracks the Size control', () => {
    expect(ringShadow(1)).not.toBe(ringShadow(2))
    expect(ringShadow(2)).toContain('0.110em')
  })

  it('defaults to 1x', () => {
    expect(ringShadow()).toBe(ringShadow(1))
  })

  it('draws the 8 offsets plus a soft drop shadow', () => {
    expect(ringShadow(1).split('#000')).toHaveLength(9)
    expect(ringShadow(1)).toContain('rgba(0,0,0,.5)')
  })
})
