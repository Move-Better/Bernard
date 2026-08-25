// GET /api/cron/sweep-stuck-clip-exports  (Vercel cron, every 5 minutes)
//
// Safety-net for the two async clip-render lanes, both of which mark a row
// 'rendering' up front and flip it terminal inside a worker's waitUntil:
//   • media_assets.render_status — the "Save to Library" b-roll export
//     (export-clip-worker → runExportRender).
//   • clip_render_jobs.status    — the embedded reel bake
//     (render-clip-job-worker → runReelRender).
// A Vercel SIGKILL at the 300s wall runs no code — the catch never fires — so a
// row of either kind can strand at 'rendering' forever: the b-roll case shows an
// eternal "Rendering…" tile in the Library; the reel-bake case leaves the
// editor's commit poll hanging until its own 6-min cap.
//
// This sweep flips any row stuck at 'rendering' for longer than a healthy render
// could possibly take to 'failed' — the same terminal state each worker's catch
// writes — so the Library tile settles / the poll resolves and the user can
// retry. Each write is guarded on status=eq.rendering (cooperative-cancel
// pattern): a row that completed between cron fire and the write no longer
// matches, so we never clobber a settled row.
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

  // Guarded PATCH #1 (b-roll export): every media_assets row still 'rendering'
  // whose updated_at predates the cutoff flips to 'failed'. return=representation
  // gives us the swept rows so we can report the count.
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

  // Guarded PATCH #2 (embedded reel bake): same shape against clip_render_jobs.
  // The status vocab and error column differ (status/error vs render_status/
  // render_error), so it's a sibling PATCH, not the same one.
  const jr = await sb(
    `clip_render_jobs?status=eq.rendering&updated_at=lt.${cutoff}${wsFilter}`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ status: 'failed', error: 'render_timeout' }),
    },
  )
  if (!jr.ok) {
    const text = await jr.text().catch(() => '')
    console.error('[sweep-stuck-clip-exports] reel-job sweep failed:', jr.status, text)
    return res.status(500).json({ error: 'reel_job_sweep_failed' })
  }
  const sweptJobs = await jr.json().catch(() => [])
  const jobCount = Array.isArray(sweptJobs) ? sweptJobs.length : 0
  if (jobCount) console.warn(`[sweep-stuck-clip-exports] failed ${jobCount} stuck reel render job(s)`)

  return res.status(200).json({ swept: count, sweptReelJobs: jobCount })
}
