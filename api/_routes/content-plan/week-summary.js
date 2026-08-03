// GET /api/content-plan/week-summary  — the F2 post-call reveal (A.3) data.
// Returns the current week's Strategist plan summary for the workspace:
// what's scheduled this week (by platform + per-day), how many are banked as
// backlog, and the active digest contribution. Used by PostCallReveal.
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole } from '../../_lib/auth.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { mondayOf } from '../../_lib/strategist.js'
import { mergeSlotsIntoCadence } from '../../_lib/cadenceSlots.js'
import { isInstagramReel } from '../../../src/lib/mediaEntry.js'
import { isTextOnlyPlatform } from '../../../src/lib/platformMediaKind.js'
import { shapeApprovedBlog } from '../../_lib/approvedBlogs.js'
import { blogTargetFor, monthKey, progressFor } from '../../_lib/blogTarget.js'
import { isEditor } from '../../../src/lib/roles.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function sb(path) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  })
}
const err = (res, msg, status = 400) => res.status(status).json({ error: msg })

// Moments IA ① — the shared provenance shape every review surface renders
// (MomentProvenance.jsx). Sourced from the atom's banked moment; null when the
// atom predates the bank (legacy pieces render nothing).
const shapeMoment = (m) =>
  m
    ? {
        excerpt: m.excerpt,
        score: m.score ?? null,
        interviewTopic: m.interview?.topic || null,
        interviewDate: m.interview?.created_at || null,
      }
    : null

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
  const ATOM_SELECT = 'id,platform,slot,scheduled_at,held_at,angle,angle_label,brief,format,status,content_piece_id,interview_id,interview:interviews!interview_id(topic),moment:moments!moment_id(excerpt,score,interview:interviews!interview_id(topic,created_at))'

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
    // A failed select here blanks the whole board — log the PostgREST body so
    // an embed/relationship error is one `vercel logs` away, never silent.
    if (!atomsRes.ok) console.error('[week-summary] atoms query failed:', atomsRes.status, (await atomsRes.text().catch(() => '')).slice(0, 300))
    const atoms = atomsRes.ok ? await atomsRes.json() : []

    // For drafted atoms, batch-fetch the content_item status so /week can
    // show approve/schedule actions without a per-card round-trip.
    const draftedIds = atoms.filter((a) => a.content_piece_id).map((a) => a.content_piece_id)
    let itemStatusMap = {}
    if (draftedIds.length) {
      const safeIds = draftedIds.filter((did) => UUID_RE.test(did))
      if (safeIds.length) {
        const quoted = safeIds.map((did) => `"${did}"`).join(',')
        const ciRes = await sb(
          `content_items?workspace_id=eq.${ws.id}&id=in.(${quoted})&select=id,status,platform,content,media_urls,slides,photo_template_id,voice_fidelity_score,voice_audit,published_at`,
        )
        if (ciRes.ok) {
          const ciRows = await ciRes.json()
          if (Array.isArray(ciRows)) { for (const ci of ciRows) itemStatusMap[ci.id] = ci }
        }
      }
    }

    // A slotted atom carries its planned scheduled_at, which is what the board
    // filters and lays out by. But a post published immediately (publish-now,
    // no reserved slot time) loses it: the content_item PATCH that flips
    // status→published sends scheduledAt:null, and db/content.js's schedule
    // sync mirrors that onto the linked atom (nulling scheduled_at while
    // keeping plan_week). That post IS live this week, so it must still show on
    // the board — otherwise its slot renders as an empty "open slot" and the
    // clinician thinks it never went out (feedback 2026-07-27: "posted to
    // LinkedIn, not showing as Live in today"). Include any atom whose piece is
    // already published (and has a published_at to place it by); shape() lays
    // it out on its published day. Note published atoms are dropped the same way
    // from month-summary.js's scheduled_at range query — tracked separately.
    const scheduled = atoms.filter((a) => {
      const ci = itemStatusMap[a.content_piece_id]
      // A rejected/archived piece is a decided "no" — drop its card from the
      // board entirely (feedback 79eb7eb1: a rejected LinkedIn post lingered on
      // /week as amber "in review"). Reject keeps the atom's scheduled_at, so
      // without this it would pass the `a.scheduled_at` check below and render.
      // The slot simply falls off that day; the week just has one fewer post.
      if (ci?.status === 'rejected' || ci?.status === 'archived') return false
      if (a.scheduled_at) return true
      return ci?.status === 'published' && Boolean(ci.published_at)
    })
    return { scheduled, itemStatusMap }
  }

  async function fetchHeldAtoms() {
    const heldRes = await sb(
      `content_plan_atoms?workspace_id=eq.${ws.id}&held_at=not.is.null&select=${ATOM_SELECT}&order=held_at.asc`,
    )
    return heldRes.ok ? await heldRes.json() : []
  }

  // Clinician "yours to review" (2d): blog content_items in in_review for this user's
  // staff row, only when blog_review_enabled is true on that row. Each row carries
  // the piece's moment (via its plan atom) so the review slice can show the
  // "From your words" provenance block (Moments IA ①).
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
      `content_items?workspace_id=eq.${ws.id}&staff_id=eq.${sf.id}&platform=eq.blog&status=eq.in_review&select=id,topic,created_at,plan_atoms:content_plan_atoms!content_piece_id(moment:moments!moment_id(excerpt,score,interview:interviews!interview_id(topic,created_at)))&order=created_at.desc&limit=10`,
    )
    if (!reviewRes.ok) return []
    const rows = await reviewRes.json()
    if (!Array.isArray(rows)) return []
    return rows.map(({ plan_atoms, ...r }) => ({
      ...r,
      moment: shapeMoment((Array.isArray(plan_atoms) ? plan_atoms : []).find((pa) => pa?.moment)?.moment),
    }))
  }

  // The signed-in clinician's own progress against the 1-blog-per-month target.
  //
  // Strictly their own number and shown only on their own strip — this is a
  // prompt to the person who can act on it, never a producer-facing scoreboard
  // of who is behind (Q, 2026-08-01). Counted on created_at, i.e. the month the
  // clinician did the interview; see blogTarget.js for why not published_at.
  async function fetchMyBlogProgress() {
    if (!clerkUserId) return null
    const target = blogTargetFor(ws)
    if (!target.enabled) return null
    const staffRes = await sb(
      `staff?workspace_id=eq.${ws.id}&user_id=eq.${encodeURIComponent(clerkUserId)}&select=id,blog_review_enabled&limit=1`,
    )
    if (!staffRes.ok) return null
    const sf = (await staffRes.json().catch(() => []))[0]
    if (!sf?.blog_review_enabled) return null

    const tz = ws.cadence_policy?.timezone || 'America/Los_Angeles'
    const month = monthKey(new Date(), tz)
    // Fetch this staffer's blogs and count in memory rather than filtering by a
    // month range in the query: the month boundary is a WORKSPACE-timezone
    // question and PostgREST would apply it in UTC, mis-crediting a blog written
    // late on the last evening of a month to the next one.
    const r = await sb(
      `content_items?workspace_id=eq.${ws.id}&staff_id=eq.${sf.id}&platform=eq.blog&select=id,platform,status,created_at&order=created_at.desc&limit=200`,
    )
    if (!r.ok) {
      console.error('[week-summary] blog target count failed:', r.status)
      return null
    }
    const rows = await r.json().catch(() => [])
    const p = progressFor(rows, month, target.perClinicianPerMonth, tz)
    return { ...p, month }
  }

  // Producer "blogs ready to publish" — the missing half of the blog loop.
  //
  // A blog is the one channel with no content_plan_atoms row (verified: 0 of 16
  // on movebetter), so it can never appear on the atom-driven board. That left
  // an approved blog with nowhere to surface: Home counted it under "N to
  // publish" and linked to /week, which structurally could not show it. Five
  // finished, words-approved posts sat unpublished for 3-8 weeks that way.
  //
  // Role-gated, unlike fetchYourReview above — this is everyone's approved work,
  // not your own, so seeing it is a publisher capability rather than authorship.
  // (requireRole's `role` already folds in the org-admin / internal-plan bypass,
  // so this matches useUserRole on the client exactly.)
  async function fetchApprovedBlogs() {
    if (!isEditor(auth.role)) return []
    const r = await sb(
      `content_items?workspace_id=eq.${ws.id}&platform=eq.blog&status=eq.approved&select=id,topic,staff_name,media_urls,approved_at,created_at&order=approved_at.desc.nullslast,created_at.desc`,
    )
    if (!r.ok) {
      console.error('[week-summary] approved blogs query failed:', r.status, (await r.text().catch(() => '')).slice(0, 300))
      return []
    }
    const rows = await r.json()
    if (!Array.isArray(rows)) return []
    return rows.map(shapeApprovedBlog)
  }

  const [{ scheduled, itemStatusMap }, heldAtoms, yourReview, approvedBlogs, myBlogTarget] = await Promise.all([
    fetchAtomsAndDraftedItems(),
    fetchHeldAtoms(),
    fetchYourReview(),
    fetchApprovedBlogs(),
    fetchMyBlogProgress(),
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

  // First renderable media entry → a thumbnail for the Day-view cards.
  //
  // A carousel with composed slides publishes the BAKED slide images (photo +
  // on-screen text), NOT the raw media_urls photos: the row keeps media_urls as
  // the raw source photos while slides[].rendered_url holds the composed cover
  // that actually ships (see src/lib/publishPiece.js + renderSlides.js). Reading
  // media_urls[0] here therefore showed a different, un-composed photo than the
  // one that went live (feedback 2026-07-28: "Live post not showing the actual
  // photo used" — the board's photo wasn't even from the same shoot as the
  // published headline cover). Mirror the publish path: a non-reel piece with
  // slides shows its first baked slide; a reel (Instagram + video) skips slide
  // baking and publishes the video, so it keeps using the video poster below.
  //
  // media_urls is the canonical [{url,type,kind,thumbnailUrl,...}] shape; for a
  // video we only use its poster (thumbnailUrl), never the raw video URL in an
  // <img>. Photos prefer thumbnailUrl too: every consumer of this field renders
  // into a 40x40 or 64x64 tile, so `url` (the full-resolution original —
  // routinely a 12 MB / 45 MP DSLR JPEG) only costs transfer + decode time and
  // visibly blanks the tile while it decodes. `url` stays as the fallback for
  // entries that have no thumbnail yet. Same failure the Library grid hit — see
  // scripts/backfill-photo-thumbnails.mjs. (A baked slide has no separate
  // thumbnail, but rendered_url is a modest ~1080px JPEG, not a raw DSLR file.)
  const thumbOf = (ci) => {
    if (!isInstagramReel(ci?.media_urls)) {
      const slides = Array.isArray(ci?.slides) ? ci.slides : []
      const cover = slides.find((s) => s?.rendered_url)?.rendered_url
      if (cover) return { url: cover, kind: 'image' }
    }
    const list = Array.isArray(ci?.media_urls) ? ci.media_urls : []
    for (const m of list) {
      if (!m) continue
      const isVideo = m.type === 'video' || m.kind === 'video'
      const src = isVideo ? m.thumbnailUrl : (m.thumbnailUrl || m.url)
      if (src) return { url: src, kind: isVideo ? 'video' : 'image', mediaAssetId: m.mediaAssetId || null }
    }
    return null
  }

  const shape = (a) => {
    const ci = a.content_piece_id ? itemStatusMap[a.content_piece_id] : null
    const thumb = thumbOf(ci)
    return {
      id: a.id,
      platform: a.platform,
      // A published post that lost its slot time (publish-now — see the filter
      // above) is placed on the board by its published_at, so it lands on the
      // real day/hour it went live instead of vanishing. The filter guarantees
      // this is non-null for every included atom (so the sort below is safe).
      scheduled_at: a.scheduled_at || (ci?.status === 'published' ? ci.published_at : null),
      thumbnailUrl: thumb?.url || null,
      mediaKind: thumb?.kind || null,
      // A real, actionable media gap: a drafted post on a platform that takes an
      // image/video, with nothing attached. Auto-attach fills most of these at
      // compose time; this flags the honest no-match remainder so the producer
      // knows to pick a photo rather than shipping bare text. Text-only
      // platforms (blog/landing/email) never flag — their hero is a different
      // concept. Only real drafts (not empty future slots) qualify.
      needsMedia: ci?.status === 'draft' && !thumb && !isTextOnlyPlatform(a.platform),
      // The thumbnail's asset id + reuse counter, so the board can show a
      // "used ×N" badge on the card without drawing it into the rendered
      // preview itself. mediaUsage is filled in below via a single batched
      // media_asset_usage lookup across the whole week (not per-card).
      mediaAssetId: thumb?.mediaAssetId || null,
      mediaUsage: null,
      label: a.angle_label,
      brief: a.brief,
      // Output format for the slot (migration 179). NULL on every pre-format
      // row, which means 'post' — normalized here so the client never has to
      // repeat the fallback.
      format: a.format || 'post',
      interviewTopic: a.interview?.topic || null,
      // Provenance for the review surfaces (Moments IA ①): the banked moment
      // this piece was composed from, when the atom carries one.
      moment: shapeMoment(a.moment),
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
  const heldShaped = heldAtoms.map(shape)

  // Batched reuse-counter lookup (media_asset_usage, migration 185) across
  // every card's thumbnail asset in one round trip — never per-card. Mirrors
  // MediaUsageBadge's { total, published } shape so the client can reuse that
  // same component. Best-effort: a failed lookup just leaves mediaUsage null,
  // same as an asset with no usage row.
  async function attachMediaUsage(items) {
    const ids = [...new Set(items.map((it) => it.mediaAssetId).filter((v) => UUID_RE.test(v || '')))]
    if (!ids.length) return
    const quoted = ids.map((v) => `"${v}"`).join(',')
    const r = await sb(
      `media_asset_usage?workspace_id=eq.${ws.id}&asset_id=in.(${quoted})&select=asset_id,use_count,published_count`,
    )
    if (!r.ok) { console.error('[week-summary] media usage lookup failed:', r.status); return }
    const rows = await r.json()
    const byId = new Map((Array.isArray(rows) ? rows : []).map((u) => [u.asset_id, { total: u.use_count || 0, published: u.published_count || 0 }]))
    for (const it of items) {
      if (it.mediaAssetId && byId.has(it.mediaAssetId)) it.mediaUsage = byId.get(it.mediaAssetId)
    }
  }
  try {
    await attachMediaUsage([...scheduledShaped, ...heldShaped])
  } catch (e) {
    console.error('[week-summary] media usage lookup threw:', e?.message)
  }

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

  // T3: enrich each channel with its pinned posting slots (persisted, or a
  // computed default when a channel has none yet) so the client can diff
  // scheduled atoms against the full slot list and render true empty tiles —
  // not just what happened to get planned this week. Additive-only (existing
  // consumers of cadence[platform].target_per_week/.enabled are unaffected).
  const rawChannels = ws.cadence_policy?.channels || {}
  // Default is weekends-OPEN (feedback 2026-07-26); a workspace opts specific
  // days quiet via cadence_policy.quiet_days.
  const cadenceQuietDays = ws.cadence_policy?.quiet_days || []
  const cadenceWithSlots = mergeSlotsIntoCadence(rawChannels, rawChannels, cadenceQuietDays, ws.cadence_policy?.formats)

  return res.status(200).json({
    weekMonday,
    hasPlan: scheduled.length > 0,
    trustStage: ws.cadence_policy?.trust_stage || 'approve_all',
    cadence: Object.keys(rawChannels).length ? cadenceWithSlots : null,
    quietDays: cadenceQuietDays,
    timezone: ws.cadence_policy?.timezone || 'America/Los_Angeles',
    scheduledTotal: scheduled.length,
    byPlatform,
    scheduled: scheduledShaped,
    predraftSummary,
    heldCount: heldAtoms.length,
    held: heldShaped,
    digest: digest ? { label: digest.label, frequency: digest.frequency, next_send: digest.next_send || null } : null,
    yourReview,
    approvedBlogs,
    myBlogTarget,
  })
}
