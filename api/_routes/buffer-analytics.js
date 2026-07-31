// Per-post performance metrics — Node.js runtime.
//
// Serves the metrics chip row under a published piece. The cache is
// `engagement_snapshots` (the same table the daily refresh-engagement cron
// writes and that top-performers / social-by-week / workspace-week already
// read) — NOT the retired content_items.buffer_metrics column, which this
// endpoint was the only reader and writer of.
//
// Why the column had to go: bundle.social's CACHED analytics endpoint returns
// all zeros; only a `force: true` pull returns real numbers. The cron forces;
// the non-forced read that populated buffer_metrics did not. Every one of the
// 18 rows in that column was entirely zero while engagement_snapshots held the
// real figures for the same posts (verified in prod 2026-07-30: a Facebook post
// reading 0/0/0 in buffer_metrics had views 5, likes 1, reach 4 in its snapshot).
//
// That is also why this handler no longer fetches on a plain page load. An
// unforced bundle read can only return zeros, and writing those into
// engagement_snapshots would let them SHADOW the cron's real forced readings
// for every downstream scorer (all of which dedupe to the newest snapshot).
// So: reads serve the snapshot cache, and only an explicit ?force=true (the
// Refresh button) performs a live forced read and records a new snapshot.
//
// Handler shape: Node runtime (req, res) — never return new Response() on
// Node; the function will silently hang until the 300s timeout.
export const config = { runtime: 'nodejs' }

import { waitUntil } from '@vercel/functions'
import { workspaceContext } from '../_lib/workspaceContext.js'
import { requireRole } from '../_lib/auth.js'
import { enforceLimit } from '../_lib/ratelimit.js'
import { getCredential } from '../_lib/getCredential.js'
import { fetchPostStats } from '../_lib/bufferPostStats.js'
import { BundlePublisher } from '../_lib/social/index.js'
import { isUnavailable } from '../_lib/engagementScoring.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// bundle has no analytics for these at all — GBP isn't covered by bundle
// (it has its own /api/gbp-analytics path fed by the Google API directly) and
// Twitter is omitted from bundle's analytics enum. Forcing either always
// throws, and force-refresh is capped at ~5/team/day shared with the cron, so
// never spend a slot on one. Same skip-list as processWorkspaceBundle.
const NO_BUNDLE_ANALYTICS = new Set(['gbp', 'twitter'])

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...init.headers,
    },
  })
}

// Latest snapshot for one item from one source. Workspace-scoped on the query,
// not just the FK, so a mis-scoped id can never read another tenant's row.
async function latestSnapshot(workspaceId, contentItemId, source) {
  const r = await sb(
    `engagement_snapshots?content_item_id=eq.${contentItemId}&workspace_id=eq.${workspaceId}` +
    `&source=eq.${source}&order=fetched_at.desc&limit=1&select=stats,fetched_at`,
  )
  if (!r.ok) return null
  const rows = await r.json().catch(() => [])
  return rows?.[0] ?? null
}

function writeSnapshot(workspaceId, contentItemId, source, stats) {
  return sb('engagement_snapshots', {
    method: 'POST',
    body: JSON.stringify({
      workspace_id: workspaceId,
      content_item_id: contentItemId,
      source,
      stats,
    }),
  })
}

// Extract a flat metrics object from the Buffer statistics blob.
// Buffer omits zero-value fields; default missing ones to 0.
// GraphQL returns 'likes'; v1 REST returned 'favorites' — handle both.
function extractMetrics(stats = {}) {
  const likes = stats.likes ?? stats.favorites ?? 0
  return {
    clicks:      stats.clicks      ?? 0,
    reach:       stats.reach       ?? 0,
    impressions: stats.impressions ?? 0,
    favorites:   likes,
    mentions:    stats.mentions    ?? 0,
    shares:      stats.shares      ?? 0,
    comments:    stats.comments    ?? 0,
    engagement:  likes + (stats.comments ?? 0) + (stats.shares ?? 0),
  }
}

// Pass through bundle's normalized engagement set as-is (Q, 2026-07-22: "show
// everything we can get" — don't collapse it into the old Buffer-shaped
// reach/engagement composite). bundle sends the same 9-field shape for every
// platform regardless of whether that platform actually reports each field
// (LinkedIn never reports views/likes/comments/shares/saves; GBP has no bundle
// analytics at all — see processWorkspaceBundle in refresh-engagement.js).
// `source`/`platform` let PostMetricsRow pick platform-native labels
// (IG/FB call the impressions number "Views"; LinkedIn calls it
// "Impressions") instead of guessing from field names alone.
function mapBundleMetrics(m = {}, platform) {
  const num = (v) => (typeof v === 'number' ? v : 0)
  return {
    source: 'bundle',
    platform,
    impressions: num(m.impressions),
    views: num(m.views),
    reach: num(m.impressionsUnique), // IG's own "Accounts reached"
    likes: num(m.likes),
    comments: num(m.comments),
    shares: num(m.shares),
    saves: num(m.saves),
  }
}

// The wire shape is unchanged from the buffer_metrics era — { metrics,
// fetchedAt, cached } — so BufferMetricsRow needs no rework. The difference is
// where `metrics` comes from: a snapshot's `stats.statistics` (the writer-side
// shape refresh-engagement.js records) projected through the same two mappers
// that used to run on a live API response.
function projectSnapshot(snap, source, platform) {
  const statistics = snap?.stats?.statistics ?? {}
  return source === 'bundle'
    ? mapBundleMetrics(statistics, platform)
    : extractMetrics(statistics)
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { searchParams } = new URL(req.url, 'http://localhost')
  const contentItemId = searchParams.get('contentItemId')
  const force = searchParams.get('force') === 'true'

  if (!contentItemId) return res.status(400).json({ error: 'Missing contentItemId' })
  if (!UUID_RE.test(contentItemId)) return res.status(400).json({ error: 'Invalid contentItemId' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    const status = auth.reason === 'forbidden' ? 403 : 401
    return res.status(status).json({ error: auth.reason })
  }

  if (!(await enforceLimit(req, res, 'generic', ws.id))) return

  // Fetch the content item — must belong to this workspace
  const itemRes = await sb(
    `content_items?id=eq.${contentItemId}&workspace_id=eq.${ws.id}&select=id,platform,buffer_update_id&limit=1`,
  )
  if (!itemRes.ok) return res.status(500).json({ error: 'Database error' })
  const items = await itemRes.json().catch(() => [])
  const item = items[0]
  if (!item) return res.status(404).json({ error: 'Content item not found' })

  if (!item.buffer_update_id) {
    return res.status(200).json({ metrics: null, reason: 'not_published' })
  }

  const isBundle = (ws.publish_provider || 'buffer') === 'bundle'
  const source = isBundle ? 'bundle' : 'buffer'
  const snap = await latestSnapshot(ws.id, contentItemId, source)

  // A sentinel snapshot records that analytics are STRUCTURALLY unavailable for
  // this post — an IG carousel or story, which bundle literally cannot report
  // on ("unsupported type"). That verdict never changes, so short-circuit even
  // on force: re-asking would burn a scarce force slot, get the same 400, and
  // append another sentinel row on every click. Returning metrics:null (rather
  // than a zeroed-out set) is what lets the UI say "not available" instead of
  // showing a phantom 0 the reader would take for a real measurement.
  if (isUnavailable(snap)) {
    return res.status(200).json({
      metrics: null,
      reason: 'analytics_unavailable',
      fetchedAt: snap.fetched_at,
      cached: true,
    })
  }

  // Serve the cache unless the user explicitly asked for a live pull. There is
  // deliberately no TTL: the cron refreshes every snapshot daily with a FORCED
  // read, and an unforced read is the thing that produced all-zero metrics in
  // the first place, so there is never a better number to go fetch on our own.
  if (!force && snap) {
    return res.status(200).json({
      metrics: projectSnapshot(snap, source, item.platform),
      fetchedAt: snap.fetched_at,
      cached: true,
    })
  }

  if (!force) return res.status(200).json({ metrics: null, reason: 'no_metrics_yet' })

  return isBundle
    ? handleBundleRefresh(res, ws, contentItemId, item, snap)
    : handleBufferRefresh(res, ws, contentItemId, item, snap)
}

// Fall back to whatever the cache already held so a transient upstream hiccup
// doesn't blank chips the user could see a second ago.
function staleFallback(res, snap, source, platform, warning) {
  if (!snap) return res.status(200).json({ metrics: null, reason: 'refresh_failed' })
  return res.status(200).json({
    metrics: projectSnapshot(snap, source, platform),
    fetchedAt: snap.fetched_at,
    cached: true,
    warning,
  })
}

// Forced bundle.social read → new engagement_snapshots row, in exactly the
// shape refresh-engagement.js writes so the two writers stay interchangeable
// for every downstream reader.
async function handleBundleRefresh(res, ws, contentItemId, item, snap) {
  if (NO_BUNDLE_ANALYTICS.has(item.platform)) {
    return res.status(200).json({ metrics: null, reason: 'analytics_unavailable' })
  }

  let analytics
  try {
    const publisher = new BundlePublisher(ws)
    analytics = await publisher.getAnalytics({
      postId: item.buffer_update_id,
      platformType: item.platform,
      force: true,
    })
  } catch (e) {
    // 400 = structurally unreportable post type. Record the sentinel the same
    // way the cron does, so the short-circuit above answers every later read.
    if (e?.status === 400) {
      const stats = {
        statistics: {},
        source: 'bundle',
        service: item.platform,
        unavailable: true,
        reason: 'unsupported_type',
      }
      waitUntil(
        writeSnapshot(ws.id, contentItemId, 'bundle', stats)
          .catch((err) => console.error('[buffer-analytics/bundle] sentinel write failed:', err?.message))
      )
      return res.status(200).json({ metrics: null, reason: 'analytics_unavailable' })
    }
    console.error('[buffer-analytics/bundle] failed:', e?.stack || e?.message)
    return staleFallback(res, snap, 'bundle', item.platform, 'bundle analytics error; returning cached metrics')
  }

  const stats = {
    statistics: { ...(analytics?.metrics ?? {}) },
    source: 'bundle',
    service: item.platform,
    platformRaw: analytics?.platformRaw ?? null,
  }
  const fetchedAt = new Date().toISOString()
  waitUntil(
    writeSnapshot(ws.id, contentItemId, 'bundle', stats)
      .catch((e) => console.error('[buffer-analytics/bundle] snapshot write failed:', e?.message))
  )
  return res.status(200).json({ metrics: mapBundleMetrics(stats.statistics, item.platform), fetchedAt, cached: false })
}

// Legacy Buffer read. Unreachable today — every workspace is on
// publish_provider='bundle' and #2488 deleted the Buffer publish path — but
// kept snapshot-backed rather than deleted so the follow-up Buffer-naming
// cleanup owns removing it in one piece.
async function handleBufferRefresh(res, ws, contentItemId, item, snap) {
  const cred = await getCredential(ws.id, 'buffer')
  if (!cred?.secret) {
    return staleFallback(res, snap, 'buffer', item.platform, 'Buffer not configured; returning cached metrics')
  }

  const result = await fetchPostStats(cred.secret, item.buffer_update_id)
  if (!result.ok || !result.post) {
    console.error(`[buffer-analytics] fetchPostStats failed for ${item.buffer_update_id}`)
    return staleFallback(res, snap, 'buffer', item.platform, 'Buffer API error; returning cached metrics')
  }

  const stats = { statistics: { ...(result.post.statistics ?? {}) }, source: 'buffer', service: item.platform }
  const fetchedAt = new Date().toISOString()
  waitUntil(
    writeSnapshot(ws.id, contentItemId, 'buffer', stats)
      .catch((e) => console.error('[buffer-analytics] snapshot write failed:', e?.message))
  )
  return res.status(200).json({ metrics: extractMetrics(stats.statistics), fetchedAt, cached: false })
}
