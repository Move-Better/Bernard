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
  if (!(await enforceLimit(req, res, 'ai'))) return

  const weekMonday = mondayOf(new Date().toISOString())

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
    const quoted = draftedIds.map((id) => `"${id}"`).join(',')
    const ciRes = await sb(
      `content_items?workspace_id=eq.${ws.id}&id=in.(${quoted})&select=id,status,platform,content,media_urls,slides,photo_template_id`,
    )
    if (ciRes.ok) {
      const ciRows = await ciRes.json()
      for (const ci of ciRows) itemStatusMap[ci.id] = ci
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
