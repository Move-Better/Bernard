// Insights — Google Business Profile Performance.
//
// Returns 30-day daily metrics for the workspace's connected GBP location:
//   totals      — aggregated impressions (map + search), direction requests,
//                 call clicks, website clicks.
//   dailySeries — day-by-day breakdown for the sparkline/chart.
//   location    — title and resource name detected at OAuth connect time.
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
  } catch (e) {
    return res.status(200).json({ connected: true, error: 'token_refresh_failed', detail: e?.message })
  }

  let result
  try {
    result = await fetchLocationMetrics(accessToken, ws.gbp_location_name, DAYS)
  } catch (e) {
    console.error('[insights/gbp-performance]', e?.message)
    return res.status(200).json({ connected: true, error: 'gbp_fetch_failed', detail: e?.message?.slice(0, 300) })
  }

  return res.status(200).json({
    connected: true,
    location: {
      name:  ws.gbp_location_name,
      title: row.config?.location_title || null,
      email: row.config?.account_email  || null,
    },
    days:        DAYS,
    totals:      result.totals,
    dailySeries: result.dailySeries,
  })
}
