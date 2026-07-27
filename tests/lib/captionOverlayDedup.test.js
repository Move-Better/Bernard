import { describe, it, expect } from 'vitest'
import { normCaptionText, captionLineTextSet, dropCaptionDupeOverlays } from '../../api/_lib/captionOverlayDedup.js'

// Regression for the "reels auto-gen with multiple caption types" report
// (feedback 478f16c3): a persisted video_edit_draft held a text overlay whose
// words were identical to a spoken caption line ("Again I did not tell"), so the
// line rendered twice — once as karaoke, once as the un-highlighted overlay —
// while an editorial hook card ("You can't do high knees slowly") is NOT a spoken
// line and must survive.

// Words the greedy chunker (≤5 words / ≤26 chars) groups into exactly one line,
// "Again I did not tell" — the line seen doubled in the report screenshot.
const captionWords = [
  { word: 'Again', start: 0.0, end: 0.3 },
  { word: 'I', start: 0.3, end: 0.4 },
  { word: 'did', start: 0.4, end: 0.6 },
  { word: 'not', start: 0.6, end: 0.8 },
  { word: 'tell', start: 0.8, end: 1.1 },
]

const dupeOverlay = { id: 'o1', role: 'title', text: 'Again I did not tell', x: 0.5, y: 0.5, in: 0, out: 3 }
const hookOverlay = { id: 'o2', role: 'hook_card', text: "You can't do high knees slowly", x: 0.5, y: 0.12, in: 0, out: 3 }

describe('captionLineTextSet', () => {
  it('groups words into normalized caption-line texts', () => {
    const set = captionLineTextSet(captionWords)
    expect(set.has('again i did not tell')).toBe(true)
  })

  it('is empty for no words', () => {
    expect(captionLineTextSet(null).size).toBe(0)
    expect(captionLineTextSet([]).size).toBe(0)
  })
})

describe('dropCaptionDupeOverlays', () => {
  const set = captionLineTextSet(captionWords)

  it('drops an overlay that duplicates a caption line', () => {
    expect(dropCaptionDupeOverlays([dupeOverlay], set)).toHaveLength(0)
  })

  it('keeps a distinct overlay (editorial hook card) that is not a caption line', () => {
    expect(dropCaptionDupeOverlays([hookOverlay], set)).toEqual([hookOverlay])
  })

  it('from a mixed list, drops only the duplicate and keeps the hook card', () => {
    const kept = dropCaptionDupeOverlays([dupeOverlay, hookOverlay], set)
    expect(kept.map((o) => o.id)).toEqual(['o2'])
  })

  it('matches regardless of case and surrounding whitespace', () => {
    const messy = { id: 'o3', text: '  AGAIN   I did   not tell  ', in: 0, out: 3 }
    expect(dropCaptionDupeOverlays([messy], set)).toHaveLength(0)
  })

  it('does nothing when there is no caption track (captions off / no words)', () => {
    // The overlay is then the ONLY place that text appears — it must be kept.
    expect(dropCaptionDupeOverlays([dupeOverlay], null)).toEqual([dupeOverlay])
    expect(dropCaptionDupeOverlays([dupeOverlay], new Set())).toEqual([dupeOverlay])
  })
})

describe('normCaptionText', () => {
  it('trims, lowercases, and collapses whitespace', () => {
    expect(normCaptionText('  Again   I  ')).toBe('again i')
    expect(normCaptionText(null)).toBe('')
  })
})
