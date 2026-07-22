import { withSentry } from '../../_lib/sentry.js'
export const config = { runtime: 'nodejs', maxDuration: 300 }
// GET /api/cron/auto-reel-week
//
// T2 (reel spine) — fill each workspace's open Reel slots for the current week
// from its own already-detected moments.
//
// The supply has been sitting there the whole time: on movebetter, 217 videos
// uploaded in 60 days produced 172 detected moments and 3 rendered clips. The
// karaoke engine, the moment scorer, and the voice-faithful captioner were all
// built and all ran; nothing connected them to the week's plan. This cron is
// that connection.
//
// It DELIBERATELY crosses the detection-only line held by auto-detect-clips.js
// ("automating the labor is fine; automating the judgment is the slop we don't
// build"). Q approved that on 2026-07-21, narrowly, for reels — because the
// approval gate stays exactly where it was: this cron produces DRAFTS. Every
// publish is still a human action, and the publish path is not in this cron's
// call graph at all.
//
// Idempotent by construction: fillReelSlots counts reel atoms that already
// exist for the week and treats the target as a ceiling, so re-running does
// nothing once the week is full.
//
// Schedule: hourly. Rendering is capped at MAX_PER_RUN per workspace per tick so
// a backlog fills in over a few ticks rather than racing the 300s function wall.
//
// Auth: Bearer CRON_SECRET.

import { fillReelSlots } from '../../_lib/reelFactory.js'
import { mondayOf } from '../../_lib/strategist.js'
import { recordAgentAction } from '../../_lib/agentActions.js'
import { verifyCronSecret } from '../../_lib/auth.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

async function handler(req, res) {
  if (!verifyCronSecret(req)) return res.status(401).json({ error: 'Unauthorized' })
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(503).json({ error: 'Supabase env not configured' })

  // Only workspaces with the video pipeline on can have reels at all.
  const wsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/workspaces?status=eq.active&video_pipeline_enabled=is.true` +
      `&select=id,slug,cadence_policy,enabled_outputs,video_pipeline_enabled,brand_style,brand_voice,name,producer_config`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
  )
  if (!wsRes.ok) return res.status(500).json({ error: 'workspace fetch failed' })
  const workspaces = await wsRes.json().catch(() => [])

  const summary = []
  for (const ws of workspaces) {
    const weekMonday = mondayOf(new Date().toISOString(), ws.cadence_policy?.timezone)
    try {
      const stats = await fillReelSlots({ ws, weekMonday })
      summary.push({ slug: ws.slug, ...stats })

      // Workday ledger — narrate only real work, never a quiet no-op tick.
      if (stats.rendered > 0) {
        await recordAgentAction({
          workspaceId: ws.id,
          producerConfig: ws.producer_config,
          kind: 'reels_drafted',
          title: `Cut ${stats.rendered} Reel${stats.rendered === 1 ? '' : 's'} from your videos — ready for your approval`,
          detail: { ...stats, weekMonday },
        })
      }
    } catch (e) {
      console.error(`[cron/auto-reel-week] ${ws.slug} threw: ${e?.message}\n${e?.stack || ''}`)
      summary.push({ slug: ws.slug, error: 'failed' })
    }
  }

  return res.status(200).json({ ok: true, workspaces: summary.length, summary })
}

export default withSentry(handler)
