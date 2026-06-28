// GET /api/cron/detect-supersessions
//
// Weekly cron: for each active workspace, scan recently-added practice-memory
// chunks for same-clinician OLDER high-similarity pairs and run the validated
// conflict judge. Genuine "supersedes" verdicts become `pending` rows in
// practice_memory_supersessions for the clinician to confirm (only confirmed
// edges suppress retrieval). Quiet by design on a young corpus — fires as a
// clinician's thinking actually diverges over time.
//
// Auth: Bearer CRON_SECRET. Schedule: vercel.json ("0 5 * * 0" = Sun 05:00 UTC).
// Always 200 so a transient failure doesn't mark the deployment unhealthy.

export const config = { runtime: 'nodejs', maxDuration: 300 }

import { detectSupersessions } from '../../_lib/supersessionDetect.js'
import { verifyCronSecret } from '../../_lib/auth.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// eslint-disable-next-line bernard/require-workspace-scope -- Cron iterates all workspaces; detectSupersessions scopes every query by workspace_id
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
  if (!verifyCronSecret(req)) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const wsRes = await sb('workspaces?status=eq.active&select=id,slug')
    if (!wsRes.ok) throw new Error(`workspaces fetch ${wsRes.status}`)
    const workspaces = await wsRes.json()

    const totals = { workspaces: workspaces.length, checked: 0, judged: 0, candidates: 0 }
    for (const ws of workspaces) {
      const r = await detectSupersessions({ workspaceId: ws.id })
      totals.checked += r.checked || 0
      totals.judged += r.judged || 0
      totals.candidates += r.candidates || 0
      if (r.candidates) console.info(`[cron/detect-supersessions] ${ws.slug}: ${r.candidates} candidate(s) from ${r.judged} judged`)
    }
    return res.status(200).json(totals)
  } catch (e) {
    console.error('[cron/detect-supersessions] threw:', e?.message)
    return res.status(200).json({ error: 'detect_failed', checked: 0, candidates: 0 })
  }
}
