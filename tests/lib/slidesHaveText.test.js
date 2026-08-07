import { describe, it, expect } from 'vitest'
import { slidesHaveText } from '../../src/lib/mediaEntry.js'

// GUARD — slidesHaveText gates the "switch to Reel and set aside your
// carousel text" confirm in UnifiedEditor.jsx's MediaPanel.attachEntry. It
// must return true only when a slide holds REAL operator-written text, so an
// empty/placeholder scaffold never nags, and must not throw on any of the
// malformed shapes a content_items row can legitimately carry (null slides,
// slides with no blocks yet, etc.).

describe('slidesHaveText', () => {
  it('is false for null/undefined/non-array slides', () => {
    expect(slidesHaveText(null)).toBe(false)
    expect(slidesHaveText(undefined)).toBe(false)
    expect(slidesHaveText('not-an-array')).toBe(false)
  })

  it('is false for an empty slides array', () => {
    expect(slidesHaveText([])).toBe(false)
  })

  it('is false for slides with no blocks, or blocks with no text', () => {
    expect(slidesHaveText([{ photo_idx: 0, template: 'cta', blocks: [] }])).toBe(false)
    expect(slidesHaveText([{ blocks: [{ role: 'hook', text: '' }] }])).toBe(false)
    expect(slidesHaveText([{ blocks: [{ role: 'hook', text: '   ' }] }])).toBe(false)
    expect(slidesHaveText([{ blocks: undefined }])).toBe(false)
  })

  it('is true when any block on any slide has real text', () => {
    expect(slidesHaveText([{ blocks: [{ role: 'hook', text: 'Real headline' }] }])).toBe(true)
  })

  it('is true when the FIRST slide is empty but a later one has text', () => {
    const slides = [
      { blocks: [{ role: 'hook', text: '' }] },
      { blocks: [] },
      { blocks: [{ role: 'body', text: 'Here is the actual carousel copy.' }] },
    ]
    expect(slidesHaveText(slides)).toBe(true)
  })
})
