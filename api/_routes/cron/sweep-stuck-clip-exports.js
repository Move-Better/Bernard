// GET /api/cron/sweep-stuck-clip-exports  (Vercel cron, every 5 minutes)
//
// Safety-net for the async "Save to Library" clip-export lane. The happy path
// flips media_assets.render_status 'rendering' → 'ready' (or 'failed') inside
// export-clip-worker's waitUntil (runExportRender). But a Vercel SIGKILL at the
// 300s wall runs no code — the catch never fires — so a b-roll row can strand at
// 'rendering' forever, showing an eternal "Rendering…" tile in the Library that
// the client poll can never resolve.
//
// This sweep flips any row stuck at 'rendering' for longer than a healthy render
// could possibly take to 'failed' (+ render_error) — the same terminal state
// runExportRender's catch writes — so the Library tile settles and the user can
// retry. The write is guarded on render_status=eq.rendering (cooperative-cancel
// pattern): a row that completed between cron fire and the write no longer
// matches, so we never clobber a 'ready' row.
//
// Auth: Bearer CRON_SECRET (same as the other cron handlers).

export const config = { runtime: 'nodejs' }
import { verifyCronSecret } from '../../_lib/auth.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// A render marks the row 'rendering' up front and finishes (or dies) within the
// 300s function wall; render_status is only written again at the terminal flip,
// and updated_at auto-bumps with it. 10 min = 2× the wall, so an in-flight
// render is never swept while only genuinely-stranded rows are.
const STUCK_THRESHOLD_MS = 10 * 60 * 1000

// eslint-disable-next-line bernard/require-workspace-scope -- Cron — iterates all workspaces; each DB query is scoped by workspace_id from the workspace list
function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    signal: AbortSignal.timeout(8_000),
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
  if (!verifyCronSecret(req)) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(503).json({ error: 'Supabase env not configured' })
  }

  const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS).toISOString()

  // Fetch active workspace IDs so the sweep is scoped to known tenants.
  const wsRes = await sb('workspaces?status=eq.active&select=id')
  if (!wsRes.ok) {
    console.error('[sweep-stuck-clip-exports] workspace fetch failed:', wsRes.status)
    return res.status(500).json({ error: 'workspace_fetch_failed' })
  }
  const workspaces = await wsRes.json().catch(() => [])
  const activeIds = (Array.isArray(workspaces) ? workspaces : []).map((w) => w.id)
  if (!activeIds.length) return res.status(200).json({ swept: 0, note: 'no_active_workspaces' })
  const wsFilter = `&workspace_id=in.(${activeIds.map((id) => `"${id}"`).join(',')})`

  // Single guarded PATCH: every row still 'rendering' whose updated_at predates
  // the cutoff flips to 'failed'. return=representation gives us the swept rows
  // so we can report the count.
  const r = await sb(
    `media_assets?render_status=eq.rendering&updated_at=lt.${cutoff}${wsFilter}`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ render_status: 'failed', render_error: 'render_timeout' }),
    },
  )
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    console.error('[sweep-stuck-clip-exports] sweep failed:', r.status, text)
    return res.status(500).json({ error: 'sweep_failed' })
  }
  const swept = await r.json().catch(() => [])
  const count = Array.isArray(swept) ? swept.length : 0
  if (count) console.warn(`[sweep-stuck-clip-exports] failed ${count} stuck clip export(s)`)

  return res.status(200).json({ swept: count })
}
