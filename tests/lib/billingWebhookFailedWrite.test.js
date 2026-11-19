// A Stripe event whose Supabase write fails must not be acknowledged. Stripe
// retries only on a non-2xx answer, so before the fix a 5xx from PostgREST was
// logged and answered 200: the plan change was lost for good (audit
// 2026-11-18, full, P2). A PATCH that matches zero rows (customer mismatch) is
// still acked, because a retry cannot change that outcome.

import { describe, it, expect, beforeEach, vi } from 'vitest'

process.env.SUPABASE_URL = 'http://supabase.test'
process.env.SUPABASE_SERVICE_KEY = 'service-key'
process.env.STRIPE_SECRET_KEY = 'sk_test_only_invalid'
delete process.env.STRIPE_WEBHOOK_SECRET
delete process.env.VERCEL_ENV

const { default: handler } = await import('../../api/_routes/billing/webhook.js')

let supabase // (url, init) => Response for /rest/v1 calls

function fakeFetch(url, init = {}) {
  const u = new URL(url)
  if (u.hostname === 'api.stripe.com') {
    return Promise.resolve(new Response(JSON.stringify({ status: 'active', items: { data: [{ price: { id: 'price_unknown' } }] } })))
  }
  return Promise.resolve(supabase(u, init))
}

function call(event) {
  const raw = JSON.stringify(event)
  const req = { method: 'POST', headers: {}, rawBody: Buffer.from(raw) }
  const res = { statusCode: 0, status(c) { this.statusCode = c; return this }, json(b) { this.body = b; return this } }
  return handler(req, res).then(() => res)
}

const deleted = {
  type: 'customer.subscription.deleted',
  data: { object: { metadata: { workspace_id: 'ws-1' }, customer: 'cus_1' } },
}
const paidByCustomer = {
  type: 'invoice.paid',
  data: { object: { customer: 'cus_1', subscription: 'sub_1' } },
}

describe('billing webhook: failed Supabase writes are retried by Stripe', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(fakeFetch))
    for (const m of ['error', 'info', 'warn']) vi.spyOn(console, m).mockImplementation(() => {})
  })

  it('answers 500 when the workspace PATCH fails', async () => {
    supabase = () => new Response('upstream down', { status: 503 })
    const res = await call(deleted)
    expect(res.statusCode).toBe(500)
  })

  it('answers 500 when the customer-id lookup fails', async () => {
    supabase = () => new Response('upstream down', { status: 503 })
    const res = await call(paidByCustomer)
    expect(res.statusCode).toBe(500)
  })

  it('still acks 200 when the PATCH succeeds', async () => {
    supabase = (u, init) => new Response(init.method === 'PATCH' ? '[{"id":"ws-1"}]' : '[{"id":"ws-1"}]')
    const res = await call(deleted)
    expect(res.statusCode).toBe(200)
  })

  it('still acks 200 when the PATCH matches no row (retry cannot help)', async () => {
    supabase = () => new Response('[]')
    const res = await call(deleted)
    expect(res.statusCode).toBe(200)
  })
})
