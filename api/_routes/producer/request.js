// POST /api/producer/request   { topic, platform }
//
// F20 — the "ask Bernard to draft something about X" box on /producer. Enqueues
// ONE agent_inbox row (kind='draft_on_topic') that the agent-tick cron claims and
// dispatches to draftOnTopic.js. Scope is LOCKED to draft-on-topic only — this is
// NOT a general intent router; the box always means "draft this topic for this
// channel," nothing else.
//
// Grounding, gating, and the human-approval invariant all live in draftOnTopic.js
// / agent-tick.js — this route's only job is to validate input and enqueue.
//
// Node runtime + Express-style (req, res).
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole }      from '../../_lib/auth.js'
import { enforceLimit }     from '../../_lib/ratelimit.js'
import { EDITOR_ROLES }     from '../../_lib/roles.js'
import { producerActive, laneEnabled } from '../../_lib/producer/config.js'
import { SUPPORTED_PLATFORMS } from '../../_lib/producer/draftOnTopic.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const TOPIC_MAX_LEN = 300

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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  const auth = await requireRole(req, EDITOR_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  if (!(await enforceLimit(req, res, 'producer-draft-request', ws.id))) return

  // Bernard must actually be hired (and not paused), and the lane must be on —
  // same gate agent-tick re-checks at dispatch time (belt-and-suspenders).
  if (!producerActive(ws.producer_config)) return res.status(403).json({ error: 'producer_not_active' })
  if (!laneEnabled(ws.producer_config, 'ad_hoc_drafts')) return res.status(403).json({ error: 'lane_disabled' })

  const body = req.body && typeof req.body === 'object' ? req.body : {}
  const topic = typeof body.topic === 'string' ? body.topic.trim() : ''
  const platform = typeof body.platform === 'string' ? body.platform.trim() : ''

  if (!topic) return res.status(400).json({ error: 'topic_required' })
  if (topic.length > TOPIC_MAX_LEN) return res.status(400).json({ error: 'topic_too_long' })
  if (!SUPPORTED_PLATFORMS.has(platform)) return res.status(400).json({ error: 'invalid_platform' })

  const dedupeKey = `draft_topic:${crypto.randomUUID()}`
  const r = await sb('agent_inbox?on_conflict=workspace_id,dedupe_key', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify([{
      workspace_id: ws.id,
      kind:         'draft_on_topic',
      dedupe_key:   dedupeKey,
      payload:      { topic, platform, requested_by: auth.userId || null },
    }]),
  })
  if (!r.ok) {
    console.error('[producer/request] enqueue failed:', r.status)
    return res.status(500).json({ error: 'enqueue_failed' })
  }
  const rows = await r.json().catch(() => [])
  if (!rows.length) {
    console.error('[producer/request] enqueue returned 0 rows')
    return res.status(500).json({ error: 'enqueue_failed' })
  }

  return res.status(202).json({ queued: true, inboxItemId: rows[0].id })
}
