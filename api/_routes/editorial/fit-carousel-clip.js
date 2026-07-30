// POST /api/editorial/fit-carousel-clip
//
// Re-bake ONE clip at 4:5 so it can sit in an Instagram carousel slot, and
// persist the result as a reusable aspect variant of its master.
//
// Why a re-bake and not a letterbox: Instagram carousels enforce one aspect
// across every item and reject anything under 0.8 (verified live 2026-07-29),
// so a 9:16 clip cannot join a 4:5 deck as-is. Fitting it with bundle's
// autoFitImage would work but pillarbox the clip; Bernard OWNS the renderer and
// the edit recipe, so it can produce a real 4:5 frame with the burned-in
// captions re-placed for it.
//
// Why the reframe is a REQUIRED input rather than derived: cropping 1920→1350
// lifts the subject in frame while the caption margin stays a fixed fraction of
// height, so replaying the reel's own reframe puts the caption ON the subject's
// face. Measured, not theorised — see .claude/video-aspect-bake-design.md. The
// producer confirms or drags a proposed nudge; this route just bakes what it's
// told.
//
// Body: { assetId: uuid, reframe?: {zoom,x,y} }
// Response 200: { variant: { id, blobUrl, thumbnailUrl, width, height }, reframe }
// Errors: 400 / 401 / 403 / 404 / 500

export const config = { runtime: 'nodejs', maxDuration: 300 }

import { requireRole } from '../../_lib/auth.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { EDITOR_ROLES } from '../../_lib/roles.js'
import { workspaceContext } from '../../_lib/workspaceContext.js'
import { resolveClipRender, runClipRender } from '../../_lib/renderClipCore.js'
import { saveAspectVariant } from '../../_lib/aspectVariants.js'
import { proposeCarouselReframe, clampReframeY } from '../../../src/lib/carouselCrop.js'

const CAROUSEL_CHANNEL = 'instagram_carousel_video'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })
  const auth = await requireRole(req, EDITOR_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  if (!(await enforceLimit(req, res, 'render', ws.id))) return

  const body = (typeof req.body === 'object' && req.body) ? req.body : {}
  const { assetId } = body
  if (!assetId || !UUID_RE.test(assetId)) return res.status(400).json({ error: 'invalid_asset_id' })

  // The crop the producer confirmed, else the proposed nudge. Only `y` is
  // producer-controlled today (the crop loses height, so vertical is the only
  // axis with a real choice in it); zoom/x ride through from the proposal.
  const proposed = proposeCarouselReframe({ sourceReframe: body.reframe, captionPos: 'top' })
  const reframe = {
    ...proposed,
    ...(body.reframe?.y !== undefined ? { y: clampReframeY(body.reframe.y) } : {}),
  }

  try {
    // resolveClipRender does the workspace-scoped asset fetch, the consent gate,
    // and resolves the stored edit recipe — reusing it is what keeps this bake
    // identical to the reel bake apart from the frame and the crop.
    const resolved = await resolveClipRender({
      req,
      ws,
      body: { ...body, channels: [CAROUSEL_CHANNEL], reframe },
    })
    if (resolved.error) {
      return res.status(resolved.status).json({ error: resolved.error, ...(resolved.extra || {}) })
    }

    const { renders, errors } = await runClipRender({
      ws,
      asset: resolved.asset,
      params: resolved.params,
    })
    const render = renders.find((r) => r.channel === CAROUSEL_CHANNEL)
    if (!render?.blobUrl) {
      console.error('[fit-carousel-clip] render produced no output:', JSON.stringify(errors || []))
      return res.status(500).json({ error: 'render_failed' })
    }

    // Persist as a variant of the MASTER, not a new library row: rendered once
    // and reused by every piece that needs this clip at 4:5, and the Library
    // still shows one tile per upload (MediaHub filters parent_id=is.null).
    const variant = await saveAspectVariant({
      sourceAsset: resolved.asset,
      channel: CAROUSEL_CHANNEL,
      render,
      reframe,
      scope: { column: 'workspace_id', id: ws.id, workspace: ws },
    })
    if (!variant?.id) return res.status(500).json({ error: 'variant_save_failed' })

    return res.status(200).json({
      variant: {
        id: variant.id,
        blobUrl: variant.blob_url,
        thumbnailUrl: variant.thumbnail_url || null,
        width: variant.width,
        height: variant.height,
      },
      reframe,
    })
  } catch (e) {
    console.error('[fit-carousel-clip] failed:', e?.stack || e?.message)
    return res.status(500).json({ error: 'fit_failed' })
  }
}
