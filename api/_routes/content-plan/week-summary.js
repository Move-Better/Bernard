// GET /api/content-plan/week-summary  — the F2 post-call reveal (A.3) data.
// Returns the current week's Strategist plan summary for the workspace:
// what's scheduled this week (by platform + per-day), how many are banked as
// backlog, and the active digest contribution. Used by PostCallReveal.
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole } from '../../_lib/auth.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { mondayOf } from '../../_lib/strategist.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function sb(path) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  })
}
const err = (res, msg, status = 400) => res.status(status).json({ error: msg })

export default async function handler(req, res) {
  if (req.method !== 'GET') return err(res, 'Method not allowed', 405)

  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'Workspace not resolved', 400)

  // Any authenticated workspace member can see their own post-call reveal.
  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) return err(res, auth.reason || 'Unauthorized', auth.reason === 'forbidden' ? 403 : 401)
  if (!(await enforceLimit(req, res, 'generic', ws.id))) return

  // Week navigation (F2): default to the current week, but accept ?week=YYYY-MM-DD
  // to view a past week (read-only, up to 8 weeks back) or a future week (up to 4
  // weeks ahead, plannable). The value must be a Monday within that window — the
  // client computes it the same UTC way mondayOf() does, so this stays in lockstep.
  const NAV_BACK = 8, NAV_FWD = 4
  const nowMonday = mondayOf(new Date().toISOString())
  let weekMonday = nowMonday
  const weekParam = new URL(req.url, 'http://localhost').searchParams.get('week')
  if (weekParam) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekParam) || mondayOf(weekParam) !== weekParam) {
      return err(res, 'Invalid week — must be a Monday (YYYY-MM-DD)', 400)
    }
    const offsetWeeks = Math.round((Date.parse(weekParam) - Date.parse(nowMonday)) / (7 * 86400000))
    if (offsetWeeks < -NAV_BACK || offsetWeeks > NAV_FWD) return err(res, 'Week out of range', 400)
    weekMonday = weekParam
  }

  // This week's planned atoms (Strategist output for plan_week). Full detail so
  // the /week calendar can render cards + drill in to the per-piece review.
  const ATOM_SELECT = 'id,platform,slot,scheduled_at,held_at,angle,angle_label,brief,status,content_piece_id,interview_id'
  const atomsRes = await sb(
    `content_plan_atoms?workspace_id=eq.${ws.id}&plan_week=eq.${weekMonday}&select=${ATOM_SELECT}`,
  )
  const atoms = atomsRes.ok ? await atomsRes.json() : []
  const scheduled = atoms.filter((a) => a.scheduled_at)

  const byPlatform = {}
  for (const a of scheduled) {
    byPlatform[a.platform] = (byPlatform[a.platform] || 0) + 1
  }

  // For drafted atoms, batch-fetch the content_item status so /week can
  // show approve/schedule actions without a per-card round-trip.
  const draftedIds = atoms.filter((a) => a.content_piece_id).map((a) => a.content_piece_id)
  let itemStatusMap = {}
  if (draftedIds.length) {
    const safeIds = draftedIds.filter((id) => UUID_RE.test(id))
    if (safeIds.length) {
      const quoted = safeIds.map((id) => `"${id}"`).join(',')
      const ciRes = await sb(
        `content_items?workspace_id=eq.${ws.id}&id=in.(${quoted})&select=id,status,platform,content,media_urls,slides,photo_template_id,voice_fidelity_score,voice_audit`,
      )
      if (ciRes.ok) {
        const ciRows = await ciRes.json()
        if (Array.isArray(ciRows)) { for (const ci of ciRows) itemStatusMap[ci.id] = ci }
      }
    }
  }

  // First ~180 chars of the drafted copy, stripped of light markdown, so /week
  // can show a review excerpt inline (D4) without a per-card content fetch.
  const excerptOf = (ci) => {
    if (!ci?.content) return null
    const text = String(ci.content).replace(/[#*_>`]/g, '').replace(/\s+/g, ' ').trim()
    return text ? (text.length > 180 ? `${text.slice(0, 180)}…` : text) : null
  }

  const shape = (a) => {
    const ci = a.content_piece_id ? itemStatusMap[a.content_piece_id] : null
    return {
      id: a.id,
      platform: a.platform,
      scheduled_at: a.scheduled_at,
      label: a.angle_label,
      brief: a.brief,
      status: a.status,
      contentPieceId: a.content_piece_id,
      contentItemStatus: ci?.status || null,
      excerpt: excerptOf(ci),
      interviewId: a.interview_id,
      voiceFidelityScore: ci?.voice_fidelity_score ?? null,
      voiceFlag: ci?.voice_audit?.red_flag || null,
    }
  }

  // Banked backlog (held across all weeks) — full list for the backlog rail.
  const heldRes = await sb(
    `content_plan_atoms?workspace_id=eq.${ws.id}&held_at=not.is.null&select=${ATOM_SELECT}&order=held_at.asc`,
  )
  const heldAtoms = heldRes.ok ? await heldRes.json() : []

  // Active digest (the newsletter contribution line) from the cadence policy.
  const digests = Array.isArray(ws.cadence_policy?.digests) ? ws.cadence_policy.digests : []
  const digest = digests.find((d) => d.enabled) || digests[0] || null

  // Clinician "yours to review" (2d): blog content_items in in_review for this user's
  // staff row, only when blog_review_enabled is true on that row.
  let yourReview = []
  const clerkUserId = auth.userId || auth.user?.id || null
  if (clerkUserId) {
    const staffRes = await sb(
      `staff?workspace_id=eq.${ws.id}&user_id=eq.${encodeURIComponent(clerkUserId)}&select=id,blog_review_enabled&limit=1`,
    )
    if (staffRes.ok) {
      const staffRows = await staffRes.json()
      const sf = staffRows[0]
      if (sf?.blog_review_enabled) {
        const reviewRes = await sb(
          `content_items?workspace_id=eq.${ws.id}&staff_id=eq.${sf.id}&platform=eq.blog&status=eq.in_review&select=id,topic,created_at&order=created_at.desc&limit=10`,
        )
        if (reviewRes.ok) yourReview = await reviewRes.json()
      }
    }
  }

  return res.status(200).json({
    weekMonday,
    hasPlan: scheduled.length > 0,
    trustStage: ws.cadence_policy?.trust_stage || 'approve_all',
    cadence: ws.cadence_policy?.channels || null,
    quietDays: ws.cadence_policy?.quiet_days || ['sat', 'sun'],
    timezone: ws.cadence_policy?.timezone || 'America/Los_Angeles',
    scheduledTotal: scheduled.length,
    byPlatform,
    scheduled: scheduled
      .map(shape)
      .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at)),
    heldCount: heldAtoms.length,
    held: heldAtoms.map(shape),
    digest: digest ? { label: digest.label, frequency: digest.frequency, next_send: digest.next_send || null } : null,
    yourReview,
  })
}
