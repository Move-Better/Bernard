// Generic authenticated topic-suggestion inbox (contract: signals-in.v1).
//
// An external integration POSTs a *suggestion* — {workspace, topic, rationale,
// provenance} — and we file it as ONE `pending` row in topic_backlog for the
// named workspace. Proposals only: this door NEVER publishes, never advances a
// topic past `pending`, never triggers generation. The existing backlog UI is
// the human gate.
//
// This is deliberately GENERIC — no Move-Better / caller-specific logic lives
// here. "Which metric → which topic" rules belong in the calling system; Bernard
// just receives a suggestion and files it for the workspace the signed payload
// names. Any future integration can reuse this same inbox.
//
// Auth (cloned from api/_routes/webhooks/bundle.js + mux.js): the caller signs
// the raw request body with HMAC-SHA256 keyed by VIGIL_SIGNAL_SECRET and sends
// the hex digest in an `X-Signature` header. We VERIFY BEFORE TOUCHING THE DB —
// the URL is public and a forged suggestion must never reach the backlog.
//
// Ship-dark: if VIGIL_SIGNAL_SECRET is unset → 503 {"error":"not_configured"},
// exactly like bundle.js. Inert rather than insecure — no signal arrives until
// the owner sets the secret, so there is no rush and no exposure.
//
// ENV — VIGIL_SIGNAL_SECRET (Sensitive) is the shared signing secret; the caller
// holds the same value. SUPABASE_URL / SUPABASE_SERVICE_KEY are the existing
// service-role credentials.

// Mounted inside the api/index Express app (per the route manifest), so this
// per-file config is informational — body handling is governed by api/index's
// express.json() middleware, which exposes the raw bytes on req.rawBody.
export const config = { runtime: 'nodejs' }

import { createHmac, timingSafeEqual } from 'node:crypto'
import { workspaceById } from '../../_lib/workspaceContext.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Service-role PostgREST helper. Workspace isolation is satisfied by resolving
// the target workspace from the SIGNED payload (workspaceById / slug lookup
// below) before any write — never from the public URL. The require-workspace-scope
// eslint rule is satisfied by importing workspaceById above.
function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey:         SUPABASE_KEY,
      Authorization:  `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer:         'return=representation',
      ...init.headers,
    },
  })
}

// Timing-safe HMAC-SHA256 verification over the exact signed bytes. Accepts the
// hex digest bare or with a `sha256=` prefix. Any mismatch (missing header, bad
// secret, wrong length) returns false — never throws.
function verifySignature(rawBody, signature, secret) {
  if (!signature || typeof signature !== 'string') return false
  const provided = signature.startsWith('sha256=') ? signature.slice(7) : signature
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

// Resolve the workspace named in the payload to a live workspace row, by id
// (UUID) or slug. Returns null for unknown / inactive. Generic — the caller
// supplies the target; no workspace id is ever pinned in this file.
async function resolveWorkspace(value) {
  const v = value.trim()
  if (UUID_RE.test(v)) return await workspaceById(v) // checks status === 'active'
  const r = await sb(`workspaces?slug=eq.${encodeURIComponent(v)}&select=*&limit=1`)
  if (!r.ok) return null
  const rows = await r.json().catch(() => [])
  const row = Array.isArray(rows) ? rows[0] : null
  if (!row || row.status !== 'active') return null
  return row
}

// Fold whatever provenance the caller sent into a human-readable line, appended
// to the rationale so a reviewer in the backlog UI sees where the suggestion
// came from. Purely a formatter — no assumptions about the caller's fields.
function summarizeProvenance(p) {
  if (!p || typeof p !== 'object') return null
  const bits = []
  if (p.source) bits.push(`source: ${p.source}`)
  if (p.metric) bits.push(`metric: ${p.metric}`)
  if (p.value !== undefined && p.value !== null && p.value !== '') bits.push(`value: ${p.value}`)
  if (p.week_ending) bits.push(`week ending ${p.week_ending}`)
  return bits.length ? `(via ${bits.join(', ')})` : null
}

function composeRationale(rationale, provenance) {
  const parts = []
  if (typeof rationale === 'string' && rationale.trim()) parts.push(rationale.trim())
  const prov = summarizeProvenance(provenance)
  if (prov) parts.push(prov)
  if (!parts.length) return null
  return parts.join('\n\n').slice(0, 4000)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed', message: 'POST only' })
  }

  // Ship-dark: inert until the signing secret is set.
  const secret = process.env.VIGIL_SIGNAL_SECRET
  if (!secret) {
    console.error('[webhooks/topic-signal] VIGIL_SIGNAL_SECRET not set; not configured')
    return res.status(503).json({ error: 'not_configured' })
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(503).json({ error: 'supabase_not_configured' })
  }

  // Verify against the exact signed bytes stashed by api/index's express.json()
  // verify callback. Re-reading the consumed stream would hang.
  const rawBody = req.rawBody
  const signature = req.headers['x-signature'] || req.headers['X-Signature']
  if (!rawBody || !rawBody.length) {
    return res.status(400).json({ error: 'no_raw_body' })
  }
  if (!verifySignature(rawBody, signature, secret)) {
    return res.status(401).json({ error: 'invalid_signature' })
  }

  let payload
  try {
    payload = JSON.parse(rawBody.toString('utf8'))
  } catch {
    return res.status(400).json({ error: 'invalid_json' })
  }

  const workspace  = payload?.workspace
  const topic      = payload?.topic
  if (typeof workspace !== 'string' || !workspace.trim()) {
    return res.status(400).json({ error: 'missing_workspace' })
  }
  if (typeof topic !== 'string' || !topic.trim()) {
    return res.status(400).json({ error: 'missing_topic' })
  }

  const ws = await resolveWorkspace(workspace)
  if (!ws) {
    return res.status(404).json({ error: 'unknown_workspace' })
  }

  const rationaleText = composeRationale(payload?.rationale, payload?.provenance)
  const rawKey = payload?.idempotency_key
  const idemKey = typeof rawKey === 'string' && rawKey.trim() ? rawKey.trim().slice(0, 200) : null

  // Idempotency: a replayed key for this workspace returns the existing row (200)
  // rather than inserting a duplicate (201).
  if (idemKey) {
    const look = await sb(
      `topic_backlog?workspace_id=eq.${encodeURIComponent(ws.id)}` +
      `&source=eq.vigil_signal&idempotency_key=eq.${encodeURIComponent(idemKey)}` +
      `&select=*&limit=1`,
      { method: 'GET' }
    )
    const rows = look.ok ? await look.json().catch(() => []) : []
    if (Array.isArray(rows) && rows[0]) {
      return res.status(200).json({ received: true, duplicate: true, row: rows[0] })
    }
  }

  // Always pending, always source='vigil_signal'. No status/publish fields are
  // ever set — the door cannot advance a topic past pending by construction.
  const insertRow = {
    workspace_id:    ws.id,
    topic:           topic.trim().slice(0, 500),
    rationale:       rationaleText,
    source:          'vigil_signal',
    status:          'pending',
    priority:        50,
    idempotency_key: idemKey,
  }

  const insRes = await sb('topic_backlog', {
    method: 'POST',
    body: JSON.stringify(insertRow),
  })

  if (!insRes.ok) {
    // Lost the race with a concurrent replay (partial unique index) — treat the
    // 409 as idempotent success and return the row that won.
    if (insRes.status === 409 && idemKey) {
      const look = await sb(
        `topic_backlog?workspace_id=eq.${encodeURIComponent(ws.id)}` +
        `&source=eq.vigil_signal&idempotency_key=eq.${encodeURIComponent(idemKey)}` +
        `&select=*&limit=1`,
        { method: 'GET' }
      )
      const rows = look.ok ? await look.json().catch(() => []) : []
      if (Array.isArray(rows) && rows[0]) {
        return res.status(200).json({ received: true, duplicate: true, row: rows[0] })
      }
    }
    console.error('[webhooks/topic-signal] insert failed:', insRes.status, await insRes.text().catch(() => ''))
    return res.status(500).json({ error: 'db_error' })
  }

  const inserted = await insRes.json().catch(() => null)
  const row = Array.isArray(inserted) ? inserted[0] : inserted
  return res.status(201).json({ received: true, created: true, row })
}
