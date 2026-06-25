// POST /api/ads/render-video
//
// Ad-creative export, video (Phase 2). Renders ONE ad aspect ratio of a clip
// from the SOURCE video using the clip's start/duration window, reusing the
// same ffmpeg pipeline Slate uses for clips (renderVideoChannel). One aspect
// per call — each is a full re-encode, so a 4-pack is 4 sequential calls
// (client-driven) to stay within the function budget.
//
// This is a standalone physical function (NOT a consolidated _routes handler)
// because it needs the ffmpeg-static binary bundled — same reason render-clip.js
// lives outside api/_routes. It wins Vercel's filesystem phase over the
// /api/(.*) → /api/index rewrite.
//
// Body:
//   { assetId, aspect, captionText?, startSec?, durationSec?,
//     overlayPosition?, overlaySize? }
//
// Auth: Clerk JWT + workspace org-id check + video_pipeline_enabled gate.
// Response 200: { aspect, url, width, height, durationSec }
// Errors: 400 / 401 / 403 / 404 / 409 (consent) / 500.

export const config = { runtime: 'nodejs', maxDuration: 300 }

import { randomUUID } from 'node:crypto'
import { put as blobPut } from '@vercel/blob'
import { requireRole } from '../_lib/auth.js'
import { enforceLimit } from '../_lib/ratelimit.js'
import { ALL_KNOWN_ROLES } from '../_lib/roles.js'
import { workspaceContext } from '../_lib/workspaceContext.js'
import { renderVideoChannel } from '../_lib/brandRenderVideo.js'

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

// Ad aspect → an existing VIDEO_CHANNEL_SPECS clip lane (cover-crop from source,
// caption band + brand overlay). These are the clip lanes, not the longform
// keep-whole lanes, so each aspect is a proper crop of the clip window.
const ASPECT_CHANNEL = {
  '1:1':  'linkedin_video',   // 1080×1080
  '4:5':  'facebook_video',   // 1080×1350
  '9:16': 'instagram_reel',   // 1080×1920
  '16:9': 'blog_hero_video',  // 1920×1080
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const ws = await workspaceContext(req)
  if (!ws) return res.status(404).json({ error: 'no_workspace' })

  const auth = await requireRole(req, ALL_KNOWN_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  if (!(await enforceLimit(req, res, 'media', ws.id))) return

  if (!ws.video_pipeline_enabled) {
    return res.status(403).json({ error: 'video_pipeline_disabled' })
  }

  const body = req.body || {}
  const assetId = String(body.assetId || '').trim()
  if (!assetId) return res.status(400).json({ error: 'assetId_required' })

  const aspect = String(body.aspect || '').trim()
  const channel = ASPECT_CHANNEL[aspect]
  if (!channel) return res.status(400).json({ error: 'invalid_aspect', valid: Object.keys(ASPECT_CHANNEL) })

  // Load the source asset, scoped to this workspace.
  const assetRes = await sb(
    `media_assets?id=eq.${assetId}&workspace_id=eq.${ws.id}&select=id,kind,blob_url,filename,staff_id,consent_status`,
  )
  if (!assetRes.ok) {
    const txt = await assetRes.text().catch(() => '')
    console.error('[ads/render-video] asset load failed:', assetRes.status, txt)
    return res.status(500).json({ error: 'db_error' })
  }
  const asset = (await assetRes.json())?.[0]
  if (!asset) return res.status(404).json({ error: 'asset_not_found' })
  if (asset.kind !== 'video') return res.status(400).json({ error: 'not_a_video' })
  if (!asset.blob_url) return res.status(400).json({ error: 'no_source_url' })

  // Consent gate — enforced server-side, mirrors clip-to-post.
  if (asset.consent_status === 'pending' || asset.consent_status === 'revoked') {
    return res.status(409).json({
      error: `consent_${asset.consent_status}`,
      message: 'Resolve consent before exporting this clip.',
    })
  }

  // Author name for the lower-third.
  let staffName = ''
  if (asset.staff_id) {
    const cRes = await sb(`staff?id=eq.${asset.staff_id}&workspace_id=eq.${ws.id}&select=name`)
    if (cRes.ok) staffName = (await cRes.json().catch(() => []))?.[0]?.name || ''
  }

  const startSec = Math.max(0, Number(body.startSec) || 0)
  const durationSec = body.durationSec != null ? Math.max(1, Number(body.durationSec)) : undefined
  const captionText = String(body.captionText || '').slice(0, 500)
  const overlayPosition = ['top', 'center', 'bottom'].includes(body.overlayPosition) ? body.overlayPosition : undefined
  const overlaySize = ['small', 'medium', 'large'].includes(body.overlaySize) ? body.overlaySize : undefined

  let render
  try {
    render = await renderVideoChannel({
      videoUrl: asset.blob_url,
      channel,
      captionText,
      workspace: ws,
      staffName,
      startSec,
      durationSec,
      subtitles: true,
      overlayPosition,
      overlaySize,
    })
  } catch (e) {
    console.error('[ads/render-video] render failed:', e?.stack || e?.message || e)
    console.error('[handler] render_failed:', e?.message)
    return res.status(500).json({ error: 'render_failed' })
  }

  const slug = aspect.replace(':', 'x')
  const pathname = `media/ads/${ws.id}/${asset.id}/${slug}-${randomUUID()}.mp4`
  let blob
  try {
    blob = await blobPut(pathname, render.buffer, {
      access: 'public',
      contentType: 'video/mp4',
      addRandomSuffix: false,
      allowOverwrite: true,
    })
  } catch (e) {
    console.error('[ads/render-video] blob upload failed:', e?.stack || e?.message || e)
    console.error('[handler] upload_failed:', e?.message)
    return res.status(500).json({ error: 'upload_failed' })
  }

  return res.status(200).json({
    aspect,
    url: blob.url,
    width: render.width,
    height: render.height,
    durationSec: durationSec ?? null,
  })
}
