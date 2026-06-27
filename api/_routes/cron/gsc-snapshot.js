import { withSentry } from '../../_lib/sentry.js'
export const config = { runtime: 'nodejs' }
// GET /api/cron/gsc-snapshot
//
// Weekly snapshot of Google Search Console query data into gsc_query_snapshots.
//
// The live Insights read (api/_routes/insights/search-queries.js) hits Search
// Console for the trailing 28 days and stores nothing — great for "right now",
// useless for trend. This cron is the history layer: once a week it writes one
// row per query per connected workspace. Decay detection (week-over-week
// position delta), cannibalization, and the post-publish ranking-delta loop all
// read from these rows. History accrues only from the first run forward; it
// cannot be backfilled, which is why the table + cron land ahead of the UI.
//
// Idempotent enough: re-running in the same week just appends another snapshot
// row (each row is timestamped) — readers always take the latest per (ws,query),
// so a duplicate run is harmless, not corrupting.
//
// Auth: Bearer CRON_SECRET (same pattern as refresh-engagement.js / weekly-plan.js).

import { decryptSecret }      from '../../_lib/credentialCrypto.js'
import { fetchSearchQueries } from '../../_lib/searchConsole.js'
import { verifyCronSecret } from '../../_lib/auth.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const WINDOW_DAYS  = 28
const ROW_LIMIT    = 200   // cap snapshot breadth per workspace per run

// eslint-disable-next-line bernard/require-workspace-scope -- Cron — iterates all workspaces; each query is scoped by workspace_id from the workspace list
function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    signal: AbortSignal.timeout(8_000),
    ...init,
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

async function getSearchConsoleCredential(workspaceId) {
  const r = await sb(
    `workspace_credentials?workspace_id=eq.${workspaceId}&service=eq.searchconsole&status=eq.active` +
    `&select=secret_ciphertext,config&order=created_at.desc&limit=1`
  )
  if (!r.ok) return null
  const rows = await r.json().catch(() => [])
  const row  = rows?.[0]
  if (!row?.secret_ciphertext) return null
  let secret
  try { secret = decryptSecret(row.secret_ciphertext) } catch { return null }
  return { secret, config: row.config || {} }
}

async function processWorkspace(ws, summary) {
  if (!ws.gsc_site_url) {
    summary.workspaces.push({ id: ws.id, slug: ws.slug, skipped: 'no-gsc-site-url' })
    return
  }
  const credential = await getSearchConsoleCredential(ws.id)
  if (!credential) {
    summary.workspaces.push({ id: ws.id, slug: ws.slug, skipped: 'no-searchconsole-credential' })
    return
  }

  let queries
  try {
    queries = await fetchSearchQueries({
      credential,
      siteUrl:  ws.gsc_site_url,
      days:     WINDOW_DAYS,
      rowLimit: ROW_LIMIT,
    })
  } catch (e) {
    console.error('[cron/gsc-snapshot]', ws.slug, e?.message)
    summary.workspaces.push({ id: ws.id, slug: ws.slug, error: 'gsc_fetch_failed' })
    return
  }

  if (!Array.isArray(queries) || queries.length === 0) {
    summary.workspaces.push({ id: ws.id, slug: ws.slug, rows: 0 })
    return
  }

  // Single bulk insert — one row per query for this run.
  const rows = queries.map((q) => ({
    workspace_id: ws.id,
    query:        q.query,
    clicks:       Math.round(q.clicks || 0),
    impressions:  Math.round(q.impressions || 0),
    ctr:          q.ctr || 0,
    position:     q.position || 0,
    window_days:  WINDOW_DAYS,
  }))

  const ins = await sb('gsc_query_snapshots', {
    method:  'POST',
    headers: { Prefer: 'return=minimal' },
    body:    JSON.stringify(rows),
  })
  if (!ins.ok) {
    const text = await ins.text().catch(() => '')
    console.error('[cron/gsc-snapshot] insert failed', ws.slug, ins.status, text.slice(0, 200))
    summary.workspaces.push({ id: ws.id, slug: ws.slug, error: `insert_${ins.status}` })
    return
  }
  summary.workspaces.push({ id: ws.id, slug: ws.slug, rows: rows.length })
}

async function handler(req, res) {
    if (!verifyCronSecret(req)) return res.status(401).json({ error: 'Unauthorized' })
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(503).json({ error: 'Supabase env not configured' })

  const wsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/workspaces?status=eq.active&gsc_site_url=not.is.null&select=id,slug,gsc_site_url`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, signal: AbortSignal.timeout(15_000) }
  )
  if (!wsRes.ok) return res.status(500).json({ error: 'workspace fetch failed' })
  const workspaces = await wsRes.json().catch(() => [])

  const summary = { startedAt: new Date().toISOString(), workspaces: [] }
  for (const ws of workspaces) {
    try {
      await processWorkspace(ws, summary)
    } catch (e) {
      console.error('[cron/gsc-snapshot] workspace threw:', e?.message)
      summary.workspaces.push({ id: ws.id, slug: ws.slug, error: 'workspace_error' })
    }
  }
  summary.finishedAt = new Date().toISOString()
  return res.status(200).json(summary)
}

export default withSentry(handler)
