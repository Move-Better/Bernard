// GET /api/engagement/website-by-week?granularity=week&periodOffset=0 — GA4
// pageviews across the workspace's published pages for a single week/month/
// year period, feeding the Insights page's Website tab + period picker
// (shares period math with social-by-week.js so Prev/Next moves both tabs
// in lockstep).
//
// Returns { connected: false } when GA4 isn't configured — same contract as
// website-ga4.js.
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole } from '../../_lib/auth.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { decryptSecret } from '../../_lib/credentialCrypto.js'
import { fetchGA4Metrics, fetchGA4OutboundClickCount, fetchGA4TotalSessions, urlToPagePath } from '../../_lib/ga4.js'
import { periodBounds, toDateStr } from '../../_lib/periodMath.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      ...init.headers,
    },
  })
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  if (!(await enforceLimit(req, res, 'insights-website-ga4', ws.id))) return

  const { searchParams } = new URL(req.url, 'http://localhost')
  const { start, end, granularity, offset: periodOffset } = periodBounds(
    searchParams.get('granularity'),
    searchParams.get('periodOffset') ?? '0',
  )
  const periodStartStr = toDateStr(start)
  // GA4's endDate is inclusive, so use the last day IN the period, not the
  // (exclusive) start of the following period.
  const periodEndStr = toDateStr(new Date(end.getTime() - 1))

  const body = { granularity, periodOffset, periodStart: periodStartStr, periodEnd: periodEndStr }

  if (!ws.ga4_property_id) return res.status(200).json({ ...body, connected: false })

  const credRes = await sb(
    `workspace_credentials?workspace_id=eq.${ws.id}&service=eq.ga4&status=eq.active` +
    `&select=secret_ciphertext&limit=1`
  )
  if (!credRes.ok) return res.status(200).json({ ...body, connected: false, error: 'credential_fetch_failed' })
  const creds = await credRes.json().catch(() => [])
  const ct = creds?.[0]?.secret_ciphertext
  if (!ct) return res.status(200).json({ ...body, connected: false })

  let serviceAccountJson
  try {
    serviceAccountJson = decryptSecret(ct)
  } catch {
    return res.status(200).json({ ...body, connected: false, error: 'credential_decrypt_failed' })
  }

  // "Book Now" clicks — GA4 Enhanced Measurement auto-tracks outbound clicks
  // to off-domain links, so a workspace with a booking widget on a different
  // domain (e.g. Jane App) gets this for free. Property-wide, so it doesn't
  // depend on the workspace having any published pages. Best-effort: a
  // failure here shouldn't block the sessions read below.
  let bookNowClicks = null
  if (ws.booking_url) {
    try {
      const bookingHost = new URL(ws.booking_url).hostname
      bookNowClicks = await fetchGA4OutboundClickCount({
        serviceAccountJson,
        propertyId: ws.ga4_property_id,
        domainContains: bookingHost,
        startDate: periodStartStr,
        endDate: periodEndStr,
      })
    } catch (e) {
      console.error('[engagement/website-by-week] book-now click count failed:', e?.message)
    }
  }

  // Property-wide total sessions — every page GA4 sees, not just our tracked
  // content_items (see fetchGA4Metrics below, which is scoped to pagePaths).
  // Best-effort, same reasoning as bookNowClicks above.
  let totalSessions = null
  try {
    totalSessions = await fetchGA4TotalSessions({
      serviceAccountJson,
      propertyId: ws.ga4_property_id,
      startDate: periodStartStr,
      endDate: periodEndStr,
    })
  } catch (e) {
    console.error('[engagement/website-by-week] total-sessions failed:', e?.message)
  }

  const itemsRes = await sb(
    `content_items?workspace_id=eq.${ws.id}&status=eq.published&resolved_url=not.is.null` +
    `&select=resolved_url&order=published_at.desc.nullslast&limit=200`
  )
  const items = itemsRes.ok ? (await itemsRes.json().catch(() => [])) : []
  const pagePaths = [...new Set(items.map((i) => urlToPagePath(i.resolved_url)).filter(Boolean))]
  if (pagePaths.length === 0) return res.status(200).json({ ...body, connected: true, sessions: 0, engagedSessions: 0, bookNowClicks, totalSessions })

  let metricsByPath
  try {
    metricsByPath = await fetchGA4Metrics({
      serviceAccountJson,
      propertyId: ws.ga4_property_id,
      pagePaths,
      startDate: periodStartStr,
      endDate: periodEndStr,
    })
  } catch (e) {
    console.error('[engagement/website-by-week]', e?.message)
    return res.status(200).json({ ...body, connected: true, error: 'ga4_fetch_failed', bookNowClicks, totalSessions })
  }

  let sessions = 0
  let engagedSessions = 0
  for (const m of Object.values(metricsByPath)) {
    sessions += m.pageviews
    engagedSessions += m.engaged_sessions
  }

  return res.status(200).json({
    ...body,
    connected: true,
    sessions,
    engagedSessions,
    engagementRate: sessions > 0 ? engagedSessions / sessions : null,
    bookNowClicks,
    totalSessions,
  })
}
