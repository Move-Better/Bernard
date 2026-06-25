// Insights — Google Search Console query analysis.
//
// Returns two reads from the workspace's connected Search Console property:
//
//   topQueries  — queries ranked by impressions over the last 28 days. Tells
//                 the owner what people are already searching to find them.
//
//   gaps        — queries with meaningful impressions (>= GAP_MIN_IMPRESSIONS)
//                 but low position (not on page 1, position > 10) and low CTR.
//                 These are keywords where the site shows up in Google but
//                 doesn't rank well — worth writing or improving a post for.
//                 Each gap also gets a `hasPost` flag: whether an existing
//                 published post likely covers the topic (rough word overlap).
//
// Returns { connected: false } when Search Console isn't configured.
//
// Node runtime + Express-style (req, res).
export const config = { runtime: 'nodejs' }

import { workspaceContext }  from '../../_lib/workspaceContext.js'
import { requireRole }       from '../../_lib/auth.js'
import { enforceLimit }      from '../../_lib/ratelimit.js'
import { decryptSecret }     from '../../_lib/credentialCrypto.js'
import { fetchSearchQueries } from '../../_lib/searchConsole.js'

const SUPABASE_URL       = process.env.SUPABASE_URL
const SUPABASE_KEY       = process.env.SUPABASE_SERVICE_KEY
const GAP_MIN_IMPRESSIONS = 10   // ignore low-signal queries
const GAP_MIN_POSITION    = 10   // below this = not on page 1
const TOP_QUERIES         = 10
const TOP_GAPS            = 5

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

// Rough topic overlap: true when a query shares at least one meaningful word
// (>= 4 chars) with a published post topic. Fast, no model needed.
function queryMatchesTopic(query, topics) {
  const qWords = query.toLowerCase().split(/\W+/).filter((w) => w.length >= 4)
  if (qWords.length === 0) return false
  for (const topic of topics) {
    const tWords = new Set((topic || '').toLowerCase().split(/\W+/).filter((w) => w.length >= 4))
    if (qWords.some((w) => tWords.has(w))) return true
  }
  return false
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  if (!(await enforceLimit(req, res, 'insights-search-queries'))) return

  if (!ws.gsc_site_url) return res.status(200).json({ connected: false })

  const credRes = await sb(
    `workspace_credentials?workspace_id=eq.${ws.id}&service=eq.searchconsole&status=eq.active` +
    `&select=secret_ciphertext,config&limit=1`
  )
  if (!credRes.ok) return res.status(200).json({ connected: false, error: 'credential_fetch_failed' })
  const creds = await credRes.json().catch(() => [])
  const row   = creds?.[0]
  if (!row?.secret_ciphertext) return res.status(200).json({ connected: false })

  let secret
  try {
    secret = decryptSecret(row.secret_ciphertext)
  } catch {
    return res.status(200).json({ connected: false, error: 'credential_decrypt_failed' })
  }
  const credential = { secret, config: row.config || {} }

  // Pull published post topics for gap cross-reference.
  const topicsRes = await sb(
    `content_items?workspace_id=eq.${ws.id}&status=eq.published&topic=not.is.null` +
    `&select=topic&limit=200`
  )
  const topicRows  = topicsRes.ok ? (await topicsRes.json().catch(() => [])) : []
  const topics     = topicRows.map((r) => r.topic).filter(Boolean)

  let queries
  try {
    queries = await fetchSearchQueries({ credential, siteUrl: ws.gsc_site_url })
  } catch (e) {
    console.error('[insights/search-queries]', e?.message)
    return res.status(200).json({ connected: true, error: 'gsc_fetch_failed'})
  }

  const topQueries = queries.slice(0, TOP_QUERIES).map((q) => ({
    query:       q.query,
    clicks:      q.clicks,
    impressions: q.impressions,
    ctr:         q.ctr,
    position:    q.position,
  }))

  // Gaps: high-impression, page-2+ queries the site doesn't rank well for.
  const gaps = queries
    .filter((q) => q.impressions >= GAP_MIN_IMPRESSIONS && q.position > GAP_MIN_POSITION)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, TOP_GAPS)
    .map((q) => ({
      query:       q.query,
      impressions: q.impressions,
      position:    Math.round(q.position * 10) / 10,
      ctr:         q.ctr,
      hasPost:     queryMatchesTopic(q.query, topics),
    }))

  return res.status(200).json({ connected: true, topQueries, gaps })
}
