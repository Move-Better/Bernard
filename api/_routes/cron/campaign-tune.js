import { withSentry } from '../../_lib/sentry.js'
export const config = { runtime: 'nodejs' }
// GET /api/cron/campaign-tune
//
// Phase 7 outcome loop: daily cron that refreshes the AI tune state on every
// active campaign that is due for a re-evaluation.
//
// Tuning frequency:
//   • Event <= 7 days away → re-tune if ai_tuned_at is older than 6h
//   • Event > 7 days away  → re-tune if ai_tuned_at is older than 20h
//   • Event in the past    → skip
//
// Auth: Bearer CRON_SECRET (same pattern as refresh-engagement.js).

import { runCampaignSpin } from '../editorial/campaign-spin.js'
import { verifyCronSecret } from '../../_lib/auth.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// eslint-disable-next-line bernard/require-workspace-scope -- Cron — iterates all workspaces; each DB query is scoped by workspace_id from the workspace list
function sb(path) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  })
}

async function handler(req, res) {
    if (!verifyCronSecret(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(503).json({ error: 'Supabase env not configured' })
  }

  // Fetch workspaces that have at least one active campaign.
  const wsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/workspaces?status=eq.active&select=id,slug`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, signal: AbortSignal.timeout(15_000) },
  )
  if (!wsRes.ok) return res.status(500).json({ error: 'workspace fetch failed' })
  const workspaces = await wsRes.json().catch(() => [])

  const now = Date.now()
  let tunedTotal = 0
  let skippedTotal = 0
  const workspaceSummary = []

  for (const ws of workspaces) {
    // Fetch active campaigns for this workspace.
    const nowIso = encodeURIComponent(new Date().toISOString())
    const campsRes = await sb(
      `campaigns?workspace_id=eq.${encodeURIComponent(ws.id)}` +
      `&status=eq.active` +
      `&or=(start_at.is.null,start_at.lte.${nowIso})` +
      `&or=(end_at.is.null,end_at.gte.${nowIso})` +
      `&select=id,name,event_at,ai_tuned_at`,
    )
    if (!campsRes.ok) {
      workspaceSummary.push({ id: ws.id, slug: ws.slug, error: `campaigns fetch ${campsRes.status}` })
      continue
    }
    const campaigns = await campsRes.json().catch(() => [])
    if (!Array.isArray(campaigns) || campaigns.length === 0) {
      workspaceSummary.push({ id: ws.id, slug: ws.slug, campaigns: 0 })
      continue
    }

    let wsTuned = 0
    let wsSkipped = 0
    for (const c of campaigns) {
      // Skip campaigns where the event is already in the past.
      if (c.event_at && new Date(c.event_at).getTime() < now) {
        wsSkipped++
        continue
      }

      // Determine freshness threshold based on event proximity.
      const daysUntilEvent = c.event_at
        ? (new Date(c.event_at).getTime() - now) / (24 * 60 * 60 * 1000)
        : Infinity
      const thresholdHours = daysUntilEvent <= 7 ? 6 : 20
      const thresholdMs = thresholdHours * 60 * 60 * 1000

      if (c.ai_tuned_at) {
        const age = now - new Date(c.ai_tuned_at).getTime()
        if (age < thresholdMs) {
          wsSkipped++
          continue
        }
      }

      // Run the spin.
      try {
        await runCampaignSpin(c.id, ws.id)
        wsTuned++
      } catch (e) {
        console.error(`[campaign-tune] spin failed for campaign ${c.id}:`, e?.message)
      }
    }

    tunedTotal += wsTuned
    skippedTotal += wsSkipped
    workspaceSummary.push({
      id: ws.id, slug: ws.slug,
      campaigns: campaigns.length,
      tuned: wsTuned,
      skipped: wsSkipped,
    })
  }

  console.info(`[campaign-tune] tuned ${tunedTotal} campaigns across ${workspaces.length} workspaces (${skippedTotal} skipped as fresh/past)`)

  return res.status(200).json({
    startedAt: new Date().toISOString(),
    workspaces: workspaceSummary,
    tunedTotal,
    skippedTotal,
  })
}

export default withSentry(handler)
