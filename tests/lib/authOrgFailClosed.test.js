// requireRole must fail closed when a caller passes `orgId` but the workspace
// has no Clerk org (null/empty clerk_org_id, or no workspace at all via
// `ws?.clerk_org_id`). Before 2026-11-19, `if (orgId && …)` skipped the org
// check entirely, so any signed-in Clerk user from ANY org passed.
// (2026-11-18 full audit, P2 tenant list.)
import { describe, it, expect, vi, beforeAll } from 'vitest'

const payload = { sub: 'user_attacker', org_id: 'org_attacker', org_role: 'org:admin' }

vi.mock('@clerk/backend', () => ({
  verifyToken: vi.fn(async () => payload),
  createClerkClient: () => ({
    users: { getUser: vi.fn(async (id) => ({ id, publicMetadata: { role: 'admin' } })) },
  }),
}))

vi.mock('../../api/_lib/supabaseRest.js', () => ({
  supabaseRest: vi.fn(async () => ({ ok: true, json: async () => [] })),
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_KEY: 'k',
}))

let requireRole
beforeAll(async () => {
  process.env.CLERK_SECRET_KEY = 'sk_test_dummy'
  ;({ requireRole } = await import('../../api/_lib/auth.js'))
})

const req = { headers: { authorization: 'Bearer t' } }

describe('requireRole: workspace with no Clerk org', () => {
  for (const [label, orgId] of [['null', null], ['undefined', undefined], ['empty', ''], ['blank', '   ']]) {
    it(`refuses when orgId is passed as ${label}`, async () => {
      const r = await requireRole(req, ['admin'], { orgId })
      expect(r.ok).toBe(false)
      expect(r.reason).toBe('no-workspace-org')
    })
  }

  it('still rejects a token from a different org', async () => {
    const r = await requireRole(req, ['admin'], { orgId: 'org_victim' })
    expect(r).toMatchObject({ ok: false, reason: 'wrong-org' })
  })

  it('passes a token from the matching org', async () => {
    const r = await requireRole(req, ['admin'], { orgId: 'org_attacker' })
    expect(r.ok).toBe(true)
  })

  it('leaves callers that omit orgId (apex routes) unchanged', async () => {
    const r = await requireRole(req, ['admin'])
    expect(r.ok).toBe(true)
  })
})
