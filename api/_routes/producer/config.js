// PATCH /api/producer/config — update the Standing Producer's per-workspace
// config (Phase 4 control panel): enable/pause, per-lane toggles, the daily
// AI-action cap. Writes workspaces.producer_config (JSONB). Owner-only.
//
// The control panel (/producer/settings) reads current config from the
// workspace context, so this route is write-only. Node runtime, (req, res).
//
// The cap field is `daily_ai_call_cap` — the SAME key agent-tick enforces
// (agent-tick.js reads cfg.daily_ai_call_cap). LANE_DEFAULTS is imported from the
// shared lib so client, this route, and the tick can never drift.
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole, requireCapability } from '../../_lib/auth.js'
import { enforceLimit }     from '../../_lib/ratelimit.js'
import { CAP_SETTINGS_EDIT } from '../../_lib/capabilities.js'
import { LANE_DEFAULTS }     from '../../_lib/producer/config.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const KNOWN_LANES      = Object.keys(LANE_DEFAULTS)
const CAP_MIN     = 10
const CAP_MAX     = 120
const CAP_DEFAULT = 40

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    signal: AbortSignal.timeout(10_000),
    ...init,
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

function clampCap(n) {
  const v = Math.round(Number(n))
  if (!Number.isFinite(v)) return CAP_DEFAULT
  return Math.min(CAP_MAX, Math.max(CAP_MIN, v))
}

// Fill defaults so the caller gets a complete, resolved config back.
function resolveConfig(raw) {
  const c = raw && typeof raw === 'object' ? raw : {}
  const lanes = {}
  for (const k of KNOWN_LANES) {
    const v = c.lanes?.[k]
    lanes[k] = v === undefined ? LANE_DEFAULTS[k] : Boolean(v)
  }
  return {
    enabled: Boolean(c.enabled),
    paused_at: c.paused_at ?? null,
    daily_ai_call_cap: clampCap(c.daily_ai_call_cap ?? CAP_DEFAULT),
    lanes,
  }
}

export default async function handler(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'method_not_allowed' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  const auth = await requireRole(req, ['admin'], { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  if (!(await enforceLimit(req, res, 'producer-config-write', ws.id))) return

  // Defense-in-depth: mirror the settings-write capability gate (workspace/me.js)
  // so a coarse legacy 'admin' role whose Phase-4 permission_tier excludes
  // settings-edit can't reconfigure Bernard's autonomy.
  const capAuth = await requireCapability(req, ws, [CAP_SETTINGS_EDIT])
  if (!capAuth.ok) return res.status(403).json({ error: capAuth.reason, missing: capAuth.missing })

  const body = req.body && typeof req.body === 'object' ? req.body : {}
  const current = ws.producer_config && typeof ws.producer_config === 'object' ? ws.producer_config : {}
  const next = { ...current }

  if ('enabled' in body) next.enabled = Boolean(body.enabled)
  if ('paused_at' in body) {
    // Never trust a client timestamp — stamp the server's own when pausing.
    next.paused_at = body.paused_at ? new Date().toISOString() : null
  }
  if ('daily_ai_call_cap' in body) next.daily_ai_call_cap = clampCap(body.daily_ai_call_cap)
  if (body.lanes && typeof body.lanes === 'object') {
    const lanes = { ...(current.lanes || {}) }
    for (const k of KNOWN_LANES) {
      if (k in body.lanes) lanes[k] = Boolean(body.lanes[k])
    }
    next.lanes = lanes
  }

  const r = await sb(`workspaces?id=eq.${ws.id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ producer_config: next }),
  })
  if (!r.ok) {
    console.error('[producer/config] write failed:', r.status)
    return res.status(500).json({ error: 'config_write_failed' })
  }

  return res.status(200).json({ config: resolveConfig(next) })
}
