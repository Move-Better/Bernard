// bundle.social webhook receiver — real-time publish status (Phase 2).
//
// bundle has no separate failure event: the `post.published` event fires for
// BOTH outcomes and you read data.status (POSTED = live, ERROR = failed
// permanently; reason in data.error / data.errorsVerbose / data.errors[]).
// See https://info.bundle.social/api-reference/webhooks.md
//
// This collapses failure-detection latency from the hourly sync cron to seconds
// and — because it keys on the bundle post id, not the row's status — also
// reconciles "publish now" posts that were optimistically marked 'published'
// but actually errored on the network.
//
// Auth: bundle signs every body with HMAC-SHA256 in an `x-signature` header;
// the SDK's webhooks.constructEvent() verifies + parses it. We MUST verify
// before touching the DB — the URL is public and a forged ERROR/POSTED could
// flip a post's status.
//
// ENV — BUNDLE_WEBHOOK_SECRET (Sensitive) is the webhook signing secret from
// the bundle.social dashboard; BUNDLE_API_KEY is the existing fleet key. Until
// the endpoint is registered + the secret set, this returns 503 (no webhooks
// arrive yet), so it is inert rather than insecure.

// Mounted inside the api/index Express app (per the route manifest), so this
// per-file config is informational — body handling is governed by api/index's
// express.json() middleware, which exposes the raw bytes on req.rawBody.
export const config = { runtime: 'nodejs' }

import { Bundlesocial } from 'bundlesocial'
import { waitUntil } from '@vercel/functions'
import { bundleErrorText, bundlePermalink } from '../../_lib/social/bundlePublisher.js'
import { notifyPublishFailure } from '../../_lib/notifyPublishFailure.js'
import { recordAgentAction } from '../../_lib/agentActions.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// eslint-disable-next-line bernard/require-workspace-scope -- bundle webhook — workspace resolved from content_items.workspace_id via the (org-global) bundle post id, not the Host header
function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey:         SUPABASE_KEY,
      Authorization:  `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer:         'return=representation',
      ...init.headers,
    },
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed', message: 'POST only' })
  }

  const secret = process.env.BUNDLE_WEBHOOK_SECRET
  const apiKey = process.env.BUNDLE_API_KEY
  if (!secret || !apiKey) {
    console.error('[bundle/webhook] BUNDLE_WEBHOOK_SECRET or BUNDLE_API_KEY not set; not configured')
    return res.status(503).json({ error: 'not_configured' })
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(503).json({ error: 'supabase_not_configured' })
  }

  // Every route runs inside the api/index Express app, whose express.json()
  // middleware has already consumed the request stream and stashed the exact
  // bytes on req.rawBody (the Stripe-webhook pattern documented in api/index.js).
  // Re-reading the stream here (req.on('data')) hangs the function — req has
  // already emitted 'end' — so verify the signature against req.rawBody.
  const rawBody = req.rawBody
  const signature = req.headers['x-signature']
  if (!rawBody || !rawBody.length) {
    return res.status(400).json({ error: 'no_raw_body' })
  }

  let event
  try {
    // constructEvent verifies the HMAC-SHA256 signature and parses the payload;
    // it throws on a bad/missing signature.
    event = new Bundlesocial(apiKey).webhooks.constructEvent(rawBody.toString('utf8'), signature, secret)
  } catch (e) {
    console.warn('[bundle/webhook] signature verify / parse failed:', e?.message)
    return res.status(401).json({ error: 'invalid_signature' })
  }

  // Only the post lifecycle carries publish status; ack everything else so
  // bundle doesn't retry deliveries we intentionally ignore.
  if (event?.type !== 'post.published') {
    return res.status(200).json({ received: true, ignored: event?.type || 'unknown' })
  }

  const data = event.data || {}
  const postId = data.id
  const status = data.status
  if (!postId || !status) {
    return res.status(200).json({ received: true, note: 'no post id/status' })
  }

  // Resolve the content_item by bundle post id (globally unique within the org,
  // stored in buffer_update_id). We then scope every write by the row's own
  // workspace_id.
  const look = await sb(
    `content_items?buffer_update_id=eq.${encodeURIComponent(postId)}` +
    `&select=id,workspace_id,status,platform,topic,content,resolved_url&limit=1`,
    { method: 'GET' }
  )
  const rows = look.ok ? (await look.json().catch(() => [])) : []
  const item = Array.isArray(rows) ? rows[0] : null
  if (!item) {
    // Unmatched (post deleted in Bernard, or a retry replaced the id) — ack.
    return res.status(200).json({ received: true, unmatched: true })
  }

  if (status === 'POSTED') {
    // Record the receipt FIRST, and unguarded by status. The permalink is a fact
    // about the live post, not a consequence of our own bookkeeping — the
    // publish-now path marks a row 'published' optimistically, which makes the
    // status-guarded promote below a no-op, and folding the URL into that PATCH
    // would mean the posts most in need of a receipt never got one. Skipped when
    // the row already has one so a redelivered webhook rewrites nothing.
    const permalink = bundlePermalink(data, item.platform)
    if (permalink && !item.resolved_url) {
      await sb(
        `content_items?id=eq.${item.id}&workspace_id=eq.${item.workspace_id}`,
        {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ resolved_url: permalink, updated_at: new Date().toISOString() }),
        }
      ).catch((e) => console.warn('[bundle/webhook] resolved_url write failed:', e?.message))
    }

    // Promote scheduled → published (guarded; a no-op if already published/failed).
    const patch = await sb(
      `content_items?id=eq.${item.id}&workspace_id=eq.${item.workspace_id}&status=eq.scheduled`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          status:       'published',
          published_at: data.postedDate || new Date().toISOString(),
          updated_at:   new Date().toISOString(),
        }),
      }
    )
    // Workday ledger (Standing Producer Phase 0) — record the win only on a real
    // scheduled→published transition, so the webhook and the hourly sync cron
    // never double-log the same publish (whichever wins the race records it).
    const promoted = patch.ok ? (await patch.json().catch(() => [])) : []
    if (Array.isArray(promoted) && promoted.length > 0) {
      const topic = (item.topic || '').trim()
      waitUntil(recordAgentAction({
        workspaceId:   item.workspace_id,
        kind:          'published',
        title:         topic ? `Published "${topic.slice(0, 80)}" to ${item.platform}` : `Published a post to ${item.platform}`,
        detail:        { platform: item.platform || null },
        contentItemId: item.id,
      }))
    }
    return res.status(200).json({ received: true, status: 'POSTED' })
  }

  if (status === 'ERROR') {
    const reason = bundleErrorText(data) || 'Publishing failed on the network.'
    // status=neq.failed allows BOTH scheduled→failed and the optimistic
    // published→failed (publish-now) correction, while making the write
    // idempotent: a second delivery (or the cron) updates 0 rows → no re-email.
    const patch = await sb(
      `content_items?id=eq.${item.id}&workspace_id=eq.${item.workspace_id}&status=neq.failed`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          status:        'failed',
          publish_error: reason.slice(0, 2000),
          updated_at:    new Date().toISOString(),
        }),
      }
    )
    const updated = patch.ok ? (await patch.json().catch(() => [])) : []
    const transitioned = Array.isArray(updated) && updated.length > 0
    if (transitioned) {
      // Phase 4: alert the owner — only on a real transition, so the webhook
      // and the cron never double-email the same failure.
      await notifyPublishFailure({ workspaceId: item.workspace_id, item, reason })
    }
    return res.status(200).json({ received: true, status: 'ERROR', failed: transitioned })
  }

  // PROCESSING / RETRYING / REVIEW etc. — still in flight; ack and wait.
  return res.status(200).json({ received: true, status })
}
