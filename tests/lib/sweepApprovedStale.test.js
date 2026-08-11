import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// fileURLToPath, not URL.pathname — the repo lives under "Claude Projects" and
// .pathname percent-encodes the space into %20, which readFileSync ENOENTs.
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

const SWEEP = read('../../api/_routes/cron/sweep-past-weeks.js')
const CHECKPOINTS = read('../../api/_routes/producer/checkpoints.js')

// Q, 2026-08-11: "There should be no pending post older than 8/3/26" — but an
// Instagram post approved 2026-06-01 was still sitting in the queue 72 days
// later. The sweep was working fine; `approved` was simply never in its status
// list, and the post carried no plan atom, so cases (a) and (b) couldn't see
// it either. It fell through all three.
//
// These pin the fix at both the sweep and the surfacing end.

describe('the sweep can see approved posts', () => {
  it('includes approved in the sweepable status list', () => {
    const m = SWEEP.match(/const SWEEPABLE_STALE_STATUSES = '([^']+)'/)
    expect(m, 'SWEEPABLE_STALE_STATUSES not found').toBeTruthy()
    const statuses = m[1].split(',')
    expect(statuses).toContain('approved')
    expect(statuses).toContain('draft')
    expect(statuses).toContain('in_review')
  })

  it('uses the constant at BOTH call sites, not just the candidate fetch', () => {
    // The candidate fetch selects rows; the PATCH re-checks status so a
    // concurrent approve/publish can't be clobbered. Extending only the first
    // would find approved rows and then refuse to archive them — a silent
    // no-op with no error anywhere. Count, not presence: this file has two
    // sites, so a presence check stays green if one is reverted.
    const uses = SWEEP.match(/status=in\.\(\$\{SWEEPABLE_STALE_STATUSES\}\)/g) || []
    expect(uses.length).toBe(2)
  })

  it('leaves no hardcoded draft,in_review status filter behind', () => {
    // The literal both sites used before the fix. If either reappears, one
    // half of the sweep has silently regressed to the old vocabulary.
    expect(SWEEP).not.toMatch(/status=in\.\(draft,in_review\)/)
  })

  it('still guards on scheduled_at so a live post is never swept', () => {
    // approved + a FUTURE schedule is live, not stalled. This guard is what
    // makes adding `approved` safe, so it must survive alongside it.
    const guards = SWEEP.match(/scheduled_at\.is\.null,scheduled_at\.lt\./g) || []
    expect(guards.length).toBeGreaterThanOrEqual(2)
  })

  it('still excludes blog from the destructive sweep', () => {
    // Q, 2026-08-10: a stale in_review blog draft is a finished piece awaiting
    // publish, and archiving it destroys the thing the digest wants shipped.
    expect(SWEEP).toMatch(/platform=neq\.blog/)
  })
})

describe('the stall is surfaced before the janitor eats it', () => {
  it('adds an approved_unscheduled checkpoint', () => {
    expect(CHECKPOINTS).toMatch(/type: 'approved_unscheduled'/)
  })

  it('counts approved rows with no schedule', () => {
    expect(CHECKPOINTS).toMatch(/status=eq\.approved&scheduled_at=is\.null/)
  })

  it('actually calls the counter — a defined-but-uncalled counter is dead scaffold', () => {
    // The repo's recurring failure mode: a function with a sensible signature
    // that nothing invokes. Require a real call, not just the definition.
    expect(CHECKPOINTS).toMatch(/^\s*approvedUnscheduled\(ws\.id\),/m)
  })

  it('deep-links to the post itself when there is exactly one', () => {
    expect(CHECKPOINTS).toMatch(/\/publish\/\$\{stalled\.firstId\}/)
  })

  it('goes amber once anything is stale, like post_approvals does', () => {
    expect(CHECKPOINTS).toMatch(/type: 'approved_unscheduled', tier: stalled\.staleCount > 0 \? 2 : 3/)
  })

  it('includes blog here, unlike postApprovals', () => {
    // An approved blog post is past clinician review and waiting on someone to
    // publish it — operational, and the sweep deliberately won't clean it up,
    // so a human must. Pinning the ABSENCE of the exclusion in this query.
    const q = CHECKPOINTS.match(/status=eq\.approved&scheduled_at=is\.null[^`]*/)?.[0] || ''
    expect(q).toBeTruthy()
    expect(q).not.toMatch(/platform=neq\.blog/)
  })
})
