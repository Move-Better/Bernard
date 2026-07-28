// GET   /api/db/moments?interview_id=<uuid>  — per-interview bank listing (StoryDetail panel)
// GET   /api/db/moments                       — workspace-wide bank listing + on-hand summary
//                                               (powers the /moments "On hand" tab, step ③)
// PATCH /api/db/moments?id=<uuid>             — retire/restore one moment (status banked|retired)
//
// The bank is the workspace's inventory of scored VERBATIM excerpts
// (migration 191). Embedding is never selected (1536 floats per row is pure
// payload weight for a list view). Retire is QUIET by design: it only stops
// future draws — content_plan_atoms.moment_id is ON DELETE SET NULL and this
// handler never touches atoms, so already-planned pieces keep their drafts.
//
// Auth: any workspace role reads; retire/restore needs an editor role.

export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole } from '../../_lib/auth.js'
import { ALL_KNOWN_ROLES, EDITOR_ROLES } from '../../_lib/roles.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { getCadencePrior, computeCadenceChannels } from '../../_lib/cadenceDefaults.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// List cap for the workspace-wide read. The largest live bank is ~133 rows;
// the summary counts below are computed from this same result set, so if a
// bank ever outgrows the cap, raise it (or converge on the summary endpoint —
// see the ponytail note) rather than paginating silently.
const BANK_LIMIT = 1000

const MOMENT_FIELDS =
  'id,excerpt,hook,moment_type,topic,region,tags,score,cluster_id,is_exemplar,status,usage_count,last_used_at,clip_asset_id,staff_id,interview_id,created_at'

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

// ponytail: duplicates the on-hand summary contract that GET /api/moments/summary
// (Lane A of the 2026-07-27 sprint) is defined to own. Built from direct queries
// here because that route hadn't merged when this shipped; once it exists, the
// /moments header should read it and this block should collapse to the list read.
// Shape mirrors the Lane A contract: usable / weeklySlotDemand / runwayWeeks /
// started / newestInterviewAt / gaps.
async function buildSummary(ws, momentRows) {
  const usable = momentRows.filter((m) => m.status === 'banked' && m.is_exemplar).length

  // Weekly slot demand — same cadence resolution as the Strategist
  // (api/_lib/strategistPlan.js): manual policy verbatim, else the Auto
  // computation. Blogs are excluded by construction (blog/email/youtube are
  // not atom-cadence channels, so they never appear in the channels map).
  let weeklySlotDemand = 0
  try {
    const policy = ws.cadence_policy || null
    const isAuto = (policy?.provenance ?? 'bernard') !== 'user'
    let channels
    if (isAuto) {
      const prior = await getCadencePrior(sb)
      channels = await computeCadenceChannels(ws.id, ws.enabled_outputs, prior, sb)
    } else {
      channels = policy?.channels || {}
    }
    for (const cfg of Object.values(channels || {})) {
      if (cfg?.enabled === false) continue
      weeklySlotDemand += Number(cfg?.target_per_week) || 0
    }
  } catch (e) {
    console.error('[db/moments] cadence resolution failed:', e?.message)
  }

  const [newestR, gapsR] = await Promise.all([
    sb(`interviews?workspace_id=eq.${ws.id}&status=eq.completed&select=created_at&order=created_at.desc&limit=1`),
    sb(`topic_backlog?workspace_id=eq.${ws.id}&source=eq.bank_gap&status=eq.pending&select=id,topic&order=created_at.desc`),
  ])
  const newestRows = newestR.ok ? await newestR.json().catch(() => []) : []
  const gaps = gapsR.ok ? await gapsR.json().catch(() => []) : []
  const newestInterviewAt = newestRows[0]?.created_at || null

  const runwayWeeks = weeklySlotDemand > 0 ? Math.round((usable / weeklySlotDemand) * 10) / 10 : null
  return {
    usable,
    weeklySlotDemand,
    runwayWeeks,
    started: momentRows.length > 0 || !!newestInterviewAt,
    newestInterviewAt,
    gaps,
  }
}

export default async function handler(req, res) {
  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  const isWrite = req.method === 'PATCH'
  const auth = await requireRole(req, isWrite ? EDITOR_ROLES : ALL_KNOWN_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  if (!(await enforceLimit(req, res, 'generic', ws.id))) return

  const url = new URL(req.url, 'http://localhost')

  // ── PATCH — retire / restore ──────────────────────────────────────────────
  if (req.method === 'PATCH') {
    const id = url.searchParams.get('id') || ''
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'invalid_id' })
    const status = req.body?.status
    if (status !== 'banked' && status !== 'retired') {
      return res.status(400).json({ error: 'invalid_status' })
    }
    const r = await sb(`moments?id=eq.${id}&workspace_id=eq.${ws.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ status, updated_at: new Date().toISOString() }),
    })
    if (!r.ok) {
      console.error('[db/moments] patch failed:', r.status, (await r.text().catch(() => '')).slice(0, 300))
      return res.status(500).json({ error: 'db_error' })
    }
    const rows = await r.json().catch(() => [])
    if (!rows.length) return res.status(404).json({ error: 'not_found' })
    return res.status(200).json({ moment: rows[0] })
  }

  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  const interviewId = url.searchParams.get('interview_id') || ''

  // ── GET ?interview_id — per-interview listing (unchanged contract) ────────
  if (interviewId) {
    if (!UUID_RE.test(interviewId)) return res.status(400).json({ error: 'invalid_interview_id' })
    const r = await sb(
      `moments?workspace_id=eq.${ws.id}&interview_id=eq.${interviewId}` +
      `&select=id,excerpt,hook,moment_type,topic,region,tags,score,cluster_id,is_exemplar,status,usage_count,last_used_at,created_at,planned:content_plan_atoms(count)` +
      `&order=score.desc.nullslast,created_at.asc`,
    )
    if (!r.ok) {
      console.error('[db/moments] query failed:', r.status, (await r.text().catch(() => '')).slice(0, 300))
      return res.status(500).json({ error: 'db_error' })
    }
    const rows = await r.json().catch(() => [])
    // Same planned_count mapping as the bank listing below — StoryDetail's
    // retire dialog states how many planned pieces keep their drafts.
    const moments = rows.map((m) => ({
      ...m,
      planned_count: Array.isArray(m.planned) ? (m.planned[0]?.count ?? 0) : 0,
      planned: undefined,
    }))
    return res.status(200).json({ moments })
  }

  // ── GET — workspace-wide bank listing + on-hand summary ───────────────────
  // interview:interviews(topic,created_at) labels the source story; planned is
  // the count of content_plan_atoms anchored to this moment (the retire dialog
  // states how many planned pieces keep their drafts).
  const r = await sb(
    `moments?workspace_id=eq.${ws.id}` +
    `&select=${MOMENT_FIELDS},interview:interviews(id,topic,created_at),planned:content_plan_atoms(count)` +
    `&order=score.desc.nullslast,created_at.desc&limit=${BANK_LIMIT}`,
  )
  if (!r.ok) {
    console.error('[db/moments] bank query failed:', r.status, (await r.text().catch(() => '')).slice(0, 300))
    return res.status(500).json({ error: 'db_error' })
  }
  const rows = await r.json().catch(() => [])
  const moments = rows.map((m) => ({
    ...m,
    planned_count: Array.isArray(m.planned) ? (m.planned[0]?.count ?? 0) : 0,
    planned: undefined,
  }))

  const summary = await buildSummary(ws, moments)
  return res.status(200).json({ moments, summary })
}
