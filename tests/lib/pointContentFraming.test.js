import { describe, it, expect } from 'vitest'
import { getAtomSystemPrompt } from '../../api/_lib/atomPrompts.js'
import { getBlogPostSystemPrompt, getNewsletterSystemPrompt } from '../../src/lib/prompts.js'
import { pointContentFraming } from '../../src/lib/pointContentFraming.js'

// Phase 2 of "Make a point" (.claude/make-a-point-spec.md): the non-diagnostic
// guardrail for point-interview content lives at the PUBLISH layer, not in the
// interview itself — the dynamic host stays free to be reactive and smart, and
// this framing block is what keeps the OUTPUT safe. It's channel-aware because
// a caveat is exactly what a short caption truncates: short formats stay
// strictly experiential (no mechanism claim to hedge), long formats may hedge a
// mechanism with a woven n=1 caveat.
//
// The invariant that matters most: every non-point caller must be BYTE-IDENTICAL
// to before this shipped. isPoint defaults to false everywhere it was threaded
// in, so a caller that never learns about `kind='point'` cannot regress.

const ws = { display_name: 'Move Better', location: 'Austin, TX', brand_voice: 'warm, direct', prompt_mode: null }
const staff = 'Dr. Quasney'
const point = 'Six months of broken deep sleep, then two 10-minute runs fixed it.'

describe('pointContentFraming', () => {
  it('returns empty string when not a point (every non-point caller stays untouched)', () => {
    expect(pointContentFraming({ isPoint: false, format: 'short' })).toBe('')
    expect(pointContentFraming({ isPoint: false, format: 'long' })).toBe('')
    expect(pointContentFraming()).toBe('')
  })

  it('short format forbids a mechanism/causal claim', () => {
    const block = pointContentFraming({ isPoint: true, format: 'short' })
    expect(block).toContain('POINT CONTENT')
    expect(block).toMatch(/Do NOT state a mechanism or causal claim/)
  })

  it('long format allows a hedged mechanism plus a woven n=1 caveat, no boilerplate tack-on', () => {
    const block = pointContentFraming({ isPoint: true, format: 'long' })
    expect(block).toContain('POINT CONTENT')
    expect(block).toMatch(/generally-accepted or open/)
    expect(block).toMatch(/n=1 caveat/)
    expect(block).toMatch(/Do NOT tack on a boilerplate/)
  })

  it('short and long framing are genuinely different blocks', () => {
    const short = pointContentFraming({ isPoint: true, format: 'short' })
    const long = pointContentFraming({ isPoint: true, format: 'long' })
    expect(short).not.toBe(long)
  })
})

describe('point-aware content generators — byte-identical when not a point', () => {
  it('getAtomSystemPrompt: isPoint omitted === isPoint explicitly false', () => {
    const withoutArg = getAtomSystemPrompt(ws, staff, point, 'instagram', 'hook', 'personal', 'smart', '', '', [], null, null, '', '', false, '', '')
    const explicitFalse = getAtomSystemPrompt(ws, staff, point, 'instagram', 'hook', 'personal', 'smart', '', '', [], null, null, '', '', false, '', '', false)
    expect(withoutArg).toBe(explicitFalse)
    expect(withoutArg).not.toContain('POINT CONTENT')
  })

  it('getBlogPostSystemPrompt: no framing when isPoint is false', () => {
    const prompt = getBlogPostSystemPrompt(ws, staff, point, 'smart', 'personal', null, '', [], null, null, null, '')
    expect(prompt).not.toContain('POINT CONTENT')
  })

  it('getBlogPostSystemPrompt (general-mode vertical): no framing when isPoint is false', () => {
    const prompt = getBlogPostSystemPrompt({ ...ws, prompt_mode: 'general' }, staff, point, 'smart', 'personal', null, '', [], null, null, null, '')
    expect(prompt).not.toContain('POINT CONTENT')
  })

  it('getNewsletterSystemPrompt: no framing when isPoint is false', () => {
    const prompt = getNewsletterSystemPrompt(ws, staff, point, 'personal', '', [], null, '')
    expect(prompt).not.toContain('POINT CONTENT')
  })
})

describe('point-aware content generators — framing threads through correctly', () => {
  it('getAtomSystemPrompt (social — short) gets the short, mechanism-forbidding block', () => {
    const prompt = getAtomSystemPrompt(ws, staff, point, 'instagram', 'hook', 'personal', 'smart', '', '', [], null, null, '', '', false, '', '', true)
    expect(prompt).toContain('POINT CONTENT')
    expect(prompt).toMatch(/Do NOT state a mechanism or causal claim/)
  })

  it('getBlogPostSystemPrompt (long) gets the long, hedged-mechanism block', () => {
    const prompt = getBlogPostSystemPrompt(ws, staff, point, 'smart', 'personal', null, '', [], null, null, null, '', true)
    expect(prompt).toContain('POINT CONTENT')
    expect(prompt).toMatch(/generally-accepted or open/)
  })

  it('getBlogPostSystemPrompt (general-mode vertical) also gets the framing — the second delegated branch is not forgotten', () => {
    const prompt = getBlogPostSystemPrompt({ ...ws, prompt_mode: 'general' }, staff, point, 'smart', 'personal', null, '', [], null, null, null, '', true)
    expect(prompt).toContain('POINT CONTENT')
  })

  it('getNewsletterSystemPrompt (long) gets the framing', () => {
    const prompt = getNewsletterSystemPrompt(ws, staff, point, 'personal', '', [], null, '', true)
    expect(prompt).toContain('POINT CONTENT')
  })
})
