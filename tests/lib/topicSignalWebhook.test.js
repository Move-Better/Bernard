// Tests for the generic topic-suggestion inbox: POST /api/webhooks/topic-signal
// (contract signals-in.v1). Covers: ship-dark 503, valid → one pending
// vigil_signal row (201), bad signature → 401, replay → no duplicate (200),
// unknown workspace → 404.
//
// The handler reads SUPABASE_URL / SUPABASE_SERVICE_KEY at module load, so we
// set them BEFORE the dynamic import. global.fetch is mocked with a tiny
// stateful fake of the two tables the handler touches (workspaces, topic_backlog).

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createHmac } from 'node:crypto'

process.env.SUPABASE_URL = 'http://supabase.test'
process.env.SUPABASE_SERVICE_KEY = 'service-key'

const { default: handler } = await import('../../api/_routes/webhooks/topic-signal.js')

const SECRET = 'vigil-signal-test-secret'
const WORKSPACES = [{ id: 'ws-1', slug: 'portland', status: 'active', display_name: 'Move Better' }]

let store = []
let idCounter = 1

function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
  }
}

function mockFetch(url, init = {}) {
  const u = typeof url === 'string' ? url : url.toString()
  const method = (init.method || 'GET').toUpperCase()

  if (u.includes('/workspaces?')) {
    const m = u.match(/slug=eq\.([^&]+)/) || u.match(/id=eq\.([^&]+)/)
    const key = m ? decodeURIComponent(m[1]) : null
    const rows = WORKSPACES.filter((w) => w.slug === key || w.id === key)
    return Promise.resolve(jsonResponse(rows))
  }

  if (u.includes('/topic_backlog')) {
    if (method === 'GET') {
      const km = u.match(/idempotency_key=eq\.([^&]+)/)
      const wm = u.match(/workspace_id=eq\.([^&]+)/)
      const key = km ? decodeURIComponent(km[1]) : null
      const wsid = wm ? decodeURIComponent(wm[1]) : null
      const rows = store.filter(
        (r) => r.source === 'vigil_signal' && r.workspace_id === wsid && r.idempotency_key === key
      )
      return Promise.resolve(jsonResponse(rows))
    }
    if (method === 'POST') {
      const body = JSON.parse(init.body)
      // Simulate the partial unique index on (workspace_id, idempotency_key).
      if (
        body.idempotency_key &&
        store.some((r) => r.workspace_id === body.workspace_id && r.idempotency_key === body.idempotency_key)
      ) {
        return Promise.resolve(jsonResponse({ message: 'duplicate key' }, 409))
      }
      const row = { id: `tb-${idCounter++}`, created_at: new Date().toISOString(), ...body }
      store.push(row)
      return Promise.resolve(jsonResponse([row], 201))
    }
  }

  return Promise.resolve(jsonResponse({ error: 'unmocked', url: u }, 500))
}

function makeReq(bodyObj, { sign = 'valid', method = 'POST' } = {}) {
  const raw = Buffer.from(JSON.stringify(bodyObj), 'utf8')
  const headers = {}
  if (sign === 'valid') {
    headers['x-signature'] = createHmac('sha256', SECRET).update(raw).digest('hex')
  } else if (sign === 'bad') {
    headers['x-signature'] = createHmac('sha256', 'wrong-secret').update(raw).digest('hex')
  } // sign === 'none' → no header
  return { method, headers, rawBody: raw }
}

function makeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(obj) { this.body = obj; return this },
  }
}

const BASE = {
  workspace: 'portland',
  topic: 'New-patient acquisition content for lower-back pain',
  rationale: 'Shift emphasis toward new-patient acquisition.',
  provenance: { source: 'vigil-scorecard', metric: 'New patients / wk', value: '9', week_ending: '2026-07-01' },
}

beforeEach(() => {
  store = []
  idCounter = 1
  process.env.VIGIL_SIGNAL_SECRET = SECRET
  global.fetch = vi.fn(mockFetch)
})

describe('POST /api/webhooks/topic-signal — ship-dark', () => {
  it('returns 503 not_configured when VIGIL_SIGNAL_SECRET is unset', async () => {
    delete process.env.VIGIL_SIGNAL_SECRET
    const res = makeRes()
    await handler(makeReq({ ...BASE, idempotency_key: 'k1' }), res)
    expect(res.statusCode).toBe(503)
    expect(res.body).toEqual({ error: 'not_configured' })
    expect(store).toHaveLength(0)
  })
})

describe('POST /api/webhooks/topic-signal — auth', () => {
  it('returns 401 on a bad signature and never touches the DB', async () => {
    const res = makeRes()
    await handler(makeReq({ ...BASE, idempotency_key: 'k1' }, { sign: 'bad' }), res)
    expect(res.statusCode).toBe(401)
    expect(res.body).toEqual({ error: 'invalid_signature' })
    expect(store).toHaveLength(0)
  })

  it('returns 401 when the signature header is missing', async () => {
    const res = makeRes()
    await handler(makeReq({ ...BASE }, { sign: 'none' }), res)
    expect(res.statusCode).toBe(401)
    expect(store).toHaveLength(0)
  })
})

describe('POST /api/webhooks/topic-signal — effect', () => {
  it('files exactly one pending vigil_signal row on a valid signature (201)', async () => {
    const res = makeRes()
    await handler(makeReq({ ...BASE, idempotency_key: 'k1' }), res)
    expect(res.statusCode).toBe(201)
    expect(res.body.created).toBe(true)
    expect(store).toHaveLength(1)
    const row = store[0]
    expect(row.source).toBe('vigil_signal')
    expect(row.status).toBe('pending')
    expect(row.workspace_id).toBe('ws-1')
    expect(row.topic).toBe(BASE.topic)
    // provenance folded into the rationale so a human sees where it came from
    expect(row.rationale).toContain('vigil-scorecard')
    expect(row.rationale).toContain('New patients / wk')
  })

  it('never sets any publish / in_progress field — pending only, by construction', async () => {
    const res = makeRes()
    await handler(makeReq({ ...BASE, idempotency_key: 'k1' }), res)
    const row = store[0]
    expect(row.status).toBe('pending')
    expect(row.interview_id).toBeUndefined()
    expect(row.published_at).toBeUndefined()
  })

  it('returns 404 for an unknown workspace and inserts nothing', async () => {
    const res = makeRes()
    await handler(makeReq({ ...BASE, workspace: 'nope', idempotency_key: 'k1' }), res)
    expect(res.statusCode).toBe(404)
    expect(res.body).toEqual({ error: 'unknown_workspace' })
    expect(store).toHaveLength(0)
  })
})

describe('POST /api/webhooks/topic-signal — idempotency', () => {
  it('a replay of the same idempotency_key returns 200 with the existing row, no duplicate', async () => {
    const first = makeRes()
    await handler(makeReq({ ...BASE, idempotency_key: 'dup-key' }), first)
    expect(first.statusCode).toBe(201)
    expect(store).toHaveLength(1)
    const firstId = store[0].id

    const second = makeRes()
    await handler(makeReq({ ...BASE, idempotency_key: 'dup-key' }), second)
    expect(second.statusCode).toBe(200)
    expect(second.body.duplicate).toBe(true)
    expect(second.body.row.id).toBe(firstId)
    expect(store).toHaveLength(1) // still one row
  })
})

describe('POST /api/webhooks/topic-signal — method + validation', () => {
  it('rejects non-POST with 405', async () => {
    const res = makeRes()
    await handler(makeReq({ ...BASE }, { method: 'GET' }), res)
    expect(res.statusCode).toBe(405)
  })

  it('returns 400 when topic is missing', async () => {
    const res = makeRes()
    await handler(makeReq({ workspace: 'portland' }), res)
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toBe('missing_topic')
  })
})
