// The Twilio recording webhook claims an interview ('in_progress' → 'processing'),
// runs the transcribe + generate cascade, then PATCHes it to 'completed'. If that
// completion PATCH fails, the claim must be released back to 'in_progress' so the
// row is not stranded at 'processing' (2026-11-18 full audit, item 8).
//
// Harness: a fake fetch that plays the interviews row as a tiny state machine
// (applying PostgREST's `status=eq.X` filter on PATCH), with every paid or
// enriching lib mocked out. The handler's waitUntil promise is captured so the
// test awaits the background work.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHmac } from 'node:crypto'

const IV = '11111111-2222-4333-8444-555555555555'
const AUTH = 'test-only-twilio-token'
const BASE = 'https://withbernard.test'

process.env.SUPABASE_URL = 'https://sb.test'
process.env.SUPABASE_SERVICE_KEY = 'test-only-service-key'
process.env.TWILIO_AUTH_TOKEN = AUTH
process.env.TWILIO_ACCOUNT_SID = 'ACtest'
process.env.OUTBOUND_CALL_PUBLIC_URL = BASE

const pending = []
vi.mock('@vercel/functions', () => ({ waitUntil: (p) => { pending.push(p) } }))
vi.mock('../api/_lib/callTranscript.js', () => ({
  transcribeCallRecording: async () => ({ messages: [{ role: 'user', content: 'hi' }], dualChannel: false }),
}))
vi.mock('../api/_lib/outboundCall.js', () => ({
  generateOutputsFromTranscript: async () => ({}),
  generateCallStoryTitle: async () => 'Nov 19, 2026 — Test',
}))
vi.mock('../api/_lib/conceptExtractor.js', () => ({ extractConcepts: async () => {}, buildInterviewText: () => '' }))
vi.mock('../api/_lib/interviewSummarizer.js', () => ({ summarizeInterview: async () => {} }))
vi.mock('../api/_lib/interviewStyleClassifier.js', () => ({ classifyAndStoreInterviewStyle: async () => {} }))
vi.mock('../api/_lib/topicRegion.js', () => ({ classifyAndStoreInterviewRegion: async () => {} }))
vi.mock('../api/_lib/voicePhraseExtractor.js', () => ({ extractVoicePhrases: async () => {} }))
vi.mock('../api/_lib/bookStale.js', () => ({ markBookStale: async () => {} }))
vi.mock('../api/_lib/practiceMemoryRag.js', () => ({ indexInterviewTranscriptFull: async () => {} }))
vi.mock('../api/_lib/strategistPlan.js', () => ({ replanWorkspaceWeek: async () => {} }))
vi.mock('../api/_lib/strategist.js', () => ({ mondayOf: () => '2026-11-16' }))
vi.mock('../api/_lib/momentExtract.js', () => ({ extractAndBankMoments: async () => {} }))
vi.mock('../api/_lib/citations/runForContentItem.js', () => ({ runCitationEnrichmentForContentItem: async () => {} }))

const { default: handler } = await import('../api/_routes/webhooks/twilio-recording.js')

let row
let completionStatus
let patches

function json(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

// Fake PostgREST: only the interviews row is stateful; everything else is a canned read.
async function fakeFetch(url, init = {}) {
  const u = new URL(url)
  const path = u.pathname.replace('/rest/v1/', '')
  const method = init.method || 'GET'
  if (path === 'interviews' && method === 'GET') return json(200, [{ ...row }])
  if (path === 'interviews' && method === 'PATCH') {
    const body = JSON.parse(init.body)
    const statusFilter = u.searchParams.get('status')
    patches.push({ statusFilter, to: body.status })
    // The completion write (no status filter) is the one this test makes fail.
    if (!statusFilter && body.status === 'completed' && completionStatus !== 204) return json(completionStatus, {})
    if (statusFilter && statusFilter !== `eq.${row.status}`) return json(200, [])
    row = { ...row, ...body }
    return json(200, [{ ...row }])
  }
  if (path === 'workspaces') return json(200, [{ id: 'w1' }])
  if (path === 'staff') return json(200, [{ id: 's1', name: 'Test Clinician' }])
  if (path === 'content_items') return json(200, [])
  return json(404, [])
}

function signedRequest() {
  const params = { RecordingUrl: 'https://api.twilio.test/rec/RE1' }
  const callbackUrl = `${BASE}/api/webhooks/twilio-recording?iv=${IV}`
  let data = callbackUrl
  for (const k of Object.keys(params).sort()) data += k + params[k]
  const sig = createHmac('sha1', AUTH).update(Buffer.from(data, 'utf8')).digest('base64')
  return {
    method: 'POST',
    url: `/api/webhooks/twilio-recording?iv=${IV}`,
    headers: { 'x-twilio-signature': sig },
    body: params,
  }
}

function fakeRes() {
  const res = { statusCode: 0 }
  res.status = (c) => { res.statusCode = c; return res }
  res.json = () => res
  return res
}

async function deliver() {
  const res = fakeRes()
  await handler(signedRequest(), res)
  expect(res.statusCode).toBe(200)
  expect(pending).toHaveLength(1)
  await pending.pop()
}

describe('twilio-recording completion write', () => {
  beforeEach(() => {
    row = { id: IV, workspace_id: 'w1', staff_id: 's1', topic: 'Your weekly call', kind: 'topic', created_at: '2026-11-19T10:00:00Z', status: 'in_progress' }
    patches = []
    pending.length = 0
    vi.stubGlobal('fetch', vi.fn(fakeFetch))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('releases the claim back to in_progress when the completion PATCH returns 500', async () => {
    completionStatus = 500
    await deliver()
    expect(patches.map((p) => p.to)).toEqual(['processing', 'completed', 'in_progress'])
    expect(row.status).toBe('in_progress')
  })

  it('leaves the row completed when the completion PATCH succeeds', async () => {
    completionStatus = 204
    await deliver()
    expect(row.status).toBe('completed')
    expect(patches.map((p) => p.to)).toEqual(['processing', 'completed'])
  })
})
