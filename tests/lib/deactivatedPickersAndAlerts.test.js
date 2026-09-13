import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { pickableStaff } from '../../src/lib/activeStaff.js'
import { alertRecipientEmails } from '../../api/_lib/workspaceOwner.js'

// GUARD — after someone is deactivated (migration 216) they must not be offered
// for new work, and alerts that used to go to them must reach someone active.
// Both failures are silent: a picker just lists them, an alert just emails
// their personal address.

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const codeOnly = (src) => src.replace(/^\s*\/\/.*$/gm, '')

describe('pickableStaff', () => {
  const people = [
    { id: 'a', name: 'Active' },
    { id: 'b', name: 'Left', deactivated_at: '2026-09-13T20:24:15Z' },
    { id: 'c', name: 'Also left', deactivated_at: '2026-09-01T00:00:00Z' },
  ]

  it('hides people whose access is switched off', () => {
    expect(pickableStaff(people).map((p) => p.id)).toEqual(['a'])
  })

  it('keeps someone already selected so they can be seen and un-selected', () => {
    expect(pickableStaff(people, ['b']).map((p) => p.id)).toEqual(['a', 'b'])
    expect(pickableStaff(people, 'c').map((p) => p.id)).toEqual(['a', 'c'])
  })

  it('tolerates a missing list', () => {
    expect(pickableStaff(undefined)).toEqual([])
  })
})

describe('every new-work picker filters deactivated people', () => {
  const PICKERS = [
    '../../src/components/MediaDetail.jsx',
    '../../src/components/MediaUploader.jsx',
    '../../src/pages/NewInterview.jsx',
    '../../src/pages/NewNewsletter.jsx',
    '../../src/pages/settings/CampaignsSettings.jsx',
  ]
  it.each(PICKERS)('%s imports and calls pickableStaff', (rel) => {
    const src = codeOnly(read(rel))
    expect(src).toMatch(/import \{ pickableStaff \} from '@\/lib\/activeStaff'/)
    expect(src).toMatch(/pickableStaff\(/)
  })

  it('the merge target list and the coverage roster skip deactivated people', () => {
    expect(codeOnly(read('../../src/pages/StaffProfile.jsx'))).toMatch(/s\.id !== staffId && !s\.deactivated_at/)
    expect(codeOnly(read('../../api/_routes/editorial/coverage.js'))).toMatch(/staff\?workspace_id=eq\.\$\{ws\.id\}&deactivated_at=is\.null/)
    expect(codeOnly(read('../../api/_routes/corpus/ingest.js'))).toMatch(/deactivated_at=is\.null&select=id&limit=1/)
  })
})

describe('founder alerts fall back to active owners', () => {
  const ok = (rows) => ({ ok: true, json: async () => rows })

  function fakes({ deactivated = [], orgAdmins = [], noEmail = [] } = {}) {
    const getUserCalls = []
    const sb = async (path) => {
      if (path.includes('deactivated_at=not.is.null')) return ok(deactivated.map((user_id) => ({ user_id })))
      return ok([])
    }
    const client = {
      users: {
        getUser: async (id) => {
          getUserCalls.push(id)
          if (noEmail.includes(id)) throw new Error('not found')
          return { primaryEmailAddressId: 'e1', emailAddresses: [{ id: 'e1', emailAddress: `${id}@example.com` }] }
        },
      },
      organizations: {
        getOrganizationMembershipList: async () => ({
          data: orgAdmins.map((userId) => ({ role: 'org:admin', publicUserData: { userId, identifier: `${userId}@example.com` } })),
        }),
      },
    }
    return { sb, clerkFn: () => client, getUserCalls }
  }

  const WS = { id: 'ws1', clerk_org_id: 'org_1', created_by_clerk_user_id: 'founder' }

  it('sends to the founder while they are active', async () => {
    const f = fakes({ orgAdmins: ['founder', 'other_owner'] })
    expect(await alertRecipientEmails(WS, f)).toEqual(['founder@example.com'])
  })

  it('sends to every active owner once the founder is deactivated — never the founder', async () => {
    const f = fakes({ deactivated: ['founder', 'gone_owner'], orgAdmins: ['founder', 'other_owner', 'gone_owner'] })
    expect(await alertRecipientEmails(WS, f)).toEqual(['other_owner@example.com'])
    expect(f.getUserCalls).not.toContain('founder')
  })

  it('falls back to owners when the founder has no resolvable email', async () => {
    const f = fakes({ orgAdmins: ['founder', 'other_owner'], noEmail: ['founder'] })
    expect(await alertRecipientEmails(WS, f)).toEqual(['other_owner@example.com'])
  })

  it('returns nobody without a workspace, rather than throwing', async () => {
    expect(await alertRecipientEmails(null, fakes())).toEqual([])
  })

  it('both notifiers resolve recipients through it, and select clerk_org_id for the fallback', () => {
    for (const rel of ['../../api/_lib/notifyPublishFailure.js', '../../api/_lib/notifyChannelHealth.js']) {
      const src = codeOnly(read(rel))
      expect(src, rel).toMatch(/alertRecipientEmails\(/)
      expect(src, rel).not.toMatch(/ownerEmail\(/)
    }
    expect(codeOnly(read('../../api/_lib/notifyPublishFailure.js'))).toMatch(/select=id,slug,display_name,clerk_org_id,created_by_clerk_user_id/)
    expect(codeOnly(read('../../api/_routes/cron/check-channel-health.js'))).toMatch(/clerk_org_id,created_by_clerk_user_id/)
  })
})
