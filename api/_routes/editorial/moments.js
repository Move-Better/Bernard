// GET /api/editorial/moments
//
// Moment Miner feed: every PROPOSED video_segment across ALL source videos in
// the workspace, FLATTENED and RANKED by quotability score (strongest first) —
// the moment-first redesign of Moment Miner's per-video "Ready to review" rows.
//
// Self-healing: any proposed segment still missing a score (detected before the
// scoring pass shipped) is scored + classified inline on first load and
// persisted, so ratings appear without a separate backfill. New segments are
// pre-scored at detection time (segmentDetect.js).
//
// Returns { moments: [{ id, sourceAssetId, filename, thumbnailUrl, width, height,
//   staffName, startSec, endSec, durationSec, quote, excerpt, why, score,
//   momentType, momentTypeLabel }] } sorted by score desc.
//
// Auth: any workspace role.

export const config = { runtime: 'nodejs', maxDuration: 60 }

import { requireRole } from '../../_lib/auth.js'
import { ALL_KNOWN_ROLES } from '../../_lib/roles.js'
import { workspaceContext } from '../../_lib/workspaceContext.js'
import { scoreSegments, MOMENT_TYPE_LABELS } from '../../_lib/scoreMoments.js'
import { blendMomentScore } from '../../_lib/scoreMomentsVisual.js'
import { enforceLimit } from '../../_lib/ratelimit.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

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

function inList(ids) {
  // PostgREST in.() — UUIDs are safe bare; de-dup + drop falsy.
  const deduped = [...new Set(ids.filter(Boolean))]
  if (!deduped.length) return null
  return `(${deduped.join(',')})`
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(404).json({ error: 'no_workspace' })
  const auth = await requireRole(req, ALL_KNOWN_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  if (!(await enforceLimit(req, res, 'ai', ws.id))) return

  // 1. All proposed segments for the workspace.
  const segRes = await sb(
    `video_segments?workspace_id=eq.${ws.id}&status=eq.proposed` +
    `&select=id,source_asset_id,staff_id,start_sec,end_sec,hook,why_it_stands_alone,transcript_excerpt,score,moment_type,visual_score,visual_breakdown,nomination_source,order_index` +
    `&order=order_index.asc`,
  )
  if (!segRes.ok) {
    console.error('[moments] segment query failed:', segRes.status, await segRes.text().catch(() => ''))
    return res.status(500).json({ error: 'db_error' })
  }
  const segments = await segRes.json().catch(() => [])
  if (!segments.length) return res.status(200).json({ moments: [] })

  // 2. Lazily score any segment missing a score (pre-scoring-pass rows). One
  // batched LLM call, then persist so it's a one-time cost per segment.
  // Cap inline scoring to 10 per request — avoids exhausting the 60s maxDuration
  // on large workspaces where 40+ PATCHes + one Sonnet call could timeout.
  // Any remaining unscored segments are picked up on the next page load.
  const unscored = segments.filter((s) => s.score == null).slice(0, 10)
  let scorePersistFailed = false
  if (unscored.length) {
    const scores = await scoreSegments(unscored, ws)
    const persistResults = await Promise.all(unscored.map(async (s, i) => {
      const newScore = scores[i]?.score ?? 55
      const newMomentType = scores[i]?.moment_type ?? 'insight'
      try {
        const r = await sb(`video_segments?id=eq.${s.id}&workspace_id=eq.${ws.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ score: newScore, moment_type: newMomentType }),
        })
        if (!r.ok) {
          console.error('[moments] score persist failed', s.id, r.status, await r.text().catch(() => ''))
          return { id: s.id, ok: false }
        }
        s.score = newScore
        s.moment_type = newMomentType
        return { id: s.id, ok: true }
      } catch (e) {
        console.error('[moments] score persist error', s.id, e?.message)
        return { id: s.id, ok: false }
      }
    }))
    scorePersistFailed = persistResults.some((r) => !r.ok)
  }

  // 3. Hydrate source assets + staff names in two small batched reads.
  const sourceIds = segments.map((s) => s.source_asset_id).filter(Boolean)
  const staffIds = segments.map((s) => s.staff_id).filter(Boolean)
  const srcInList = inList(sourceIds)
  const staffInList = inList(staffIds)
  const [srcRes, staffRes] = await Promise.all([
    srcInList ? sb(`media_assets?id=in.${srcInList}&workspace_id=eq.${ws.id}&select=id,filename,thumbnail_url,width,height,consent_status`) : Promise.resolve({ ok: true, json: async () => [] }),
    staffInList ? sb(`staff?id=in.${staffInList}&workspace_id=eq.${ws.id}&select=id,name`) : Promise.resolve({ ok: true, json: async () => [] }),
  ])
  const sources = srcRes.ok ? await srcRes.json().catch(() => []) : []
  const staff = staffRes.ok ? await staffRes.json().catch(() => []) : []
  const srcMap = Object.fromEntries(sources.map((a) => [a.id, a]))
  const staffMap = Object.fromEntries(staff.map((s) => [s.id, s.name]))

  // 4. Shape + rank. F13: rank on the BLENDED score (transcript + what the
  // camera sees), not transcript alone. Segments without a visual_score (older
  // footage, or a source still being visually scored) fall back to transcript.
  const moments = segments.map((s) => {
    const src = srcMap[s.source_asset_id] || {}
    const start = Number(s.start_sec) || 0
    const end = Number(s.end_sec) || 0
    const visualScore = s.visual_score ?? null
    return {
      id: s.id,
      sourceAssetId: s.source_asset_id,
      filename: src.filename || null,
      thumbnailUrl: src.thumbnail_url || null,
      width: src.width || null,
      height: src.height || null,
      consentStatus: src.consent_status || null,
      staffName: staffMap[s.staff_id] || null,
      startSec: start,
      endSec: end,
      durationSec: Math.max(0, end - start),
      quote: s.hook || s.transcript_excerpt || '',
      excerpt: s.transcript_excerpt || '',
      why: s.why_it_stands_alone || '',
      score: s.score ?? null,
      visualScore,
      visualBreakdown: s.visual_breakdown || null,
      nominationSource: s.nomination_source || 'transcript',
      rankScore: blendMomentScore(s.score, visualScore),
      momentType: s.moment_type || 'insight',
      momentTypeLabel: MOMENT_TYPE_LABELS[s.moment_type] || 'Moment',
    }
  }).sort((a, b) => (b.rankScore ?? -1) - (a.rankScore ?? -1) || a.startSec - b.startSec)

  return res.status(200).json({ moments, ...(scorePersistFailed ? { scorePersistFailed: true } : {}) })
}
