import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// GUARD — the marker that decides WHICH locations get a tailored Google Business
// draft must be the same one that decides which can RECEIVE a post.
//
// These had drifted apart. Drafting keyed off workspace_locations.gbp_location_id
// (a Buffer GBP channel id); publishing keys off bundle_team_id (the per-location
// bundle Team). In prod that left 3 locations across 2 workspaces carrying a
// gbp_location_id with no bundle Team — so Bernard would write per-location GBP
// copy for listings it could not post to, and the publish attempt would 503.
//
// It had produced nothing visible only because both those workspaces have
// generated zero GBP items to date. The live workspace has both markers on both
// locations, which is why the split never surfaced.
//
// gbp_location_id is now vestigial: Buffer was retired 2026-07-30, its value is
// read by nothing, and no tenant can obtain one. bundle_team_id is the only
// marker a tenant can populate (via the per-location connect portal).
//
// fileURLToPath, not URL.pathname — the repo lives under "Claude Projects" and
// .pathname percent-encodes the space, which readFileSync ENOENTs.
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

const DRAFT_ATOM = read('../../api/_lib/producer/draftAtom.js')
const NEW_BRIEF = read('../../src/pages/NewBrief.jsx')
const UNIFIED_EDITOR = read('../../src/components/editor/UnifiedEditor.jsx')

describe('GBP per-location marker', () => {
  it('drafting selects locations by bundle_team_id, not gbp_location_id', () => {
    // The PostgREST filter that picks which locations get a variant.
    expect(DRAFT_ATOM).toContain('status=eq.active&bundle_team_id=not.is.null')
    expect(DRAFT_ATOM).not.toContain('gbp_location_id=not.is.null')
  })

  it('no client surface filters locations on gbp_location_id', () => {
    // Presence-filters of the form `.filter((l) => l.gbp_location_id)`. A match
    // means a picker is offering locations the publish path cannot reach.
    for (const [name, src] of [['NewBrief', NEW_BRIEF], ['UnifiedEditor', UNIFIED_EDITOR]]) {
      expect(src, `${name} still filters on gbp_location_id`).not.toMatch(/l\s*\.\s*gbp_location_id/)
      expect(src, `${name} lost its bundle_team_id filter`).toMatch(/l\s*\.\s*bundle_team_id/)
    }
  })

  it('the settings form no longer collects the dead id', () => {
    const settings = read('../../src/pages/settings/LocationsSettings.jsx')
    // A bound input would mean we are still asking tenants for a value that is
    // unobtainable and that nothing reads.
    expect(settings).not.toMatch(/set\(['"]gbp_location_id['"]\)/)
  })
})
