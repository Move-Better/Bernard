// A double-submitted onboarding claim must never delete a Clerk org that a
// workspace is bound to. Claim A creates the org, claim B reuses it (no
// workspace bound yet), B's insert wins, A's loses on the slug and rolled the
// org back, deleting the org B's new workspace runs on (audit 2026-11-18, P2).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

process.env.SUPABASE_URL = 'http://supabase.test'
process.env.SUPABASE_SERVICE_KEY = 'service-key'

const { rollbackOrg } = await import('../../api/_routes/onboarding/claim.js')

let bound
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => (bound === 'error'
    ? new Response('down', { status: 503 })
    : new Response(JSON.stringify(bound ? [{ id: 'ws-b' }] : []), { status: 200 }))))
})
afterEach(() => vi.unstubAllGlobals())

describe('claim rollbackOrg', () => {
  it('keeps an org a workspace is now bound to', async () => {
    bound = true
    const deleteOrg = vi.fn()
    expect(await rollbackOrg('org_1', { createdHere: true, deleteOrg })).toBe(false)
    expect(deleteOrg).not.toHaveBeenCalled()
  })

  it('never deletes an org this request reused', async () => {
    bound = false
    const deleteOrg = vi.fn()
    expect(await rollbackOrg('org_1', { createdHere: false, deleteOrg })).toBe(false)
    expect(deleteOrg).not.toHaveBeenCalled()
  })

  it('keeps the org when the binding cannot be checked', async () => {
    bound = 'error'
    const deleteOrg = vi.fn()
    expect(await rollbackOrg('org_1', { createdHere: true, deleteOrg })).toBe(false)
    expect(deleteOrg).not.toHaveBeenCalled()
  })

  it('deletes an org it created that nothing is bound to', async () => {
    bound = false
    const deleteOrg = vi.fn()
    expect(await rollbackOrg('org_1', { createdHere: true, deleteOrg })).toBe(true)
    expect(deleteOrg).toHaveBeenCalledWith('org_1')
  })
})

// Every rollback site in the route must go through rollbackOrg. A direct
// deleteOrganization(org.id) would reopen the race on that path.
describe('claim.js rollback sites', () => {
  const src = readFileSync(fileURLToPath(new URL('../../api/_routes/onboarding/claim.js', import.meta.url)), 'utf8')
  it('has no direct org delete outside rollbackOrg', () => {
    expect(src).not.toMatch(/deleteOrganization\(org\.id\)/)
  })
  it('routes all four rollback sites through rollbackOrg (non-vacuity)', () => {
    expect(src.match(/await rollbackOrg\(org\.id/g)).toHaveLength(4)
  })
})
