// /api/voice-memo (audit 2026-11-18, P2):
//  - the memo title used the server's UTC date, so an evening recording in
//    California was titled the next day;
//  - every failure after the blob upload left the audio in the store with no
//    row pointing at it.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'

const blobDel = vi.fn(async () => {})
vi.mock('@vercel/blob', () => ({ put: async (p) => ({ url: `https://blob.test/${p}` }), del: (...a) => blobDel(...a) }))
vi.mock('../../api/_lib/workspaceContext.js', () => ({
  workspaceContext: async () => ({ id: 'ws', slug: 'ws', clerk_org_id: 'org', cadence_policy: { timezone: 'America/Los_Angeles' } }),
}))
vi.mock('../../api/_lib/auth.js', () => ({ requireRole: async () => ({ ok: true, userId: 'user_1' }) }))
vi.mock('../../api/_lib/ratelimit.js', () => ({ enforceLimit: async () => true }))
let transcribeImpl
vi.mock('../../api/_lib/transcribe.js', () => ({ transcribeBufferToText: (...a) => transcribeImpl(...a) }))

process.env.ELEVENLABS_API_KEY = 'test'
process.env.SUPABASE_URL = 'http://supabase.test'
process.env.SUPABASE_SERVICE_KEY = 'k'
const { default: handler } = await import('../../api/voice-memo.js')

let posted
function call() {
  const req = new EventEmitter()
  req.method = 'POST'
  req.url = '/api/voice-memo?filename=m.webm'
  req.headers = { 'content-type': 'audio/webm' }
  req.destroy = () => {}
  const res = { statusCode: 0, status(c) { this.statusCode = c; return this }, json(b) { this.body = b; return this } }
  const p = handler(req, res)
  setImmediate(() => { req.emit('data', Buffer.from('audio')); req.emit('end') })
  return p.then(() => res)
}

beforeEach(() => {
  blobDel.mockClear()
  posted = []
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    const table = new URL(String(url)).pathname.split('/').pop()
    if (init.method === 'POST') { posted.push({ table, body: JSON.parse(init.body) }); return new Response(JSON.stringify([{ id: `${table}-1` }])) }
    return new Response(JSON.stringify(table === 'staff' ? [{ id: 'staff-1' }] : []))
  }))
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('voice memo', () => {
  it('titles the memo with the clinic\'s local date, not UTC', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-19T05:00:00Z')) // 21:00 on the 18th in California
    transcribeImpl = async () => 'what I said'
    const res = await call()
    expect(res.statusCode).toBe(200)
    expect(posted.find((p) => p.table === 'interviews').body.topic).toBe('Voice memo — 2026-11-18')
  })

  it('deletes the uploaded audio when transcription fails', async () => {
    transcribeImpl = async () => { throw new Error('vendor down') }
    const res = await call()
    expect(res.statusCode).toBe(502)
    expect(blobDel).toHaveBeenCalledTimes(1)
  })

  it('keeps the audio when the memo is saved', async () => {
    transcribeImpl = async () => 'what I said'
    await call()
    expect(blobDel).not.toHaveBeenCalled()
  })
})
