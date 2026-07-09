// GET /api/engagement/website-by-week?weekOffset=0 — GA4 pageviews across the
// workspace's published pages for a single UTC-Monday week, feeding the
// Insights page's Website tab + week picker (shares the same week math as
// social-by-week.js so Prev/Next moves both tabs in lockstep).
//
// Returns { connected: false } when GA4 isn't configured — same contract as
// website-ga4.js.
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole } from '../../_lib/auth.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { decryptSecret } from '../../_lib/credentialCrypto.js'
import { fetchGA4Metrics, urlToPagePath } from '../../_lib/ga4.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const WEEK_NAV_BACK = 8

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

// Mirrors YourWeek.jsx's weekMondayDate() / social-by-week.js's copy of it —
// same UTC-Monday convention so all three pages agree on what "week -1" means.
function weekMondayDate(offset) {
  const d = new Date()
  const dow = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - dow + offset * 7)
  d.setUTCHours(0, 0, 0, 0)
  return d
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  if (!(await enforceLimit(req, res, 'insights-website-ga4', ws.id))) return

  const { searchParams } = new URL(req.url, 'http://localhost')
  const rawOffset = Number.parseInt(searchParams.get('weekOffset') ?? '0', 10)
  const weekOffset = Number.isFinite(rawOffset) ? Math.max(-WEEK_NAV_BACK, Math.min(0, rawOffset)) : 0

  const weekStart = weekMondayDate(weekOffset)
  const weekEnd = new Date(weekStart)
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7)
  const weekStartStr = weekStart.toISOString().slice(0, 10)
  // GA4's endDate is inclusive, so use the last day IN the week, not the
  // (exclusive) start of the following week.
  const weekEndStr = new Date(weekEnd.getTime() - 1).toISOString().slice(0, 10)

  const body = { weekOffset, weekStart: weekStartStr, weekEnd: weekEndStr }

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

  const itemsRes = await sb(
    `content_items?workspace_id=eq.${ws.id}&status=eq.published&resolved_url=not.is.null` +
    `&select=resolved_url&order=published_at.desc.nullslast&limit=200`
  )
  const items = itemsRes.ok ? (await itemsRes.json().catch(() => [])) : []
  const pagePaths = [...new Set(items.map((i) => urlToPagePath(i.resolved_url)).filter(Boolean))]
  if (pagePaths.length === 0) return res.status(200).json({ ...body, connected: true, sessions: 0, engagedSessions: 0 })

  let metricsByPath
  try {
    metricsByPath = await fetchGA4Metrics({
      serviceAccountJson,
      propertyId: ws.ga4_property_id,
      pagePaths,
      startDate: weekStartStr,
      endDate: weekEndStr,
    })
  } catch (e) {
    console.error('[engagement/website-by-week]', e?.message)
    return res.status(200).json({ ...body, connected: true, error: 'ga4_fetch_failed' })
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
  })
}
