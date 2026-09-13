import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// GUARD — the deactivation gate is only as good as its wiring.
//
// tests/lib/teamAccess.test.js proves isDeactivatedInWorkspace() answers
// correctly. That proves nothing about whether anything ASKS it: delete the call
// from requireRole and every unit test stays green while a person who left can
// still open every route. The same is true of the server→client handoff (the
// me.js flag, the screen, the retry loop) and of the route's refusals. None of
// these fail loudly when broken — a missing gate just lets someone in.

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const codeOnly = (src) => src.replace(/^\s*\/\/.*$/gm, '')

const AUTH = codeOnly(read('../../api/_lib/auth.js'))
const ME = codeOnly(read('../../api/_routes/workspace/me.js'))
const APP = codeOnly(read('../../src/App.jsx'))
const WS_CONTEXT = codeOnly(read('../../src/lib/WorkspaceContext.jsx'))
const ROUTE = codeOnly(read('../../api/_routes/staff/access.js'))

describe('requireRole enforces deactivation', () => {
  const start = AUTH.indexOf('export async function requireRole')
  const end = AUTH.indexOf('export async function requirePlatformAdmin')
  const body = AUTH.slice(start, end)

  it('is sliced from the real function (a rotted anchor would pass vacuously)', () => {
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    expect(body).toMatch(/allowedRoles\.includes\(role\)/)
  })

  it('calls the gate and refuses with reason deactivated', () => {
    expect(body).toMatch(/isDeactivatedInWorkspace\(userId, wsRow\.id\)/)
    expect(body).toMatch(/reason: 'deactivated'/)
  })

  it('checks the gate BEFORE the role allow-list, so no role or bypass gets past it', () => {
    expect(body.indexOf('isDeactivatedInWorkspace(')).toBeLessThan(body.indexOf('allowedRoles.includes(role)'))
  })
})

describe('a deactivated person sees the switched-off screen, not a broken app', () => {
  it('me.js flags the slim shape', () => {
    expect(ME).toMatch(/access_deactivated:\s*auth\.reason === 'deactivated'/)
  })

  it('App renders the screen instead of the routes', () => {
    expect(APP).toMatch(/if \(ws\?\.access_deactivated\) return <AccessDeactivated/)
  })

  it('WorkspaceContext does not keep retrying for a fresh token', () => {
    expect(WS_CONTEXT).toMatch(/if \(data\.row\.access_deactivated\) return/)
  })
})

describe('POST /api/staff/access refusals and ordering', () => {
  it('requires members.invite', () => {
    expect(ROUTE).toMatch(/requireCapability\(req, ws, \[CAP_MEMBERS_INVITE\]\)/)
  })

  it('refuses deactivating yourself or an owner', () => {
    expect(ROUTE).toMatch(/target\.user_id === auth\.userId\) \{\s*return res\.status\(400\)\.json\(\{ error: 'cannot_deactivate_self' \}\)/)
    expect(ROUTE).toMatch(/owners\.has\(target\.user_id\)\) return res\.status\(400\)\.json\(\{ error: 'cannot_deactivate_owner' \}\)/)
  })

  it('hands work over before switching access off, so a failure leaves them active and retryable', () => {
    const handover = ROUTE.indexOf('await applyHandover(sb')
    const switchOff = ROUTE.indexOf('deactivated_at: new Date().toISOString()')
    expect(handover).toBeGreaterThan(-1)
    expect(switchOff).toBeGreaterThan(handover)
  })

  it('clears the cache on the instance that changed access', () => {
    expect((ROUTE.match(/invalidateDeactivation\(target\.user_id, ws\.id\)/g) || []).length).toBe(2)
  })
})
