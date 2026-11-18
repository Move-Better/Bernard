// A first-time subscriber's checkout.session.completed must activate the
// workspace. Before the fix, the activation PATCH filtered on
// stripe_customer_id=eq.<new customer>, but a workspace that has never paid has
// stripe_customer_id NULL, so the PATCH matched zero rows: the money was taken
// and the workspace stayed on trial (audit 2026-11-18, full).
//
// global.fetch is a small fake that applies the two PostgREST filters this
// handler can send (eq and an or=(is.null,eq) group) to one workspace row, so
// the test exercises the real filter string, not a copy of it.

import { describe, it, expect, beforeEach, vi } from 'vitest'

process.env.SUPABASE_URL = 'http://supabase.test'
process.env.SUPABASE_SERVICE_KEY = 'service-key'
process.env.STRIPE_SECRET_KEY = 'sk_test_only_invalid'
delete process.env.STRIPE_WEBHOOK_SECRET
delete process.env.VERCEL_ENV

const { default: handler } = await import('../../api/_routes/billing/webhook.js')

let row

function matchesCustomerFilter(params, current) {
  const eq = params.get('stripe_customer_id')
  if (eq) return eq === `eq.${current}`
  const or = params.get('or')
  if (or) {
    const m = or.match(/^\(stripe_customer_id\.is\.null,stripe_customer_id\.eq\.([^)]+)\)$/)
    if (!m) throw new Error(`unexpected or filter: ${or}`)
    return current == null || current === decodeURIComponent(m[1])
  }
  return true
}

function fakeFetch(url, init = {}) {
  const u = new URL(url)
  if (u.hostname === 'api.stripe.com') {
    return Promise.resolve(new Response(JSON.stringify({ items: { data: [{ price: { id: 'price_unknown' } }] } })))
  }
  if (u.pathname === '/rest/v1/workspaces' && init.method === 'PATCH') {
    const params = u.searchParams
    const idOk = params.get('id') === `eq.${row.id}`
    if (!idOk || !matchesCustomerFilter(params, row.stripe_customer_id)) {
      return Promise.resolve(new Response('[]'))
    }
    row = { ...row, ...JSON.parse(init.body) }
    return Promise.resolve(new Response(JSON.stringify([row])))
  }
  throw new Error(`unexpected fetch ${init.method || 'GET'} ${url}`)
}

function call(event) {
  const raw = JSON.stringify(event)
  const req = { method: 'POST', headers: {}, rawBody: Buffer.from(raw) }
  const res = { statusCode: 0, status(c) { this.statusCode = c; return this }, json(b) { this.body = b; return this } }
  return handler(req, res).then(() => res)
}

function checkoutCompleted(customer) {
  return {
    type: 'checkout.session.completed',
    data: { object: { metadata: { workspace_id: 'ws-1' }, customer, subscription: 'sub_1' } },
  }
}

describe('billing webhook: checkout.session.completed', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(fakeFetch))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
  })

  it('activates a first-time subscriber whose workspace has no Stripe customer yet', async () => {
    row = { id: 'ws-1', plan: 'trial', stripe_customer_id: null, trial_ends_at: '2026-12-01T00:00:00Z' }
    await call(checkoutCompleted('cus_new'))
    expect(row.stripe_customer_id).toBe('cus_new')
    expect(row.plan).toBe('solo')
    expect(row.trial_ends_at).toBeNull()
  })

  it('still activates when the workspace already has this customer (re-subscribe)', async () => {
    row = { id: 'ws-1', plan: 'trial', stripe_customer_id: 'cus_same', trial_ends_at: null }
    await call(checkoutCompleted('cus_same'))
    expect(row.plan).toBe('solo')
  })

  it('does not rebind a workspace that belongs to a different Stripe customer', async () => {
    row = { id: 'ws-1', plan: 'trial', stripe_customer_id: 'cus_owner', trial_ends_at: null }
    await call(checkoutCompleted('cus_other'))
    expect(row.stripe_customer_id).toBe('cus_owner')
    expect(row.plan).toBe('trial')
  })
})
