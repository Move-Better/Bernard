// GET /api/moments/summary — the on-hand inventory summary (Moments IA ②,
// .claude/moment-ia-build-plan.md "Shared contract"). One number the /week
// chip, its drawer, and the Home restock nudge all read; Lane B's /moments
// header may consume it too.
//
// Contract fields (build exactly — other lanes read this):
//   usable            banked AND is_exemplar moment count
//   weeklySlotDemand  sum of enabled cadence targets (blogs excluded)
//   runwayWeeks       usable / weeklySlotDemand, 1dp; null when demand is 0
//   started           any moments OR any completed interview ever
//   newestInterviewAt newest completed interview date (freshness keys on the
//                     INTERVIEW date, never moments.created_at — backfill
//                     timestamps are all identical)
//   gaps              open topic_backlog rows with source='bank_gap' → [{id, topic}]
//   composition       current week: { momentSlots, legacySlots, openSlots }
// Additive extra (not in the contract, used by the /week drawer):
//   strongest         top 5 usable moments by score → [{id, excerpt, score}]
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole } from '../../_lib/auth.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { mondayOf } from '../../_lib/strategist.js'
import { mergeSlotsIntoCadence } from '../../_lib/cadenceSlots.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      ...init.headers,
    },
  })
}

// Row count without transferring rows — HEAD + count=exact, total from the
// content-range header ("0-0/133").
async function countRows(path) {
  const r = await sb(`${path}&limit=1`, { method: 'HEAD', headers: { Prefer: 'count=exact' } })
  if (!r.ok) return null
  const total = parseInt((r.headers.get('content-range') || '').split('/')[1], 10)
  return Number.isFinite(total) ? total : null
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })
  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  if (!(await enforceLimit(req, res, 'generic', ws.id))) return

  // Same tz-aware "this week" the /week board uses.
  const weekMonday = mondayOf(new Date().toISOString(), ws.cadence_policy?.timezone)

  // Weekly demand from the cadence policy (no DB round-trip — ws carries it).
  // Blogs are excluded per the contract: runway measures the social board.
  const rawChannels = ws.cadence_policy?.channels || {}
  const weeklySlotDemand = Object.entries(rawChannels)
    .filter(([platform, c]) => platform !== 'blog' && c?.enabled)
    .reduce((sum, [, c]) => sum + Math.max(0, Math.round(Number(c.target_per_week) || 0)), 0)

  // Defined board slots for the open-slot count — the same slot resolution the
  // /week board renders empty tiles from (persisted slots, else the computed
  // default), so composition's total matches what the user sees as tiles.
  const quietDays = ws.cadence_policy?.quiet_days || []
  const cadenceWithSlots = mergeSlotsIntoCadence(rawChannels, rawChannels, quietDays)
  const definedSlots = Object.entries(cadenceWithSlots)
    .filter(([platform, c]) => platform !== 'blog' && c?.enabled)
    .reduce((sum, [, c]) => sum + (Array.isArray(c.slots) ? c.slots.filter((s) => s?.enabled !== false).length : 0), 0)

  const [usable, anyMoment, newestRows, gapRows, weekAtoms, strongestRows] = await Promise.all([
    countRows(`moments?workspace_id=eq.${ws.id}&status=eq.banked&is_exemplar=is.true&select=id`),
    countRows(`moments?workspace_id=eq.${ws.id}&select=id`),
    sb(`interviews?workspace_id=eq.${ws.id}&status=eq.completed&select=created_at&order=created_at.desc&limit=1`)
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []),
    sb(`topic_backlog?workspace_id=eq.${ws.id}&source=eq.bank_gap&status=in.(pending,in_progress)&select=id,topic&order=priority.desc,created_at.desc&limit=10`)
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []),
    sb(`content_plan_atoms?workspace_id=eq.${ws.id}&plan_week=eq.${weekMonday}&scheduled_at=not.is.null&select=id,moment_id`)
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []),
    sb(`moments?workspace_id=eq.${ws.id}&status=eq.banked&is_exemplar=is.true&select=id,excerpt,score&order=score.desc.nullslast&limit=5`)
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []),
  ])

  const usableCount = usable ?? 0
  const momentSlots = (Array.isArray(weekAtoms) ? weekAtoms : []).filter((a) => a.moment_id).length
  const legacySlots = (Array.isArray(weekAtoms) ? weekAtoms : []).length - momentSlots
  const openSlots = Math.max(0, definedSlots - momentSlots - legacySlots)

  const newestInterviewAt = newestRows?.[0]?.created_at
    ? String(newestRows[0].created_at).slice(0, 10)
    : null

  return res.status(200).json({
    usable: usableCount,
    weeklySlotDemand,
    runwayWeeks: weeklySlotDemand > 0 ? Math.round((usableCount / weeklySlotDemand) * 10) / 10 : null,
    started: (anyMoment ?? 0) > 0 || Boolean(newestInterviewAt),
    newestInterviewAt,
    gaps: (Array.isArray(gapRows) ? gapRows : []).map((g) => ({ id: g.id, topic: g.topic })),
    composition: { momentSlots, legacySlots, openSlots },
    strongest: (Array.isArray(strongestRows) ? strongestRows : []).map((m) => ({
      id: m.id,
      excerpt: m.excerpt,
      score: m.score ?? null,
    })),
  })
}
