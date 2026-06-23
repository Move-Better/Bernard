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

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

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

async function fetchOverdueItems(wsFilter = '') {
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
    `&select=id,workspace_id,buffer_update_id,scheduled_at` +
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
  return r.ok
}

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return res.status(503).json({ error: 'CRON_SECRET not configured' })
  if (req.headers?.authorization !== `Bearer ${cronSecret}`) {
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
  if (!activeIds.length) {
    console.info('[sync-buffer-published] no active workspaces; skipping sync')
    return res.status(200).json({ checked: 0, promoted: 0, skipped: 0, errors: 0 })
  }
  const wsScope = `&workspace_id=in.(${activeIds.map(id => `"${id}"`).join(',')})`
  const items = await fetchOverdueItems(wsScope)
  if (items.length === 0) {
    return res.status(200).json({ checked: 0, promoted: 0, skipped: 0, errors: 0 })
  }

  const byWorkspace = groupByWorkspace(items)
  const summary = { checked: items.length, promoted: 0, skipped: 0, errors: 0, workspaces: [] }

  for (const [workspaceId, wsItems] of Object.entries(byWorkspace)) {
    const wsRow = wsMap[workspaceId] || {}
    const wsResult = { workspaceId, promoted: 0, skipped: 0, errors: 0, notFound: 0 }

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
            // SCHEDULED / PROCESSING / REVIEW / RETRYING — still in flight, check next run.
            // ERROR / DELETED — permanent failure; leave as scheduled so it's visible in the UI.
            if (!status.isFailed) { summary.skipped++; wsResult.skipped++ }
            else wsResult.notFound++
            continue
          }
          const promoted = await promoteToPublished(
            item.id, workspaceId,
            status.postedAt || new Date().toISOString()
          )
          if (promoted) { summary.promoted++; wsResult.promoted++ }
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
        if (promoted) {
          summary.promoted++
          wsResult.promoted++
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
