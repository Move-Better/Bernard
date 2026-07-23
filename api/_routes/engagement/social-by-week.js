import { withSentry } from '../../_lib/sentry.js'
export const config = { runtime: 'nodejs' }
// GET /api/engagement/social-by-week?granularity=week&periodOffset=0 —
// per-platform social reach/engagement for a single week/month/year period,
// for the Insights page's Social Media tab + period picker.
//
// granularity+periodOffset mirror website-by-week.js's convention (0 = this
// period, negative = past) so the two tabs compute the same boundaries for
// the same selection. Only past/current periods make sense for a read of
// what already happened — clamped in periodMath.js.

import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole } from '../../_lib/auth.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { scoreSnapshot } from '../../_lib/engagementScoring.js'
import { periodBounds, prevPeriodBounds, toDateStr } from '../../_lib/periodMath.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// Platforms shown on the Social Media tab — everything bundle.social/Buffer
// can post to, excluding GBP (its own tab) and website-ish platforms (blog,
// wordpress, email — the Website tab).
const SOCIAL_PLATFORMS = new Set([
  'instagram', 'instagram_story', 'facebook', 'linkedin', 'tiktok',
  'youtube_short', 'youtube', 'twitter', 'threads', 'bluesky', 'mastodon',
])

// bundle.social's real per-platform numbers (Views/Impressions, Likes,
// Comments, Shares, Saves) — same fields BufferMetricsRow shows on a single
// post. Returns null for non-bundle snapshots (Buffer's shape has no
// views/saves and shouldn't be summed as if it did).
function rawBundleMetrics(snap) {
  if (snap?.source !== 'bundle') return null
  const s = snap.stats?.statistics || {}
  const num = (v) => (typeof v === 'number' ? v : 0)
  return {
    impressions: num(s.impressions),
    views:       num(s.views),
    likes:       num(s.likes),
    comments:    num(s.comments),
    shares:      num(s.shares),
    saves:       num(s.saves),
  }
}

function sb(path) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  })
}

export default withSentry(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    const status = auth.reason === 'forbidden' ? 403 : 401
    return res.status(status).json({ error: auth.reason })
  }

  if (!(await enforceLimit(req, res, 'generic', ws.id))) return

  const { searchParams } = new URL(req.url, 'http://localhost')
  const { start: periodStart, end: periodEnd, granularity, offset: periodOffset } = periodBounds(
    searchParams.get('granularity'),
    searchParams.get('periodOffset') ?? '0',
  )
  const { start: prevStart, end: prevEnd } = prevPeriodBounds(granularity, periodOffset)

  // One items read spanning BOTH windows (prev directly precedes current), then
  // split — saves a round-trip and keeps the two windows' filters identical.
  const itemsRes = await sb(
    `content_items?workspace_id=eq.${ws.id}` +
    `&status=eq.published` +
    `&published_at=gte.${encodeURIComponent(prevStart.toISOString())}` +
    `&published_at=lt.${encodeURIComponent(periodEnd.toISOString())}` +
    `&select=id,topic,platform,published_at`
  )
  if (!itemsRes.ok) return res.status(500).json({ error: 'Database error' })
  const allItems = await itemsRes.json().catch(() => [])
  const social = (Array.isArray(allItems) ? allItems : []).filter((i) => SOCIAL_PLATFORMS.has(i.platform))
  const items = social.filter((i) => new Date(i.published_at) >= periodStart)
  const prevItems = social.filter((i) => new Date(i.published_at) < prevEnd)

  const emptyBody = {
    granularity,
    periodOffset,
    periodStart: toDateStr(periodStart),
    periodEnd: toDateStr(new Date(periodEnd.getTime() - 1)),
    overall: { posts: 0, reach: 0, engagement: 0 },
    byPlatform: [],
    topPost: null,
    prev: { posts: prevItems.length, measuredPosts: 0, reach: 0, engagement: 0 },
  }
  if (social.length === 0) return res.status(200).json(emptyBody)

  const idList = social.map((i) => `"${i.id}"`).join(',')
  const snapRes = await sb(
    `engagement_snapshots?workspace_id=eq.${ws.id}` +
    `&content_item_id=in.(${idList})` +
    `&order=fetched_at.desc` +
    `&select=content_item_id,source,stats`
  )
  if (!snapRes.ok) return res.status(500).json({ error: 'Database error' })
  const snapRows = await snapRes.json().catch(() => [])

  // Dedupe to the latest snapshot per content item (rows already ordered desc).
  const latestByItem = new Map()
  for (const row of Array.isArray(snapRows) ? snapRows : []) {
    if (!latestByItem.has(row.content_item_id)) latestByItem.set(row.content_item_id, row)
  }

  // Previous-period totals — same measured-only rules as the main loop below,
  // counts only (the UI's vs-previous delta chips).
  const prev = { posts: prevItems.length, measuredPosts: 0, reach: 0, engagement: 0 }
  for (const item of prevItems) {
    const snap = latestByItem.get(item.id)
    if (!snap || snap.stats?.unavailable === true) continue
    const { reach, engagement } = scoreSnapshot(snap)
    prev.measuredPosts++
    prev.reach += reach
    prev.engagement += engagement
  }

  if (items.length === 0) return res.status(200).json({ ...emptyBody, prev })

  const byPlatform = new Map()
  let overallPosts = 0
  let overallMeasured = 0
  let overallReach = 0
  let overallEngagement = 0
  let topPost = null

  for (const item of items) {
    overallPosts++
    const snap = latestByItem.get(item.id)
    // A sentinel snapshot with `unavailable:true` means the provider structurally
    // can't return analytics for this post (e.g. bundle.social + an IG carousel/
    // story). It is NOT a measured zero — treat it as "no data", so a phantom 0
    // never gets presented as a real reading. A post with no snapshot at all is
    // "pending" (not yet pulled). Only a real snapshot counts as measured.
    const isUnavailable = snap?.stats?.unavailable === true
    const measured = !!snap && !isUnavailable
    const { reach, engagement } = measured ? scoreSnapshot(snap) : { reach: 0, engagement: 0 }

    if (measured) {
      overallMeasured++
      overallReach += reach
      overallEngagement += engagement
    }

    const bucket = byPlatform.get(item.platform) || {
      platform: item.platform, posts: 0, measured: 0, unavailable: 0, reach: 0, engagement: 0,
      hasRaw: false, raw: { impressions: 0, views: 0, likes: 0, comments: 0, shares: 0, saves: 0 },
    }
    bucket.posts++
    if (measured) {
      bucket.measured++
      bucket.reach += reach
      bucket.engagement += engagement
      // bundle-sourced platforms get their own real numbers shown instead of
      // the reach/engagement composite (Q, 2026-07-22: "just display
      // everything we can get" — same reasoning as BufferMetricsRow).
      const raw = rawBundleMetrics(snap)
      if (raw) {
        bucket.hasRaw = true
        for (const k of Object.keys(bucket.raw)) bucket.raw[k] += raw[k]
      }
    } else if (isUnavailable) {
      bucket.unavailable++
    }
    byPlatform.set(item.platform, bucket)

    // Rank the top post only among measured posts — a "top post" with no real
    // reading is meaningless.
    if (measured && (!topPost || reach > topPost.reach)) {
      topPost = { id: item.id, topic: item.topic || 'Untitled', platform: item.platform, reach, engagement }
    }
  }

  // Per-platform status: measured (has a real reading, even if genuinely 0) >
  // unavailable (provider can't report it) > pending (published, not yet pulled).
  const platformRows = [...byPlatform.values()].map((b) => ({
    ...b,
    status: b.measured > 0 ? 'measured' : b.unavailable > 0 ? 'unavailable' : 'pending',
  }))
  const statusRank = { measured: 0, pending: 1, unavailable: 2 }
  platformRows.sort((a, b) => (statusRank[a.status] - statusRank[b.status]) || (b.reach - a.reach))

  return res.status(200).json({
    granularity,
    periodOffset,
    periodStart: toDateStr(periodStart),
    periodEnd: toDateStr(new Date(periodEnd.getTime() - 1)),
    overall: { posts: overallPosts, measuredPosts: overallMeasured, reach: overallReach, engagement: overallEngagement },
    byPlatform: platformRows,
    topPost,
    prev,
  })
})
