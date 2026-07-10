// POST /api/webhooks/twilio-recording?iv=<interviewId>
//
// F1 — outbound call completion. Twilio posts here when the call recording is
// ready. We transcribe it, generate the blog + outputs server-side (browserless),
// write them to the interview, and run the SAME enrichment the in-app interview
// runs on completion.
//
// NOTE: the enrichment sequence below MIRRORS the completion cascade in
// api/_routes/db/interviews.js (PATCH branch). That cascade lives inside the
// Clerk-authenticated route handler, so a server-to-server completion can't hit
// it via HTTP; we call the same exported libs directly here instead. A future
// refactor should extract the cascade into a shared helper both callers use.
//
// Auth: Twilio signs each request (X-Twilio-Signature = base64 HMAC-SHA1 of the
// callback URL + sorted POST params, keyed by the auth token). Fail-closed.
//
// ⚠️ SMOKE-PENDING: exact recording download auth + dual-channel handling are
// confirmed on the first provisioned call (see the runbook). Node runtime.
export const config = { runtime: 'nodejs', maxDuration: 300 }

import { timingSafeEqual, createHmac } from 'node:crypto'
import { waitUntil } from '@vercel/functions'
import { transcribeCallRecording } from '../../_lib/callTranscript.js'
import { generateOutputsFromTranscript } from '../../_lib/outboundCall.js'
import { extractConcepts, buildInterviewText } from '../../_lib/conceptExtractor.js'
import { summarizeInterview } from '../../_lib/interviewSummarizer.js'
import { classifyAndStoreInterviewStyle } from '../../_lib/interviewStyleClassifier.js'
import { classifyAndStoreInterviewRegion } from '../../_lib/topicRegion.js'
import { extractVoicePhrases } from '../../_lib/voicePhraseExtractor.js'
import { markBookStale } from '../../_lib/bookStale.js'
import { indexInterviewTranscriptFull } from '../../_lib/practiceMemoryRag.js'
import { replanWorkspaceWeek } from '../../_lib/strategistPlan.js'
import { mondayOf } from '../../_lib/strategist.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// eslint-disable-next-line bernard/require-workspace-scope -- webhook: no Clerk session; workspace is resolved from the interview row looked up by the signature-verified `iv` correlation id, and every subsequent query is filtered by that workspace_id (wsFilter).
function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    signal: AbortSignal.timeout(15_000),
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

// Twilio request validation: signature = base64(HMAC-SHA1(authToken,
// url + concat(sorted(key+value)))). See twilio.com/docs/usage/security.
function verifyTwilioSignature(url, params, header, authToken) {
  if (!authToken || !header) return false
  let data = url
  for (const key of Object.keys(params).sort()) {
    data += key + params[key]
  }
  const expected = createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64')
  const a = Buffer.from(expected)
  const b = Buffer.from(String(header))
  return a.length === b.length && timingSafeEqual(a, b)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (!authToken) {
    console.error('[webhooks/twilio-recording] TWILIO_AUTH_TOKEN not set; rejecting')
    return res.status(500).json({ error: 'not_configured' })
  }

  const q = new URL(req.url, 'http://localhost').searchParams
  const iv = q.get('iv')
  const params = req.body && typeof req.body === 'object' ? req.body : {}

  const base = (process.env.OUTBOUND_CALL_PUBLIC_URL || '').replace(/\/$/, '')
  const callbackUrl = `${base}/api/webhooks/twilio-recording?iv=${encodeURIComponent(iv || '')}`
  if (!verifyTwilioSignature(callbackUrl, params, req.headers['x-twilio-signature'], authToken)) {
    return res.status(401).json({ error: 'invalid_signature' })
  }

  const recordingUrl = params.RecordingUrl
  if (!iv || !recordingUrl) return res.status(400).json({ error: 'missing_recording' })

  // Ack Twilio immediately; do the heavy lifting in the background. All work is
  // inside this single waitUntil promise, so nested awaits are covered (see the
  // CLAUDE.md waitUntil note).
  res.status(200).json({ ok: true })
  waitUntil(processRecording({ iv, recordingUrl, authToken }).catch((e) =>
    console.error(`[webhooks/twilio-recording] processing failed iv=${iv}: ${e?.message} ${e?.stack || ''}`),
  ))
}

async function processRecording({ iv, recordingUrl, authToken }) {
  // 1. Load the interview + its workspace + staff.
  const ivRes = await sb(`interviews?id=eq.${encodeURIComponent(iv)}&select=id,workspace_id,staff_id,topic,created_at&limit=1`)
  const interview = ivRes.ok ? (await ivRes.json())[0] : null
  if (!interview) throw new Error('interview_not_found')
  const wsId = interview.workspace_id

  const [wsRes, staffRes] = await Promise.all([
    sb(`workspaces?id=eq.${wsId}&select=*&limit=1`),
    sb(`staff?id=eq.${interview.staff_id}&workspace_id=eq.${wsId}&select=id,name,staff_type,default_tone,default_voice_mode,voice_notes,blog_review_enabled&limit=1`),
  ])
  const workspace = wsRes.ok ? (await wsRes.json())[0] : null
  const staff = staffRes.ok ? (await staffRes.json())[0] : null
  if (!workspace || !staff) throw new Error('workspace_or_staff_missing')

  // 2. Transcribe the recording (authed download).
  const basicAuth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${authToken}`).toString('base64')
  const { messages } = await transcribeCallRecording({ recordingUrl, basicAuth })

  // 3. Generate outputs (browserless), same builders as the in-app interview.
  const outputs = await generateOutputsFromTranscript({ workspace, staff, topic: interview.topic, messages })

  // 4. Write transcript + outputs to the interview row.
  await sb(`interviews?id=eq.${iv}&workspace_id=eq.${wsId}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ messages, outputs, status: 'completed', session_state: null, updated_at: new Date().toISOString() }),
  })

  // 5. Enrichment — mirrors api/_routes/db/interviews.js completion cascade.
  const wsFilter = `workspace_id=eq.${wsId}`

  // 5a. content_items (blog).
  try {
    const exists = await sb(`content_items?interview_id=eq.${iv}&${wsFilter}&select=id&limit=1`)
    const existsRows = exists.ok ? await exists.json() : []
    if (existsRows.length === 0 && outputs.blogPost?.trim()) {
      const status = staff.blog_review_enabled ? 'in_review' : 'draft'
      const ins = await sb('content_items', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify([{
          workspace_id: wsId,
          interview_id: iv,
          staff_id: staff.id,
          staff_name: staff.name,
          topic: interview.topic ?? '',
          platform: 'blog',
          content: outputs.blogPost,
          ai_original_content: outputs.blogPost,
          status,
          published_at: null,
          resolved_url: null,
          media_urls: [],
          location_id: null,
        }]),
      })
      if (!ins.ok) console.error(`[webhooks/twilio-recording] content_items insert ${ins.status} iv=${iv}`)
    }
  } catch (e) {
    console.error(`[webhooks/twilio-recording] content_items block threw iv=${iv}: ${e?.message}`)
  }

  const turns = messages
  const interviewText = buildInterviewText(turns)
  const clinicianTurns = turns
    .filter((m) => m?.role === 'user' && typeof m.content === 'string' && m.content.trim())
    .map((m) => m.content.trim())
    .join('\n\n')

  // 5b. Enrichment steps — each independently guarded; awaited (we're already
  // inside the webhook's waitUntil, so nested waitUntil would not be honored).
  const steps = [
    ['concepts', () => extractConcepts({ workspaceId: wsId, sourceKind: 'interview_turn', sourceId: iv, text: interviewText, staffId: staff.id, weightDelta: 1.0 })],
    ['summary', () => summarizeInterview({ interviewId: iv, workspaceId: wsId, staffId: staff.id, staffName: staff.name, topic: interview.topic, messages: turns })],
    ['style', () => classifyAndStoreInterviewStyle({ workspaceId: wsId, staffId: staff.id, interviewId: iv, messages: turns })],
    ['rag', () => indexInterviewTranscriptFull({ workspaceId: wsId, staffId: staff.id, interviewId: iv, messages: turns, cleanedMessages: null, topic: interview.topic, createdAt: interview.created_at })],
    ['region', () => classifyAndStoreInterviewRegion({ interviewId: iv, workspaceId: wsId, topic: interview.topic })],
    ['book', () => markBookStale({ workspaceId: wsId })],
    ['strategist', () => replanWorkspaceWeek({ workspace: { id: wsId, cadence_policy: workspace.cadence_policy ?? null, enabled_outputs: workspace.enabled_outputs ?? null }, weekMonday: mondayOf(new Date().toISOString()) })],
  ]
  if (clinicianTurns) {
    steps.push(['voice', () => extractVoicePhrases({ workspaceId: wsId, staffId: staff.id, content: clinicianTurns, initialWeight: 0.5 })])
  }
  for (const [name, fn] of steps) {
    try { await fn() } catch (e) { console.error(`[webhooks/twilio-recording] enrichment '${name}' failed iv=${iv}: ${e?.message}`) }
  }
}
