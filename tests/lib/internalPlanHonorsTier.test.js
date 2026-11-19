// On an 'internal' workspace every member used to resolve to admin, so a Team
// member could use owner pages and actions. Q, 2026-11-19: honor a restricting
// tier. Team member ('clinician') and Viewer are not admin; owners (org admins),
// producers and people with no staff row yet keep the bypass; a failed tier
// lookup degrades to the restricted role, never to admin.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = { payload: null, tier: null, tierStatus: 200 }

vi.mock('@clerk/backend', () => ({
  verifyToken: vi.fn(async () => state.payload),
  createClerkClient: () => ({
    users: { getUser: vi.fn(async (id) => ({ id, publicMetadata: {} })) },
  }),
}))

vi.mock('../../api/_lib/supabaseRest.js', () => ({
  supabaseRest: vi.fn(async (path) => {
    if (path.startsWith('workspaces?')) {
      return { ok: true, json: async () => [{ id: 'ws1', plan: 'internal' }] }
    }
    if (path.includes('deactivated_at=not.is.null')) return { ok: true, json: async () => [] }
    if (path.includes('select=permission_tier')) {
      if (state.tierStatus !== 200) return { ok: false, status: state.tierStatus, json: async () => null }
      return { ok: true, json: async () => (state.tier ? [{ permission_tier: state.tier }] : []) }
    }
    return { ok: true, json: async () => [] }
  }),
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_KEY: 'k',
}))

let requireRole
beforeEach(async () => {
  process.env.CLERK_SECRET_KEY = 'sk_test_dummy'
  vi.resetModules()
  ;({ requireRole } = await import('../../api/_lib/auth.js'))
})

const req = () => ({ headers: { authorization: 'Bearer t' } })
const run = (user, orgRole, tier, tierStatus = 200) => {
  state.payload = { sub: user, org_id: 'org1', org_role: orgRole }
  state.tier = tier
  state.tierStatus = tierStatus
  return requireRole(req(), ['admin'], { orgId: 'org1' })
}

describe('requireRole on an internal-plan workspace', () => {
  it('refuses a Team member (clinician tier) on an admin-only route', async () => {
    const r = await run('u_team', 'org:member', 'clinician')
    expect(r).toMatchObject({ ok: false, reason: 'forbidden', role: 'clinician' })
  })
  it('refuses a Viewer', async () => {
    expect((await run('u_view', 'org:member', 'viewer')).ok).toBe(false)
  })
  it('keeps a producer as admin', async () => {
    expect(await run('u_prod', 'org:member', 'producer')).toMatchObject({ ok: true, role: 'admin' })
  })
  it('keeps a person with no staff row yet as admin', async () => {
    expect(await run('u_new', 'org:member', null)).toMatchObject({ ok: true, role: 'admin' })
  })
  it('keeps a Clerk org admin as admin even when their row says clinician', async () => {
    expect(await run('u_owner', 'org:admin', 'clinician')).toMatchObject({ ok: true, role: 'admin' })
  })
  it('degrades to the restricted role, not admin, when the tier lookup fails', async () => {
    const r = await run('u_err', 'org:member', null, 500)
    expect(r).toMatchObject({ ok: false, reason: 'forbidden', role: 'clinician' })
  })
})
