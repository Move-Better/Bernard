import { describe, it, expect } from 'vitest'
import { listWorkspaceOwnerUserIds } from '../../api/_lib/workspaceOwners.js'

// The Playwright/e2e fixture account is a real Clerk org:admin on the
// movebetter workspace (needed so it passes authz checks in tests — see
// tests/e2e/auth.setup.ts + scripts/capture-screenshot.mjs). Left unfiltered,
// that made it indistinguishable from a real owner, and it started receiving
// production "Weekly Producer Digest" emails at e2e@movebetter.co via
// engagement-digest.js and approval-escalation.js (both resolve recipients
// through this one function). This pins the exclusion so it can't silently
// regress.

function membership(role, identifier, userId) {
  return { role, publicUserData: { identifier, userId } }
}

const noOwnerTierRows = async () => ({ ok: true, json: async () => [] })

describe('listWorkspaceOwnerUserIds — e2e fixture exclusion', () => {
  it('excludes an org:admin whose identifier is the e2e fixture email', async () => {
    const clerk = () => ({
      organizations: {
        getOrganizationMembershipList: async () => ({
          data: [
            membership('org:admin', 'e2e@movebetter.co', 'user_e2e_fixture'),
            membership('org:admin', 'drq@movebetter.co', 'user_real_owner'),
          ],
        }),
      },
    })

    const owners = await listWorkspaceOwnerUserIds(
      { id: 'ws1', clerk_org_id: 'org_1' },
      noOwnerTierRows,
      clerk,
    )

    expect(owners.has('user_real_owner')).toBe(true)
    expect(owners.has('user_e2e_fixture')).toBe(false)
    expect(owners.size).toBe(1)
  })

  it('matches the fixture email case-insensitively', async () => {
    const clerk = () => ({
      organizations: {
        getOrganizationMembershipList: async () => ({
          data: [membership('org:admin', 'E2E@MoveBetter.CO', 'user_e2e_fixture')],
        }),
      },
    })

    const owners = await listWorkspaceOwnerUserIds(
      { id: 'ws1', clerk_org_id: 'org_1' },
      noOwnerTierRows,
      clerk,
    )

    expect(owners.size).toBe(0)
  })

  it('still returns a non-fixture org:admin when the fixture is not a member', async () => {
    const clerk = () => ({
      organizations: {
        getOrganizationMembershipList: async () => ({
          data: [membership('org:admin', 'owner@movebetter.co', 'user_real_owner')],
        }),
      },
    })

    const owners = await listWorkspaceOwnerUserIds(
      { id: 'ws1', clerk_org_id: 'org_1' },
      noOwnerTierRows,
      clerk,
    )

    expect(owners.has('user_real_owner')).toBe(true)
  })
})
