// POST /api/webhooks/openai-realtime
//
// F1 — outbound call. OpenAI fires `realtime.call.incoming` when Twilio bridges
// our outbound call to the OpenAI SIP connector. We correlate the SIP call to
// the interview (via the X-Bernard-Interview SIP header we set when dialing),
// then accept the call with the interview instructions we stashed at trigger
// time. OpenAI then drives the conversation autonomously (create_response:true).
//
// Auth: OpenAI signs webhooks (Standard Webhooks scheme). We verify the HMAC
// over the raw body with OPENAI_WEBHOOK_SECRET and timingSafeEqual — fail-closed
// if the secret is unset or the signature is missing/bad.
//
// ⚠️ SMOKE-PENDING: the exact sip_headers shape + signature header names are
// confirmed on the first provisioned call (see the runbook). Node runtime; the
// raw body is exposed on req.rawBody by the express.json middleware (same
// pattern as webhooks/mux.js + webhooks/bundle.js).
export const config = { runtime: 'nodejs' }

import { timingSafeEqual, createHmac } from 'node:crypto'
import { acceptOpenAiCall } from '../../_lib/twilioSip.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// eslint-disable-next-line bernard/require-workspace-scope -- webhook: no Clerk session; workspace is resolved from the interview row looked up by the signature-verified correlation id, and the callState PATCH is filtered by that workspace_id.
function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    signal: AbortSignal.timeout(10_000),
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

// Standard Webhooks signature: HMAC-SHA256 over `${id}.${timestamp}.${body}`,
// key = base64-decoded secret (whsec_ prefix stripped). The signature header is
// a space-separated list of `v1,<base64>` — any one matching passes.
function verifyOpenAiSignature(rawBody, headers, secret) {
  if (!secret || !rawBody) return false
  const id = headers['webhook-id']
  const ts = headers['webhook-timestamp']
  const sigHeader = headers['webhook-signature']
  if (!id || !ts || !sigHeader) return false

  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const signed = `${id}.${ts}.${rawBody.toString('utf8')}`
  const expected = createHmac('sha256', key).update(signed).digest('base64')
  const expectedBuf = Buffer.from(expected)

  return String(sigHeader).split(' ').some((part) => {
    const b64 = part.includes(',') ? part.split(',')[1] : part
    const candidate = Buffer.from(b64 || '', 'utf8')
    return candidate.length === expectedBuf.length && timingSafeEqual(candidate, expectedBuf)
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const secret = process.env.OPENAI_WEBHOOK_SECRET
  if (!secret) {
    console.error('[webhooks/openai-realtime] OPENAI_WEBHOOK_SECRET not set; rejecting')
    return res.status(500).json({ error: 'not_configured' })
  }
  const rawBody = req.rawBody
  if (!rawBody || !rawBody.length) return res.status(400).json({ error: 'no_raw_body' })
  if (!verifyOpenAiSignature(rawBody, req.headers, secret)) {
    return res.status(401).json({ error: 'invalid_signature' })
  }

  let event
  try {
    event = JSON.parse(rawBody.toString('utf8'))
  } catch {
    return res.status(400).json({ error: 'bad_json' })
  }

  // We only act on the incoming-call event; ack everything else.
  if (event?.type !== 'realtime.call.incoming') {
    return res.status(200).json({ ok: true, ignored: event?.type || 'unknown' })
  }

  const callId = event?.data?.call_id
  const sipHeaders = Array.isArray(event?.data?.sip_headers) ? event.data.sip_headers : []
  const interviewId = sipHeaders.find((h) => (h?.name || '').toLowerCase() === 'x-bernard-interview')?.value

  if (!callId || !interviewId) {
    console.error(`[webhooks/openai-realtime] missing callId or interviewId (callId=${!!callId})`)
    return res.status(400).json({ error: 'missing_correlation' })
  }

  // Fetch the stashed instructions for this interview.
  const ivRes = await sb(`interviews?id=eq.${encodeURIComponent(interviewId)}&select=id,workspace_id,session_state&limit=1`)
  if (!ivRes.ok) {
    console.error(`[webhooks/openai-realtime] interview lookup failed ${ivRes.status} iv=${interviewId}`)
    return res.status(500).json({ error: 'lookup_failed' })
  }
  const interview = (await ivRes.json().catch(() => []))[0]
  const instructions = interview?.session_state?.outbound?.instructions
  if (!interview || !instructions) {
    console.error(`[webhooks/openai-realtime] no stashed instructions for iv=${interviewId}`)
    return res.status(404).json({ error: 'interview_not_found' })
  }

  try {
    await acceptOpenAiCall({ callId, instructions })
  } catch (e) {
    console.error(`[webhooks/openai-realtime] accept failed iv=${interviewId}: ${e?.message}`)
    return res.status(502).json({ error: 'accept_failed' })
  }

  await sb(`interviews?id=eq.${encodeURIComponent(interviewId)}&workspace_id=eq.${interview.workspace_id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      session_state: { outbound: { ...interview.session_state.outbound, callState: 'connected', callId } },
    }),
  }).catch((e) => console.error(`[webhooks/openai-realtime] callState patch failed: ${e?.message}`))

  return res.status(200).json({ ok: true })
}
