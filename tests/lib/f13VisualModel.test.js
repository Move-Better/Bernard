import { describe, it, expect } from 'vitest'
import { DEFAULT_VIDEO_MODEL, RATE_CARD } from '../../api/_lib/analyzeVideoWindow.js'
import { buildInstructions } from '../../api/_lib/scoreMomentsVisual.js'

// google/gemini-2.5-pro (the old default) is retired by Google on 2026-12-01. The swap to Flash and its
// known weaknesses are recorded in analyzeVideoWindow.js and decisions.md 2026-11-16.
describe('F13 video model', () => {
  it('is gemini-3.8-flash, not a retiring 2.5 model', () => {
    expect(DEFAULT_VIDEO_MODEL).toBe('google/gemini-3.8-flash')
    expect(DEFAULT_VIDEO_MODEL).not.toMatch(/gemini-2\.5/)
  })
  it('has a rate-card entry, so the per-video cost log is never silently null', () => {
    expect(RATE_CARD[DEFAULT_VIDEO_MODEL]).toEqual({ in: 0.75, out: 3.75 })
    expect(Object.keys(RATE_CARD).some((m) => /gemini-2\.5/.test(m))).toBe(false)
  })
})

describe('F13 eye_contact wording', () => {
  const text = buildInstructions({ display_name: 'Test Clinic' })
  const line = text.split('\n').find((l) => l.startsWith('- eye_contact:')) || ''
  it('means the camera lens, not "the listener"', () => {
    expect(line).toContain('looking INTO the camera lens')
    expect(line).not.toContain('at the listener')
  })
  it('says looking at another person in the frame is NOT eye contact', () => {
    expect(line).toContain('Looking at another person in the frame')
    expect(line).toContain('is NOT eye contact with the camera')
  })
})
