import { describe, it, expect } from 'vitest'
import { buildModelExemplarsBlock } from '../../api/_lib/atomPrompts.js'

// The "came together well" craft signal (src/lib/modelRating.js) — a human
// marks a post as a model, optionally with reason chips + a free-text note.
// buildModelExemplarsBlock turns that into a "write more like this" prompt
// block. Pure/string-only so it's tested without a DB.
describe('buildModelExemplarsBlock', () => {
  it('returns empty string for no rows, non-array, or content-less rows', () => {
    expect(buildModelExemplarsBlock([])).toBe('')
    expect(buildModelExemplarsBlock(null)).toBe('')
    expect(buildModelExemplarsBlock(undefined)).toBe('')
    expect(buildModelExemplarsBlock([{ model_reasons: ['hook_grabs'] }])).toBe('')
  })

  it('resolves reason keys to their labels and includes the free-text note', () => {
    const block = buildModelExemplarsBlock([
      { content: 'A real caption.', model_reasons: ['sounds_genuine', 'media_choice_good'], model_note: 'The MRI-then-reassurance framing.' },
    ])
    expect(block).toContain('A real caption.')
    expect(block).toContain('Sounds genuine')
    expect(block).toContain('Media choice is good')
    expect(block).toContain('The MRI-then-reassurance framing.')
    // Raw keys must never leak into the prompt — only resolved labels.
    expect(block).not.toContain('sounds_genuine')
    expect(block).not.toContain('media_choice_good')
  })

  it('omits the "why this one worked" line when neither reasons nor a note were given', () => {
    const block = buildModelExemplarsBlock([{ content: 'A caption with no reasons.' }])
    expect(block).toContain('A caption with no reasons.')
    expect(block).not.toContain('why this one worked')
  })

  it('caps at 3 exemplars even when more rows are passed', () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ content: `Caption ${i}` }))
    const block = buildModelExemplarsBlock(rows)
    expect(block).toContain('Caption 0')
    expect(block).toContain('Caption 2')
    expect(block).not.toContain('Caption 3')
    expect(block).not.toContain('Caption 4')
  })

  it('falls back to the raw key for a reason not in the label map, rather than dropping it silently', () => {
    const block = buildModelExemplarsBlock([{ content: 'X', model_reasons: ['not_a_real_key'] }])
    expect(block).toContain('not_a_real_key')
  })
})
