// POST /api/seminar/create
//
// Seminar / Talk capture lane (Slice ①). The browser has already uploaded the
// talk audio direct-to-Blob (a 50–85 MB file can't ride a request body past
// Vercel's ~4.5 MB limit) and hands us the resulting blob URL here. This handler
// creates a capture_mode='seminar' interview row with transcribe_status=
// 'processing', then kicks the background transcription worker on a fresh
// function instance (chunked Whisper would blow the 300s budget inline).
//
// The UI polls the interview's transcribe_status (hard-capped) until 'ready',
// then drives the same blog→atoms generation pipeline as voice-memo.
//
// Body: { blobUrl: string, filename?: string, durationSec?: number }
// Response: { staffId, interviewId }
//
// Node runtime — @clerk/backend + the blob/worker fetch need Node, and the
// body is JSON (do NOT disable bodyParser here, unlike voice-memo).

export const config = { runtime: 'nodejs', maxDuration: 60 }

import { createClerkClient } from '@clerk/backend'
import { requireRole } from '../_lib/auth.js'
import { workspaceContext } from '../_lib/workspaceContext.js'
import { enforceLimit } from '../_lib/ratelimit.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

let _clerk = null
function clerkClient() {
  if (!_clerk) _clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })
  return _clerk
}

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...init.headers,
    },
  })
}

// Fire the background transcription worker on a fresh instance. We don't await
// the actual transcription — the worker schedules it via waitUntil and returns
// 202 fast, so this resolves quickly and the create request returns to the user.
async function kickWorker(baseUrl, interviewId) {
  if (!baseUrl || !process.env.CRON_SECRET) {
    console.error('[seminar/create] cannot kick worker — baseUrl or CRON_SECRET missing')
    return false
  }
  try {
    const r = await fetch(`${baseUrl}/api/seminar/transcribe-worker`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.CRON_SECRET}`,
      },
      body: JSON.stringify({ interviewId }),
    })
    return r.ok
  } catch (e) {
    console.error(`[seminar/create] worker kick failed: ${e?.message}`)
    return false
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  if (!(await enforceLimit(req, res, 'media'))) return

  // ── Validate body ─────────────────────────────────────────────────────────
  const body = req.body || {}
  const blobUrl = typeof body.blobUrl === 'string' ? body.blobUrl.trim() : ''
  const filename = typeof body.filename === 'string' ? body.filename.slice(0, 200) : ''
  const durationSec = Number.isFinite(body.durationSec) ? Math.round(body.durationSec) : null

  if (!blobUrl) return res.status(400).json({ error: 'blobUrl is required' })
  // Defense-in-depth: the URL must point at OUR blob store, not an arbitrary
  // attacker-supplied host the worker would then fetch. Vercel Blob public URLs
  // live on *.public.blob.vercel-storage.com.
  let parsed
  try { parsed = new URL(blobUrl) } catch { return res.status(400).json({ error: 'blobUrl is not a valid URL' }) }
  if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.public.blob.vercel-storage.com')) {
    return res.status(400).json({ error: 'blobUrl must be a Vercel Blob URL' })
  }

  // ── Find or create the caller's Self staff row ────────────────────────────
  const wsFilter = `workspace_id=eq.${ws.id}`
  let staffId
  let defaultTone = 'smart'

  const staffRes = await sb(
    `staff?${wsFilter}&user_id=eq.${encodeURIComponent(auth.userId)}&select=id,default_tone&limit=1`
  )
  if (staffRes.ok) {
    const rows = await staffRes.json()
    if (rows.length) {
      staffId = rows[0].id
      defaultTone = rows[0].default_tone || 'smart'
    }
  }

  if (!staffId) {
    let name = 'Me'
    try {
      const user = await clerkClient().users.getUser(auth.userId)
      const full = [user.firstName, user.lastName].filter(Boolean).join(' ')
      name = full || user.username || user.primaryEmailAddress?.emailAddress?.split('@')[0] || 'Me'
    } catch (e) {
      console.warn(`[seminar/create] could not fetch Clerk user ${auth.userId}: ${e?.message}`)
    }
    const cRes = await sb('staff', {
      method: 'POST',
      body: JSON.stringify({
        workspace_id: ws.id,
        name,
        user_id: auth.userId,
        created_by_id: auth.userId,
      }),
    })
    if (!cRes.ok) {
      const b = await cRes.text().catch(() => '')
      console.error(`[seminar/create] staff create failed ${cRes.status}: ${b.slice(0, 300)}`)
      return res.status(500).json({ error: 'Could not create staff member record' })
    }
    staffId = (await cRes.json())[0]?.id
  }
  if (!staffId) return res.status(500).json({ error: 'Staff ID could not be determined' })

  // ── Create the seminar interview row (transcript fills in via the worker) ──
  const date = new Date().toLocaleDateString('en-CA') // YYYY-MM-DD
  const baseLabel = filename ? filename.replace(/\.[a-z0-9]+$/i, '') : `Seminar — ${date}`
  const topic = `Seminar — ${baseLabel}`.slice(0, 200)

  const ivRes = await sb('interviews', {
    method: 'POST',
    body: JSON.stringify({
      workspace_id: ws.id,
      staff_id: staffId,
      owner_id: auth.userId,
      topic,
      status: 'in_progress',
      capture_mode: 'seminar',
      transcribe_status: 'processing',
      source_audio_url: blobUrl,
      source_audio_duration_sec: durationSec,
      messages: [],
      tone: defaultTone,
      voice_mode: 'personal',
      generation_style: 'blog_post',
    }),
  })
  if (!ivRes.ok) {
    const b = await ivRes.text().catch(() => '')
    console.error(`[seminar/create] interview create failed ${ivRes.status}: ${b.slice(0, 300)}`)
    return res.status(500).json({ error: 'Could not save seminar record' })
  }
  const interview = (await ivRes.json())[0]
  if (!interview?.id) return res.status(500).json({ error: 'Interview created but no ID returned' })

  // ── Kick the background transcription worker ──────────────────────────────
  // Derive the worker origin from Vercel's own deployment URL, NOT the
  // user-controllable Host header. This is a browser-facing POST, so trusting
  // `Host` would let a caller redirect the CRON_SECRET-bearing worker fetch at a
  // host they control. VERCEL_URL is injected by the platform at runtime; fall
  // back to the Host header only for local dev where it's unset.
  const vercelHost = process.env.VERCEL_URL
  const baseUrl = vercelHost
    ? `https://${vercelHost}`
    : (req.headers.host ? `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}` : null)
  const kicked = await kickWorker(baseUrl, interview.id)
  if (!kicked) {
    // The row exists with transcribe_status='processing'; without a worker it
    // would poll forever. Mark it failed so the UI surfaces a retry instead.
    await sb(`interviews?id=eq.${interview.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ transcribe_status: 'failed' }),
    }).catch(() => {})
    return res.status(502).json({ error: 'Could not start transcription — please try again.' })
  }

  return res.status(200).json({ staffId, interviewId: interview.id })
}
