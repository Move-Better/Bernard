// GET /api/cron/sweep-stuck-seminars  (Vercel cron, every 5 minutes)
//
// Safety-net for the Seminar / Talk transcription lane. The happy path flips
// interviews.transcribe_status 'processing' → 'ready'/'failed' inside a single
// 300s worker (a 2-hour talk finishes well within one budget). But a Vercel
// SIGKILL at the 300s wall — or a hung OpenAI call before the AbortSignal lands
// — does NOT run the worker's catch/finally, so the row can strand at
// 'processing' forever with no terminal write and the UI polls until its hard
// cap, leaving the user no retry.
//
// This sweep flips any row stuck at 'processing' for longer than a healthy job
// could possibly take to 'failed', so the UI surfaces a retry. The write is
// guarded on transcribe_status=eq.processing (the cooperative-cancel pattern):
// a row that finished between the candidate scan and the write no longer
// matches, so we never clobber a 'ready'/'failed' row back to 'failed'.
//
// Auth: Bearer CRON_SECRET (same as the other cron handlers).

export const config = { runtime: 'nodejs' }
import { verifyCronSecret } from '../../_lib/auth.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// A healthy worker resolves in <300s; transcribe_status is only ever set on
// seminar rows. 20 min is a generous ceiling that a real job never reaches, so
// only genuinely-stranded rows are swept.
const STUCK_THRESHOLD_MS = 20 * 60 * 1000

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
    console.error('[sweep-stuck-seminars] workspace fetch failed:', wsRes.status)
    return res.status(500).json({ error: 'workspace_fetch_failed' })
  }
  const workspaces = await wsRes.json().catch(() => [])
  const activeIds = (Array.isArray(workspaces) ? workspaces : []).map(w => w.id)
  if (!activeIds.length) return res.status(200).json({ swept: 0, note: 'no_active_workspaces' })
  const wsFilter = `&workspace_id=in.(${activeIds.map(id => `"${id}"`).join(',')})`

  // Single guarded PATCH: every row still 'processing' whose updated_at predates
  // the cutoff flips to 'failed'. The updated_at filter is the staleness check
  // (the row's last write was its creation, since nothing touches it mid-job);
  // the transcribe_status filter is the cooperative guard. return=representation
  // gives us the swept rows so we can report the count.
  const r = await sb(
    `interviews?transcribe_status=eq.processing&updated_at=lt.${cutoff}${wsFilter}`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ transcribe_status: 'failed' }),
    }
  )
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    console.error('[sweep-stuck-seminars] sweep failed:', r.status, text)
    return res.status(500).json({ error: 'sweep_failed' })
  }
  const swept = await r.json().catch(() => [])
  const count = Array.isArray(swept) ? swept.length : 0
  if (count) console.warn(`[sweep-stuck-seminars] marked ${count} stuck seminar(s) failed`)

  return res.status(200).json({ swept: count })
}
