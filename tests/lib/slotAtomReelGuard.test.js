import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { isSpeculativelyDraftableFormat, ATOM_FORMATS } from '../../api/_lib/atomPlan.js'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

// Feedback 2026-08-07 (a7e996d0-a10c-4144-ae52-c7ef632a3555): the "Draft
// something new" action on an empty /week slot (create-slot-atom.js) created
// a content_plan_atoms row with format='reel' for a slot that had no backing
// clip. draftAtom.js has no reel-specific generation — it drafted the normal
// Instagram carousel prompt (caption + 5 slides, no video) — and
// contentFormatForAtom (by design, see plannerFormatInheritance.test.js)
// carries a planned format through to the content_item unconditionally. The
// result: a "Reel" badge over carousel content with zero media attached.
//
// Not a rare edge case — cadenceSlots.js's DEFAULT_REEL_SHARE means ~75% of a
// workspace's weekly Instagram slots are reel-formatted by default, so any
// operator using "Draft something new" on an empty Instagram slot hits this
// most of the time.
describe('isSpeculativelyDraftableFormat — reel atoms need a real clip', () => {
  it('refuses reel — a reel can only come from a rendered clip', () => {
    expect(isSpeculativelyDraftableFormat(ATOM_FORMATS.REEL)).toBe(false)
    expect(isSpeculativelyDraftableFormat('reel')).toBe(false)
  })

  it('allows every other planned format to be drafted from a transcript alone', () => {
    expect(isSpeculativelyDraftableFormat(ATOM_FORMATS.POST)).toBe(true)
    expect(isSpeculativelyDraftableFormat(ATOM_FORMATS.CAROUSEL)).toBe(true)
    expect(isSpeculativelyDraftableFormat(ATOM_FORMATS.STORY)).toBe(true)
  })
})

describe('create-slot-atom.js — refuses to plant a speculative reel atom', () => {
  const src = read('../../api/_routes/content-plan/create-slot-atom.js')

  it('imports and calls the guard before inserting the atom', () => {
    expect(src).toContain('isSpeculativelyDraftableFormat')
    const guardIdx = src.indexOf('isSpeculativelyDraftableFormat(fmt)')
    const insertIdx = src.indexOf("sb('content_plan_atoms'")
    expect(guardIdx).toBeGreaterThan(-1)
    expect(insertIdx).toBeGreaterThan(-1)
    expect(guardIdx).toBeLessThan(insertIdx)
  })

  it('rejects with a distinct, non-generic error code (not a bare 400/500)', () => {
    expect(src).toContain('reel_needs_clip')
  })
})

describe('YourWeek.jsx — gives an honest message instead of a generic failure toast', () => {
  const src = read('../../src/pages/YourWeek.jsx')

  it('handles reel_needs_clip distinctly from the generic draft-failed branch', () => {
    expect(src).toContain("e?.payload?.error === 'reel_needs_clip'")
  })
})
