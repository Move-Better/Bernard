// GET /api/cron/recheck-live-answers
//
// Quarterly-cadence sweep: re-score LIVE public answers and send the drifted ones
// back to their author for review. An answer becomes eligible 90 days after the
// clinician last acted on it, so approving something never bounces straight back,
// and a flag they knowingly published over only returns if the score materially
// drops. See api/_lib/sweepDriftedAnswers.js for both rules.
//
// Runs weekly and takes a small slice each pass rather than the whole library at
// once: eligibility is per-answer (paced off each one's own publish date), so a
// weekly tick spreads the work and the LLM spend instead of stacking every
// re-score onto one day.
//
// Auth: Bearer CRON_SECRET. Schedule: vercel.json ("0 9 * * 1" = Mon 09:00 UTC).
// Always 200 so a transient failure doesn't mark the deployment unhealthy.

export const config = { runtime: 'nodejs', maxDuration: 300 }

import { sweepDriftedAnswers } from '../../_lib/sweepDriftedAnswers.js'
import { verifyCronSecret } from '../../_lib/auth.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// eslint-disable-next-line bernard/require-workspace-scope -- Cron iterates all workspaces; sweepDriftedAnswers scopes every query by workspace_id
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

  const totals = { workspaces: 0, checked: 0, requeued: 0, respected: 0, failed: 0 }
  try {
    const wsRes = await sb('workspaces?status=eq.active&select=id,slug,display_name,name')
    if (!wsRes.ok) throw new Error(`workspaces fetch ${wsRes.status}`)
    const workspaces = await wsRes.json()

    for (const ws of workspaces) {
      const r = await sweepDriftedAnswers(ws)
      totals.workspaces++
      totals.checked += r.checked
      totals.requeued += r.requeued
      totals.respected += r.respected
      totals.failed += r.failed
      if (r.requeued > 0) {
        console.info(`[recheck-live-answers] ${ws.slug}: re-queued ${r.requeued} drifted answer(s)`)
      }
    }
  } catch (e) {
    console.error('[recheck-live-answers] sweep failed:', e?.message)
  }

  return res.status(200).json({ ok: true, ...totals })
}
