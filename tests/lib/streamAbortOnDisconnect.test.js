// /api/stream must stop the model call when the client disconnects. Before the
// fix nothing was wired to the request lifetime, so a closed tab let the
// generation run to completion (up to 16k output tokens) for nobody (audit
// 2026-11-18, P2).

import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'

let captured
vi.mock('ai', () => ({
  streamText: (opts) => {
    captured = opts
    return {
      stream: (async function* () {
        yield { type: 'text-delta', text: 'hello' }
        await new Promise((r) => setTimeout(r, 5))
        yield { type: 'text-delta', text: 'world' }
      })(),
    }
  },
}))
vi.mock('../../api/_lib/sentry.js', () => ({ withSentry: (h) => h }))
vi.mock('../../api/_lib/workspaceContext.js', () => ({ workspaceContext: async () => ({ id: 'ws', clerk_org_id: 'org' }) }))
vi.mock('../../api/_lib/auth.js', () => ({ requireRole: async () => ({ ok: true }) }))
vi.mock('../../api/_lib/ratelimit.js', () => ({ enforceLimit: async () => true }))

process.env.AI_GATEWAY_API_KEY = 'test'
const { default: handler } = await import('../../api/stream.js')

function fakeRes() {
  const r = new EventEmitter()
  r.writes = []
  r.writableEnded = false
  r.status = () => r
  r.json = () => r
  r.setHeader = () => {}
  r.flushHeaders = () => {}
  r.write = (chunk) => { r.writes.push(chunk); if (r.writes.length === 1) r.emit('close') }
  r.end = () => { r.writableEnded = true }
  return r
}

describe('/api/stream client disconnect', () => {
  it('aborts the model call and stops writing when the client goes away', async () => {
    const res = fakeRes()
    await handler({ method: 'POST', headers: {}, body: { messages: [{ role: 'user', content: 'hi' }], systemPrompt: 's' } }, res)
    expect(captured.abortSignal?.aborted).toBe(true)
    expect(res.writes).toHaveLength(1)
  })
})
