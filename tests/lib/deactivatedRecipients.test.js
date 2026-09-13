import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { listWorkspaceOwnerUserIds } from '../../api/_lib/workspaceOwners.js'

// GUARD — someone whose access was switched off (staff.deactivated_at,
// migration 216) must stop getting nudges, digests and send-back emails.
//
// Deactivation deliberately KEEPS the Clerk login, org membership and tier, so
// every recipient query that was correct yesterday still matches a person who
// left. Nothing errors when one is missed: the email simply goes to their new
// personal address. Each recipient source is pinned here.

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const codeOnly = (src) => src.replace(/^\s*\/\/.*$/gm, '')

const ESCALATION = codeOnly(read('../../api/_routes/cron/approval-escalation.js'))
const DIGEST = codeOnly(read('../../api/_routes/cron/engagement-digest.js'))
const BLOG_NUDGE = codeOnly(read('../../api/_routes/cron/blog-target-nudge.js'))
const SENDBACK = codeOnly(read('../../api/_routes/cron/moment-sendback-nudge.js'))

// The producer query spans two concatenated template literals, so match across
// the `+` rather than requiring both tokens on one line.
const PRODUCERS_ACTIVE = /permission_tier=eq\.producer`\s*\+\s*`[^`]*deactivated_at=is\.null/

describe('recipient queries skip deactivated people', () => {
  it.each([['approval-escalation', ESCALATION], ['engagement-digest', DIGEST]])(
    '%s only mails active producers',
    (_name, src) => { expect(src).toMatch(PRODUCERS_ACTIVE) },
  )

  it('engagement-digest also cleans a hand-set recipient list', () => {
    // Calling the lookup is not enough — a mutant that fetched the set and
    // then ignored it survived the call-only version of this assertion. Pin
    // that the result actually filters the recipients.
    expect(DIGEST).toMatch(/const gone = await listDeactivatedUserIds\(ws, sb/)
    expect(DIGEST).toMatch(/recipientUserIds = recipientUserIds\.filter\(\(uid\) => !gone\.has\(uid\)\)/)
  })

  it('blog-target-nudge only nudges active reviewers', () => {
    expect(BLOG_NUDGE).toMatch(/blog_review_enabled=is\.true[^`]*deactivated_at=is\.null/)
  })

  it('moment-sendback-nudge skips a deactivated author', () => {
    expect(SENDBACK).toMatch(/select=id,name,user_id,deactivated_at/)
    expect(SENDBACK).toMatch(/if \(staff\?\.deactivated_at\)/)
  })
})

describe('listWorkspaceOwnerUserIds leaves deactivated owners out', () => {
  const ok = (rows) => ({ ok: true, json: async () => rows })

  it('drops a Clerk org admin whose access is switched off, and filters owner-tier rows', async () => {
    const paths = []
    const sb = async (path) => {
      paths.push(path)
      if (path.includes('permission_tier=eq.owner')) return ok([{ user_id: 'user_tier_owner' }])
      if (path.includes('deactivated_at=not.is.null')) return ok([{ user_id: 'user_admin_gone' }])
      return ok([])
    }
    const clerk = () => ({
      organizations: {
        getOrganizationMembershipList: async () => ({
          data: [
            { role: 'org:admin', publicUserData: { userId: 'user_admin_active', identifier: 'q@example.com' } },
            { role: 'org:admin', publicUserData: { userId: 'user_admin_gone', identifier: 'gone@example.com' } },
          ],
        }),
      },
    })

    const owners = await listWorkspaceOwnerUserIds({ id: 'ws1', clerk_org_id: 'org_1' }, sb, clerk, '[test]')
    expect([...owners].sort()).toEqual(['user_admin_active', 'user_tier_owner'])
    expect(paths.find((p) => p.includes('permission_tier=eq.owner'))).toContain('deactivated_at=is.null')
  })
})
