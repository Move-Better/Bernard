import { withSentry } from '../../_lib/sentry.js'
export const config = { runtime: 'nodejs' }
// Social publish endpoint — Node.js runtime.
//
// Publishes to bundle.social, the only provider since #2488. Credentials are
// resolved per-workspace so each tenant brings its own bundle team.
//
// GBP fans out across the workspace's active locations, one bundle Team each
// (bundle allows one active Google Business listing per Team). Other platforms
// post once to the workspace brand Team.
//
// The legacy path /api/publish/buffer still resolves here via the alias in
// ./buffer.js — see that file for when it can be deleted.

import { workspaceScope } from '../../_lib/workspaceScope.js'
import { requireRole } from '../../_lib/auth.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { BundlePublisher } from '../../_lib/social/index.js'
import { YOUTUBE_PRIVACIES } from '../../_lib/social/bundlePublisher.js'
import { resolveBundleGbpTargets } from '../../_lib/social/gbpTargets.js'
import { checkWordsApproved } from '../../_lib/wordsApprovalGate.js'
import { claimDispatch, releaseDispatch } from '../../_lib/dispatchClaim.js'
import { clampToCap, platformCap } from '../../_lib/socialLengthTargets.js'
import { FORMAT_IDS } from '../../../src/lib/platformFormats.js'

// GBP's hard character ceiling, resolved from the single source of truth.
const GBP_CAP = platformCap('gbp')
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Executes a publish for already-resolved inputs. Extracted from the HTTP
// handler below so the producer retry-publish route
// (api/_routes/producer/retry-publish.js) can re-run the identical
// channel-resolution + fan-out logic against a content_items row's own stored
// fields, instead of duplicating the sequence.
export async function runBundlePublish(workspace, { platform, content, mediaUrls = [], scheduledAt, locationIds, locationContents, format = null, title = null, description = null, privacy = null }) {
  let publisher
  try {
    publisher = new BundlePublisher(workspace)
  } catch (_e) {
    return { status: 503, body: { error: 'bundle_not_configured' } }
  }

  // GBP fan-out: post to each active location that has its own connected bundle
  // Team. See handleBundlePublish's header comment for the full rationale.
  if (platform === 'gbp') {
    try {
      const targets = await resolveBundleGbpTargets(workspace.id, locationIds)
      if (targets.length === 0) {
        return {
          status: 404,
          body: { error: 'No Google Business location is connected to bundle.social. Open Settings → Integrations and connect each location’s Google Business listing.' },
        }
      }
      const gbpMediaUrls = Array.isArray(mediaUrls) ? mediaUrls.slice(0, 1) : mediaUrls
      const posts = []
      for (const loc of targets) {
        const rawText = (locationContents && typeof locationContents === 'object' && locationContents[loc.id]) || content
        const text = clampToCap(rawText, GBP_CAP)
        const locPublisher = new BundlePublisher(workspace, { teamId: loc.teamId })
        const r = await locPublisher.publish({ platform: 'gbp', content: text, mediaUrls: gbpMediaUrls, scheduledAt })
        posts.push(r)
      }
      const first = posts[0]
      return {
        status: 200,
        body: {
          success: true,
          postId: first?.postId,
          bufferId: first?.postId, // legacy alias — drop with ./buffer.js
          scheduledAt: first?.scheduledAt,
          status: first?.status,
          profileCount: posts.length,
        },
      }
    } catch (e) {
      console.error('[publish/bundle gbp] failed:', e?.stack || e?.message, e?.body ? JSON.stringify(e.body) : '')
      return { status: 502, body: { error: 'bundle_gbp_post_failed' } }
    }
  }

  try {
    const result = await publisher.publish({ platform, content, mediaUrls, scheduledAt, format, title, description, privacy })
    return {
      status: 200,
      body: {
        success: result.success,
        postId: result.postId,
        bufferId: result.postId, // legacy alias — drop with ./buffer.js
        scheduledAt: result.scheduledAt,
        status: result.status,
        profileCount: result.profileCount,
      },
    }
  } catch (e) {
    console.error('[publish/bundle] failed:', e?.stack || e?.message, e?.body ? JSON.stringify(e.body) : '')
    return { status: 502, body: { error: 'bundle_post_failed' } }
  }
}

async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const scope = await workspaceScope(req)
  if (!scope) return res.status(404).json({ error: 'no_workspace' })
  const auth = await requireRole(req, null, { orgId: scope.workspace.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  if (!(await enforceLimit(req, res, 'publish', scope.workspace.id))) return

  // bundle.social is the only provider (2026-07-30). The Buffer fork that used
  // to live here is gone: migration 197 moved every workspace to bundle, so the
  // branch was already unreachable at runtime before it was deleted — which is
  // what makes this removal behaviour-preserving rather than a bet.
  //
  // Two hand-synced publish paths had already produced real incidents (the GBP
  // 1500-char clamp existing on only one of them; ~12 UI strings naming the
  // wrong provider), and the format work — mixed carousels, explicit
  // Reel/Story — is expressible only through the bundle adapter.
  return handleBundlePublish(req, res, scope.workspace)
}

// Bundle.social publish path. Request/response contract, unchanged since the
// Buffer fork was deleted: DELETE { platformPostId }; POST { platform, content,
// mediaUrls, scheduledAt, locationIds?, locationContents? }; response
// { success, postId, bufferId, … } where both id fields carry the same bundle
// post id (stored as content_items.platform_post_id downstream).
//
// `bufferId` is retained alongside `postId` only so a browser tab on the
// previous JS bundle still reads an id back — see ./buffer.js for when both it
// and the alias route can go.
//
// GBP multi-location fan-out: a Google Business post fans out across each active
// location that has its own connected bundle Team (one Team per location — bundle
// allows one active GBP per Team). Non-GBP platforms post once to the workspace
// brand Team (Instagram/Facebook).
async function handleBundlePublish(req, res, workspace) {
  let publisher
  try {
    publisher = new BundlePublisher(workspace)
  } catch (_e) {
    return res.status(503).json({ error: 'bundle_not_configured' })
  }

  if (req.method === 'DELETE') {
    const body = (typeof req.body === 'object' && req.body) ? req.body : {}
    // `bufferUpdateId` is the pre-rename request field. Accepted alongside the
    // current name because a browser tab on the previous JS bundle still sends
    // it, and Bernard is a PWA whose service worker can serve a cached shell for
    // a while after a deploy — cancelling a scheduled post is exactly where a
    // 400 costs the user a real post going out. Drop with ./buffer.js.
    const postId = body.platformPostId || body.bufferUpdateId
    if (!postId || typeof postId !== 'string') {
      return res.status(400).json({ error: 'Missing platformPostId' })
    }
    // Verify the scheduled post belongs to this workspace before cancelling —
    // prevents a member of workspace A from cancelling workspace B's posts.
    // The bundle post id is stored as content_items.platform_post_id
    // downstream, which is what makes this ownership check possible.
    if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(503).json({ error: 'Service not configured' })
    const ownerCheck = await fetch(
      `${SUPABASE_URL}/rest/v1/content_items?platform_post_id=eq.${encodeURIComponent(postId)}&workspace_id=eq.${workspace.id}&select=id`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
    )
    if (ownerCheck.ok) {
      const rows = await ownerCheck.json()
      if (!rows.length) return res.status(403).json({ error: 'Post not found in this workspace' })
    }
    try {
      const r = await publisher.deletePost({ postId })
      return res.status(200).json({ success: true, ...(r.alreadyGone ? { alreadyGone: true } : {}) })
    } catch (e) {
      console.error('[publish/bundle DELETE] failed:', e?.stack || e?.message)
      return res.status(502).json({ error: 'bundle_cancel_failed' })
    }
  }

  const body = (typeof req.body === 'object' && req.body) ? req.body : {}
  const { platform, content, mediaUrls = [], scheduledAt, locationIds, locationContents, contentItemId, format } = body
  if (!platform || !content) return res.status(400).json({ error: 'Missing platform or content' })

  // YouTube-only extras: the video title and description are two separate fields
  // there (every other network has one caption), plus bundle's privacy enum.
  // Ignored for other platforms — buildDataBlock only reads them under YOUTUBE.
  const ytTitle = typeof body.title === 'string' ? body.title.trim() : null
  const ytDescription = typeof body.description === 'string' ? body.description : null
  const ytPrivacy = typeof body.privacy === 'string' ? body.privacy.toUpperCase() : null
  if (ytPrivacy && !YOUTUBE_PRIVACIES.has(ytPrivacy)) {
    return res.status(400).json({ error: 'invalid_privacy' })
  }
  // Explicit format is optional; when present it must be from the shared
  // vocabulary (src/lib/platformFormats.js). Media-vs-format fit is validated
  // deeper, in BundlePublisher.publish, where the media entries are in hand.
  if (format != null && !FORMAT_IDS.includes(format)) {
    return res.status(400).json({ error: 'invalid_format' })
  }

  // Words-approval gate (Phase 3, story-monitor redesign) — see
  // api/_lib/wordsApprovalGate.js for the full rationale.
  const gate = await checkWordsApproved(contentItemId, workspace.id)
  if (!gate.ok) return res.status(gate.status).json(gate.body)

  // ── Cross-path double-publish guard (audit P1, 2026-07-15) ────────────────
  // The /week Approve path (api/_lib/dispatchContentItem.js) dispatches the SAME
  // piece to bundle.social behind an atomic dispatching_at claim. This editor
  // Publish/Schedule path must take the SAME lock (api/_lib/dispatchClaim.js), or
  // the two can post the piece to the customer's live channel twice. Only a
  // piece-backed publish can be guarded — an ad-hoc publish with no contentItemId
  // has no row to lock (and no persisted piece another path could also dispatch).
  let claimed = false
  if (contentItemId && UUID_RE.test(contentItemId)) {
    const claim = await claimDispatch(contentItemId, workspace.id)
    if (!claim.ok) {
      // in_progress: another dispatch (Approve, or a double-clicked Publish)
      // holds a fresh claim — surface 409 so the client does NOT re-post. Its
      // own status PATCH never runs; the winning path commits the row.
      return res.status(claim.reason === 'in_progress' ? 409 : 502).json({
        error: claim.reason === 'in_progress' ? 'dispatch_in_progress' : 'claim_failed',
      })
    }
    if (claim.row?.status === 'scheduled' || claim.row?.status === 'published') {
      // The other path already dispatched this piece — release and report
      // success so the client settles without posting again.
      await releaseDispatch(contentItemId, workspace.id)
      return res.status(200).json({ success: true, alreadyDispatched: true })
    }
    claimed = true
  }

  let result
  try {
    result = await runBundlePublish(workspace, {
      platform, content, mediaUrls, scheduledAt, locationIds, locationContents,
      format: format || null,
      title: ytTitle, description: ytDescription, privacy: ytPrivacy,
    })
  } catch (e) {
    // runBundlePublish catches internally today; this is belt-and-suspenders so
    // an unexpected throw can never strand the claim (released below).
    console.error('[publish/bundle] dispatch threw:', e?.stack || e?.message)
    result = { status: 502, body: { error: 'bundle_post_failed' } }
  }

  if (claimed) {
    // On success, commit a terminal status in the SAME release so there's no
    // dispatching_at=null / status=approved gap the Approve path could re-claim
    // and re-post into before the client's own status PATCH lands. On failure,
    // release only (status untouched) so a retry can re-acquire the lock.
    //
    // 'scheduled' even for publish-now: bundle ALWAYS creates the post as
    // SCHEDULED (postDate ≈ now + 60s) and promotes it to POSTED itself, so
    // nothing is live at this point. Claiming 'published' here was a claim we
    // couldn't back — and it silently defeated the post.published webhook, whose
    // promote is guarded on status=eq.scheduled, so published_at and the live
    // post URL never landed for exactly the posts a user was watching.
    //
    // scheduled_at MUST carry a real timestamp, never null: the hourly
    // sync-published-status backstop only picks up rows whose scheduled_at is
    // non-null AND in the past, so a null would strand the row at 'scheduled'
    // forever on any workspace whose webhook delivery failed.
    const committedAt = scheduledAt || result.body?.scheduledAt || new Date().toISOString()
    const extra = result.status === 200
      ? { status: 'scheduled', scheduled_at: committedAt }
      : {}
    await releaseDispatch(contentItemId, workspace.id, extra)

    if (result.status === 200) {
      // Tell the client the row is already committed so it doesn't overwrite the
      // status with an optimistic 'published' of its own.
      return res.status(200).json({ ...result.body, committedStatus: 'scheduled', scheduledAt: committedAt })
    }
  }

  return res.status(result.status).json(result.body)
}

export default withSentry(handler)
