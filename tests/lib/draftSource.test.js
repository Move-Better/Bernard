import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  resolveDraftSource,
  DRAFT_SOURCES,
  NO_SOURCE_MESSAGE,
} from '../../api/_lib/producer/draftSource.js'

// Regression: feedback e491bb5c (movebetter, 2026-08-10) — clicking Draft on a
// reel slot on /week 422'd with "this atom has no linked interview". The atom
// was a reel_factory reel whose draft had been archived and detached by
// sweep-past-weeks, leaving { interview_id: null, source_segment_id: <set> }.
// A reel legitimately has no interview, so "has an interview" was never the
// right question to gate drafting on.

describe('resolveDraftSource', () => {
  it('routes an interview-backed atom to the transcript path', () => {
    expect(resolveDraftSource({ interview_id: 'iv-1', source_segment_id: null }))
      .toBe(DRAFT_SOURCES.INTERVIEW)
  })

  it('routes a detached reel atom to the clip path instead of rejecting it', () => {
    // The exact shape sweep-past-weeks leaves behind.
    const orphanedReel = {
      interview_id: null,
      source_segment_id: 'e60ac68a-2612-498d-b5b2-73f4baa0a33b',
      content_piece_id: null,
      format: 'reel',
      status: 'pending',
    }
    expect(resolveDraftSource(orphanedReel)).toBe(DRAFT_SOURCES.REEL_SEGMENT)
  })

  it('prefers the interview when an atom somehow carries both', () => {
    // Ordering matters: every pre-existing interview atom must stay on exactly
    // the path it used before the reel branch existed.
    expect(resolveDraftSource({ interview_id: 'iv-1', source_segment_id: 'seg-1' }))
      .toBe(DRAFT_SOURCES.INTERVIEW)
  })

  it('returns null only when the atom genuinely has no source', () => {
    expect(resolveDraftSource({ interview_id: null, source_segment_id: null })).toBeNull()
    expect(resolveDraftSource({})).toBeNull()
    expect(resolveDraftSource(null)).toBeNull()
    expect(resolveDraftSource(undefined)).toBeNull()
  })

  it('does not treat empty strings as a usable source', () => {
    expect(resolveDraftSource({ interview_id: '', source_segment_id: '' })).toBeNull()
  })
})

describe('NO_SOURCE_MESSAGE', () => {
  it('does not tell the user to link an interview', () => {
    // The old copy sent the reporter looking for an interview to attach to a
    // clip that never had one. This message is only reachable when the atom has
    // NO source at all, so naming interviews specifically is always wrong here.
    expect(NO_SOURCE_MESSAGE.toLowerCase()).not.toContain('must be linked to an interview')
    expect(NO_SOURCE_MESSAGE).toMatch(/interview/i)   // it may mention one as a possibility…
    expect(NO_SOURCE_MESSAGE).toMatch(/clip/i)        // …but must name the clip too
  })
})

// Structural guard: the pure function above is worthless if the route doesn't
// call it. Asserts on call FORM (`name(`), not a bare mention, so a comment or
// an import left behind after a refactor can't satisfy it.
describe('content-plan/draft.js wiring', () => {
  const src = readFileSync(
    fileURLToPath(new URL('../../api/_routes/content-plan/draft.js', import.meta.url)),
    'utf8',
  )

  it('reads a file that is actually the draft route (non-vacuity)', () => {
    expect(src.length).toBeGreaterThan(2000)
    expect(src).toContain('content_plan_atoms')
  })

  it('gates on resolveDraftSource, not on interview_id directly', () => {
    expect(src).toContain('resolveDraftSource(atom)')
    // The bug: a bare interview_id guard ahead of the status checks.
    expect(src).not.toMatch(/if\s*\(\s*!atom\.interview_id\s*\)\s*return\s+err/)
  })

  it('actually invokes the reel path', () => {
    expect(src).toMatch(/draftReelAtom\(\s*\{/)
    expect(src).toContain('DRAFT_SOURCES.REEL_SEGMENT')
  })
})
