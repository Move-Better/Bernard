import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// GUARD — T4 trust metrics must be computed for EVERY active workspace, not
// only for workspaces that opted into the weekly digest email.
//
// computeTrustMetrics lives inside engagement-digest's per-workspace loop.
// Originally that loop was fed by a query filtered on
// `engagement_digest_enabled=eq.true`, so the measurement only ran for
// workspaces that wanted an unrelated email. Every workspace had the digest
// off, so it ran for exactly zero of them and produced nothing for two
// months — while the comment directly above it claimed it ran "independent of
// whether the digest email itself sends this run". The code contradicted its
// own stated intent, and nothing failed, because not-measuring looks
// identical to measuring-nothing.
//
// Two independent assertions, because either one alone can be satisfied while
// the bug is present:
//   1. the workspace query must not filter on the digest toggle
//   2. computeTrustMetrics must be called BEFORE the digest gate returns
// (1) without (2) still lets someone re-add an early `continue`; (2) without
// (1) still lets the query exclude the workspaces in the first place.

// fileURLToPath, not URL.pathname — the repo lives under "Claude Projects" and
// .pathname percent-encodes the space, which readFileSync ENOENTs on.
const HANDLER = fileURLToPath(
  new URL('../../api/_routes/cron/engagement-digest.js', import.meta.url),
)
const src = readFileSync(HANDLER, 'utf8')

describe('engagement-digest: trust metrics are not gated behind the digest toggle', () => {
  it('does not filter the workspace query on engagement_digest_enabled', () => {
    // The filter form is `engagement_digest_enabled=eq.true` in a PostgREST
    // query string. Reading the column in a `select=` list is fine and
    // expected — the per-workspace gate needs it — so match the filter
    // operator specifically, not a bare mention of the column.
    expect(src).not.toMatch(/engagement_digest_enabled=eq\./)
  })

  it('still reads the toggle so the digest itself stays opt-in', () => {
    // Non-vacuity: if this disappears, the query change above would have
    // turned an opt-in email into one that mails everybody.
    expect(src).toMatch(/ws\.engagement_digest_enabled/)
    expect(src).toMatch(/select=[^'"`]*engagement_digest_enabled/)
  })

  it('calls computeTrustMetrics before the digest opt-out returns', () => {
    const measure = src.indexOf('computeTrustMetrics(ws.id')
    const gate = src.indexOf('if (!ws.engagement_digest_enabled)')

    // Both anchors must exist, or this test passes vacuously.
    expect(measure, 'computeTrustMetrics(ws.id call site').toBeGreaterThan(-1)
    expect(gate, 'digest opt-out gate').toBeGreaterThan(-1)

    expect(
      measure,
      'computeTrustMetrics must run above the digest gate, or workspaces with ' +
        'the digest off are never measured',
    ).toBeLessThan(gate)
  })
})
