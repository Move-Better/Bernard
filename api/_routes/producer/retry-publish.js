// POST /api/producer/retry-publish  { contentItemId }
//
// Manually re-attempts a failed social publish for one content_items row.
// Closes a real gap: the "Needs you" publish_failed card (NeedsYouStrip.jsx)
// told the user "Reconnect and I'll dispatch the queued post automatically",
// but nothing ever retried the post — reconnecting a channel on Buffer/
// bundle.social has no effect on the stored failure record, and the card only
// clears when a later successful publish for the same content_item_id is
// recorded, or when the 24h FAILURE_WINDOW_MS in needs-you.js ages it out.
//
// Reuses the exact channel-resolution + fan-out logic from
// api/_routes/publish/buffer.js (runBufferPublish / runBundlePublish) so a
// retry runs through the identical code path as the original publish, just
// sourcing platform/content/media from the content_items row itself instead
// of a fresh request body.
//
// On success: content_items → status back to scheduled/published,
// publish_error cleared, platform_post_id/buffer_update_id set; an
// agent_actions 'published' row is written so needs-you.js's
// unresolvedPublishFailures() supersedes the earlier 'publish_failed' row for
// this content_item_id on the next fetch.
// On failure: publish_error is updated with the new reason and
// notifyPublishFailure() records a fresh 'publish_failed' action + owner
// email, so the card stays up-to-date with the latest attempt.
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole } from '../../_lib/auth.js'
import { EDITOR_ROLES } from '../../_lib/roles.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { getCredential } from '../../_lib/getCredential.js'
import { recordAgentAction } from '../../_lib/agentActions.js'
import { notifyPublishFailure } from '../../_lib/notifyPublishFailure.js'
import { runBufferPublish, runBundlePublish } from '../publish/buffer.js'
import { checkWordsApproved } from '../../_lib/wordsApprovalGate.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

const err = (res, msg, status = 400) => res.status(status).json({ error: msg })

async function dbErr(res, r, msg = 'Database error', status = 500) {
  const body = await r.text().catch(() => '')
  console.error(`[producer/retry-publish] ${msg} — supabase ${r.status}: ${body.slice(0, 500)}`)
  return res.status(status).json({ error: msg })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405)
  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'Workspace not resolved', 400)
  const auth = await requireRole(req, EDITOR_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  if (!(await enforceLimit(req, res, 'publish', ws.id))) return

  const { contentItemId } = req.body || {}
  if (!contentItemId) return err(res, 'Missing contentItemId')
  if (!UUID_RE.test(contentItemId)) return err(res, 'Invalid contentItemId', 400)

  const itemRes = await sb(
    `content_items?id=eq.${contentItemId}&workspace_id=eq.${ws.id}` +
    `&select=id,platform,content,media_urls,scheduled_at,location_overrides,status,interview_id`,
  )
  if (!itemRes.ok) return dbErr(res, itemRes)
  const itemRows = await itemRes.json()
  if (!itemRows.length) return err(res, 'Content item not found', 404)
  const item = itemRows[0]

  if (item.status !== 'failed') return err(res, 'not_failed', 409)

  // Words-approval gate (Phase 3, story-monitor redesign) — a retry is a
  // publish dispatch like any other, so it's gated the same way.
  const gate = await checkWordsApproved(contentItemId, ws.id)
  if (!gate.ok) return res.status(gate.status).json(gate.body)

  const platform = item.platform
  const content = item.content
  const mediaUrls = Array.isArray(item.media_urls) ? item.media_urls : []
  // A missed scheduled time isn't re-sent into the past — post it now instead.
  // (A 'failed' status normally means the send was already attempted, so
  // scheduled_at is typically in the past by the time this runs anyway.)
  const scheduledAt = item.scheduled_at && new Date(item.scheduled_at).getTime() > Date.now()
    ? item.scheduled_at
    : null
  // location_overrides is populated for EVERY active GBP location at draft
  // time (buildGbpLocationVariants), so its key set already equals what
  // resolveGbpChannelIds/resolveBundleGbpTargets would default to when
  // locationIds is omitted. ponytail: if a human later narrowed a multi-
  // location GBP post down to a subset at publish time, that subset isn't
  // persisted anywhere on content_items, so a retry re-targets every active
  // location rather than the originally-picked one. Not reachable for
  // non-GBP platforms.
  const locationIds = item.location_overrides && typeof item.location_overrides === 'object'
    ? Object.keys(item.location_overrides)
    : undefined
  const locationContents = item.location_overrides && typeof item.location_overrides === 'object'
    ? Object.fromEntries(
        Object.entries(item.location_overrides)
          .filter(([, v]) => v && typeof v === 'object')
          .map(([id, v]) => [id, v.content]),
      )
    : undefined

  let result
  if ((ws.publish_provider || 'buffer') === 'bundle') {
    result = await runBundlePublish(ws, { platform, content, mediaUrls, scheduledAt, locationIds, locationContents })
  } else {
    const cred = await getCredential(ws.id, 'buffer')
    if (!cred?.secret) return err(res, 'not_configured', 503)
    result = await runBufferPublish({
      workspaceId: ws.id, token: cred.secret, platform, content, mediaUrls, scheduledAt,
      useQueue: false, locationIds, locationContents,
    })
  }

  if (result.status !== 200 || !result.body?.success) {
    const reason = typeof result.body?.error === 'string' ? result.body.error : 'Retry failed'
    await sb(`content_items?id=eq.${contentItemId}&workspace_id=eq.${ws.id}`, {
      method: 'PATCH',
      body:   JSON.stringify({ publish_error: reason.slice(0, 2000), updated_at: new Date().toISOString() }),
    }).catch(() => {})
    notifyPublishFailure({ workspaceId: ws.id, item: { id: contentItemId, platform, content }, reason }).catch(() => {})
    return res.status(result.status && result.status >= 400 ? result.status : 502).json({ error: 'retry_failed' })
  }

  const willBeScheduled = !!scheduledAt
  const patch = {
    status:            willBeScheduled ? 'scheduled' : 'published',
    published_at:      willBeScheduled ? null : new Date().toISOString(),
    platform_post_id:  result.body.bufferId ?? null,
    buffer_update_id:  result.body.bufferId ?? null,
    publish_error:     null,
    updated_at:        new Date().toISOString(),
    ...(willBeScheduled && result.body.scheduledAt ? { scheduled_at: result.body.scheduledAt } : {}),
  }
  const upd = await sb(`content_items?id=eq.${contentItemId}&workspace_id=eq.${ws.id}`, {
    method: 'PATCH',
    body:   JSON.stringify(patch),
  })
  if (!upd.ok) return dbErr(res, upd, 'Update after retry failed')

  await recordAgentAction({
    workspaceId:    ws.id,
    producerConfig: ws.producer_config,
    kind:           'published',
    title:          `Published a post to ${platform} (retried)`,
    detail:         { platform },
    contentItemId,
  })

  return res.status(200).json({ success: true })
}
