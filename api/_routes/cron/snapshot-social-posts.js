import { withSentry } from '../../_lib/sentry.js'
export const config = { runtime: 'nodejs' }
// GET /api/cron/snapshot-social-posts
//
// Weekly sync of each bundle.social workspace's ACCOUNT-level analytics into
// social_channel_snapshots — the /outcome-review adoption denominator, and
// (since migration 215) the IG reach series the 2026-09-15 reel kill
// criterion reads. bundle snapshots every connected account roughly daily but
// RETAINS only a ~31-day sliding window (measured 2026-09-04: exactly 31
// items), so anything not persisted here is unrecoverable a month later.
//
// Each run therefore upserts bundle's ENTIRE retained series — one row per
// daily item, deduped on (workspace_id, platform, snapshot_at) via the
// migration-215 unique index + PostgREST merge-duplicates — rather than just
// the newest item. Two properties fall out:
//   - a missed weekly run self-heals completely (the next run re-pulls up to
//     ~31 days), which the old latest-item-only shape could not do;
//   - re-syncing an already-stored day is a harmless overwrite with the same
//     values from the same source.
//
// Row semantics: postCount/followers are CUMULATIVE profile counters (native
// posts included — verified live 2026-07-21 against the movebetter IG);
// impressions/impressions_unique/views/views_unique/likes/comments are
// TRAILING-WINDOW metrics (they move down as well as up day to day — verified
// live 2026-09-04; on IG impressions == impressions_unique on every observed
// item). The monthly review diffs cumulative counters across a month boundary
// and reads the trailing-window metrics directly.
//
// Known platform quirk: Facebook pages may report postCount 0 (Meta doesn't
// expose a reliable page post total). Rows are stored as reported; the
// outcome-review doc tells the reader to fall back to a manual profile check
// when a channel's post_count never moves off 0.
//
// Auth: Bearer CRON_SECRET (same pattern as gsc-snapshot.js).

import { BundlePublisher } from '../../_lib/social/bundlePublisher.js'
import { verifyCronSecret } from '../../_lib/auth.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// eslint-disable-next-line bernard/require-workspace-scope -- Cron — iterates all bundle workspaces; each bundle call is scoped by that workspace's own bundle_team_id and each insert carries its workspace_id
function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    signal: AbortSignal.timeout(8_000),
    ...init,
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

async function processWorkspace(ws, summary) {
  const publisher = new BundlePublisher(ws)

  let accounts
  try {
    accounts = await publisher.listAccounts()
  } catch (e) {
    console.error('[cron/snapshot-social-posts] listAccounts failed:', ws.slug, e?.message)
    summary.workspaces.push({ id: ws.id, slug: ws.slug, error: 'list_accounts_failed' })
    return
  }

  // One series per distinct connected account TYPE (bundle allows one active
  // account per type per Team). Even an unhealthy account is worth reading —
  // bundle keeps serving the last snapshots it captured.
  const types = [...new Set((accounts || []).map((a) => a?.type).filter(Boolean))]

  const rows = []
  const skipped = []
  for (const type of types) {
    try {
      const snap = await publisher.getAccountSnapshots({ platformType: type })
      if (!snap?.snapshots?.length) {
        skipped.push(type)
        continue
      }
      // The whole retained series, one row per daily item — deduped by the
      // upsert below, so re-synced days are harmless (see header comment).
      for (const s of snap.snapshots) {
        rows.push({
          workspace_id:       ws.id,
          platform:           type,
          account_username:   snap.username,
          post_count:         s.postCount,
          followers:          s.followers,
          impressions:        s.impressions,
          impressions_unique: s.impressionsUnique,
          views:              s.views,
          views_unique:       s.viewsUnique,
          likes:              s.likes,
          comments:           s.comments,
          snapshot_at:        s.at,
        })
      }
    } catch (e) {
      // One unsupported/erroring account type must not lose the others.
      console.error('[cron/snapshot-social-posts] snapshot failed:', ws.slug, type, e?.message)
      skipped.push(type)
    }
  }

  if (rows.length === 0) {
    summary.workspaces.push({ id: ws.id, slug: ws.slug, rows: 0, skipped })
    return
  }

  // merge-duplicates (not ignore-): an existing row for the same instant gets
  // its payload columns overwritten — same values from the same source, and it
  // is what filled the reach columns onto pre-215 rows on the first run.
  const ins = await sb(
    'social_channel_snapshots?on_conflict=workspace_id,platform,snapshot_at',
    {
      method:  'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body:    JSON.stringify(rows),
    }
  )
  if (!ins.ok) {
    const text = await ins.text().catch(() => '')
    console.error('[cron/snapshot-social-posts] insert failed', ws.slug, ins.status, text.slice(0, 200))
    summary.workspaces.push({ id: ws.id, slug: ws.slug, error: `insert_${ins.status}` })
    return
  }

  summary.workspaces.push({ id: ws.id, slug: ws.slug, rows: rows.length, skipped })
}

async function handler(req, res) {
  if (!verifyCronSecret(req)) return res.status(401).json({ error: 'Unauthorized' })
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(503).json({ error: 'Supabase env not configured' })
  if (!process.env.BUNDLE_API_KEY) {
    // Nothing to snapshot without the fleet key; inert rather than noisy.
    return res.status(200).json({ checked: 0, skipped: 'no_bundle_api_key' })
  }

  const wsRes = await sb(
    'workspaces?status=eq.active&publish_provider=eq.bundle&bundle_team_id=not.is.null' +
    '&select=id,slug,bundle_team_id'
  )
  if (!wsRes.ok) return res.status(500).json({ error: 'workspace fetch failed' })
  const workspaces = (await wsRes.json().catch(() => [])) || []

  const summary = { startedAt: new Date().toISOString(), workspaces: [] }
  for (const ws of workspaces) {
    try {
      await processWorkspace(ws, summary)
    } catch (e) {
      console.error('[cron/snapshot-social-posts] workspace threw:', ws.id, e?.message)
      summary.workspaces.push({ id: ws.id, slug: ws.slug, error: 'workspace_error' })
    }
  }
  summary.finishedAt = new Date().toISOString()
  return res.status(200).json(summary)
}

export default withSentry(handler)
