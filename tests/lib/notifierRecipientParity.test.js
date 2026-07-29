import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// GUARD — the two producer-facing notifier crons must mail the SAME people,
// and must resolve OWNERS FROM CLERK rather than from staff.permission_tier.
//
// Two bugs, found a day apart, both in this pair of files:
//
//   1. They resolved recipients independently and drifted — escalation used
//      in.(owner,producer), the digest used eq.producer. An owner was nagged
//      daily about posts they were never sent a weekly summary of.
//
//   2. The fix for (1) still read the wrong source. Ownership in Bernard is a
//      CLERK fact (org_role === 'org:admin'); staff.permission_tier is left
//      NULL on create by design (staff/ensure-self.js) and NOTHING in the
//      product ever writes 'owner' to it. So in.(owner,producer) found zero
//      owners on 6 of 7 live workspaces, each of which has a real Clerk admin.
//      Only movebetter worked, because one row was set by hand.
//
// Both crons now go through listWorkspaceOwnerUserIds(). This guard pins that,
// because the failure is invisible from either file alone: the query looks
// perfectly reasonable, returns 200, and simply omits people.

// fileURLToPath, not URL.pathname — the repo lives under "Claude Projects" and
// .pathname percent-encodes the space, which readFileSync ENOENTs on.
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

const DIGEST = read('../../api/_routes/cron/engagement-digest.js')
const ESCALATION = read('../../api/_routes/cron/approval-escalation.js')
const CRONS = [['engagement-digest', DIGEST], ['approval-escalation', ESCALATION]]

// Strip `//` line comments before asserting that a bad pattern is ABSENT.
// Both files legitimately DESCRIBE the old broken query in prose, and a naive
// negative match reddens on that description — punishing the comment that
// explains the bug. This is the mirror of the documented "a grep guard is
// satisfied by a mention" trap: here a mention would falsely FAIL it.
const codeOnly = (src) => src.replace(/^\s*\/\/.*$/gm, '')

describe('producer notifier crons resolve the same recipients', () => {
  it.each(CRONS)('%s resolves owners via listWorkspaceOwnerUserIds', (_name, src) => {
    // `(` matters: a bare mention in a comment must not satisfy this.
    expect(src).toMatch(/listWorkspaceOwnerUserIds\(/)
    expect(src).toMatch(/from '\.\.\/\.\.\/_lib\/workspaceOwners\.js'/)
  })

  it.each(CRONS)('%s does not treat permission_tier as the owner source', (_name, src) => {
    // The shape that was wrong: in.(owner,producer) — right idea, wrong source
    // of truth. Asserted against code only, so the comments explaining the bug
    // don't trip it.
    expect(codeOnly(src)).not.toMatch(/permission_tier=in\.\([^)]*owner/)
  })

  it.each(CRONS)('%s still reads producer tier from staff', (_name, src) => {
    // Non-vacuity for the assertion above: producers ARE a real staff tier, so
    // removing the tier query entirely would silently drop them while leaving
    // the "no owner source" assertion trivially satisfied.
    expect(src).toMatch(/permission_tier=eq\.producer/)
  })

  it('both pass a workspace object carrying clerk_org_id', () => {
    // The helper reads workspace.clerk_org_id. If a cron selects the workspace
    // without that column, the Clerk lookup silently finds nobody and the whole
    // fix becomes a no-op that still returns 200 — exactly the failure this
    // guard exists to prevent. (approval-escalation shipped without it and had
    // to have the column added in the same change.)
    for (const [name, src] of CRONS) {
      const selects = [...src.matchAll(/select=([A-Za-z0-9_,]+)/g)].map((m) => m[1])
      const wsSelect = selects.find((s) => s.includes('slug') && s.includes('display_name'))
      expect(wsSelect, `${name}: no workspaces select found`).toBeTruthy()
      expect(wsSelect.split(','), `${name}: workspaces select omits clerk_org_id`).toContain('clerk_org_id')
    }
  })
})
