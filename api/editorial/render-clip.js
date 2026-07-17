// POST /api/editorial/render-clip
//
// Phase 2 Day 7/7b of the 30-day video output build.
// Renders a media asset (photo or video) into per-channel branded outputs.
//
// Photos  → JPEG per channel   (Sharp + SVG overlay)
// Videos  → MP4  per channel   (ffmpeg + Whisper subs + Sharp SVG overlay PNG)
//
// SYNCHRONOUS render: this endpoint renders inside the request and returns the
// encoded output in the response. It serves the post + ad-export flows, which
// render short selections that comfortably fit the 300s budget. The heavy
// "Save to Library" b-roll export moved to the ASYNC worker path
// (api/editorial/export-clip{,-worker}.js) because a long/hi-res clip could
// blow the ceiling → 504. Both paths share the render implementation in
// api/_lib/renderClipCore.js so they never drift.
//
// Body:
//   {
//     assetId: string,             // media_assets.id
//     captionText?: string,        // overlaid in caption band (photos + videos)
//     channels?: string[]          // default: 3 most-used channels for the asset kind
//     ...editor doc (startSec, durationSec, grade, reframe, cuts, overlays, music, ...)
//   }
//
// Auth: Clerk JWT + workspace org-id check + video_pipeline_enabled gate.
//
// Response 200:
//   {
//     assetId, kind, sourceBlobUrl, captionText, staffName,
//     renders: [{ channel, blobUrl, width, height, sizeBytes, hadSubtitles? }, ...],
//     errors?: [{ channel, error }],
//     elapsedMs
//   }
// Errors: 400 / 401 / 403 / 404 / 415 / 500.

export const config = { runtime: 'nodejs', maxDuration: 300 }

import { waitUntil } from '@vercel/functions'
import { requireRole } from '../_lib/auth.js'
import { enforceLimit } from '../_lib/ratelimit.js'
import { ALL_KNOWN_ROLES } from '../_lib/roles.js'
import { workspaceContext } from '../_lib/workspaceContext.js'
import { resolveClipRender, runClipRender } from '../_lib/renderClipCore.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  // --- Workspace + auth ---
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

  // --- Validate + resolve the source asset and render params ---
  const resolved = await resolveClipRender({ ws, body: req.body || {} })
  if (!resolved.ok) {
    return res.status(resolved.status).json({ error: resolved.error, ...(resolved.extra || {}) })
  }

  // --- Render each channel + upload (synchronous) ---
  const { renders, errors, elapsedMs } = await runClipRender({
    ws, asset: resolved.asset, params: resolved.params,
  })

  waitUntil(Promise.resolve()) // placeholder for future analytics logging

  return res.status(renders.length > 0 ? 200 : 500).json({
    assetId: resolved.asset.id,
    kind: resolved.asset.kind,
    sourceBlobUrl: resolved.asset.blob_url,
    captionText: resolved.params.captionText,
    staffName: resolved.params.staffName,
    renders,
    errors: errors.length ? errors : undefined,
    elapsedMs,
  })
}
