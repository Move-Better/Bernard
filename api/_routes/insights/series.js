// GET /api/insights/series?source=social|website|search&granularity=week —
// the Insights trend strip's data: the last N periods (12 weeks / 12 months /
// 3 years, matching MAX_OFFSET) of one headline metric per source:
//   • social  — posts published + measured reach/engagement per period, from
//               content_items + each item's latest engagement snapshot (same
//               measured-only rules as social-by-week.js)
//   • website — property-wide GA4 sessions per period (one by-date report,
//               bucketed here)
//   • search  — GSC clicks/impressions per period (one by-date query,
//               bucketed here)
// The series is anchored to now (independent of the picker's offset), so the
// client caches it per granularity and only the by-period reads refetch as
// the user steps around.
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole } from '../../_lib/auth.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { scoreSnapshot } from '../../_lib/engagementScoring.js'
import { decryptSecret } from '../../_lib/credentialCrypto.js'
import { fetchGA4SessionsByDate } from '../../_lib/ga4.js'
import { fetchSearchTotalsByDate } from '../../_lib/searchConsole.js'
import { GRANULARITIES, prevPeriodBounds, periodBounds, toDateStr } from '../../_lib/periodMath.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const SOURCES = new Set(['social', 'website', 'search'])
const PERIODS = { week: 12, month: 12, year: 3 }

// Mirror of social-by-week.js's platform scope.
const SOCIAL_PLATFORMS = new Set([
  'instagram', 'instagram_story', 'facebook', 'linkedin', 'tiktok',
  'youtube_short', 'youtube', 'twitter', 'threads', 'bluesky', 'mastodon',
])

function sb(path) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  })
}

// The last N period windows, oldest first, each { start, end, offset }.
// Built by walking prevPeriodBounds back from the current period so the
// boundaries are byte-identical to what the by-period endpoints compute.
function periodWindows(granularity) {
  const n = PERIODS[granularity] || 12
  const windows = [periodBounds(granularity, 0)]
  while (windows.length < n) {
    const oldest = windows[0]
    windows.unshift(prevPeriodBounds(granularity, oldest.offset))
  }
  return windows
}

function bucketFor(windows, date) {
  const t = date.getTime()
  for (let i = 0; i < windows.length; i++) {
    if (t >= windows[i].start.getTime() && t < windows[i].end.getTime()) return i
  }
  return -1
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  if (!(await enforceLimit(req, res, 'generic', ws.id))) return

  const { searchParams } = new URL(req.url, 'http://localhost')
  const source = searchParams.get('source')
  if (!SOURCES.has(source)) return res.status(400).json({ error: 'invalid_source' })
  const granularity = GRANULARITIES.includes(searchParams.get('granularity'))
    ? searchParams.get('granularity') : 'week'

  const windows = periodWindows(granularity)
  const spanStart = windows[0].start
  const spanEnd = windows[windows.length - 1].end
  const spanStartStr = toDateStr(spanStart)
  const spanEndStr = toDateStr(new Date(spanEnd.getTime() - 1))

  const base = {
    source,
    granularity,
    series: windows.map((w) => ({ period_start: toDateStr(w.start), offset: w.offset })),
  }

  if (source === 'social') {
    const itemsRes = await sb(
      `content_items?workspace_id=eq.${ws.id}&status=eq.published` +
      `&published_at=gte.${encodeURIComponent(spanStart.toISOString())}` +
      `&published_at=lt.${encodeURIComponent(spanEnd.toISOString())}` +
      `&select=id,platform,published_at`
    )
    if (!itemsRes.ok) return res.status(500).json({ error: 'Database error' })
    const allItems = await itemsRes.json().catch(() => [])
    const items = (Array.isArray(allItems) ? allItems : []).filter((i) => SOCIAL_PLATFORMS.has(i.platform))

    for (const p of base.series) Object.assign(p, { posts: 0, measuredPosts: 0, reach: 0, engagement: 0 })

    if (items.length > 0) {
      const idList = items.map((i) => `"${i.id}"`).join(',')
      const snapRes = await sb(
        `engagement_snapshots?workspace_id=eq.${ws.id}` +
        `&content_item_id=in.(${idList})` +
        `&order=fetched_at.desc&select=content_item_id,source,stats`
      )
      const snapRows = snapRes.ok ? await snapRes.json().catch(() => []) : []
      const latestByItem = new Map()
      for (const row of Array.isArray(snapRows) ? snapRows : []) {
        if (!latestByItem.has(row.content_item_id)) latestByItem.set(row.content_item_id, row)
      }
      for (const item of items) {
        const idx = bucketFor(windows, new Date(item.published_at))
        if (idx < 0) continue
        const p = base.series[idx]
        p.posts++
        const snap = latestByItem.get(item.id)
        if (!snap || snap.stats?.unavailable === true) continue
        const { reach, engagement } = scoreSnapshot(snap)
        p.measuredPosts++
        p.reach += reach
        p.engagement += engagement
      }
    }
    return res.status(200).json(base)
  }

  // website + search both need a decrypted credential; both return
  // { connected: false } rather than erroring when unconfigured.
  const service = source === 'website' ? 'ga4' : 'searchconsole'
  if (source === 'website' && !ws.ga4_property_id) return res.status(200).json({ ...base, connected: false })
  if (source === 'search' && !ws.gsc_site_url) return res.status(200).json({ ...base, connected: false })

  const credRes = await sb(
    `workspace_credentials?workspace_id=eq.${ws.id}&service=eq.${service}&status=eq.active` +
    `&select=secret_ciphertext,config&limit=1`
  )
  if (!credRes.ok) return res.status(200).json({ ...base, connected: false, error: 'credential_fetch_failed' })
  const creds = await credRes.json().catch(() => [])
  const row = creds?.[0]
  if (!row?.secret_ciphertext) return res.status(200).json({ ...base, connected: false })

  let secret
  try {
    secret = decryptSecret(row.secret_ciphertext)
  } catch {
    return res.status(200).json({ ...base, connected: false, error: 'credential_decrypt_failed' })
  }

  if (source === 'website') {
    for (const p of base.series) p.sessions = 0
    try {
      const days = await fetchGA4SessionsByDate({
        serviceAccountJson: secret,
        propertyId: ws.ga4_property_id,
        startDate: spanStartStr,
        endDate: spanEndStr,
      })
      for (const d of days) {
        // GA4 returns YYYYMMDD.
        const iso = `${d.date.slice(0, 4)}-${d.date.slice(4, 6)}-${d.date.slice(6, 8)}`
        const idx = bucketFor(windows, new Date(`${iso}T00:00:00Z`))
        if (idx >= 0) base.series[idx].sessions += d.sessions
      }
    } catch (e) {
      console.error('[insights/series] ga4 by-date failed:', e?.message)
      return res.status(200).json({ ...base, connected: true, error: 'ga4_fetch_failed' })
    }
    return res.status(200).json({ ...base, connected: true })
  }

  // search
  for (const p of base.series) Object.assign(p, { clicks: 0, impressions: 0 })
  try {
    const days = await fetchSearchTotalsByDate({
      credential: { secret, config: row.config || {} },
      siteUrl: ws.gsc_site_url,
      startDate: spanStartStr,
      endDate: spanEndStr,
    })
    for (const d of days) {
      const idx = bucketFor(windows, new Date(`${d.date}T00:00:00Z`))
      if (idx >= 0) {
        base.series[idx].clicks += d.clicks
        base.series[idx].impressions += d.impressions
      }
    }
  } catch (e) {
    console.error('[insights/series] gsc by-date failed:', e?.message)
    return res.status(200).json({ ...base, connected: true, error: 'gsc_fetch_failed' })
  }
  return res.status(200).json({ ...base, connected: true })
}
