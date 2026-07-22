// POST /api/editorial/render-segments
//
// Moment Miner — AI "Find clips" output (Option 2).
//
// Turns kept proposed segments into rendered media_assets b-roll clips — one
// media_assets row per segment, parent_asset_id set to the source video, exactly
// the shape the manual "Library b-roll" path produces (saveBroll). This is
// what Moment Miner surfaces: source-video cards with an "X clips cut"
// badge (api/editorial/clip-counts counts media_assets with parent_asset_id) and
// the Library b-roll pool. The old story_packages output was invisible on the
// new Moment Miner; this path no longer creates packages.
//
// Per segment: render the ≤60s window into an instagram_reel MP4 (voice-faithful
// caption burned in, Whisper subtitles), upload to Blob, insert a media_assets
// b-roll row, and link the segment (status='rendered', rendered_asset_id). The
// render runs OFF the request path (waitUntil + 202) because a batch of reels
// would race the 300s function ceiling; the ClipFinder drawer polls
// /api/editorial/segments while segments sit in status='rendering'.
//
// Body:
//   { segmentIds: string[] }   // 1..12 video_segments ids to render
//   { createDraft?: boolean }  // ALSO create an approvable content_items draft
//
// createDraft (T2, reel spine) defaults to FALSE so the manual "Find clips →
// render" path is byte-for-byte unchanged — a clinician exploring 12 candidate
// moments should not get 12 drafts in their week. The auto-reel path passes
// true: that is the whole point of the golden path (upload → captioned reel →
// draft sitting in a reel slot, zero editor opens). Drafts are drafts; a human
// still approves every publish.
//
// Auth: Clerk JWT + workspace org-id + video_pipeline_enabled.
//
// Responses:
//   202 { clips: [{ segmentId, status: 'rendering' }], skipped: [...] }
//   400 / 401 / 403 / 404 / 500

export const config = { runtime: 'nodejs', maxDuration: 300 }

import { waitUntil } from '@vercel/functions'
import { requireRole } from '../_lib/auth.js'
import { enforceLimit } from '../_lib/ratelimit.js'
import { ALL_KNOWN_ROLES } from '../_lib/roles.js'
import { workspaceContext } from '../_lib/workspaceContext.js'
// The render body lives in reelFactory so this manual path and the auto-reel
// cron cannot drift apart — one renderer, one caption, one output shape.
import { renderSegmentToReel } from '../_lib/reelFactory.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

async function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...init.headers,
    },
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const ws = await workspaceContext(req)
  if (!ws) return res.status(404).json({ error: 'no_workspace' })
  if (!ws.video_pipeline_enabled) {
    return res.status(403).json({ error: 'feature_disabled' })
  }

  const auth = await requireRole(req, ALL_KNOWN_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  if (!(await enforceLimit(req, res, 'media', ws.id))) return

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const body = req.body || {}
  const rawIds = Array.isArray(body.segmentIds)
    ? [...new Set(body.segmentIds.map((s) => String(s)).filter(Boolean))]
    : []
  if (!rawIds.length) return res.status(400).json({ error: 'segmentIds_required' })
  if (rawIds.some((id) => !UUID_RE.test(id))) return res.status(400).json({ error: 'invalid_segment_id' })
  const segmentIds = rawIds
  if (segmentIds.length > 12) return res.status(400).json({ error: 'too_many_segments', max: 12 })
  const createDraft = body.createDraft === true

  // Fetch the requested segments (workspace-scoped) + their source asset so we
  // have the blob url + filename + staff for the render. Consent is enforced on
  // the source asset — a pending/revoked source can't be turned into clips.
  const inList = segmentIds.map((id) => `"${id}"`).join(',')
  const segRes = await sb(
    `video_segments?id=in.(${inList})&workspace_id=eq.${ws.id}` +
      `&select=id,source_asset_id,staff_id,start_sec,end_sec,hook,transcript_excerpt,status,rendered_asset_id,` +
      // Disambiguate the embed: video_segments has TWO FKs to media_assets
      // (source_asset_id + rendered_asset_id from migration 113), so PostgREST
      // needs the explicit FK constraint or it 500s with PGRST201 (ambiguous).
      `source_asset:media_assets!video_segments_source_asset_id_fkey(id,kind,blob_url,filename,archived_at,consent_status,transcript_words)`,
  )
  if (!segRes.ok) return res.status(500).json({ error: 'db_error' })
  const segments = await segRes.json()

  if (!segments.length) return res.status(404).json({ error: 'no_segments_found' })

  // Resolve staff names once (best-effort) for lower-third overlays.
  const staffIds = [...new Set(segments.map((s) => s.staff_id).filter(Boolean))]
  const staffNames = {}
  if (staffIds.length) {
    const cIn = staffIds.map((id) => `"${id}"`).join(',')
    const cRes = await sb(`staff?id=in.(${cIn})&workspace_id=eq.${ws.id}&select=id,name`)
    if (cRes.ok) {
      for (const c of await cRes.json()) staffNames[c.id] = c.name
    }
  }

  const clips = []
  const skipped = []
  const toRender = []

  for (const seg of segments) {
    const asset = seg.source_asset
    if (!asset || asset.kind !== 'video' || !asset.blob_url || asset.archived_at) {
      skipped.push({ segmentId: seg.id, reason: 'invalid_source' })
      continue
    }
    if (asset.consent_status === 'pending' || asset.consent_status === 'revoked') {
      skipped.push({ segmentId: seg.id, reason: `consent_${asset.consent_status}` })
      continue
    }
    if (seg.status === 'rendered' || seg.rendered_asset_id) {
      skipped.push({ segmentId: seg.id, reason: 'already_rendered', assetId: seg.rendered_asset_id })
      continue
    }
    if (seg.status === 'rendering') {
      skipped.push({ segmentId: seg.id, reason: 'already_rendering' })
      continue
    }
    toRender.push({ seg, asset })
  }

  if (toRender.length) {
    // Mark all selected segments 'rendering' up front so the drawer shows them
    // in flight immediately and a re-submit can't double-render them.
    const renderIds = toRender.map(({ seg }) => `"${seg.id}"`).join(',')
    await sb(`video_segments?id=in.(${renderIds})&workspace_id=eq.${ws.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'rendering' }),
    }).catch(() => {})

    // Render off the request path with bounded concurrency. Rendering serially
    // blew the 300s function wall on a 3-clip batch (the 3rd reel never finished
    // and its segment stranded in 'rendering'); a small pool finishes a typical
    // batch well inside the budget without N concurrent ffmpeg procs OOMing the
    // 1GB function. ClipFinder polls segments to completion; any segment still
    // 'rendering' if the wall is hit on a large batch is reset to 'proposed' by
    // the sweep-stuck-segment-renders cron (~10 min) so it can be re-submitted.
    const RENDER_CONCURRENCY = 3
    waitUntil(
      (async () => {
        let next = 0
        async function worker() {
          while (next < toRender.length) {
            const { seg, asset } = toRender[next++]
            await renderSegmentToReel({
              ws,
              seg,
              asset,
              staffName: staffNames[seg.staff_id] || '',
              createDraft,
            })
          }
        }
        await Promise.all(
          Array.from({ length: Math.min(RENDER_CONCURRENCY, toRender.length) }, worker),
        )
      })(),
    )

    for (const { seg } of toRender) clips.push({ segmentId: seg.id, status: 'rendering' })
  }

  return res.status(202).json({ clips, skipped })
}
