// Mux webhook receiver. Mux POSTs JSON events when an asset finishes
// transcoding (or errors out); we flip media_assets.transcode_status to
// 'ready' / 'errored' so the UI can stop showing the placeholder.
//
// Events we care about:
//   video.asset.ready     — playback ID is now playable
//   video.asset.errored   — transcode failed; details in data.errors[0]
//   video.asset.deleted   — emitted on asset deletion; we don't currently
//                           initiate Mux deletes, so this is a no-op.
//
// Auth: Mux signs every webhook body with HMAC-SHA256 keyed by the webhook
// signing secret. We MUST verify before touching the DB — webhook URLs are
// public and a forged payload could mark an asset 'ready' before transcode
// actually finishes, leaving the player serving a broken stream.

// Mounted inside the api/index Express app (per the route manifest), so this
// per-file config is informational — body handling is governed by api/index's
// express.json() middleware, which exposes the raw bytes on req.rawBody.
export const config = { runtime: 'nodejs' }

import { verifyWebhookSignature, mintPlaybackToken, muxSignedConfigured, getAssetDimensions } from '../../_lib/muxClient.js'
import { put as blobPut } from '@vercel/blob'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// Pull a poster frame from Mux's image service and rehost it to our Blob store
// so thumbnail_url is a permanent public URL (Mux signed URLs expire). Mux
// decodes any codec/container reliably — H.264, HEVC, non-faststart .mov —
// where the local ffmpeg-static path is fragile (truncated downloads, codec
// gaps). Returns the rehosted URL, or null on any failure (non-fatal).
async function rehostMuxThumbnail(playbackId, assetId, workspaceId) {
  try {
    const token = muxSignedConfigured()
      ? mintPlaybackToken({ playbackId, audience: 't', expiresInSec: 300 })
      : null
    const url = `https://image.mux.com/${playbackId}/thumbnail.jpg${token ? `?token=${token}` : ''}`
    const res = await fetch(url)
    if (!res.ok) {
      console.error(`[mux/webhook] Mux thumbnail fetch failed: ${res.status}`)
      return null
    }
    // Mux thumbnails are small JPEGs; guard against an unexpectedly large body
    // before buffering it into memory (CLAUDE.md large-file rule).
    const len = Number(res.headers.get('content-length') || 0)
    if (len && len > 25 * 1024 * 1024) {
      console.error(`[mux/webhook] thumbnail too large (${len} bytes); skipping rehost`)
      return null
    }
    const buf = Buffer.from(await res.arrayBuffer())
    // Guard for missing Content-Length header — cap after buffering.
    if (buf.length > 25 * 1024 * 1024) {
      console.error(`[mux/webhook] thumbnail too large after buffer (${buf.length} bytes); skipping rehost`)
      return null
    }
    // Namespace the blob key by the immutable workspace UUID so thumbnail keys
    // aren't a flat, cross-tenant-predictable namespace (CLAUDE.md blob rule).
    // Skip rehost entirely if workspace couldn't be resolved — an un-namespaced
    // key would be guessable by anyone who knows the Mux asset ID.
    if (!workspaceId) {
      console.warn(`[mux/webhook] rehostMuxThumbnail: no workspaceId for asset ${assetId}; skipping rehost`)
      return null
    }
    const key = `media/thumbs/${workspaceId}/${assetId}.jpg`
    const uploaded = await blobPut(key, buf, {
      access: 'public',
      contentType: 'image/jpeg',
      addRandomSuffix: true,
      allowOverwrite: false,
    })
    return uploaded.url
  } catch (e) {
    console.error(`[mux/webhook] rehostMuxThumbnail failed: ${e?.message}`)
    return null
  }
}

// eslint-disable-next-line bernard/require-workspace-scope -- Mux webhook — workspace resolved from media_assets.workspace_id via Mux asset ID, not Host header
function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
      ...init.headers,
    },
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed', message: 'POST only' })
  }

  const secret = process.env.MUX_WEBHOOK_SECRET
  if (!secret) {
    console.error('[mux/webhook] MUX_WEBHOOK_SECRET not set; rejecting all events')
    return res.status(500).json({ error: 'misconfigured', message: 'Webhook secret not configured' })
  }

  // Every route runs inside the api/index Express app, whose express.json()
  // middleware has already consumed the request stream and stashed the exact
  // bytes on req.rawBody (the Stripe-webhook pattern documented in api/index.js).
  // Re-reading the stream here (req.on('data')) hangs the function — req has
  // already emitted 'end' — so verify the signature against req.rawBody.
  const rawBody = req.rawBody
  const signature = req.headers['mux-signature'] || req.headers['Mux-Signature']
  if (!rawBody || !rawBody.length) {
    return res.status(400).json({ error: 'no_raw_body' })
  }
  if (!verifyWebhookSignature(rawBody, signature, secret)) {
    return res.status(401).json({ error: 'invalid_signature' })
  }

  let event
  try {
    event = JSON.parse(rawBody.toString('utf8'))
  } catch {
    return res.status(400).json({ error: 'invalid_json' })
  }
  const type      = event?.type
  const assetId   = event?.data?.id
  const errors    = event?.data?.errors
  const passthrough = event?.data?.passthrough

  if (!type || !assetId) {
    console.warn('[mux/webhook] received event with no type or asset id; ignoring')
    return res.status(200).json({ received: true })
  }

  const tag = `[mux/webhook type=${type} asset=${assetId}]`

  // We key the row lookup on either the asset id or the passthrough we set
  // at create time (which is the media_assets row id). Passthrough is the
  // more reliable join because Mux occasionally re-issues asset ids during
  // certain failure-and-retry flows, but normally either works.
  const filterByAsset = `mux_asset_id=eq.${encodeURIComponent(assetId)}`
  const filterByPass  = passthrough ? `id=eq.${encodeURIComponent(passthrough)}` : null

  // Resolve the owning workspace_id BEFORE mutating so every PATCH is
  // workspace-scoped. The HMAC gate already proves the event came from Mux
  // (active leak isn't possible), but as defense-in-depth we never issue a
  // workspace-blind write to a tenant-scoped table. If the row can't be found
  // (e.g. the create-call PATCH hasn't landed yet), wsId stays null and we fall
  // back to the unscoped filter — the unique asset/passthrough id still pins a
  // single row, so this preserves the create-race fallback without widening it.
  async function resolveWorkspaceId() {
    let r = await sb(`media_assets?${filterByAsset}&select=workspace_id&limit=1`)
    if (r.ok) {
      const rows = await r.json().catch(() => [])
      if (rows[0]?.workspace_id) return rows[0].workspace_id
    }
    if (filterByPass) {
      r = await sb(`media_assets?${filterByPass}&select=workspace_id&limit=1`)
      if (r.ok) {
        const rows = await r.json().catch(() => [])
        if (rows[0]?.workspace_id) return rows[0].workspace_id
      }
    }
    return null
  }

  async function patchByAssetOrPassthrough(patch) {
    const wsId = await resolveWorkspaceId()
    if (!wsId) {
      console.warn('[mux-webhook] no workspace resolved for asset', assetId, 'event', type, '— skipping PATCH (race or orphaned asset)')
      return null
    }
    const wsFilter = `&workspace_id=eq.${encodeURIComponent(wsId)}`

    // Try asset_id first (set by our create call). Fall back to passthrough
    // if zero rows updated — covers the edge case where the create call's
    // PATCH lost a race with the ready webhook (Mux is fast).
    let r = await sb(`media_assets?${filterByAsset}${wsFilter}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(patch),
    })
    if (!r.ok) {
      console.error(tag, 'asset_id PATCH failed:', r.status, await r.text())
      return false
    }
    const rows = await r.json().catch(() => [])
    if (rows.length > 0) return true

    if (!filterByPass) return false
    r = await sb(`media_assets?${filterByPass}${wsFilter}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ ...patch, mux_asset_id: assetId }),
    })
    if (!r.ok) {
      console.error(tag, 'passthrough PATCH failed:', r.status, await r.text())
      return false
    }
    return true
  }

  if (type === 'video.asset.ready') {
    const playbackId = event?.data?.playback_ids?.[0]?.id || null
    const durationS  = event?.data?.duration
    const patch = { transcode_status: 'ready' }
    if (playbackId) patch.mux_playback_id = playbackId
    if (typeof durationS === 'number') patch.duration_s = durationS

    // Capture display dimensions + aspect ratio from Mux. The local ffmpeg
    // probe fails on non-faststart .mov (moov at tail), leaving width/height
    // null — which means the player has no aspect info and crops portrait
    // videos to fill a landscape box. Mux always knows the true DISPLAY
    // dimensions (rotation already applied), so this is the reliable source.
    const videoTrack = Array.isArray(event?.data?.tracks)
      ? event.data.tracks.find((t) => t?.type === 'video')
      : null
    if (videoTrack?.max_width && videoTrack?.max_height) {
      patch.width  = videoTrack.max_width
      patch.height = videoTrack.max_height
    }
    if (typeof event?.data?.aspect_ratio === 'string') {
      patch.aspect_ratio = event.data.aspect_ratio
    }

    // The ready event frequently omits data.tracks (observed: 14 of 16 ready
    // videos landed with null width/height). Without dimensions the player has
    // no aspect ratio and collapses portrait clips into a wrong-shaped box. Fall
    // back to a direct asset fetch — Mux always knows the true display size.
    // Non-fatal: a transient API error just leaves dims null (the client now
    // also measures at runtime), so we still mark the asset ready.
    if (!patch.width || !patch.height) {
      try {
        const dims = await getAssetDimensions(assetId)
        if (dims.width && dims.height) {
          patch.width  = dims.width
          patch.height = dims.height
        }
        if (!patch.aspect_ratio && dims.aspectRatio) patch.aspect_ratio = dims.aspectRatio
      } catch (e) {
        console.error(`${tag} getAssetDimensions fallback failed:`, e?.message)
      }
    }

    // Backfill a poster frame from Mux when the local ffmpeg pass didn't
    // produce one (truncated download, codec gap on iPhone .mov, etc.). Look
    // up the row's current thumbnail_url first so we never clobber a good
    // ffmpeg thumbnail or a user-chosen frame.
    if (playbackId) {
      const lookup = await sb(`media_assets?${filterByAsset}&select=id,thumbnail_url,workspace_id`).catch(() => null)
      let rowId = null
      let hasThumb = false
      let rowWsId = null
      if (lookup?.ok) {
        const r = (await lookup.json().catch(() => []))?.[0]
        rowId = r?.id || null
        hasThumb = !!r?.thumbnail_url
        rowWsId = r?.workspace_id || null
      }
      if (!rowId && passthrough) rowId = passthrough
      if (rowId && !hasThumb) {
        const thumbUrl = await rehostMuxThumbnail(playbackId, rowId, rowWsId)
        if (thumbUrl) patch.thumbnail_url = thumbUrl
      }
    }

    const readyResult = await patchByAssetOrPassthrough(patch)
    // null = the media_assets row wasn't found yet (create-race): the upload's
    // own PATCH hasn't landed. Return 503 so Mux re-delivers (it retries non-2xx
    // with backoff); by the next delivery the row exists and the asset gets its
    // ready status instead of stranding at 'transcoding' forever.
    if (readyResult === null) {
      return res.status(503).json({ error: 'row_not_found_yet', message: 'media_assets row not resolved; retry later' })
    }
    return res.status(200).json({ received: true })
  }

  if (type === 'video.asset.errored') {
    const reason = Array.isArray(errors) && errors[0]
      ? (errors[0].messages?.join('; ') || errors[0].type || 'unknown')
      : 'unknown'
    console.error(`[mux/webhook] transcode errored for asset ${assetId}: ${reason}`)
    const erroredResult = await patchByAssetOrPassthrough({ transcode_status: 'errored' })
    if (erroredResult === null) {
      return res.status(503).json({ error: 'row_not_found_yet', message: 'media_assets row not resolved; retry later' })
    }
    return res.status(200).json({ received: true })
  }

  // Unhandled event types — Mux fires a wide set (video.asset.created,
  // .updated, .static_renditions.ready, etc.). Acknowledge so Mux doesn't
  // retry the delivery; log so we can decide if a future event becomes
  // load-bearing.
  console.info(tag, 'unhandled event; ack only')
  return res.status(200).json({ received: true })
}
