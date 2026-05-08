// GBP dispatcher for the content_pieces publish loop. Wraps the same Google
// service-account → JWT → /v4/.../localPosts pattern that powers
// api/publish/gbp.js so a single brief can fan out to all configured GBP
// locations on a single click.
//
// Why import the helpers from api/publish/gbp.js directly (vs. internal
// HTTP fetch): the helpers (`getGoogleToken`, `postToLocation`, `buildPost`)
// are pure functions over Web Crypto + fetch. They run identically on the
// Node 24 LTS default runtime that Vercel functions use today, so re-using
// them avoids a duplicate JWT signer and keeps both the legacy edge handler
// and this Node-runtime dispatcher in lockstep.
//
// Surface: publishPieceToGbp({ piece, finalAsset }) → { ok, postId, posted, failed }
// Returns the comma-joined `postId` so the caller can store it on
// content_pieces.published_target_id.

import { getGoogleToken, postToLocation, buildPost } from '../publish/gbp.js'
import { brand } from '../../src/lib/brand.js'

function configuredLocationIds() {
  return (process.env.GBP_LOCATION_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

// Build the post body from a content_piece + its final_asset row. Mirrors
// api/publish/gbp.js's buildPost shape but pulls the CTA URL from the
// content_piece's final_cta_url before falling back to the brand booking URL.
function buildBodyFromPiece(piece, finalAsset) {
  const summary = (piece.final_caption || piece.ai_caption || '').trim()
  if (!summary) {
    throw new Error('content_piece has no caption to publish')
  }

  const mediaUrls = finalAsset?.blob_url
    ? [{ url: finalAsset.blob_url, type: finalAsset.mime_type || (finalAsset.kind === 'video' ? 'video/mp4' : 'image/jpeg') }]
    : []

  const post = buildPost(summary, mediaUrls)

  // Brief-level CTA override. Without this the GBP CTA always points at the
  // brand booking URL — losing the editor's per-piece routing.
  if (piece.final_cta_url) {
    post.callToAction = {
      actionType: 'BOOK',
      url: piece.final_cta_url,
    }
  } else if (process.env.BRAND_URL || brand.prompt.bookingUrl) {
    // Already set by buildPost(); leave as-is.
  }

  return post
}

export async function publishPieceToGbp({ piece, finalAsset }) {
  const accountId   = process.env.GBP_ACCOUNT_ID
  const locationIds = configuredLocationIds()
  if (!accountId || !locationIds.length) {
    throw new Error('GBP not configured — set GBP_ACCOUNT_ID and GBP_LOCATION_IDS on this deployment')
  }

  const post  = buildBodyFromPiece(piece, finalAsset)
  const token = await getGoogleToken()

  const results = await Promise.allSettled(
    locationIds.map((locationId) => postToLocation(token, accountId, locationId, post)),
  )

  const tagged    = results.map((r, i) => ({ r, locationId: locationIds[i] }))
  const succeeded = tagged.filter(({ r }) => r.status === 'fulfilled').map(({ r }) => r.value)
  const failed    = tagged.filter(({ r }) => r.status === 'rejected')
                          .map(({ r, locationId }) => ({ locationId, error: r.reason?.message }))

  if (!succeeded.length) {
    const detail = failed.map((f) => `${f.locationId}: ${f.error}`).join('; ')
    throw new Error(`All GBP posts failed: ${detail}`)
  }

  // postId surfaces on content_pieces.published_target_id. Comma-join so
  // multi-location publishes still get traceably tagged.
  const postId = succeeded.map((s) => s.name).filter(Boolean).join(',')
  return { ok: true, postId, posted: succeeded, failed }
}
