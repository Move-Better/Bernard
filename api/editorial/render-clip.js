// POST /api/editorial/render-clip
//
// Phase 2 Day 7/7b of the 30-day video output build.
// Renders a media asset (photo or video) into per-channel branded outputs.
//
// Photos  → JPEG per channel   (Sharp + SVG overlay)
// Videos  → MP4  per channel   (ffmpeg + Whisper subs + Sharp SVG overlay PNG)
//
// Body:
//   {
//     assetId: string,             // media_assets.id
//     captionText?: string,        // overlaid in caption band (photos + videos)
//     channels?: string[]          // default: 3 most-used channels for the asset kind
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
// Errors: 400 / 401 / 403 / 404 / 500.

export const config = { runtime: 'nodejs', maxDuration: 300 }

import { put as blobPut } from '@vercel/blob'
import { waitUntil } from '@vercel/functions'
import { requireRole } from '../_lib/auth.js'
import { enforceLimit } from '../_lib/ratelimit.js'
import { ALL_KNOWN_ROLES } from '../_lib/roles.js'
import { workspaceContext } from '../_lib/workspaceContext.js'
import { renderPhotoChannel, CHANNEL_SPECS } from '../_lib/brandRender.js'
import { renderVideoChannel, VIDEO_CHANNEL_SPECS } from '../_lib/brandRenderVideo.js'
import { sliceWordsToWindow } from '../_lib/karaokeCaptions.js'

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

const DEFAULT_PHOTO_CHANNELS = ['linkedin_feed', 'instagram_reel_still', 'blog_hero']
const DEFAULT_VIDEO_CHANNELS = ['linkedin_video', 'instagram_reel', 'blog_hero_video']

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

  // --- Validate body ---
  const body = req.body || {}
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const assetId = String(body.assetId || '').trim()
  if (!assetId) return res.status(400).json({ error: 'assetId_required' })
  if (!UUID_RE.test(assetId)) return res.status(400).json({ error: 'invalid_assetId' })

  const captionText = String(body.captionText || '').slice(0, 500)
  const startSec = body.startSec != null ? Number(body.startSec) : undefined
  const durationSec = body.durationSec != null ? Number(body.durationSec) : undefined
  if (startSec !== undefined && !Number.isFinite(startSec)) return res.status(400).json({ error: 'startSec must be a number' })
  if (durationSec !== undefined && !Number.isFinite(durationSec)) return res.status(400).json({ error: 'durationSec must be a number' })
  const subtitles = body.subtitles !== undefined ? Boolean(body.subtitles) : undefined
  const VALID_OVERLAY_POSITIONS = ['top', 'center', 'bottom']
  const VALID_OVERLAY_SIZES = ['small', 'medium', 'large']
  const overlayPosition = VALID_OVERLAY_POSITIONS.includes(body.overlayPosition) ? body.overlayPosition : undefined
  const overlaySize = VALID_OVERLAY_SIZES.includes(body.overlaySize) ? body.overlaySize : undefined
  const captionAccent = typeof body.captionAccent === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.captionAccent) ? body.captionAccent : undefined
  const captionAnim = ['pop', 'fade'].includes(body.captionAnim) ? body.captionAnim : undefined
  const captionStyle = ['bold', 'word_box', 'accent_fill', 'glow', 'underline', 'pop'].includes(body.captionStyle) ? body.captionStyle : undefined
  // AI-colorist grade (canonical params). Clamped/normalized inside the renderer
  // (gradeToFfmpeg → normalizeGrade); a neutral or absent grade is a no-op.
  const grade = body.grade && typeof body.grade === 'object' && !Array.isArray(body.grade) ? body.grade : undefined
  // Static reframe (zoom/pan) + manual timed text overlays. Validated/clamped
  // inside the renderer (isNeutralReframe / normalizeOverlays); absent = no-op.
  const reframe = body.reframe && typeof body.reframe === 'object' && !Array.isArray(body.reframe) ? body.reframe : undefined
  const kenBurns = body.kenBurns && typeof body.kenBurns === 'object' && !Array.isArray(body.kenBurns)
    && ['push_in', 'pull_out', 'pan_left', 'pan_right'].includes(body.kenBurns.motion)
    ? { motion: body.kenBurns.motion, intensity: Math.max(0, Math.min(100, Number(body.kenBurns.intensity) || 50)) }
    : undefined
  const overlays = Array.isArray(body.overlays) && body.overlays.length ? body.overlays : undefined
  // Playback speed 0.5..2 (default 1 = no-op); clamped again in the renderer.
  const sp = Number(body.speed)
  const speed = Number.isFinite(sp) && sp >= 0.5 && sp <= 2 ? sp : undefined
  // Edited-captions override: when the editor sends caption words explicitly (the
  // user fixed a word), use them verbatim (already window-relative, 0-based)
  // instead of slicing the source's transcript_words.
  const captionWordsOverride = Array.isArray(body.captionWords) && body.captionWords.length ? body.captionWords : undefined
  const requestedChannels = Array.isArray(body.channels) && body.channels.length
    ? body.channels.map((c) => String(c))
    : null  // resolved after we know asset kind

  // --- Fetch asset + clinician ---
  const assetRes = await sb(
    `media_assets?id=eq.${assetId}&workspace_id=eq.${ws.id}` +
      `&select=id,kind,blob_url,filename,staff_id,archived_at,consent_status,transcript_words`,
  )
  if (!assetRes.ok) return res.status(500).json({ error: 'db_error' })
  const assets = await assetRes.json()
  const asset = assets?.[0]
  if (!asset) return res.status(404).json({ error: 'asset_not_found' })
  if (asset.archived_at) return res.status(404).json({ error: 'asset_archived' })

  // Consent gate — block only unresolved/withdrawn consent.
  // Allowed consent vocabulary (media_assets CHECK): not_required | pending | obtained | revoked.
  // 'granted' is NOT a valid value, so the old `!== 'granted'` gate 403'd every real asset.
  // Matches the sibling handlers (render-segments / clip-to-broll / clip-to-post).
  if (asset.consent_status === 'pending' || asset.consent_status === 'revoked') {
    return res.status(403).json({ error: 'consent_not_granted' })
  }
  if (!asset.blob_url) return res.status(500).json({ error: 'asset_missing_blob_url' })

  const isVideo = asset.kind === 'video'
  const isPhoto = asset.kind === 'photo'
  if (!isVideo && !isPhoto) {
    return res.status(415).json({ error: 'unsupported_asset_kind' })
  }

  // Resolve channels + validate against the appropriate spec map for this kind.
  const specMap = isVideo ? VIDEO_CHANNEL_SPECS : CHANNEL_SPECS
  const defaultChannels = isVideo ? DEFAULT_VIDEO_CHANNELS : DEFAULT_PHOTO_CHANNELS
  const channels = requestedChannels ?? defaultChannels

  for (const c of channels) {
    if (!specMap[c]) {
      return res.status(400).json({ error: 'invalid_channel', channel: c, kind: asset.kind })
    }
  }

  let staffName = ''
  if (asset.staff_id) {
    const cRes = await sb(`staff?id=eq.${asset.staff_id}&workspace_id=eq.${ws.id}&select=name`)
    if (cRes.ok) {
      const cRows = await cRes.json()
      staffName = cRows?.[0]?.name || ''
    }
  }

  // --- Render each channel + upload ---
  const renders = []
  const errors = []
  const renderStartedAt = Date.now()

  for (const channel of channels) {
    try {
      const safeFilename = (asset.filename || 'render')
        .replace(/[^\w.-]/g, '_')
        .replace(/\.\w+$/, '')

      if (isPhoto) {
        const { buffer, width, height } = await renderPhotoChannel({
          photoUrl: asset.blob_url,
          channel,
          captionText,
          workspace: ws,
          staffName,
        })
        // Use ws.id (immutable) not ws.slug (mutable) for blob namespacing.
        const pathname = `media/renders/${ws.id}/${asset.id}/${channel}-${safeFilename}.jpg`
        const blob = await blobPut(pathname, buffer, {
          access: 'public',
          contentType: 'image/jpeg',
          addRandomSuffix: false,
          allowOverwrite: true,
        })
        renders.push({ channel, blobUrl: blob.url, width, height, sizeBytes: buffer.length })

      } else {
        // Persisted captions (migration 137): if the source was transcribed at
        // detection (media_assets.transcript_words), slice those words to THIS
        // clip window and hand them to the renderer — it then skips the per-render
        // Whisper pass entirely. Legacy assets (no transcript_words) fall back to
        // the live transcription inside renderVideoChannel, unchanged.
        const captionWords = captionWordsOverride
          || (Array.isArray(asset.transcript_words) && asset.transcript_words.length
            ? sliceWordsToWindow(asset.transcript_words, startSec ?? 0, durationSec ?? 60)
            : null)
        // Video — ffmpeg pipeline with karaoke captions + brand overlay
        const { buffer, width, height, hadSubtitles } = await renderVideoChannel({
          videoUrl: asset.blob_url,
          channel,
          captionText,
          workspace: ws,
          staffName,
          ...(startSec !== undefined ? { startSec } : {}),
          ...(durationSec !== undefined ? { durationSec } : {}),
          ...(subtitles !== undefined ? { subtitles } : {}),
          ...(overlayPosition !== undefined ? { overlayPosition } : {}),
          ...(overlaySize !== undefined ? { overlaySize } : {}),
          ...(captionAccent !== undefined ? { captionAccent } : {}),
          ...(captionAnim !== undefined ? { captionAnim } : {}),
          ...(captionStyle !== undefined ? { captionStyle } : {}),
          ...(captionWords && captionWords.length ? { captionWords } : {}),
          ...(grade ? { grade } : {}),
          ...(reframe ? { reframe } : {}),
          ...(kenBurns ? { kenBurns } : {}),
          ...(overlays ? { overlays } : {}),
          ...(speed ? { speed } : {}),
        })
        // Use ws.id (immutable) not ws.slug (mutable) for blob namespacing.
        const pathname = `media/renders/${ws.id}/${asset.id}/${channel}-${safeFilename}.mp4`
        const blob = await blobPut(pathname, buffer, {
          access: 'public',
          contentType: 'video/mp4',
          addRandomSuffix: false,
          allowOverwrite: true,
        })
        renders.push({ channel, blobUrl: blob.url, width, height, sizeBytes: buffer.length, hadSubtitles })
      }

    } catch (e) {
      console.error(`[render-clip] channel ${channel} failed:`, e?.stack || e?.message || e)
      errors.push({ channel, error: e?.message || 'unknown' })
    }
  }

  const elapsedMs = Date.now() - renderStartedAt

  waitUntil(Promise.resolve()) // placeholder for future analytics logging

  return res.status(renders.length > 0 ? 200 : 500).json({
    assetId,
    kind: asset.kind,
    sourceBlobUrl: asset.blob_url,
    captionText,
    staffName,
    renders,
    errors: errors.length ? errors : undefined,
    elapsedMs,
  })
}
