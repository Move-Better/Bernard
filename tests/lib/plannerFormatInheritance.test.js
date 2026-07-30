import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { contentFormatForAtom, ATOM_FORMATS } from '../../api/_lib/atomPlan.js'
import { FORMAT_IDS } from '../../src/lib/platformFormats.js'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

describe('contentFormatForAtom — the planner→draft join', () => {
  it('carries a planned reel through to the draft', () => {
    expect(contentFormatForAtom({ platform: 'instagram', format: 'reel' })).toBe('reel')
  })

  it('carries a planned carousel through (atom vocab has no CHECK, so this is reachable)', () => {
    expect(contentFormatForAtom({ platform: 'instagram', format: 'carousel' })).toBe('carousel')
  })

  it('falls back to the platform default when the atom has none', () => {
    expect(contentFormatForAtom({ platform: 'instagram' })).toBe('post')
    expect(contentFormatForAtom({ platform: 'instagram_story' })).toBe('story')
  })

  it('REFUSES a format outside the content_items vocabulary', () => {
    // content_plan_atoms.format has NO check constraint (migration 179, on
    // purpose); content_items.format DOES (migration 195). Copying an unknown
    // atom format straight through would 400 the INSERT and fail the draft.
    // Returning null means "derive as before" — a real state, not a guess.
    expect(contentFormatForAtom({ platform: 'instagram', format: 'lasergram' })).toBeNull()
  })

  it('every ATOM_FORMATS value is a legal content_items format', () => {
    // Two vocabularies that must not drift. If someone adds an atom format with
    // no content_items counterpart, drafts silently stop inheriting it.
    for (const v of Object.values(ATOM_FORMATS)) expect(FORMAT_IDS).toContain(v)
  })
})

describe('every draft-creation path inherits the planned format', () => {
  // Grepped rather than executed: these INSERTs need a workspace, an interview
  // and a live model call. The rule is "no draft path omits format", and a
  // route-by-route memory of which paths exist is exactly what went stale
  // before — predraftWeek did not even SELECT the column.
  const PATHS = {
    'content-plan/draft.js': read('../../api/_routes/content-plan/draft.js'),
    'producer/predraftWeek.js': read('../../api/_lib/producer/predraftWeek.js'),
    'clipDraft.js': read('../../api/_lib/clipDraft.js'),
  }

  it('finds all the known draft paths (a rotted path would pass vacuously)', () => {
    expect(Object.keys(PATHS)).toHaveLength(3)
    for (const src of Object.values(PATHS)) expect(src).toContain('content_items')
  })

  it('each stamps format_source bernard, never accepting it from a caller', () => {
    for (const [name, src] of Object.entries(PATHS)) {
      expect(src, `${name} must stamp format_source`).toContain("format_source: 'bernard'")
    }
  })

  it('predraftWeek SELECTS format — it silently could not inherit without this', () => {
    expect(PATHS['producer/predraftWeek.js']).toMatch(/select=[^`'"]*\bformat\b/)
  })

  it('clipDraft stamps reel only for Instagram (no reel lane elsewhere)', () => {
    expect(PATHS['clipDraft.js']).toContain("platform === 'instagram'")
  })
})
