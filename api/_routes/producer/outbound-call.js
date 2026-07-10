// POST /api/producer/outbound-call   { staffId, topic? }
//
// F1 — "Bernard picks up the phone." Manually triggers an OUTBOUND weekly call:
// Bernard dials the clinician, runs the same interview as the in-app voice call,
// and (via the recording webhook) turns the transcript into the week's content.
//
// v1 (Q, 2026-07-10): manual trigger only, one pilot workspace + one pilot
// number. The recipient number is NEVER taken from the request — it is the
// server-side OUTBOUND_CALL_PILOT_NUMBER — so this endpoint cannot be used to
// dial an arbitrary number. Cadence-automated triggering is a fast-follow.
//
// Gates (in order): workspaceContext → requireRole(owner) → enforceLimit →
// feature flag (realtime_voice_enabled) → workspace allowlist → telephony
// configured → pilot number set.
//
// Node runtime + Express-style (req, res).
export const config = { runtime: 'nodejs', maxDuration: 30 }

import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole }      from '../../_lib/auth.js'
import { enforceLimit }     from '../../_lib/ratelimit.js'
import { assembleCallSystemPrompt, readShippedThisWeek } from '../../_lib/outboundCall.js'
import { originateOutboundCall, telephonyConfigured } from '../../_lib/twilioSip.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    signal: AbortSignal.timeout(10_000),
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

// Workspaces allowed to place outbound calls (comma-separated slugs). Keeps the
// pilot to exactly the workspaces Q has provisioned + consented.
function allowedWorkspace(slug) {
  const list = (process.env.OUTBOUND_CALL_ENABLED_WORKSPACES || '')
    .split(',').map((s) => s.trim()).filter(Boolean)
  return list.includes(slug)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  // Elevated gate: only org admins can place a call (requireRole resolves org
  // admins to role 'admin'; there is no 'owner' role — that's a permission_tier).
  const auth = await requireRole(req, ['admin'], { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  if (!(await enforceLimit(req, res, 'ai', ws.id))) return

  // ── Feature gates ────────────────────────────────────────────────────────
  if (!ws.realtime_voice_enabled) return res.status(403).json({ error: 'realtime_voice_disabled' })
  if (!allowedWorkspace(ws.slug))  return res.status(403).json({ error: 'outbound_not_enabled' })
  if (!telephonyConfigured())      return res.status(503).json({ error: 'telephony_not_configured' })

  const pilotNumber = process.env.OUTBOUND_CALL_PILOT_NUMBER
  if (!pilotNumber) return res.status(503).json({ error: 'pilot_number_not_set' })

  // ── Validate input ───────────────────────────────────────────────────────
  const body = req.body || {}
  const staffId = typeof body.staffId === 'string' ? body.staffId : null
  if (!staffId || !UUID_RE.test(staffId)) return res.status(400).json({ error: 'invalid_staffId' })

  const staffRes = await sb(
    `staff?id=eq.${staffId}&workspace_id=eq.${ws.id}` +
      `&select=id,name,staff_type,default_tone,default_voice_mode,voice_notes,interview_style_memory&limit=1`,
  )
  if (!staffRes.ok) {
    console.error(`[producer/outbound-call] staff lookup failed ${staffRes.status} ws=${ws.slug}`)
    return res.status(500).json({ error: 'staff_lookup_failed' })
  }
  const staff = (await staffRes.json().catch(() => []))[0]
  if (!staff) return res.status(404).json({ error: 'staff_not_found' })

  const topic = typeof body.topic === 'string' && body.topic.trim()
    ? body.topic.trim().slice(0, 300)
    : 'Your weekly call'

  // ── Create the interview row (same shape the browser call uses) ───────────
  const ivRes = await sb('interviews', {
    method: 'POST',
    body: JSON.stringify({
      workspace_id: ws.id,
      staff_id: staff.id,
      topic,
      owner_id: auth.userId,
      status: 'in_progress',
      messages: [],
      capture_mode: 'realtime_voice',
      voice_mode: staff.default_voice_mode === 'personal' ? 'personal' : 'practice',
      tone: staff.default_tone || 'smart',
    }),
  })
  if (!ivRes.ok) {
    const t = await ivRes.text().catch(() => '')
    console.error(`[producer/outbound-call] interview create failed ${ivRes.status} ws=${ws.slug}: ${t.slice(0, 300)}`)
    return res.status(500).json({ error: 'interview_create_failed' })
  }
  const interview = (await ivRes.json())[0]

  // ── Assemble the call instructions (server-side; no browser) ──────────────
  const shippedTitles = await readShippedThisWeek(sb, ws.id)
  const instructions = assembleCallSystemPrompt({ workspace: ws, staff, topic, shippedTitles })

  // Stash the instructions on the interview so the OpenAI accept-webhook can
  // retrieve them by interviewId (the call's correlation id). session_state is
  // repurposed here — an outbound call is never browser-resumed.
  await sb(`interviews?id=eq.${interview.id}&workspace_id=eq.${ws.id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ session_state: { outbound: { instructions, callState: 'dialing' } } }),
  }).catch((e) => console.error(`[producer/outbound-call] stash instructions failed: ${e?.message}`))

  // ── Dial ─────────────────────────────────────────────────────────────────
  try {
    const { callSid } = await originateOutboundCall({ toNumber: pilotNumber, interviewId: interview.id })
    return res.status(202).json({ interviewId: interview.id, callSid, status: 'dialing' })
  } catch (e) {
    console.error(`[producer/outbound-call] originate failed ws=${ws.slug} iv=${interview.id}: ${e?.message}`)
    await sb(`interviews?id=eq.${interview.id}&workspace_id=eq.${ws.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'abandoned' }),
    }).catch(() => {})
    return res.status(502).json({ error: 'dial_failed' })
  }
}
