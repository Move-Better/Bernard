// Server-side dispatch of an approved content_item (Standing Producer Phase 2B).
//
// Lets api/_routes/content-plan/approve.js finish the job on the server: approve
// AND schedule in one action, so it no longer depends on the browser tab
// completing the dispatch. Mirrors the client's publishPieceToBuffer payload
// exactly (content = string|JSON.stringify; mediaUrls = piece.media_urls) and
// reuses the SAME bundle publisher + GBP fan-out the /api/publish/buffer path
// uses, so server- and client-dispatched posts are identical.
//
// Scope (deliberately conservative — see the sprint doc):
//   - Only workspaces on publish_provider='bundle' dispatch here. Buffer-provider
//     workspaces get { fallback:'client' } and the client runs its proven path.
//   - Carousels (slides needing a fresh canvas bake, which the server can't do)
//     get { fallback:'client', needs_client_bake:true }. Text-only and video
//     (reel) pieces dispatch directly.
// These two sets are DISJOINT from what the server dispatches, so a piece is
// ever handled by exactly one path — no double-post.
//
// Idempotency: content_items.dispatch_state records every posted target
// (append-only, via autoPublishRetry's mergePostedLocations). A retry skips
// already-posted targets — critical for GBP multi-location fan-out.

import { BundlePublisher } from './social/index.js'
import { resolveBundleGbpTargets } from './social/gbpTargets.js'
import { unpostedTargets, mergePostedLocations } from './autoPublishRetry.js'
import { isInstagramReel } from '../../src/lib/mediaEntry.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// Platforms bundle.social can post (matches PLATFORM_TO_BUNDLE_TYPE in
// social/bundlePublisher.js). Anything else (e.g. blog) falls back to the client.
const BUNDLE_PLATFORMS = new Set([
  'instagram', 'instagram_story', 'facebook', 'linkedin', 'tiktok',
  'youtube_short', 'youtube', 'twitter', 'threads', 'bluesky', 'mastodon', 'gbp',
])

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    signal: AbortSignal.timeout(15_000),
    ...init,
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

// Platforms that render slide carousels — only these defer to a client bake when
// slides are present. GBP/text platforms never carousel, so a stray `slides`
// array on them must NOT route to the client fallback (that path is
// dispatch_state-blind and would re-post — the double-post class from the audit).
const CAROUSEL_PLATFORMS = new Set(['instagram', 'facebook'])

// A dispatch shouldn't outlive the function's max duration; a claim older than
// this is treated as abandoned (crashed request) and reclaimable.
const CLAIM_STALE_MS = 5 * 60 * 1000

/**
 * @param {object} a
 * @param {object} a.ws     workspace row (publish_provider, id, clerk_org_id…)
 * @param {object} a.piece  content_items row: id,status,platform,content,media_urls,slides,scheduled_at,location_overrides
 * @returns {Promise<object>} one of:
 *   { dispatched:true, postId, scheduledAt, profileCount }
 *   { dispatched:true, alreadyDispatched:true }
 *   { dispatched:false, fallback:'client', needs_client_bake?:true }   // client runs publishPieceToBuffer
 *   { dispatched:false, reason:'in_progress' }                         // another dispatch holds the claim
 *   { dispatched:false, error:'<key>' }                                // surfaced; client must NOT re-dispatch
 */
export async function dispatchContentItem({ ws, piece }) {
  const provider = ws.publish_provider || 'buffer'
  if (provider !== 'bundle') return { dispatched: false, fallback: 'client' }
  if (!BUNDLE_PLATFORMS.has(piece.platform)) return { dispatched: false, fallback: 'client' }

  // Carousels need a fresh client canvas bake (renderFreeformSlide is DOM-bound);
  // the server can't produce the baked slide images, so defer to the client.
  // A reel (video) has slides skipped and dispatches here. Scoped to
  // carousel-capable platforms so GBP never routes to the fallback. This gate is
  // BEFORE the claim/dispatch, so a deferred piece has posted nothing.
  const reel = isInstagramReel(piece.media_urls)
  if (!reel && CAROUSEL_PLATFORMS.has(piece.platform) && Array.isArray(piece.slides) && piece.slides.length > 0) {
    return { dispatched: false, fallback: 'client', needs_client_bake: true }
  }

  const wsFilter = `workspace_id=eq.${ws.id}`

  // ── Atomic claim ──────────────────────────────────────────────────────────
  // Serialize concurrent approves of the SAME piece. Only the request that flips
  // dispatching_at (from null OR a stale value) proceeds; a loser gets 0 rows
  // and bails without posting. We read the AUTHORITATIVE dispatch_state + status
  // from the claim response, not from the possibly-stale row approve.js fetched.
  const nowIso = new Date().toISOString()
  const staleIso = new Date(Date.now() - CLAIM_STALE_MS).toISOString()
  const claimRes = await sb(
    `content_items?id=eq.${piece.id}&${wsFilter}&or=(dispatching_at.is.null,dispatching_at.lt.${staleIso})`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ dispatching_at: nowIso }),
    }
  )
  if (!claimRes.ok) return { dispatched: false, error: 'claim_failed' }
  const claimed = (await claimRes.json().catch(() => []))?.[0]
  if (!claimed) return { dispatched: false, reason: 'in_progress' }

  async function releaseClaim(extra = {}) {
    await sb(`content_items?id=eq.${piece.id}&${wsFilter}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ dispatching_at: null, updated_at: new Date().toISOString(), ...extra }),
    }).catch((e) => console.warn('[dispatchContentItem] claim release failed:', e?.message))
  }

  // Re-check terminal status from the fresh (claimed) row.
  if (claimed.status === 'scheduled' || claimed.status === 'published') {
    await releaseClaim()
    return { dispatched: true, alreadyDispatched: true }
  }

  // Match the client payload exactly.
  const content = typeof claimed.content === 'string' ? claimed.content : JSON.stringify(claimed.content)
  const mediaUrls = Array.isArray(claimed.media_urls) ? claimed.media_urls : []
  const scheduledAt = claimed.scheduled_at || null
  const locationOverrides = claimed.location_overrides && typeof claimed.location_overrides === 'object'
    ? claimed.location_overrides : {}

  // Targets: GBP fans out per connected location; everything else is one post.
  let targets
  if (piece.platform === 'gbp') {
    targets = await resolveBundleGbpTargets(ws.id, null)
    if (targets.length === 0) { await releaseClaim(); return { dispatched: false, error: 'no_gbp_location' } }
  } else {
    targets = [{ id: piece.platform }]
  }

  const state = claimed.dispatch_state && typeof claimed.dispatch_state === 'object' ? claimed.dispatch_state : {}
  let channelState = state.published_channels?.[piece.platform] || {}
  const todo = unpostedTargets(targets, channelState)

  // Already fully dispatched (a prior run posted every target) — idempotent no-op.
  if (todo.length === 0) {
    await releaseClaim()
    return { dispatched: true, alreadyDispatched: true }
  }

  async function persistState(nextChannelState) {
    const nextState = {
      ...state,
      published_channels: { ...(state.published_channels || {}), [piece.platform]: nextChannelState },
    }
    state.published_channels = nextState.published_channels
    await sb(`content_items?id=eq.${piece.id}&${wsFilter}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ dispatch_state: nextState, updated_at: new Date().toISOString() }),
    }).catch((e) => console.warn('[dispatchContentItem] dispatch_state persist failed:', e?.message))
  }

  let firstResult = null
  try {
    for (const t of todo) {
      // GBP: honor the per-location body override generated at draft time
      // (keyed by workspace_locations.id) — matching the client publish path.
      const text = (piece.platform === 'gbp' && locationOverrides[t.id]) ? locationOverrides[t.id] : content
      const publisher = piece.platform === 'gbp'
        ? new BundlePublisher(ws, { teamId: t.teamId })
        : new BundlePublisher(ws)
      const r = await publisher.publish({ platform: piece.platform, content: text, mediaUrls, scheduledAt })
      firstResult = firstResult || r
      // Record THIS post immediately so a mid-fan-out failure can't cause a
      // retry to double-post an already-posted location.
      channelState = mergePostedLocations(
        { ...channelState, content_item_id: piece.id },
        [{ id: t.id, postId: r.postId }],
        new Date().toISOString(),
      )
      await persistState(channelState)
    }
  } catch (e) {
    console.error('[dispatchContentItem] publish failed:', ws.slug, piece.id, e?.message)
    // Some targets may have posted (recorded above); release the claim so a
    // re-approve can retry the remaining targets idempotently. Do NOT fall back
    // to the client (it would re-post).
    await releaseClaim()
    return { dispatched: false, error: (e?.message || 'dispatch_failed').slice(0, 200) }
  }

  // All targets posted — commit the row to scheduled + clear the claim.
  await releaseClaim({
    status: 'scheduled',
    buffer_update_id: firstResult?.postId ?? null,
    scheduled_at: firstResult?.scheduledAt ?? scheduledAt ?? null,
  })
  return {
    dispatched: true,
    postId: firstResult?.postId ?? null,
    scheduledAt: firstResult?.scheduledAt ?? scheduledAt ?? null,
    profileCount: todo.length,
  }
}
