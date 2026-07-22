export const config = { runtime: 'nodejs' }
// Cron: sync published status back from Buffer (runs hourly).
//
// Finds all content_items where status='scheduled', buffer_update_id IS NOT NULL,
// and scheduled_at is in the past. For each, asks Buffer whether the post has
// actually been sent (post.sentAt set). If yes, promotes the row to
// status='published' with published_at=sentAt.
//
// This closes the gap where Buffer publishes a scheduled post autonomously but
// Bernard has no inbound webhook to hear about it.
//
// Auth: Bearer CRON_SECRET (same as all other crons).

import { getCredential } from '../../_lib/getCredential.js'
import { fetchPostStats } from '../../_lib/bufferPostStats.js'
import { BundlePublisher } from '../../_lib/social/bundlePublisher.js'
import { notifyPublishFailure } from '../../_lib/notifyPublishFailure.js'
import { recordAgentAction } from '../../_lib/agentActions.js'
import { verifyCronSecret } from '../../_lib/auth.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Look back at most 30 days to avoid hammering Buffer for very old orphaned rows.
const LOOKBACK_DAYS = 30
// Cap items processed per run to keep latency predictable.
const MAX_ITEMS = 100

// eslint-disable-next-line bernard/require-workspace-scope -- Cron — iterates all workspaces; each DB query is scoped by workspace_id from the workspace list
function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer:        'return=representation',
      ...init.headers,
    },
  })
}

async function fetchOverdueItems(wsFilter) {
  if (!wsFilter) throw new Error('[sync-buffer-published] wsFilter is required — refusing unscoped query')
  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()
  // scheduled_at.lt.now() catches everything past its window;
  // scheduled_at.gte.cutoff avoids touching rows older than 30 days.
  const r = await sb(
    `content_items` +
    `?status=eq.scheduled` +
    `&buffer_update_id=not.is.null` +
    `&scheduled_at=lt.${new Date().toISOString()}` +
    `&scheduled_at=gte.${cutoff}` +
    wsFilter +
    `&select=id,workspace_id,buffer_update_id,scheduled_at,platform,topic,resolved_url` +
    `&order=scheduled_at.asc` +
    `&limit=${MAX_ITEMS}`
  )
  if (!r.ok) {
    console.error('[sync-buffer-published] overdue fetch failed:', r.status)
    return []
  }
  return (await r.json().catch(() => [])) || []
}

// Group items by workspace_id so we only decrypt each credential once.
function groupByWorkspace(items) {
  const map = {}
  for (const item of items) {
    if (!map[item.workspace_id]) map[item.workspace_id] = []
    map[item.workspace_id].push(item)
  }
  return map
}

async function promoteToPublished(id, workspaceId, sentAt) {
  const r = await sb(
    `content_items?id=eq.${id}&workspace_id=eq.${workspaceId}&status=eq.scheduled`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        status:       'published',
        published_at: sentAt,
        updated_at:   new Date().toISOString(),
      }),
    }
  )
  if (!r.ok) return { ok: false, transitioned: false }
  // return=representation → an empty array means the row was no longer
  // 'scheduled' (the webhook beat us to it), so THIS run didn't cause the
  // transition and must not log a duplicate 'published' ledger row.
  const rows = await r.json().catch(() => [])
  return { ok: true, transitioned: Array.isArray(rows) && rows.length > 0 }
}

// Store the live post's URL so the UI can offer "View live post". The webhook
// normally gets here first; this covers the deliveries it missed (endpoint not
// registered, dropped delivery). Unguarded by status — the permalink is a fact
// about the post, not a consequence of our bookkeeping — and skipped when the
// row already has one. Best-effort; a missing receipt must never fail the sync.
async function recordPermalink(id, workspaceId, permalink) {
  try {
    await sb(`content_items?id=eq.${id}&workspace_id=eq.${workspaceId}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ resolved_url: permalink, updated_at: new Date().toISOString() }),
    })
  } catch (e) {
    console.warn('[sync-buffer-published] resolved_url write failed for item:', id, e?.message)
  }
}

// Workday ledger (Standing Producer Phase 0) — narrate a publish this cron just
// confirmed. Gated on producer_config.enabled inside the helper (fetched, since
// the item row carries no config). Best-effort; never throws.
async function recordPublished(workspaceId, item) {
  const topic = (item.topic || '').trim()
  await recordAgentAction({
    workspaceId,
    kind:          'published',
    title:         topic ? `Published "${topic.slice(0, 80)}" to ${item.platform}` : `Published a post to ${item.platform}`,
    detail:        { platform: item.platform || null },
    contentItemId: item.id,
  })
}

// Mark a scheduled post as permanently failed, with the reason bundle returned.
// Guarded on status=eq.scheduled so a row a webhook already resolved (Phase 2)
// is never clobbered by this slower cron pass.
async function markFailed(id, workspaceId, reason) {
  const r = await sb(
    `content_items?id=eq.${id}&workspace_id=eq.${workspaceId}&status=eq.scheduled`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        status:        'failed',
        publish_error: (reason || 'Publishing failed on the network.').slice(0, 2000),
        updated_at:    new Date().toISOString(),
      }),
    }
  )
  if (!r.ok) return { ok: false, transitioned: false }
  // return=representation → updated rows; an empty array means the row was no
  // longer 'scheduled' (e.g. the webhook beat us to it), so this run did NOT
  // cause the transition and must not re-send the owner email.
  const rows = await r.json().catch(() => [])
  return { ok: true, transitioned: Array.isArray(rows) && rows.length > 0 }
}

export default async function handler(req, res) {
    if (!verifyCronSecret(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(503).json({ error: 'Supabase env not configured' })
  }

  const wsRes = await sb('workspaces?status=eq.active&select=id,publish_provider,bundle_team_id')
  if (!wsRes.ok) {
    console.error('[sync-buffer-published] workspace fetch failed:', wsRes.status)
    return res.status(500).json({ error: 'workspace fetch failed' })
  }
  const wsRows = await wsRes.json().catch(() => [])
  const wsMap = {}
  const activeIds = (Array.isArray(wsRows) ? wsRows : []).map((w) => { wsMap[w.id] = w; return w.id })
  const safeIds = activeIds.filter(id => UUID_RE.test(id))
  if (!safeIds.length) {
    console.info('[sync-buffer-published] no active workspaces; skipping sync')
    return res.status(200).json({ checked: 0, promoted: 0, failed: 0, skipped: 0, errors: 0 })
  }
  const wsScope = `&workspace_id=in.(${safeIds.map(id => `"${id}"`).join(',')})`
  const items = await fetchOverdueItems(wsScope)
  if (items.length === 0) {
    return res.status(200).json({ checked: 0, promoted: 0, failed: 0, skipped: 0, errors: 0 })
  }

  const byWorkspace = groupByWorkspace(items)
  const summary = { checked: items.length, promoted: 0, failed: 0, skipped: 0, errors: 0, workspaces: [] }

  for (const [workspaceId, wsItems] of Object.entries(byWorkspace)) {
    const wsRow = wsMap[workspaceId] || {}
    const wsResult = { workspaceId, promoted: 0, failed: 0, skipped: 0, errors: 0, notFound: 0 }

    if (!wsRow.id) {
      console.warn('[sync-buffer-published] skipping unknown workspace:', workspaceId)
      summary.skipped += wsItems.length
      summary.workspaces.push({ workspaceId, skipped: wsItems.length, reason: 'unknown-workspace' })
      continue
    }

    if (wsRow.publish_provider === 'bundle') {
      // bundle.social path: postGet({ id }) returns { status, postedDate }.
      // bundle transitions SCHEDULED → POSTED autonomously within seconds/minutes.
      let publisher
      try {
        publisher = new BundlePublisher(wsRow)
      } catch (e) {
        console.warn('[sync-buffer-published] bundle init failed for workspace:', workspaceId, e?.message)
        summary.skipped += wsItems.length
        summary.workspaces.push({ workspaceId, skipped: wsItems.length, reason: 'bundle-init-failed' })
        continue
      }

      for (const item of wsItems) {
        try {
          const status = await publisher.getPostStatus({ postId: item.buffer_update_id })
          if (!status?.status) {
            // Null response — post not found or deleted; leave as-is.
            wsResult.notFound++
            continue
          }
          if (!status.isPosted) {
            if (status.isError) {
              // Network rejected it permanently — mark failed so the UI surfaces it
              // (badge + Home banner) instead of it sitting forever as "scheduled".
              const reason = status.error || 'Publishing failed on the network.'
              const r = await markFailed(item.id, workspaceId, reason)
              if (!r.ok) { summary.errors++; wsResult.errors++ }
              else if (r.transitioned) {
                summary.failed++; wsResult.failed++
                // Phase 4: alert the workspace owner — only on a real transition,
                // so the cron and webhook never double-email the same failure.
                await notifyPublishFailure({ workspaceId, item, reason })
              }
            } else if (status.isFailed) {
              // DELETED in bundle (usually intentional) — not a publish failure; leave as-is.
              wsResult.notFound++
            } else {
              // SCHEDULED / PROCESSING / REVIEW / RETRYING — still in flight, check next run.
              summary.skipped++; wsResult.skipped++
            }
            continue
          }
          if (status.permalink && !item.resolved_url) {
            await recordPermalink(item.id, workspaceId, status.permalink)
          }
          const promoted = await promoteToPublished(
            item.id, workspaceId,
            status.postedAt || new Date().toISOString()
          )
          if (promoted.ok) {
            summary.promoted++; wsResult.promoted++
            if (promoted.transitioned) await recordPublished(workspaceId, item)
          }
          else { summary.errors++; wsResult.errors++ }
        } catch (e) {
          console.error('[sync-buffer-published] bundle postGet error for item:', item.id, e?.message)
          summary.errors++
          wsResult.errors++
        }
      }
    } else {
      // Buffer path (unchanged).
      const cred = await getCredential(workspaceId, 'buffer')
      if (!cred?.secret) {
        console.warn('[sync-buffer-published] no Buffer token for workspace:', workspaceId)
        summary.skipped += wsItems.length
        summary.workspaces.push({ workspaceId, skipped: wsItems.length, reason: 'no-token' })
        continue
      }

      for (const item of wsItems) {
        const { ok, post, errors } = await fetchPostStats(cred.secret, item.buffer_update_id)

        if (!ok) {
          console.error('[sync-buffer-published] Buffer API error for item:', item.id, errors)
          summary.errors++
          wsResult.errors++
          continue
        }

        if (!post) {
          // Buffer returned null — post was deleted or ID is no longer valid.
          wsResult.notFound++
          continue
        }

        // Buffer sets sentAt when the post has been delivered to the platform.
        if (!post.sentAt) {
          summary.skipped++
          wsResult.skipped++
          continue
        }

        const promoted = await promoteToPublished(item.id, workspaceId, post.sentAt)
        if (promoted.ok) {
          summary.promoted++
          wsResult.promoted++
          if (promoted.transitioned) await recordPublished(workspaceId, item)
        } else {
          summary.errors++
          wsResult.errors++
        }
      }
    }

    summary.workspaces.push(wsResult)
  }

  console.info('[sync-buffer-published]', JSON.stringify(summary))
  return res.status(200).json(summary)
}
