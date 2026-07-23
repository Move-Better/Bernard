// POST /api/webhooks/twilio-status?iv=<interviewId>
//
// F1 — outbound call status. Twilio posts the final call status here. Per the
// v1 no-answer policy (Q, 2026-07-10: "silent → in-app nudge only"), a call the
// clinician didn't take is simply marked abandoned — no voicemail, no retry, no
// SMS. The existing Home "your weekly call" nudge (WeeklyCallHero) keeps showing
// because an abandoned call never counts as a completed one, so the clinician is
// nudged to call in-app on their own terms. A 'completed' status is left alone —
// the recording webhook owns the success path.
//
// Auth: Twilio-signed (same scheme as twilio-recording.js). Fail-closed. Node.
export const config = { runtime: 'nodejs' }

import { timingSafeEqual, createHmac } from 'node:crypto'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// Terminal Twilio statuses that mean the clinician did not take the call.
const UNANSWERED = new Set(['no-answer', 'busy', 'failed', 'canceled'])

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// eslint-disable-next-line bernard/require-workspace-scope -- webhook: no Clerk session; only PATCHes a single interview by its own primary-key id (the signature-verified `iv`), which cannot cross tenants.
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

function verifyTwilioSignature(url, params, header, authToken) {
  if (!authToken || !header) return false
  let data = url
  for (const key of Object.keys(params).sort()) data += key + params[key]
  const expected = createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64')
  const a = Buffer.from(expected)
  const b = Buffer.from(String(header))
  return a.length === b.length && timingSafeEqual(a, b)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (!authToken) return res.status(500).json({ error: 'not_configured' })

  const iv = new URL(req.url, 'http://localhost').searchParams.get('iv')
  const params = req.body && typeof req.body === 'object' ? req.body : {}
  const base = (process.env.OUTBOUND_CALL_PUBLIC_URL || '').replace(/\/$/, '')
  const callbackUrl = `${base}/api/webhooks/twilio-status?iv=${encodeURIComponent(iv || '')}`
  if (!verifyTwilioSignature(callbackUrl, params, req.headers['x-twilio-signature'], authToken)) {
    return res.status(401).json({ error: 'invalid_signature' })
  }

  // Same guard as twilio-recording.js: never let a non-UUID land in the
  // PostgREST filter below. Defense-in-depth — the signature already binds iv.
  if (iv && !UUID_RE.test(iv)) return res.status(400).json({ error: 'invalid_id' })

  const status = params.CallStatus
  if (iv && UNANSWERED.has(status)) {
    // Only abandon a still-open call — never clobber one the recording webhook
    // already completed (a race between status + recording callbacks).
    await sb(`interviews?id=eq.${encodeURIComponent(iv)}&status=eq.in_progress`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'abandoned', updated_at: new Date().toISOString() }),
    }).catch((e) => console.error(`[webhooks/twilio-status] abandon patch failed iv=${iv}: ${e?.message}`))
    console.info(`[webhooks/twilio-status] call unanswered (${status}) iv=${iv} — marked abandoned, in-app nudge stands`)
  }

  return res.status(200).json({ ok: true })
}
