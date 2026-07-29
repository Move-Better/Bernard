import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// GUARD — /settings/access must display and authorize owners using the same
// Clerk-derived source as everything else, not staff.permission_tier alone.
//
// AccessMatrix.jsx:153 derives `isOwner` purely from `person.permission_tier
// === 'owner'`. Nothing in the product ever writes 'owner' to that column
// (staff/ensure-self.js leaves it NULL on create by design), so before this
// fix, the real owner rendered as a plain clinician row on every workspace but
// one: not owner-locked in the UI, and under-resolved capabilities from
// resolveCapabilities(tier, ...) being called with the raw stored tier.
// Concretely, another admin could click and toggle capability overrides on the
// actual owner's row — the same fail-open shape already fixed in
// staff/capabilities.js, reached through the UI instead of the API.
//
// The fix stays server-side: the API resolves the effective tier once (Clerk
// admin -> 'owner', else the stored tier) and the client's existing
// `permission_tier === 'owner'` check is correct once the API stops lying.
// This guard pins the server side, since that's where a regression would
// silently reintroduce the bug without the client changing at all.

// fileURLToPath, not URL.pathname — the repo lives under "Claude Projects" and
// .pathname percent-encodes the space, which readFileSync ENOENTs on.
const src = readFileSync(
  fileURLToPath(new URL('../../api/_routes/workspace/access-matrix.js', import.meta.url)),
  'utf8',
)

describe('access-matrix API resolves owners from Clerk before returning them', () => {
  it('imports and calls listWorkspaceOwnerUserIds', () => {
    expect(src).toMatch(/from '\.\.\/\.\.\/_lib\/workspaceOwners\.js'/)
    expect(src).toMatch(/listWorkspaceOwnerUserIds\(/)
  })

  it('the returned permission_tier and capability sets come from the same effective tier', () => {
    // All three must share one variable, or a future edit can drift the
    // display tier out of sync with the tier actually used to resolve
    // capabilities — reintroducing the under-resolved-capabilities half of the
    // bug even if the display half stays fixed. The pending-invite branch is
    // hardcoded 'clinician' by design (an unaccepted invite is never an
    // owner) and is deliberately excluded — it's a different object literal.
    const permTier = [...src.matchAll(/permission_tier:\s*(\w+)/g)].map((m) => m[1])
      .filter((v) => v !== "'clinician'" && v !== 'clinician')
    const tierCaps = [...src.matchAll(/tier_capabilities:\s*resolveCapabilities\((\w+)/g)].map((m) => m[1])
      .filter((v) => v !== 'clinician')
    const resolvedCaps = [...src.matchAll(/resolved_capabilities:\s*resolveCapabilities\(\s*\n?\s*(\w+)/g)].map((m) => m[1])
      .filter((v) => v !== 'clinician')

    expect(permTier.length, 'expected a permission_tier: <var> assignment').toBeGreaterThan(0)
    expect(tierCaps.length, 'expected a tier_capabilities: resolveCapabilities(<var>) call').toBeGreaterThan(0)
    expect(resolvedCaps.length, 'expected a resolved_capabilities: resolveCapabilities(<var>) call').toBeGreaterThan(0)

    const vars = new Set([...permTier, ...tierCaps, ...resolvedCaps])
    expect([...vars], 'display tier and capability-resolution tier must be the same variable').toEqual(['effectiveTier'])
  })
})
