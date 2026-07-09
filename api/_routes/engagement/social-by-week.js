import { withSentry } from '../../_lib/sentry.js'
export const config = { runtime: 'nodejs' }
// GET /api/engagement/social-by-week?weekOffset=0 — per-platform social
// reach/engagement for a single UTC-Monday week, for the Insights page's
// Social Media tab + week picker.
//
// weekOffset mirrors YourWeek.jsx's convention (0 = this week, negative =
// past weeks) so the two pages compute the same Monday for the same offset.
// Only past/current weeks make sense for a read of what already happened —
// clamped to [-WEEK_NAV_BACK, 0].

import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole } from '../../_lib/auth.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { scoreSnapshot } from '../../_lib/engagementScoring.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const WEEK_NAV_BACK = 8

// Platforms shown on the Social Media tab — everything bundle.social/Buffer
// can post to, excluding GBP (its own tab) and website-ish platforms (blog,
// wordpress, email — the Website tab).
const SOCIAL_PLATFORMS = new Set([
  'instagram', 'instagram_story', 'facebook', 'linkedin', 'tiktok',
  'youtube_short', 'youtube', 'twitter', 'threads', 'bluesky', 'mastodon',
])

function sb(path) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  })
}

// UTC-Monday week math — mirrors YourWeek.jsx's weekMondayDate() exactly so
// "week -1" means the same calendar week on both pages.
function weekMondayDate(offset) {
  const d = new Date()
  const dow = (d.getUTCDay() + 6) % 7 // 0 = Monday
  d.setUTCDate(d.getUTCDate() - dow + offset * 7)
  d.setUTCHours(0, 0, 0, 0)
  return d
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
  const rawOffset = Number.parseInt(searchParams.get('weekOffset') ?? '0', 10)
  const weekOffset = Number.isFinite(rawOffset) ? Math.max(-WEEK_NAV_BACK, Math.min(0, rawOffset)) : 0

  const weekStart = weekMondayDate(weekOffset)
  const weekEnd = new Date(weekStart)
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7)

  const itemsRes = await sb(
    `content_items?workspace_id=eq.${ws.id}` +
    `&status=eq.published` +
    `&published_at=gte.${encodeURIComponent(weekStart.toISOString())}` +
    `&published_at=lt.${encodeURIComponent(weekEnd.toISOString())}` +
    `&select=id,topic,platform`
  )
  if (!itemsRes.ok) return res.status(500).json({ error: 'Database error' })
  const allItems = await itemsRes.json().catch(() => [])
  const items = (Array.isArray(allItems) ? allItems : []).filter((i) => SOCIAL_PLATFORMS.has(i.platform))

  const emptyBody = {
    weekOffset,
    weekStart: weekStart.toISOString().slice(0, 10),
    weekEnd: new Date(weekEnd.getTime() - 1).toISOString().slice(0, 10),
    overall: { posts: 0, reach: 0, engagement: 0 },
    byPlatform: [],
    topPost: null,
  }
  if (items.length === 0) return res.status(200).json(emptyBody)

  const idList = items.map((i) => `"${i.id}"`).join(',')
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

  const byPlatform = new Map()
  let overallPosts = 0
  let overallReach = 0
  let overallEngagement = 0
  let topPost = null

  for (const item of items) {
    overallPosts++
    const snap = latestByItem.get(item.id)
    const { reach, engagement } = snap ? scoreSnapshot(snap) : { reach: 0, engagement: 0 }

    overallReach += reach
    overallEngagement += engagement

    const bucket = byPlatform.get(item.platform) || { platform: item.platform, posts: 0, reach: 0, engagement: 0 }
    bucket.posts++
    bucket.reach += reach
    bucket.engagement += engagement
    byPlatform.set(item.platform, bucket)

    if (!topPost || reach > topPost.reach) {
      topPost = { id: item.id, topic: item.topic || 'Untitled', platform: item.platform, reach, engagement }
    }
  }

  return res.status(200).json({
    weekOffset,
    weekStart: weekStart.toISOString().slice(0, 10),
    weekEnd: new Date(weekEnd.getTime() - 1).toISOString().slice(0, 10),
    overall: { posts: overallPosts, reach: overallReach, engagement: overallEngagement },
    byPlatform: [...byPlatform.values()].sort((a, b) => b.reach - a.reach),
    topPost,
  })
})
