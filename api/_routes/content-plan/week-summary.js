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
  // weeks ahead, plannable). The value must be a Monday within that window. "This
  // week" is resolved in the WORKSPACE timezone (the client mirrors this), so the
  // board doesn't jump to next week during the Sun-evening/Mon-UTC gap. The bare
  // weekParam is validated tz-neutrally (it's already a floating Monday date).
  const NAV_BACK = 8, NAV_FWD = 4
  const nowMonday = mondayOf(new Date().toISOString(), ws.cadence_policy?.timezone)
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
  const ATOM_SELECT = 'id,platform,slot,scheduled_at,held_at,angle,angle_label,brief,format,status,content_piece_id,interview_id,interview:interviews!interview_id(topic)'

  // Three independent Supabase round-trips (atoms+drafted-items chain, the
  // backlog query, and the reviewer's own staff+review-queue chain) used to
  // run strictly sequentially — up to 4 awaits back to back. None of them
  // depend on each other's results, so run them concurrently; this is the
  // main contributor to /week and / (Home, which also hits this route)
  // showing up as the app's slowest routes in PostHog web-vitals (P95 LCP
  // 6-9s, 2026-07-16 UX report).
  const clerkUserId = auth.userId || auth.user?.id || null

  async function fetchAtomsAndDraftedItems() {
    const atomsRes = await sb(
      `content_plan_atoms?workspace_id=eq.${ws.id}&plan_week=eq.${weekMonday}&select=${ATOM_SELECT}`,
    )
    const atoms = atomsRes.ok ? await atomsRes.json() : []
    const scheduled = atoms.filter((a) => a.scheduled_at)

    // For drafted atoms, batch-fetch the content_item status so /week can
    // show approve/schedule actions without a per-card round-trip.
    const draftedIds = atoms.filter((a) => a.content_piece_id).map((a) => a.content_piece_id)
    let itemStatusMap = {}
    if (draftedIds.length) {
      const safeIds = draftedIds.filter((did) => UUID_RE.test(did))
      if (safeIds.length) {
        const quoted = safeIds.map((did) => `"${did}"`).join(',')
        const ciRes = await sb(
          `content_items?workspace_id=eq.${ws.id}&id=in.(${quoted})&select=id,status,platform,content,media_urls,slides,photo_template_id,voice_fidelity_score,voice_audit`,
        )
        if (ciRes.ok) {
          const ciRows = await ciRes.json()
          if (Array.isArray(ciRows)) { for (const ci of ciRows) itemStatusMap[ci.id] = ci }
        }
      }
    }
    return { scheduled, itemStatusMap }
  }

  async function fetchHeldAtoms() {
    const heldRes = await sb(
      `content_plan_atoms?workspace_id=eq.${ws.id}&held_at=not.is.null&select=${ATOM_SELECT}&order=held_at.asc`,
    )
    return heldRes.ok ? await heldRes.json() : []
  }

  // Clinician "yours to review" (2d): blog content_items in in_review for this user's
  // staff row, only when blog_review_enabled is true on that row.
  async function fetchYourReview() {
    if (!clerkUserId) return []
    const staffRes = await sb(
      `staff?workspace_id=eq.${ws.id}&user_id=eq.${encodeURIComponent(clerkUserId)}&select=id,blog_review_enabled&limit=1`,
    )
    if (!staffRes.ok) return []
    const staffRows = await staffRes.json()
    const sf = staffRows[0]
    if (!sf?.blog_review_enabled) return []
    const reviewRes = await sb(
      `content_items?workspace_id=eq.${ws.id}&staff_id=eq.${sf.id}&platform=eq.blog&status=eq.in_review&select=id,topic,created_at&order=created_at.desc&limit=10`,
    )
    return reviewRes.ok ? await reviewRes.json() : []
  }

  const [{ scheduled, itemStatusMap }, heldAtoms, yourReview] = await Promise.all([
    fetchAtomsAndDraftedItems(),
    fetchHeldAtoms(),
    fetchYourReview(),
  ])

  const byPlatform = {}
  for (const a of scheduled) {
    byPlatform[a.platform] = (byPlatform[a.platform] || 0) + 1
  }

  // First ~180 chars of the drafted copy, stripped of light markdown, so /week
  // can show a review excerpt inline (D4) without a per-card content fetch.
  const excerptOf = (ci) => {
    if (!ci?.content) return null
    const text = String(ci.content).replace(/[#*_>`]/g, '').replace(/\s+/g, ' ').trim()
    return text ? (text.length > 180 ? `${text.slice(0, 180)}…` : text) : null
  }

  // First renderable media entry → a thumbnail for the Day-view cards. media_urls
  // is the canonical [{url,type,kind,thumbnailUrl,...}] shape; for a video we only
  // use its poster (thumbnailUrl), never the raw video URL in an <img>.
  const thumbOf = (ci) => {
    const list = Array.isArray(ci?.media_urls) ? ci.media_urls : []
    for (const m of list) {
      if (!m) continue
      const isVideo = m.type === 'video' || m.kind === 'video'
      const src = isVideo ? m.thumbnailUrl : (m.url || m.thumbnailUrl)
      if (src) return { url: src, kind: isVideo ? 'video' : 'image' }
    }
    return null
  }

  const shape = (a) => {
    const ci = a.content_piece_id ? itemStatusMap[a.content_piece_id] : null
    const thumb = thumbOf(ci)
    return {
      id: a.id,
      platform: a.platform,
      scheduled_at: a.scheduled_at,
      thumbnailUrl: thumb?.url || null,
      mediaKind: thumb?.kind || null,
      label: a.angle_label,
      brief: a.brief,
      // Output format for the slot (migration 179). NULL on every pre-format
      // row, which means 'post' — normalized here so the client never has to
      // repeat the fallback.
      format: a.format || 'post',
      interviewTopic: a.interview?.topic || null,
      status: a.status,
      contentPieceId: a.content_piece_id,
      contentItemStatus: ci?.status || null,
      excerpt: excerptOf(ci),
      interviewId: a.interview_id,
      voiceFidelityScore: ci?.voice_fidelity_score ?? null,
      voiceFlag: ci?.voice_audit?.red_flag || null,
      // 'held' (short caption below the voice bar — a real drift flag), 'soft'
      // (long-form below the bar; the rubric isn't calibrated there, so not
      // flagged), 'passed', or null (unscored / pre-P2A drafts).
      voiceGate: ci?.voice_audit?.gate || null,
      // Pre-drafted ahead of the week by the Standing Producer (Phase 3). Drives
      // the "drafted ahead" mark + the pre-draft summary banner on /week.
      predrafted: Boolean(ci?.voice_audit?.predrafted),
    }
  }

  // Active digest (the newsletter contribution line) from the cadence policy.
  const digests = Array.isArray(ws.cadence_policy?.digests) ? ws.cadence_policy.digests : []
  const digest = digests.find((d) => d.enabled) || digests[0] || null

  const scheduledShaped = scheduled
    .map(shape)
    .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))

  // Pre-draft summary (Phase 3): how much of the week Bernard drafted ahead, and
  // how much cleared the voice check vs. still needs the human. 'held' short
  // captions are the ones flagged for a closer look.
  const predrafted = scheduledShaped.filter((s) => s.predrafted)
  const predraftSummary = predrafted.length
    ? {
        total: scheduledShaped.length,
        predrafted: predrafted.length,
        needsYou: predrafted.filter((s) => s.voiceGate === 'held').length,
        ready: predrafted.filter((s) => s.voiceGate !== 'held').length,
      }
    : null

  return res.status(200).json({
    weekMonday,
    hasPlan: scheduled.length > 0,
    trustStage: ws.cadence_policy?.trust_stage || 'approve_all',
    cadence: ws.cadence_policy?.channels || null,
    quietDays: ws.cadence_policy?.quiet_days || ['sat', 'sun'],
    timezone: ws.cadence_policy?.timezone || 'America/Los_Angeles',
    scheduledTotal: scheduled.length,
    byPlatform,
    scheduled: scheduledShaped,
    predraftSummary,
    heldCount: heldAtoms.length,
    held: heldAtoms.map(shape),
    digest: digest ? { label: digest.label, frequency: digest.frequency, next_send: digest.next_send || null } : null,
    yourReview,
  })
}
