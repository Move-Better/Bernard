import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// GUARD — every moment-anchored draft path stamps content_items.moment_id.
//
// Migration 214 added content_items.moment_id + moment_provenance because the
// only prior link (content_plan_atoms.moment_id → content_piece_id) decays when
// the planner recycles atoms — the P5 concordance cohort lost 31 → 21 members
// in one week of recycles (2026-08 outcome review § Week-4). The stamp is a
// spread in each path's itemPayload; nothing at runtime asserts it, so dropping
// it from either path would be green on every gate and silently resume the
// decay for all future drafts. This test pins both paths.
//
// Deliberately NOT covered, with reasons:
//   • draftOnTopic.js — ad-hoc drafts synthesize an atom with no moment_id.
//   • draftReelAtom.js — reel atoms carry no moment_id (migration 179; see the
//     "No bumpMomentUsage" comment in content-plan/draft.js's reel branch).
// If either ever grows a moment_id source, it needs the same stamp AND a row
// here.
//
// fileURLToPath, not URL.pathname — the repo path contains a space.
const read = (rel) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

const STAMP =
  /\.\.\.\(atom\.moment_id \? \{ moment_id: atom\.moment_id, moment_provenance: momentProvenance \} : \{\}\)/

const PATHS = [
  ['../../api/_routes/content-plan/draft.js', 'interactive draft route'],
  ['../../api/_lib/producer/predraftWeek.js', 'pre-draft cron path'],
]

describe('moment-anchored drafts stamp moment_id onto content_items (migration 214)', () => {
  it.each(PATHS)('%s stamps moment_id + moment_provenance in its itemPayload', (rel) => {
    const src = read(rel)
    // Non-vacuity: the payload block this guard anchors on must still exist.
    expect(src).toContain('const itemPayload = {')
    expect(src.match(STAMP)).toBeTruthy()
    // The stamp must sit INSIDE the itemPayload literal, before the insert —
    // a stamp pasted elsewhere (e.g. a later PATCH that a partial failure
    // skips) would satisfy a bare content check.
    const payloadStart = src.indexOf('const itemPayload = {')
    const insertAt = src.indexOf("sb('content_items'", payloadStart)
    const stampAt = src.search(STAMP)
    expect(stampAt).toBeGreaterThan(payloadStart)
    expect(stampAt).toBeLessThan(insertAt)
  })

  it('draftAtom fetches the freeze fields and returns momentProvenance', () => {
    const src = read('../../api/_lib/producer/draftAtom.js')
    // The provenance snapshot needs score/type/exemplar/cluster in the moment
    // SELECT — dropping them reverts the freeze to all-nulls silently.
    expect(src).toMatch(/moments\?id=eq\.\$\{atom\.moment_id\}[^`]*select=[^`]*score,moment_type,is_exemplar,cluster_id/)
    expect(src).toContain('momentProvenance = {')
    // Returned to callers (the two stamping paths destructure it).
    expect(src).toMatch(/return \{[^}]*momentProvenance,/s)
  })
})
