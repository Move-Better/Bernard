// GET /api/cron/sweep-stuck-segment-renders  (Vercel cron, every 5 minutes)
//
// Safety-net for the Slate "Find clips" render lane. The happy path flips
// video_segments.status 'rendering' → 'rendered' (or back to 'proposed' on a
// caught failure) inside render-segments' waitUntil worker pool. But a Vercel
// SIGKILL at the 300s wall runs no code — the per-segment catch never fires —
// so rows can strand at 'rendering' forever. Stuck rows are invisible-but-
// blocking: render-segments skips status='rendering' on resubmit and ClipFinder
// shows a spinner with no retry.
//
// This sweep resets any row stuck at 'rendering' for longer than a healthy
// batch could possibly take back to 'proposed' — the same reset the caught-
// failure path performs — so the segment reappears in ClipFinder's proposed
// list and can be re-selected and re-rendered. The write is guarded on
// status=eq.rendering (the cooperative-cancel pattern): a row that finished
// between cron fire and the write no longer matches, so we never clobber a
// 'rendered' or user-edited row.
//
// Auth: Bearer CRON_SECRET (same as the other cron handlers).

export const config = { runtime: 'nodejs' }
import { verifyCronSecret } from '../../_lib/auth.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// A render batch marks all its segments 'rendering' up front and finishes (or
// dies) within the 300s function wall; a segment's updated_at is only bumped
// again at its terminal write. 10 min = 2× the wall, so an in-flight batch is
// never swept while only genuinely-stranded rows are.
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

  // Fetch active workspace IDs so the sweep is scoped to known tenants
  const wsRes = await sb('workspaces?status=eq.active&select=id')
  if (!wsRes.ok) {
    console.error('[sweep-stuck-segment-renders] workspace fetch failed:', wsRes.status)
    return res.status(500).json({ error: 'workspace_fetch_failed' })
  }
  const workspaces = await wsRes.json().catch(() => [])
  const activeIds = (Array.isArray(workspaces) ? workspaces : []).map(w => w.id)
  if (!activeIds.length) return res.status(200).json({ swept: 0, note: 'no_active_workspaces' })
  const wsFilter = `&workspace_id=in.(${activeIds.map(id => `"${id}"`).join(',')})`

  // Single guarded PATCH: every row still 'rendering' whose updated_at predates
  // the cutoff reverts to 'proposed' (updated_at auto-bumps via the migration
  // 105 trigger; the row's last write was the batch-start status flip, since a
  // healthy render only touches it again at completion). return=representation
  // gives us the swept rows so we can report the count.
  const r = await sb(
    `video_segments?status=eq.rendering&updated_at=lt.${cutoff}${wsFilter}`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ status: 'proposed' }),
    }
  )
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    console.error('[sweep-stuck-segment-renders] sweep failed:', r.status, text)
    return res.status(500).json({ error: 'sweep_failed' })
  }
  const swept = await r.json().catch(() => [])
  const count = Array.isArray(swept) ? swept.length : 0
  if (count) console.warn(`[sweep-stuck-segment-renders] reset ${count} stuck segment render(s) to proposed`)

  return res.status(200).json({ swept: count })
}
