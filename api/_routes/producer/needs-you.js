// GET /api/producer/needs-you
//
// The read behind Bernard's "needs you" surface (Standing Producer Phase 4).
// Aggregates the things the producer CAN'T resolve on its own and hands back to
// the human — read-only, all workspace-scoped. Three categories (from the sprint
// plan §Phase 4 / the answer-graph mockup screen 3):
//   1. escalated_caption — a held draft the voice-repair pass couldn't lift
//      (voice_audit.escalated = true); the human needs to rewrite it.
//   2. publish_failed    — a recent publish failure not superseded by a later
//      success for the same piece; the human reconnects/retries.
//   3. plan_gap          — the upcoming week's plan is under the cadence target;
//      "your week is N short — a fresh capture fills the rest."
//
// Returns { enabled: producerActive(config), items: [] }. When the producer is
// disabled OR paused, returns { enabled:false, items:[] } so the UI renders an
// honest empty state without a second config round-trip.
//
// This is a clean read-only STUB matching the 3 mockup categories; field names +
// copy will be refined against the approved mockup in the morning (see TODO below).
//
// Node runtime + Express-style (req, res). No writes, no email, no producer_config
// changes — a pure read.
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole }      from '../../_lib/auth.js'
import { enforceLimit }     from '../../_lib/ratelimit.js'
import { producerActive }   from '../../_lib/producer/config.js'
import { mondayOf }         from '../../_lib/strategist.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const WEEK_MS = 7 * 24 * 60 * 60 * 1000
// How far back to look for unresolved publish failures (matches the agent-tick
// backfill window — a failure older than this has either been retried or is stale).
const FAILURE_WINDOW_MS = 24 * 60 * 60 * 1000
const MAX_PER_CATEGORY  = 25

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

// Escalated held captions: a draft the producer flagged and couldn't fix. Set by
// regradeContentItem.js (voice_audit.escalated=true, still gate='held').
async function escalatedCaptions(wsId) {
  const r = await sb(
    `content_items?workspace_id=eq.${wsId}&status=eq.draft&voice_audit->>escalated=eq.true` +
    `&select=id,platform,topic,voice_fidelity_score,voice_audit,updated_at` +
    `&order=updated_at.desc&limit=${MAX_PER_CATEGORY}`
  )
  if (!r.ok) { console.error('[producer/needs-you] escalated fetch failed:', r.status); return [] }
  const rows = (await r.json().catch(() => [])) || []
  return rows.map((ci) => ({
    type:          'escalated_caption',
    contentItemId: ci.id,
    platform:      ci.platform || null,
    topic:         ci.topic || null,
    score:         ci.voice_fidelity_score ?? null,
    redFlag:       ci.voice_audit?.red_flag || null,
    at:            ci.updated_at || null,
  }))
}

// Recent publish failures NOT superseded by a later success for the same piece.
// Both failure ('publish_failed') and success ('published') actions carry
// content_item_id; a failure is "resolved" once a 'published' action for the same
// piece is created at/after it.
async function unresolvedPublishFailures(wsId) {
  const since = new Date(Date.now() - FAILURE_WINDOW_MS).toISOString()
  const failRes = await sb(
    `agent_actions?workspace_id=eq.${wsId}&kind=eq.publish_failed&created_at=gte.${since}` +
    `&select=id,title,detail,content_item_id,created_at&order=created_at.desc&limit=${MAX_PER_CATEGORY}`
  )
  if (!failRes.ok) { console.error('[producer/needs-you] failures fetch failed:', failRes.status); return [] }
  const failures = (await failRes.json().catch(() => [])) || []
  if (!failures.length) return []

  // Pull recent successes in the same window to supersede resolved failures.
  // The limit=200 is generous for the 24h window, but at extreme publish volume
  // (>200 successes/day) the oldest could fall outside the slice; acceptable at
  // current scale — revisit with a per-content_item `in.()` filter if it grows.
  const okRes = await sb(
    `agent_actions?workspace_id=eq.${wsId}&kind=eq.published&created_at=gte.${since}` +
    `&select=content_item_id,created_at&order=created_at.desc&limit=200`
  )
  // Fail SAFE: if we can't verify what's been superseded, don't surface any
  // publish failures this pass (better to under-report than to resurface a
  // failure the user already resolved).
  if (!okRes.ok) {
    console.error('[producer/needs-you] supersession success fetch failed:', okRes.status)
    return []
  }
  const successes = (await okRes.json().catch(() => [])) || []
  // Latest success time per content_item_id.
  const latestSuccess = new Map()
  for (const s of successes) {
    if (!s.content_item_id) continue
    const t = Date.parse(s.created_at || '') || 0
    if (t > (latestSuccess.get(s.content_item_id) || 0)) latestSuccess.set(s.content_item_id, t)
  }
  return failures
    .filter((f) => {
      if (!f.content_item_id) return true // no piece to supersede → still surface it
      const failedAt = Date.parse(f.created_at || '') || 0
      const okAt = latestSuccess.get(f.content_item_id) || 0
      return okAt < failedAt // resolved only if a success came AFTER the failure
    })
    .map((f) => ({
      type:          'publish_failed',
      contentItemId: f.content_item_id || null,
      platform:      f.detail?.platform || null,
      detail:        f.detail?.reason || f.title || null,
      at:            f.created_at || null,
    }))
}

// Plan gap: the upcoming week's plan is UNDER the workspace's cadence target —
// the strategist filled fewer slots than the cadence asks for, so the human's
// input (a fresh capture) is needed to fill the rest.
//
// Note this is NOT `interview_id IS NULL` (an earlier stub used that, but
// content_plan_atoms.interview_id is NOT NULL at the schema level, so that
// predicate could never match). The honest, cheap signal is scheduled-count vs.
// cadence target. Only fires when a plan EXISTS for next week (the strategist has
// run) but falls short — never when next week simply hasn't been planned yet, so
// it doesn't nag before the plan is even built.
async function planGaps(wsId, ws) {
  const nextMonday = mondayOf(new Date(Date.now() + WEEK_MS).toISOString())
  const r = await sb(
    `content_plan_atoms?workspace_id=eq.${wsId}&plan_week=eq.${nextMonday}` +
    `&scheduled_at=not.is.null&select=id&limit=200`
  )
  if (!r.ok) { console.error('[producer/needs-you] plan-gap fetch failed:', r.status); return [] }
  const scheduled = ((await r.json().catch(() => [])) || []).length
  if (scheduled === 0) return [] // no plan yet → not actionable, don't surface

  const channels = ws.cadence_policy?.channels || {}
  const target = Object.values(channels)
    .filter((c) => c?.enabled)
    .reduce((sum, c) => sum + (Number(c.target_per_week) || 0), 0)
  const short = target - scheduled
  if (short <= 0) return []

  // One aggregate item — "your week is N short" — rather than one per empty slot.
  return [{
    type:      'plan_gap',
    short,
    scheduled,
    target,
    week:      nextMonday,
  }]
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  // Any authenticated workspace member can read their own "needs you" surface.
  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  if (!(await enforceLimit(req, res, 'producer-needs-you', ws.id))) return

  // Gated: disabled OR paused → honest empty state, no reads.
  if (!producerActive(ws.producer_config)) {
    return res.status(200).json({ enabled: false, items: [] })
  }

  // TODO(morning): the approved mockup (answer-graph-v1.html screen 3 /
  // standing-producer-sprint.md §Phase 4) is the final spec for the exact fields
  // + copy of each item. This stub matches the 3 categories; refine field names
  // and add any per-category metadata (e.g. thread age, retry count) then.
  let items = []
  try {
    const [escalated, failures, gaps] = await Promise.all([
      escalatedCaptions(ws.id),
      unresolvedPublishFailures(ws.id),
      planGaps(ws.id, ws),
    ])
    items = [...escalated, ...failures, ...gaps]
  } catch (e) {
    console.error('[producer/needs-you] aggregate failed:', e?.message)
    return res.status(500).json({ error: 'needs_you_fetch_failed' })
  }

  return res.status(200).json({
    enabled: true,
    items,
    counts: {
      escalated_caption: items.filter((i) => i.type === 'escalated_caption').length,
      publish_failed:    items.filter((i) => i.type === 'publish_failed').length,
      plan_gap:          items.filter((i) => i.type === 'plan_gap').length,
    },
    pausedAt: ws.producer_config?.paused_at ?? null,
  })
}
