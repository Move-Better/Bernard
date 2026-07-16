// GET /api/insights/search-by-period?granularity=week&periodOffset=0 —
// Search Console clicks/impressions for a single week/month/year period,
// for the Insights page's SEO tab + shared period picker (same granularity/
// periodOffset contract as engagement/website-by-week.js and
// engagement/social-by-week.js).
//
// Separate from insights/search-queries.js, whose topQueries/gaps reads use
// a fixed rolling-28-day window unrelated to whatever period this picker
// shows.
//
// Returns { connected: false } when Search Console isn't configured.
export const config = { runtime: 'nodejs' }

import { workspaceContext }  from '../../_lib/workspaceContext.js'
import { requireRole }       from '../../_lib/auth.js'
import { enforceLimit }      from '../../_lib/ratelimit.js'
import { decryptSecret }     from '../../_lib/credentialCrypto.js'
import { fetchSearchTotals } from '../../_lib/searchConsole.js'
import { periodBounds, prevPeriodBounds, toDateStr } from '../../_lib/periodMath.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey:        SUPABASE_KEY,
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

  if (!(await enforceLimit(req, res, 'insights-search-queries', ws.id))) return

  const { searchParams } = new URL(req.url, 'http://localhost')
  const { start, end, granularity, offset: periodOffset } = periodBounds(
    searchParams.get('granularity'),
    searchParams.get('periodOffset') ?? '0',
  )
  const periodStartStr = toDateStr(start)
  // GSC's endDate is inclusive, so use the last day IN the period.
  const periodEndStr = toDateStr(new Date(end.getTime() - 1))

  const body = { granularity, periodOffset, periodStart: periodStartStr, periodEnd: periodEndStr }

  if (!ws.gsc_site_url) return res.status(200).json({ ...body, connected: false })

  const credRes = await sb(
    `workspace_credentials?workspace_id=eq.${ws.id}&service=eq.searchconsole&status=eq.active` +
    `&select=secret_ciphertext,config&limit=1`
  )
  if (!credRes.ok) return res.status(200).json({ ...body, connected: false, error: 'credential_fetch_failed' })
  const creds = await credRes.json().catch(() => [])
  const row   = creds?.[0]
  if (!row?.secret_ciphertext) return res.status(200).json({ ...body, connected: false })

  let secret
  try {
    secret = decryptSecret(row.secret_ciphertext)
  } catch {
    return res.status(200).json({ ...body, connected: false, error: 'credential_decrypt_failed' })
  }
  const credential = { secret, config: row.config || {} }

  // Previous period alongside the current one — vs-previous delta chips.
  // Prev is best-effort: its failure nulls the deltas, not the card.
  const { start: prevStart, end: prevEnd } = prevPeriodBounds(granularity, periodOffset)
  let totals
  let prevTotals = null
  try {
    ;[totals, prevTotals] = await Promise.all([
      fetchSearchTotals({ credential, siteUrl: ws.gsc_site_url, startDate: periodStartStr, endDate: periodEndStr }),
      fetchSearchTotals({
        credential, siteUrl: ws.gsc_site_url,
        startDate: toDateStr(prevStart), endDate: toDateStr(new Date(prevEnd.getTime() - 1)),
      }).catch((e) => {
        console.error('[insights/search-by-period] prev-period totals failed:', e?.message)
        return null
      }),
    ])
  } catch (e) {
    console.error('[insights/search-by-period]', e?.message)
    return res.status(200).json({ ...body, connected: true, error: 'gsc_fetch_failed' })
  }

  return res.status(200).json({
    ...body,
    connected: true,
    clicks: totals.clicks,
    impressions: totals.impressions,
    prev: prevTotals ? { clicks: prevTotals.clicks, impressions: prevTotals.impressions } : null,
  })
}
