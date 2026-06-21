import { withSentry } from '../../_lib/sentry.js'
export const config = { runtime: 'nodejs' }
// GET /api/cron/weekly-plan
//
// F2.1 Strategist — WEEKLY BACKSTOP. Re-plans the current week for every active
// workspace (the completion-trigger in db/interviews.js is the primary path;
// this catches anything the per-completion trigger missed, e.g. a failed run).
// Idempotent: replanWorkspaceWeek uses replace-untouched, so re-running is safe.
//
// Auth: Bearer CRON_SECRET (same pattern as campaign-tune.js / refresh-engagement.js).

import { replanWorkspaceWeek } from '../../_lib/strategistPlan.js'
import { mondayOf } from '../../_lib/strategist.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return res.status(503).json({ error: 'CRON_SECRET not configured' })
  const auth = req.headers?.authorization || req.headers?.Authorization
  if (auth !== `Bearer ${cronSecret}`) return res.status(401).json({ error: 'Unauthorized' })
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(503).json({ error: 'Supabase env not configured' })

  // Active workspaces + cadence_policy (the Strategist reads channels/quiet_days;
  // falls back to RECOMMENDED_CADENCE when the policy is absent).
  const wsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/workspaces?status=eq.active&select=id,slug,cadence_policy`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
  )
  if (!wsRes.ok) return res.status(500).json({ error: 'workspace fetch failed' })
  const workspaces = await wsRes.json().catch(() => [])

  const weekMonday = mondayOf(new Date().toISOString())
  const summary = []
  for (const ws of workspaces) {
    try {
      const stats = await replanWorkspaceWeek({ workspace: ws, weekMonday })
      summary.push({ slug: ws.slug, ...stats })
    } catch (e) {
      console.error(`[cron/weekly-plan] ${ws.slug} threw: ${e?.message}\n${e?.stack || ''}`)
      summary.push({ slug: ws.slug, error: e?.message || 'failed' })
    }
  }
  return res.status(200).json({ weekMonday, workspaces: workspaces.length, summary })
}

export default withSentry(handler)
