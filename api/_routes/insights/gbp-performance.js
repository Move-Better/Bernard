// Insights — Google Business Profile Performance.
//
// Returns 30-day daily metrics summed across ALL locations in the workspace's
// connected GBP account:
//   totals      — aggregated impressions (map + search), direction requests,
//                 call clicks, website clicks across every location.
//   dailySeries — day-by-day breakdown for the sparkline/chart (summed).
//   locations[] — [{name, title}] for each location (for display labels).
//
// Returns { connected: false } when GBP Analytics isn't configured.
export const config = { runtime: 'nodejs' }

import { workspaceContext }      from '../../_lib/workspaceContext.js'
import { requireRole }           from '../../_lib/auth.js'
import { enforceLimit }          from '../../_lib/ratelimit.js'
import { decryptSecret }         from '../../_lib/credentialCrypto.js'
import { refreshGbpToken }       from '../../_lib/gbpAuth.js'
import { fetchLocationMetrics }  from '../../_lib/gbpClient.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const DAYS = 30

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
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  if (!(await enforceLimit(req, res, 'insights-gbp-performance'))) return

  if (!ws.gbp_location_name) return res.status(200).json({ connected: false })

  const credRes = await sb(
    `workspace_credentials?workspace_id=eq.${ws.id}&service=eq.gbp_analytics&status=eq.active&select=secret_ciphertext,config&limit=1`
  )
  if (!credRes.ok) return res.status(200).json({ connected: false, error: 'credential_fetch_failed' })
  const creds = await credRes.json().catch(() => [])
  const row   = creds?.[0]
  if (!row?.secret_ciphertext) return res.status(200).json({ connected: false })

  let refreshToken
  try {
    refreshToken = decryptSecret(row.secret_ciphertext)
  } catch {
    return res.status(200).json({ connected: false, error: 'credential_decrypt_failed' })
  }

  let accessToken
  try {
    accessToken = await refreshGbpToken(refreshToken)
  } catch (_e) {
    return res.status(200).json({ connected: true, error: 'token_refresh_failed'})
  }

  // Build the list of locations to fetch — use config.locations[] when present
  // (multi-location, stored after the gbpAuth update), fall back to the single
  // location_name on older credentials.
  const locationList = Array.isArray(row.config?.locations) && row.config.locations.length
    ? row.config.locations
    : [{ location_name: ws.gbp_location_name, location_title: row.config?.location_title || null }]

  let results
  try {
    results = await Promise.all(
      locationList.map((loc) => fetchLocationMetrics(accessToken, loc.location_name, DAYS))
    )
  } catch (e) {
    console.error('[insights/gbp-performance]', e?.message)
    return res.status(200).json({ connected: true, error: 'gbp_fetch_failed'})
  }

  // Merge daily series across locations by summing numeric fields per date
  const numericFields = ['impressions', 'mapImpressions', 'searchImpressions', 'directionRequests', 'callClicks', 'websiteClicks']
  const dayMap = {}
  for (const { dailySeries } of results) {
    for (const entry of dailySeries) {
      if (!dayMap[entry.date]) dayMap[entry.date] = { date: entry.date, impressions: 0, mapImpressions: 0, searchImpressions: 0, directionRequests: 0, callClicks: 0, websiteClicks: 0 }
      for (const f of numericFields) dayMap[entry.date][f] += entry[f] || 0
    }
  }
  const dailySeries = Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date))

  const totals = { impressions: 0, mapImpressions: 0, searchImpressions: 0, directionRequests: 0, callClicks: 0, websiteClicks: 0 }
  for (const entry of dailySeries) {
    for (const f of numericFields) totals[f] += entry[f]
  }

  // Per-location totals for the breakdown view
  const locations = locationList.map((loc, i) => {
    const locTotals = { impressions: 0, mapImpressions: 0, searchImpressions: 0, directionRequests: 0, callClicks: 0, websiteClicks: 0 }
    for (const entry of (results[i]?.dailySeries || [])) {
      for (const f of numericFields) locTotals[f] += entry[f] || 0
    }
    return { name: loc.location_name, title: loc.location_title || null, totals: locTotals }
  })

  return res.status(200).json({
    connected: true,
    locations,
    email:       row.config?.account_email || null,
    days:        DAYS,
    totals,
    dailySeries,
  })
}
