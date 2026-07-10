// F1 — "Bernard picks up the phone" (outbound call). Telephony leg.
//
// Bernard OWNS the realtime loop (OpenAI Realtime, same engine as the in-app
// voice interview) — the phone company is a swappable SIP pipe. For the
// outbound call:
//   1. Twilio originates the PSTN leg to the clinician's number and, on answer,
//      bridges it to OpenAI's SIP connector (sip:PROJECT@sip.api.openai.com).
//   2. OpenAI fires `realtime.call.incoming` to our webhook; we accept it with
//      the assembled interview instructions (see webhooks/openai-realtime.js).
//   3. Twilio records the call dual-channel; on hangup its recording webhook
//      turns the audio into a transcript → the interview completion cascade.
//
// This module is a thin fetch wrapper over the Twilio + OpenAI REST APIs — no
// SDK dependency (keeps the worktree node_modules symlink clean). Env is read
// lazily inside functions so a deployment without Twilio keys still loads the
// module cleanly (bundle-smoke safe) and the feature simply stays off.
//
// ⚠️ SMOKE-PENDING: the exact SIP-header surfacing, dual-channel ordering, and
// accept-payload shape are validated against live Twilio+OpenAI during the
// first provisioned call (see .claude/f1-outbound-call-runbook.md). Nothing
// here dials until OUTBOUND_CALL is provisioned + enabled.

const OPENAI_KEY = () => process.env.OPENAI_API_KEY

// Bernard's realtime voice — matches api/realtime-session.js so the phone call
// sounds like the in-app interview. `ballad`: British male, softer-spoken.
const REALTIME_VOICE = 'ballad'
const REALTIME_MODEL = 'gpt-realtime'

/**
 * All env the outbound-call feature needs, read lazily. Returns { ok, missing }.
 * A route can call this to 503 cleanly instead of half-dialing.
 */
export function telephonyConfig() {
  const cfg = {
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
    twilioAuthToken:  process.env.TWILIO_AUTH_TOKEN,
    twilioFrom:       process.env.TWILIO_FROM_NUMBER,       // Bernard's caller-ID number, E.164
    openaiProjectId:  process.env.OPENAI_REALTIME_PROJECT_ID, // proj_… for the SIP URI
    openaiKey:        process.env.OPENAI_API_KEY,
    publicBaseUrl:    process.env.OUTBOUND_CALL_PUBLIC_URL,  // https host Twilio/OpenAI call back to
  }
  const missing = Object.entries(cfg)
    .filter(([, v]) => !v)
    .map(([k]) => k)
  return { ok: missing.length === 0, missing, ...cfg }
}

/** True when every telephony env var is present. Cheap gate for a route. */
export function telephonyConfigured() {
  return telephonyConfig().ok
}

/**
 * Originate the outbound call. Twilio dials `toNumber`; on answer it bridges to
 * OpenAI's SIP connector and records both legs on separate channels. The
 * interviewId is passed BOTH as a SIP header (so the OpenAI accept-webhook can
 * correlate the realtime session to the interview) AND as a query param on the
 * recording/status callbacks (so those webhooks can find the interview too).
 *
 * We build TwiML inline (no external URL) so there's nothing extra to host.
 *
 * @param {object} p
 * @param {string} p.toNumber       - clinician's number, E.164 (never from user input)
 * @param {string} p.interviewId    - the correlation id (= the interviews row id)
 * @returns {Promise<{ callSid: string }>}
 */
export async function originateOutboundCall({ toNumber, interviewId }) {
  const cfg = telephonyConfig()
  if (!cfg.ok) throw new Error(`telephony_not_configured:${cfg.missing.join(',')}`)

  const base = cfg.publicBaseUrl.replace(/\/$/, '')
  const recCb = `${base}/api/webhooks/twilio-recording?iv=${encodeURIComponent(interviewId)}`
  const statusCb = `${base}/api/webhooks/twilio-status?iv=${encodeURIComponent(interviewId)}`

  // SIP URI to OpenAI's connector, carrying the correlation id as a custom
  // header (surfaced in the realtime.call.incoming webhook's sip_headers).
  const sipUri =
    `sip:${cfg.openaiProjectId}@sip.api.openai.com;transport=tls` +
    `?X-Bernard-Interview=${encodeURIComponent(interviewId)}`

  // record-from-answer-dual → stereo recording, one leg per channel, so the
  // transcript step can attribute turns by channel (see callTranscript.js).
  const twiml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response><Dial record="record-from-answer-dual" recordingStatusCallback="${xmlEscape(recCb)}" recordingStatusCallbackEvent="completed">` +
    `<Sip>${xmlEscape(sipUri)}</Sip></Dial></Response>`

  const body = new URLSearchParams({
    To: toNumber,
    From: cfg.twilioFrom,
    Twiml: twiml,
    StatusCallback: statusCb,
    StatusCallbackEvent: 'completed',
  })

  const auth = Buffer.from(`${cfg.twilioAccountSid}:${cfg.twilioAuthToken}`).toString('base64')
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${cfg.twilioAccountSid}/Calls.json`,
    {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(15_000),
    },
  )
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    console.error(`[twilioSip] originate failed ${res.status}: ${t.slice(0, 300)}`)
    throw new Error('originate_failed')
  }
  const data = await res.json().catch(() => ({}))
  return { callSid: data.sid }
}

/**
 * Accept an incoming OpenAI Realtime SIP call with the assembled interview
 * instructions. Configures the session for AUTONOMOUS operation (create_response
 * true) — unlike the in-browser path (api/realtime-session.js) there is no
 * client to trigger responses, so the model must drive. VAD is tuned less
 * sensitive to blunt the silence-hallucination risk that create_response:true
 * reintroduces (see the realtime-session.js note). ⚠️ SMOKE-PENDING tuning.
 *
 * @param {object} p
 * @param {string} p.callId        - OpenAI call id from realtime.call.incoming
 * @param {string} p.instructions  - assembled system prompt (assembleCallSystemPrompt)
 * @returns {Promise<void>}
 */
export async function acceptOpenAiCall({ callId, instructions }) {
  const key = OPENAI_KEY()
  if (!key) throw new Error('openai_not_configured')

  const sessionConfig = {
    type: 'realtime',
    model: REALTIME_MODEL,
    instructions,
    audio: {
      output: { voice: REALTIME_VOICE },
      input: {
        transcription: { model: 'gpt-4o-mini-transcribe' },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.7,            // less sensitive than the in-app 0.65 — autonomous mode
          prefix_padding_ms: 300,
          silence_duration_ms: 2500, // longer than in-app 2000 — ride out phone-line pauses
          create_response: true,     // AUTONOMOUS: no client to fire response.create
          interrupt_response: true,
        },
      },
    },
  }

  const res = await fetch(`https://api.openai.com/v1/realtime/calls/${encodeURIComponent(callId)}/accept`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(sessionConfig),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    console.error(`[twilioSip] accept failed ${res.status}: ${t.slice(0, 300)}`)
    throw new Error('accept_failed')
  }
}

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
