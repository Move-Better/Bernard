import { withSentry } from '../../_lib/sentry.js'
// maxDuration 800, not 300: a SINGLE 4K reel render measured >300s on Fluid in
// prod (2026-08-11 manual trigger — one claimed segment, 308 MB 3840x2160
// source, died at the wall with MAX_PER_RUN already 1).
//
// THIS LINE ALONE IS NOT ENOUGH. Vercel projects have a SEPARATE, PROJECT-WIDE
// ceiling (`defaultResourceConfig.functionDefaultTimeout`, set in the dashboard
// under Settings → Functions → Function Max Duration) that a route's own
// `maxDuration` can never exceed — only ever undercut. Shipping 800 here first
// deployed clean and still 504'd at exactly 300s in prod, with no warning
// anywhere in the build or deploy output: the project ceiling silently clamped
// it. Confirmed via the Vercel API (`GET /v13/deployments/:id` →
// `config.functionTimeout`), then raised via `PATCH /v9/projects/:id` with
// `{"resourceConfig":{"functionDefaultTimeout":800}}` — Q approved 2026-08-11,
// since it's a project-wide setting affecting every function, not scoped to
// this route. A straight redeploy/alias-promote of the already-built
// deployment does NOT pick up a raised ceiling; it needs a fresh BUILD
// (confirmed: the new deployment's own `config.functionTimeout` read the
// raised value only after a forced rebuild).
//
// If this route (or any other) 504s at exactly 300s again despite its own
// `maxDuration` reading higher: don't re-edit this number. Check
// `GET /v13/deployments/:id` → `config.functionTimeout` on the LIVE
// deployment first — that is the actual enforced value, and this comment is
// not proof of it.
//
// The real fix that makes this headroom stop mattering is the per-asset
// render intermediate (2026-08-10 decisions entry) — it caps render cost at
// the resolution we output, not the resolution we film.
export const config = { runtime: 'nodejs', maxDuration: 800 }
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

// This cron runs hourly, and a footage shortfall persists until someone films
// something — so without this guard the ask would be re-recorded 24x a day and
// the workday ledger would become unreadable. One ask per day is a reminder;
// twenty-four is nagging.
const ASK_COOLDOWN_MS = 20 * 60 * 60 * 1000

async function askedRecently(wsId) {
  try {
    const since = new Date(Date.now() - ASK_COOLDOWN_MS).toISOString()
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/agent_actions?workspace_id=eq.${wsId}` +
        `&kind=eq.footage_needed&created_at=gte.${since}&select=id&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
    )
    if (!r.ok) {
      // can't tell → stay quiet rather than risk spamming, but LOG it — this
      // branch fails open forever with zero trace otherwise, and "the ask
      // never fires" then reads identically to "there was never a shortfall."
      console.error(`[cron/auto-reel-week] ${wsId} askedRecently check failed: ${r.status}`)
      return true
    }
    return ((await r.json().catch(() => [])) || []).length > 0
  } catch (e) {
    console.error(`[cron/auto-reel-week] ${wsId} askedRecently threw:`, e?.message)
    return true
  }
}

// What to actually ask someone to film. An ask of "record more videos" is easy
// to ignore; "film 30 seconds on plantar fasciitis" is a task. The open topic
// backlog is already the workspace's own list of what it wants to say and
// hasn't, so it is the honest source — no invented topics.
// Returns [] when the backlog is empty; the ask then degrades to the generic
// "more footage" form rather than making something up.
async function suggestFootageTopics(wsId, limit = 3) {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/topic_backlog?workspace_id=eq.${wsId}&status=eq.open` +
        `&select=topic,rationale,priority&order=priority.desc,created_at.asc&limit=${limit}`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
    )
    if (!r.ok) return []
    const rows = (await r.json().catch(() => [])) || []
    return rows
      .map((t) => ({ topic: String(t.topic || '').trim(), why: String(t.rationale || '').trim().slice(0, 140) }))
      .filter((t) => t.topic)
  } catch (e) {
    console.error('[cron/auto-reel-week] topic suggest failed:', e?.message)
    return []
  }
}

async function handler(req, res) {
  if (!verifyCronSecret(req)) return res.status(401).json({ error: 'Unauthorized' })
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(503).json({ error: 'Supabase env not configured' })

  // Only workspaces with the video pipeline on can have reels at all.
  const wsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/workspaces?status=eq.active&video_pipeline_enabled=is.true` +
      // select=* deliberately: the render path (renderVideoChannel + generateCaption)
      // consumes the same broad workspace shape workspaceContext() hands the manual
      // path, so an explicit column list here is a standing trap — one wrong or
      // newly-required name and PostgREST 400s the whole query. It did exactly
      // that: `name` does not exist on workspaces (it is display_name/app_name),
      // so this cron returned 500 'workspace fetch failed' on every run from the
      // moment it shipped and never rendered anything. 7 rows, once an hour.
      `&select=*`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
  )
  if (!wsRes.ok) return res.status(500).json({ error: 'workspace fetch failed' })
  const workspaces = await wsRes.json().catch(() => [])

  const summary = []
  for (const ws of workspaces) {
    const weekMonday = mondayOf(new Date().toISOString(), ws.cadence_policy?.timezone)
    try {
      const stats = await fillReelSlots({ ws, weekMonday })
      const entry = { slug: ws.slug, ...stats }

      // Workday ledger — narrate only real work, never a quiet no-op tick.
      if (stats.rendered > 0) {
        const r = await recordAgentAction({
          workspaceId: ws.id,
          producerConfig: ws.producer_config,
          kind: 'reels_drafted',
          title: `Cut ${stats.rendered} Reel${stats.rendered === 1 ? '' : 's'} from your videos — ready for your approval`,
          detail: { ...stats, weekMonday },
        })
        if (!r.ok) console.error(`[cron/auto-reel-week] ${ws.slug} reels_drafted ledger skipped: ${r.skipped || r.status || r.error}`)
      }

      // The footage-ask. A shortfall means the week WANTS reels and the clip
      // library cannot supply them — the one gap Bernard genuinely cannot close
      // on its own, because it needs someone to point a camera at themselves.
      // Recorded (deduped per week) so /week can turn it into a concrete "film
      // this" ask rather than silently under-filling the week.
      //
      // recordAgentAction() no-ops for a workspace that hasn't hired the
      // Standing Producer (producer_config.enabled) — by design, since /week's
      // "needs you" surface is itself producer-gated, so an ask nobody's
      // producer view will ever show is not worth writing. But a REAL shortfall
      // getting silently dropped there looked, from the outside, identical to
      // "the whole mechanism is broken" — this is the exact silent-failure this
      // cron burned a day debugging (2026-08-11: agent_actions had zero
      // footage_needed rows ever, including runs that reported shortfall:1 for
      // 4 workspaces — all 4 turned out to have never enabled the producer).
      // `entry.footageAsk` makes that outcome visible in the cron's own JSON
      // response instead of requiring a fresh SQL investigation every time.
      if (stats.shortfall > 0) {
        if (await askedRecently(ws.id)) {
          entry.footageAsk = 'skipped_recent'
        } else {
          const topics = await suggestFootageTopics(ws.id)
          const r = await recordAgentAction({
            workspaceId: ws.id,
            producerConfig: ws.producer_config,
            kind: 'footage_needed',
            title: `Need ${stats.shortfall} more short video${stats.shortfall === 1 ? '' : 's'} to fill this week's Reels`,
            detail: { ...stats, weekMonday, topics },
          })
          entry.footageAsk = r.ok ? 'recorded' : `skipped_${r.skipped || r.status || 'error'}`
          if (!r.ok) console.error(`[cron/auto-reel-week] ${ws.slug} footage_needed ledger skipped: ${r.skipped || r.status || r.error}`)
        }
      }

      summary.push(entry)
    } catch (e) {
      console.error(`[cron/auto-reel-week] ${ws.slug} threw: ${e?.message}\n${e?.stack || ''}`)
      summary.push({ slug: ws.slug, error: 'failed' })
    }
  }

  return res.status(200).json({ ok: true, workspaces: summary.length, summary })
}

export default withSentry(handler)
