import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// GUARD — the two producer-facing notifier crons must mail the SAME set of
// people.
//
// engagement-digest (weekly summary) and approval-escalation (daily nudge)
// both tell the same humans about the same approval queue. They resolved
// recipients independently and drifted: escalation used
// `permission_tier=in.(owner,producer)` while the digest used
// `permission_tier=eq.producer`. Net effect on the live workspace — an owner
// got nagged every day about posts they were never sent a weekly summary of.
//
// This is the same shape as the Buffer/bundle.social divergence in CLAUDE.md:
// two paths that "obviously" do the same thing, each re-implementing the rule,
// with no test tying them together. Neither file's own source looks wrong in
// isolation, which is exactly why this has to be a cross-file assertion.
//
// The tier set is deliberately compared as a normalized SET, not as a literal
// string, so reordering (`producer,owner`) or whitespace doesn't red-flag a
// change that is genuinely equivalent.

// fileURLToPath, not URL.pathname — the repo lives under "Claude Projects" and
// .pathname percent-encodes the space, which readFileSync ENOENTs on.
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

const DIGEST = read('../../api/_routes/cron/engagement-digest.js')
const ESCALATION = read('../../api/_routes/cron/approval-escalation.js')

// Pull the tier set out of a `permission_tier=in.(a,b)` PostgREST filter.
function tierSet(src, label) {
  const m = /permission_tier=in\.\(([^)]+)\)/.exec(src)
  expect(m, `${label}: no permission_tier=in.(...) filter found`).not.toBeNull()
  return new Set(m[1].split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean))
}

describe('producer notifier crons resolve the same recipients', () => {
  it('both derive recipients from the same permission tiers', () => {
    const digest = tierSet(DIGEST, 'engagement-digest')
    const escalation = tierSet(ESCALATION, 'approval-escalation')

    // Non-vacuity: a regex that matched an empty group would make the
    // comparison below trivially true.
    expect(digest.size, 'digest tier set is empty').toBeGreaterThan(0)
    expect(escalation.size, 'escalation tier set is empty').toBeGreaterThan(0)

    expect([...digest].sort()).toEqual([...escalation].sort())
  })

  it('that shared set is owner + producer', () => {
    // Pins the actual intent, not just parity — parity alone is satisfied by
    // both files being changed to something wrong in the same commit.
    expect([...tierSet(DIGEST, 'engagement-digest')].sort()).toEqual(['owner', 'producer'])
  })

  it('neither cron narrows recipients with an eq.producer filter', () => {
    // The pre-fix digest shape. `eq.` on this column is how the drift
    // happened; an `in.(...)` set is the only form that should appear.
    expect(DIGEST).not.toMatch(/permission_tier=eq\./)
    expect(ESCALATION).not.toMatch(/permission_tier=eq\./)
  })
})
