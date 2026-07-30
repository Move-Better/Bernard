// GET   /api/db/moments?interview_id=<uuid>  — per-interview bank listing (StoryDetail panel)
// GET   /api/db/moments                       — workspace-wide bank listing
//                                               (powers the /moments "On hand" tab, step ③;
//                                               header stats come from GET /api/moments/summary)
// PATCH /api/db/moments?id=<uuid>             — retire/restore one moment (status banked|retired)
//                                               and/or stamp the review marker (reviewed true|false)
//
// The bank is the workspace's inventory of scored VERBATIM excerpts
// (migration 191). Embedding is never selected (1536 floats per row is pure
// payload weight for a list view). Retire is QUIET by design: it only stops
// future draws — content_plan_atoms.moment_id is ON DELETE SET NULL and this
// handler never touches atoms, so already-planned pieces keep their drafts.
//
// Review (migration 193) is a MARKER, not a gate — an approved moment is drawn
// by the planner exactly like an unreviewed one. It exists so the On-hand
// approval queue ("banked AND reviewed_at IS NULL") is finite and each verdict
// carries an audit stamp. Both verdicts stamp it: Approve sends
// {reviewed:true}, Retire sends {status:'retired', reviewed:true}. reviewed_at
// and reviewed_by are SERVER-set only, never accepted from the client (same
// rule as content_items.approved_by).
//
// Auth: any workspace role reads; retire/restore needs an editor role.

export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole } from '../../_lib/auth.js'
import { ALL_KNOWN_ROLES, EDITOR_ROLES } from '../../_lib/roles.js'
import { enforceLimit } from '../../_lib/ratelimit.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// List cap for the workspace-wide read. The largest live bank is ~133 rows;
// the On-hand tab count is derived from this result set client-side, so if a
// bank ever outgrows the cap, raise it rather than paginating silently.
const BANK_LIMIT = 1000

const MOMENT_FIELDS =
  'id,excerpt,hook,moment_type,topic,region,tags,score,cluster_id,is_exemplar,status,usage_count,last_used_at,clip_asset_id,staff_id,interview_id,reviewed_at,reviewed_by,created_at'

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

export default async function handler(req, res) {
  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  const isWrite = req.method === 'PATCH'
  const auth = await requireRole(req, isWrite ? EDITOR_ROLES : ALL_KNOWN_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  if (!(await enforceLimit(req, res, 'generic', ws.id))) return

  const url = new URL(req.url, 'http://localhost')

  // ── PATCH — retire / restore / review ─────────────────────────────────────
  if (req.method === 'PATCH') {
    const id = url.searchParams.get('id') || ''
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'invalid_id' })

    const status = req.body?.status
    const reviewed = req.body?.reviewed
    const hasStatus = status !== undefined
    const hasReviewed = reviewed !== undefined

    if (hasStatus && status !== 'banked' && status !== 'retired') {
      return res.status(400).json({ error: 'invalid_status' })
    }
    if (hasReviewed && typeof reviewed !== 'boolean') {
      return res.status(400).json({ error: 'invalid_reviewed' })
    }
    // An empty PATCH would silently succeed and look like it worked.
    if (!hasStatus && !hasReviewed) return res.status(400).json({ error: 'nothing_to_update' })

    const patch = { updated_at: new Date().toISOString() }
    if (hasStatus) patch.status = status
    if (hasReviewed) {
      // Audit fields are server-set only — never accept a timestamp or an
      // identity from the client (same rule as content_items.approved_by).
      patch.reviewed_at = reviewed ? new Date().toISOString() : null
      patch.reviewed_by = reviewed ? auth.userId : null
    }

    const r = await sb(`moments?id=eq.${id}&workspace_id=eq.${ws.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(patch),
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

  // ── GET — workspace-wide bank listing ─────────────────────────────────────
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
  return res.status(200).json({ moments })
}
