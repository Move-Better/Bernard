// GET /api/cron/auto-detect-clips  (Vercel cron, every 10 minutes)
//
// L2 of the slop-safe auto-clip flow: when a source video lands in a
// video-pipeline-enabled workspace, automatically run AI clip DETECTION so the
// clinician finds standalone-clip PROPOSALS already waiting in the Slate review
// queue — instead of having to open each video and click "Find clips".
//
// DETECTION ONLY — this is the deliberate product line. It transcribes + runs one
// LLM pass proposing ≤60s standalone moments (video_segments, status 'proposed')
// via the same path the manual ClipFinder uses. It NEVER renders, NEVER creates
// content_items drafts, and NEVER publishes. The human still keeps/discards and
// approves. Automating the labor (find the moments) is fine; automating the
// judgment (what ships, in whose voice) is the slop we don't build.
//
// Each run claims a small BATCH of un-processed sources, flips them to
// 'detecting', and kicks detectSegmentsForAsset off the response path
// (waitUntil). detectSegmentsForAsset flips 'detecting' → 'ready' | 'failed' and
// never throws. Stale 'detecting' rows (a dropped waitUntil) are rescued after
// STALE_DETECTING_MS so nothing strands.
//
// Auth: Bearer CRON_SECRET (same as the other cron handlers).

export const config = { runtime: 'nodejs', maxDuration: 300 }

import { waitUntil } from '@vercel/functions'
import { workspaceById } from '../../_lib/workspaceContext.js'
import { detectSegmentsForAsset } from '../../_lib/segmentDetect.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// Sources processed per run. Each detection (audio extract + Whisper + one LLM
// pass) comfortably fits the 300s budget; a small batch keeps a backlog draining
// without piling concurrent ffmpeg+Whisper work onto one instance.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const BATCH = 3
// Only sources long enough to contain a standalone moment. Mirrors the backfill
// floor; shorter b-roll is left for manual use (and would propose nothing).
const MIN_SECONDS = 20
// Proposals per source — bounded to avoid review fatigue (matches find-clips).
const MAX_SEGMENTS = 8
// A row stuck 'detecting' longer than this had its background work dropped
// (instance recycled before waitUntil flushed); re-claim it.
const STALE_DETECTING_MS = 15 * 60 * 1000
// Sources to auto-detect, by source type. Derived clips (parent_asset_id set)
// and rendered Slate outputs are excluded.
const SOURCE_TYPES = '(upload,capture_companion,local-import)'

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
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return res.status(503).json({ error: 'CRON_SECRET not configured' })
  if (req.headers?.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(503).json({ error: 'Supabase env not configured' })
  }
  if (!process.env.AI_GATEWAY_API_KEY || !process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: 'detection env (AI_GATEWAY_API_KEY / OPENAI_API_KEY) not configured' })
  }

  // 1. Fetch all active workspaces.
  const wsRes = await sb('workspaces?status=eq.active&select=id')
  if (!wsRes.ok) {
    console.error('[auto-detect-clips] workspace query failed:', wsRes.status, await wsRes.text().catch(() => ''))
    return res.status(500).json({ error: 'workspace_query_failed' })
  }
  const wsIds = (await wsRes.json()).map((w) => w.id)
  const safeIds = wsIds.filter((id) => UUID_RE.test(id))
  if (safeIds.length === 0) {
    console.info('[auto-detect-clips] no active workspaces — skipping')
    return res.status(200).json({ claimed: 0, reason: 'no_active_workspaces' })
  }
  const inList = `(${safeIds.join(',')})`

  // 2. Candidates: never-detected sources, plus stale 'detecting' rescues.
  const staleBefore = new Date(Date.now() - STALE_DETECTING_MS).toISOString()
  const select = 'id,filename,workspace_id,staff_id,blob_url,duration_s,segment_status,updated_at'
  const common =
    `&kind=eq.video&archived_at=is.null&parent_asset_id=is.null` +
    `&source=in.${SOURCE_TYPES}` +
    `&workspace_id=in.${inList}` +
    `&duration_s=gte.${MIN_SECONDS}`

  const freshRes = await sb(
    `media_assets?segment_status=is.null${common}&select=${select}` +
    `&order=created_at.desc&limit=${BATCH}`,
  )
  if (!freshRes.ok) {
    console.error('[auto-detect-clips] candidate query failed:', freshRes.status, await freshRes.text().catch(() => ''))
    return res.status(500).json({ error: 'candidate_query_failed' })
  }
  let candidates = await freshRes.json()

  if (candidates.length < BATCH) {
    const staleRes = await sb(
      `media_assets?segment_status=eq.detecting&updated_at=lt.${staleBefore}${common}` +
      `&select=${select}&order=updated_at.asc&limit=${BATCH - candidates.length}`,
    )
    if (staleRes.ok) candidates = candidates.concat(await staleRes.json())
  }

  if (candidates.length === 0) return res.status(200).json({ claimed: 0 })

  // 3. Claim (flip to 'detecting') then kick detection off the response path.
  const claimed = []
  for (const asset of candidates) {
    if (!asset.blob_url) continue
    // Re-assert the prior status in the filter so two overlapping cron runs can't
    // both claim the same row (null uses `is.`, a value uses `eq.`).
    const priorFilter = asset.segment_status === null ? 'segment_status=is.null' : 'segment_status=eq.detecting'
    const patch = await sb(
      `media_assets?id=eq.${asset.id}&workspace_id=eq.${asset.workspace_id}&${priorFilter}`,
      { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ segment_status: 'detecting', segment_error: null, updated_at: new Date().toISOString() }) },
    ).catch(() => null)
    // If the conditional PATCH matched no row, another run claimed it — skip.
    if (!patch || !patch.ok) continue
    const rows = await patch.json().catch(() => [])
    if (!Array.isArray(rows) || rows.length === 0) continue

    const ws = await workspaceById(asset.workspace_id)
    if (!ws) continue

    waitUntil(
      detectSegmentsForAsset({ workspace: ws, asset, maxSegments: MAX_SEGMENTS })
        .catch((e) => console.error(`[auto-detect-clips] ${asset.id} failed:`, e?.stack || e?.message)),
    )
    claimed.push({ id: asset.id, filename: asset.filename })
  }

  return res.status(200).json({ claimed: claimed.length, assets: claimed })
}
