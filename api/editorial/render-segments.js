// POST /api/editorial/render-segments
//
// Slate clip workshop — AI "Find clips" output (Option 2).
//
// Turns kept proposed segments into rendered media_assets b-roll clips — one
// media_assets row per segment, parent_asset_id set to the source video, exactly
// the shape the manual "Library b-roll" path produces (saveSlateBroll). This is
// what the reworked Slate surfaces: source-video cards with an "X clips cut"
// badge (api/editorial/clip-counts counts media_assets with parent_asset_id) and
// the Library b-roll pool. The old story_packages output was invisible on the
// new Slate; this path no longer creates packages.
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
//
// Auth: Clerk JWT + workspace org-id + video_pipeline_enabled.
//
// Responses:
//   202 { clips: [{ segmentId, status: 'rendering' }], skipped: [...] }
//   400 / 401 / 403 / 404 / 500

export const config = { runtime: 'nodejs', maxDuration: 300 }

import { put as blobPut } from '@vercel/blob'
import { waitUntil } from '@vercel/functions'
import { requireRole } from '../_lib/auth.js'
import { ALL_KNOWN_ROLES } from '../_lib/roles.js'
import { workspaceContext } from '../_lib/workspaceContext.js'
import { renderVideoChannel } from '../_lib/brandRenderVideo.js'
import { generateCaption } from '../_lib/captionGen.js'
import { saveSlateBroll } from '../_lib/saveSlateBroll.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// One clip → one reel-format b-roll asset. Mirrors SlateClipEditor's
// DEFAULT_CHANNEL so the AI path and the manual workshop produce the same shape.
const CLIP_CHANNEL = 'instagram_reel'

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

/**
 * Render one kept segment into a media_assets b-roll clip, off the request path.
 * Never throws — on failure the segment is reset to 'proposed' so the clinician
 * can re-select and retry, and the error is logged. (video_segments has no
 * per-row error column; reverting to 'proposed' keeps the suggestion intact and
 * re-renderable. A hard-killed render leaves the row stuck in 'rendering';
 * segmentDetect clears stale 'rendering' rows on the next detect.)
 */
async function renderSegmentToBroll({ ws, seg, asset, staffName }) {
  const startSec = Number(seg.start_sec) || 0
  const durationSec = Math.max(1, (Number(seg.end_sec) || 0) - startSec)
  const hook = String(seg.hook || '').slice(0, 500)
  const transcriptExcerpt = String(seg.transcript_excerpt || '').trim()

  try {
    // Voice-faithful caption from the segment's OWN transcript + the staff
    // member's voice phrases. Best-effort: fall back to the hook so a clip never
    // fails to render because captioning hiccuped.
    let captionText = hook
    try {
      const generated = await generateCaption({
        topic: hook || 'Clip',
        clip: {},
        workspace: ws,
        staffId: seg.staff_id || null,
        clipTranscript: transcriptExcerpt,
      })
      if (generated && generated.trim()) captionText = generated.trim().slice(0, 500)
    } catch (e) {
      console.error('[render-segments] caption gen failed, using hook:', e?.stack || e?.message)
    }

    // Render the ≤60s window as a reel-format clip with the caption burned in.
    const { buffer, width, height } = await renderVideoChannel({
      videoUrl: asset.blob_url,
      channel: CLIP_CHANNEL,
      captionText,
      workspace: ws,
      staffName,
      startSec,
      durationSec,
      subtitles: true,
    })

    const safeFilename = (asset.filename || 'clip')
      .replace(/[^\w.-]/g, '_')
      .replace(/\.\w+$/, '')
    // Key by segment id so multiple segments off one source never clobber.
    const pathname = `media/clips/${ws.id}/${asset.id}/${seg.id}-${safeFilename}.mp4`
    const blob = await blobPut(pathname, buffer, {
      access: 'public',
      contentType: 'video/mp4',
      addRandomSuffix: false,
      allowOverwrite: true,
    })

    // Insert the b-roll media_assets row (parent_asset_id = source) + index it.
    const saved = await saveSlateBroll({
      ws,
      renders: [{ blobUrl: blob.url, width, height, sizeBytes: buffer.length }],
      staffId: seg.staff_id || null,
      notes: `Slate AI clip from asset ${asset.id}${hook ? ` — "${hook.slice(0, 80)}"` : ''}`,
      parentAssetId: asset.id,
    })
    const newAssetId = saved?.[0]?.id || null

    await sb(`video_segments?id=eq.${seg.id}&workspace_id=eq.${ws.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'rendered', rendered_asset_id: newAssetId }),
    }).catch(() => {})
  } catch (e) {
    console.error('[render-segments] render failed for segment', seg.id, e?.stack || e?.message)
    await sb(`video_segments?id=eq.${seg.id}&workspace_id=eq.${ws.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'proposed' }),
    }).catch(() => {})
  }
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

  const body = req.body || {}
  const segmentIds = Array.isArray(body.segmentIds)
    ? [...new Set(body.segmentIds.map((s) => String(s)).filter(Boolean))]
    : []
  if (!segmentIds.length) return res.status(400).json({ error: 'segmentIds_required' })
  if (segmentIds.length > 12) return res.status(400).json({ error: 'too_many_segments', max: 12 })

  // Fetch the requested segments (workspace-scoped) + their source asset so we
  // have the blob url + filename + staff for the render. Consent is enforced on
  // the source asset — a pending/revoked source can't be turned into clips.
  const inList = segmentIds.map((id) => `"${id}"`).join(',')
  const segRes = await sb(
    `video_segments?id=in.(${inList})&workspace_id=eq.${ws.id}` +
      `&select=id,source_asset_id,staff_id,start_sec,end_sec,hook,transcript_excerpt,status,rendered_asset_id,` +
      `source_asset:media_assets(id,kind,blob_url,filename,archived_at,consent_status)`,
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

    // Render each off the request path; ClipFinder polls segments to completion.
    waitUntil(
      (async () => {
        for (const { seg, asset } of toRender) {
          await renderSegmentToBroll({ ws, seg, asset, staffName: staffNames[seg.staff_id] || '' })
        }
      })(),
    )

    for (const { seg } of toRender) clips.push({ segmentId: seg.id, status: 'rendering' })
  }

  return res.status(202).json({ clips, skipped })
}
