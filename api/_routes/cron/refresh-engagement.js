import { withSentry } from '../../_lib/sentry.js'
import { extractPackageShortId } from '../../_lib/utm.js'
export const config = { runtime: 'nodejs' }
// Tier 2b — daily engagement refresh + auto-flag.
//
// Vercel cron hits this once a day (vercel.json). For every active workspace
// that has a Buffer credential, walk recent published content_items, refresh
// their Buffer stats into engagement_snapshots, then flip performed_well=true
// on items that beat a workspace+platform-relative threshold. The manual
// thumbs-up still works alongside this — we never *unset* performed_well, so
// editors stay in control of the long-tail exemplar pool.
//
// Heuristic (kept deliberately simple — revisit after we have signal):
//   score(item)  = sum of numeric values in stats.statistics
//   threshold    = 2× median(score across same workspace+platform pool)
//   sample gate  = pool must have ≥ MIN_SAMPLES same-platform items
//
// Median over mean: a single viral post would otherwise drag mean up and
// hide the next round of strong-but-not-viral posts from auto-flagging.
//
// Auth: Bearer CRON_SECRET (same pattern as backup-db).

import { decryptSecret } from '../../_lib/credentialCrypto.js'
import { fetchGA4Metrics, urlToPagePath } from '../../_lib/ga4.js'
import { fetchPostStats } from '../../_lib/bufferPostStats.js'
import { BundlePublisher } from '../../_lib/social/bundlePublisher.js'
import { refreshGbpToken } from '../../_lib/gbpAuth.js'
import { listLocalPosts, fetchPostViewInsights } from '../../_lib/gbpClient.js'
import { verifyCronSecret } from '../../_lib/auth.js'

const SUPABASE_URL  = process.env.SUPABASE_URL
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY
const MIN_SAMPLES   = 5
const SCORE_MULT    = 2
const SCAN_WINDOW_D = 60     // only consider posts published in the last N days
const SNAPSHOT_MAX_AGE_H = 24 // skip refetch if we have a snapshot newer than this
// bundle.social force-refresh decay schedule — see processWorkspaceBundle.
const CHECKPOINT_DAYS = [1, 3, 7, 30]
const MAX_BUNDLE_FORCES_PER_RUN = 4 // stay under bundle's ~5/team/day force-analytics cap
// GA4 minimum traffic gate (Tier 3): a low-traffic clinic blog where the
// median post gets 3 pageviews shouldn't auto-flag a "winner" at 6 views —
// that's noise, not signal. Require at least this many pageviews before a
// row is even eligible to be flagged. Independent of the median heuristic;
// flagging still requires score > 2× median ON TOP of clearing this bar.
const GA4_MIN_PAGEVIEWS = 50

// eslint-disable-next-line bernard/require-workspace-scope -- Cron — iterates all workspaces; each DB query is scoped by workspace_id from the workspace list
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

function scoreOf(stats) {
  if (!stats || typeof stats !== 'object') return 0
  const s = stats.statistics
  if (s && typeof s === 'object') {
    return Object.values(s).reduce((sum, v) => sum + (typeof v === 'number' ? v : 0), 0)
  }
  // GBP stores flat { views, actions, service } with no .statistics key
  let score = 0
  for (const [k, v] of Object.entries(stats)) {
    if (['pageviews', 'sessions', 'views', 'actions', 'clicks'].includes(k) && typeof v === 'number') score += v
  }
  return score
}

function median(nums) {
  const sorted = [...nums].sort((a, b) => a - b)
  const n = sorted.length
  if (!n) return 0
  return n % 2 === 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2
}

async function getCredSecret(workspaceId, service) {
  const url = `${SUPABASE_URL}/rest/v1/workspace_credentials?workspace_id=eq.${workspaceId}&service=eq.${service}&status=eq.active&select=secret_ciphertext&order=created_at.desc&limit=1`
  const r = await fetch(url, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } })
  if (!r.ok) return null
  const rows = await r.json().catch(() => null)
  const ct = rows?.[0]?.secret_ciphertext
  if (!ct) return null
  try { return decryptSecret(ct) } catch { return null }
}

async function getBufferToken(workspaceId) {
  // Inline cred read (the getCredential helper is fine, but this cron is
  // service-side and skipping the helper avoids any future ambient-env
  // fallback that would mask a missing per-workspace token).
  const url = `${SUPABASE_URL}/rest/v1/workspace_credentials?workspace_id=eq.${workspaceId}&service=eq.buffer&status=eq.active&select=secret_ciphertext&order=created_at.desc&limit=1`
  const r = await fetch(url, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } })
  if (!r.ok) return null
  const rows = await r.json().catch(() => null)
  const ct = rows?.[0]?.secret_ciphertext
  if (!ct) return null
  try { return decryptSecret(ct) } catch { return null }
}

async function fetchBufferStats(token, updateId, platform) {
  const result = await fetchPostStats(token, updateId)
  if (!result.ok || !result.post) return null
  const p = result.post
  return {
    statistics:   p.statistics ?? {},
    status:       p.status     ?? null,
    sent_at:      p.sentAt     ?? null,
    service:      platform     ?? null,
    service_link: null,
  }
}

async function processWorkspace(ws, summary) {
  if (ws.publish_provider === 'bundle') return  // bundle workspaces handled by processWorkspaceBundle
  const token = await getBufferToken(ws.id)
  if (!token) {
    summary.workspaces.push({ id: ws.id, slug: ws.slug, skipped: 'no-buffer-token' })
    return
  }

  // Pull recent published items with a buffer_update_id.
  const sinceIso = new Date(Date.now() - SCAN_WINDOW_D * 24 * 60 * 60 * 1000).toISOString()
  const itemsRes = await sb(
    `content_items?workspace_id=eq.${ws.id}` +
    `&status=eq.published` +
    `&buffer_update_id=not.is.null` +
    `&published_at=gte.${encodeURIComponent(sinceIso)}` +
    `&select=id,platform,buffer_update_id,performed_well,published_at`
  )
  if (!itemsRes.ok) {
    summary.workspaces.push({ id: ws.id, slug: ws.slug, error: `items fetch ${itemsRes.status}` })
    return
  }
  const items = await itemsRes.json()
  if (!Array.isArray(items) || items.length === 0) {
    summary.workspaces.push({ id: ws.id, slug: ws.slug, items: 0 })
    return
  }

  // Refresh snapshots where we don't already have a fresh one.
  const freshCutoff = new Date(Date.now() - SNAPSHOT_MAX_AGE_H * 60 * 60 * 1000).toISOString()
  let refreshed = 0
  for (const item of items) {
    const latestRes = await sb(
      `engagement_snapshots?content_item_id=eq.${item.id}&workspace_id=eq.${ws.id}&order=fetched_at.desc&limit=1&select=fetched_at,stats`
    )
    const latestRows = latestRes.ok ? await latestRes.json().catch(() => []) : []
    const latest = latestRows?.[0]
    if (latest && latest.fetched_at > freshCutoff) {
      item._stats = latest.stats
      continue
    }
    const stats = await fetchBufferStats(token, item.buffer_update_id, item.platform)
    if (!stats) continue
    // Buffer's API does not expose per-post engagement yet (analytics are
    // dashboard-only; "API for Post Analytics" is In Progress on Buffer's
    // roadmap — confirmed 2026-06-04 via schema introspection + docs, see
    // api/_lib/bufferPostStats.js). So `stats.statistics` is always empty
    // today. Skip writing the snapshot rather than accumulating hollow rows
    // that score 0 and read as fake zeros downstream. When Buffer ships the
    // metrics field (wired in bufferPostStats.js), these inserts resume
    // automatically.
    if (!stats.statistics || Object.keys(stats.statistics).length === 0) continue
    const ins = await sb('engagement_snapshots', {
      method: 'POST',
      body: JSON.stringify({
        workspace_id:    ws.id,
        content_item_id: item.id,
        source:          'buffer',
        stats,
      }),
    })
    if (ins.ok) {
      refreshed++
      item._stats = stats
    }
  }

  // Group by platform; auto-flag items above the workspace+platform median.
  const byPlatform = {}
  for (const item of items) {
    if (!item._stats) continue
    if (!byPlatform[item.platform]) byPlatform[item.platform] = []
    byPlatform[item.platform].push(item)
  }

  const flagged = []
  for (const [platform, pool] of Object.entries(byPlatform)) {
    if (pool.length < MIN_SAMPLES) continue
    const scores = pool.map(i => scoreOf(i._stats))
    const med = median(scores)
    if (med <= 0) continue
    const bar = med * SCORE_MULT
    for (let i = 0; i < pool.length; i++) {
      const item = pool[i]
      const score = scores[i]
      if (item.performed_well) continue
      if (score <= bar) continue
      const r = await sb(`content_items?id=eq.${item.id}&workspace_id=eq.${ws.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ performed_well: true }),
      })
      if (r.ok) flagged.push({ id: item.id, platform, score, median: med })
    }
  }

  summary.workspaces.push({
    id: ws.id,
    slug: ws.slug,
    source: 'buffer',
    items: items.length,
    refreshed,
    flagged: flagged.length,
    flagged_detail: flagged,
  })
}

// bundle.social walker — same shape as processWorkspace (Buffer), different source.
// Walks bundle workspaces only; called in parallel with the GA4 walker in the
// main loop. Analytics for Twitter/GBP are known to be unavailable from bundle
// (GBP: bundle has no data; Twitter: omitted from analytics enum) — those
// throw inside getAnalytics and are caught/skipped below.
async function processWorkspaceBundle(ws, summary) {
  if (ws.publish_provider !== 'bundle') return

  let publisher
  try {
    publisher = new BundlePublisher(ws)
  } catch (e) {
    console.error('[cron/refresh-engagement] bundle init failed:', e?.message)
    summary.workspaces.push({ id: ws.id, slug: ws.slug, source: 'bundle', skipped: 'bundle-init-failed', error: 'bundle_init_error' })
    return
  }

  const sinceIso = new Date(Date.now() - SCAN_WINDOW_D * 24 * 60 * 60 * 1000).toISOString()
  const itemsRes = await sb(
    `content_items?workspace_id=eq.${ws.id}` +
    `&status=eq.published` +
    `&buffer_update_id=not.is.null` +
    `&published_at=gte.${encodeURIComponent(sinceIso)}` +
    `&select=id,platform,buffer_update_id,performed_well,published_at`
  )
  if (!itemsRes.ok) {
    summary.workspaces.push({ id: ws.id, slug: ws.slug, source: 'bundle', error: `items fetch ${itemsRes.status}` })
    return
  }
  const items = await itemsRes.json()
  if (!Array.isArray(items) || items.length === 0) {
    summary.workspaces.push({ id: ws.id, slug: ws.slug, source: 'bundle', items: 0 })
    return
  }

  const freshCutoff = new Date(Date.now() - SNAPSHOT_MAX_AGE_H * 60 * 60 * 1000).toISOString()
  const now = Date.now()

  // bundle.social only advances a post's analytics history on a FORCED read,
  // and force-refresh is rate-limited to ~5/team/day, shared across every
  // platform on this workspace's one brand Team (FB+IG+LinkedIn+...). Forcing
  // every live post every day would blow that quota immediately (movebetter
  // alone has 20+ posts in the scan window). Instead force only at a few
  // fixed post-age checkpoints, then stop — engagement naturally front-loads,
  // so day 1/3/7/30 captures the real curve without unbounded daily cost.
  // A post that's never been pulled at all (pre-dates this rollout, or missed
  // its checkpoint due to a cron gap) gets a rate-limited one-time catch-up
  // instead, so the backlog drains gradually rather than in one quota-busting
  // run.
  const due = []
  const catchUp = []
  for (const item of items) {
    // GBP has no bundle analytics at all, and Twitter is omitted from bundle's
    // analytics enum entirely — both always throw in getAnalytics, so never
    // spend a scarce force-refresh slot queuing them.
    if (item.platform === 'gbp' || item.platform === 'twitter') continue

    const latestRes = await sb(
      `engagement_snapshots?content_item_id=eq.${item.id}&workspace_id=eq.${ws.id}&source=eq.bundle&order=fetched_at.desc&limit=1&select=fetched_at,stats`
    )
    const latestRows = latestRes.ok ? await latestRes.json().catch(() => []) : []
    const latest = latestRows?.[0]
    if (latest && latest.fetched_at > freshCutoff) {
      item._stats = latest.stats
      continue
    }

    const ageDays = Math.floor((now - new Date(item.published_at).getTime()) / (24 * 60 * 60 * 1000))
    if (CHECKPOINT_DAYS.includes(ageDays)) {
      due.push(item)
    } else if (!latest) {
      catchUp.push(item)
    } else {
      item._stats = latest.stats // off-checkpoint day, already have history — carry it forward, no bundle call
    }
  }

  // Round-robin the scarce force budget ACROSS platforms. The candidate order
  // is due (checkpoint-age) then catchUp (never-pulled), which within a single
  // platform is the right priority — but taking a flat `slice(0, MAX)` of that
  // list lets one busy platform consume the entire per-run budget every run and
  // permanently starve the others (movebetter's LinkedIn backlog was eating all
  // 4 slots daily, so Instagram/Facebook analytics were NEVER fetched despite
  // being the clinic's strongest channels). Instead, bucket candidates by
  // platform (due-first order preserved inside each bucket) and pick one from
  // each bucket in turn until the budget is spent.
  const candidatesByPlatform = new Map()
  for (const item of [...due, ...catchUp]) {
    if (!candidatesByPlatform.has(item.platform)) candidatesByPlatform.set(item.platform, [])
    candidatesByPlatform.get(item.platform).push(item)
  }
  const buckets = [...candidatesByPlatform.values()]
  const selected = []
  let rr = 0
  while (selected.length < MAX_BUNDLE_FORCES_PER_RUN && buckets.some((b) => b.length)) {
    const bucket = buckets[rr % buckets.length]
    const next = bucket.shift()
    if (next) selected.push(next)
    rr++
  }

  // Per-platform outcome tally — surfaced in the summary so a genuine all-zero
  // reading (post measured, really got 0) can be told apart from a platform we
  // simply never reached or that errors on every force. Without this the two
  // are indistinguishable downstream (both show 0 in the UI).
  const platformOutcomes = {}
  const bump = (platform, key) => {
    const o = (platformOutcomes[platform] ||= { forced: 0, wrote: 0, allZero: 0, errored: 0, unavailable: 0 })
    o[key]++
  }

  let refreshed = 0
  for (const item of selected) {
    bump(item.platform, 'forced')
    let analytics
    try {
      analytics = await publisher.getAnalytics({ postId: item.buffer_update_id, platformType: item.platform, force: true })
    } catch (e) {
      // A 400 from bundle means analytics are STRUCTURALLY unavailable for this
      // post — IG carousels/stories are the common case (bundle literally can't
      // read them: "unsupported type (e.g. story, carousel)"). Write a sentinel
      // snapshot so the UI can say "not available" instead of a phantom 0, and so
      // catchUp stops burning a scarce force slot re-trying it every run. A 500 /
      // network error is transient — skip and let the next run retry.
      if (e?.status === 400) {
        bump(item.platform, 'unavailable')
        const stats = { statistics: {}, source: 'bundle', service: item.platform, unavailable: true, reason: 'unsupported_type' }
        const ins = await sb('engagement_snapshots', {
          method: 'POST',
          body: JSON.stringify({ workspace_id: ws.id, content_item_id: item.id, source: 'bundle', stats }),
        })
        if (ins.ok) item._stats = stats
        console.warn(`[cron/refresh-engagement] bundle analytics unavailable ws=${ws.slug} platform=${item.platform}: ${e?.message}`)
        continue
      }
      // Temporary error (bundle 500, network) — skip; the next run retries.
      bump(item.platform, 'errored')
      console.warn(`[cron/refresh-engagement] bundle getAnalytics failed ws=${ws.slug} platform=${item.platform}:`, e?.message)
      continue
    }
    const metrics = analytics?.metrics

    // Write the snapshot even when every metric is 0 — a forced read genuinely
    // checked and that's the real reading. Skipping it would leave `catchUp`
    // re-queuing the same post forever, since it depends on `!latest` to know
    // a post has never been pulled.
    // platformRaw is the platform's own verbatim analytics payload, kept
    // alongside bundle's normalized 9-field set so we can check for metrics
    // bundle's shape doesn't surface (IG saves/profile visits, etc.) without
    // a second API call — see normalizeBundleAnalytics in bundlePublisher.js.
    const stats = {
      statistics: { ...metrics },
      source: 'bundle',
      service: item.platform,
      platformRaw: analytics?.platformRaw ?? null,
    }
    const nonZero = Object.values(metrics).some((v) => typeof v === 'number' && v > 0)
    if (!nonZero) bump(item.platform, 'allZero')
    const ins = await sb('engagement_snapshots', {
      method: 'POST',
      body: JSON.stringify({ workspace_id: ws.id, content_item_id: item.id, source: 'bundle', stats }),
    })
    if (ins.ok) {
      refreshed++
      bump(item.platform, 'wrote')
      item._stats = stats
    }
  }

  // Auto-flag: same median heuristic as the Buffer walker.
  const byPlatform = {}
  for (const item of items) {
    if (!item._stats) continue
    if (!byPlatform[item.platform]) byPlatform[item.platform] = []
    byPlatform[item.platform].push(item)
  }
  const flagged = []
  for (const [platform, pool] of Object.entries(byPlatform)) {
    if (pool.length < MIN_SAMPLES) continue
    const scores = pool.map((i) => scoreOf(i._stats))
    const med = median(scores)
    if (med <= 0) continue
    const bar = med * SCORE_MULT
    for (let i = 0; i < pool.length; i++) {
      const item = pool[i]
      const score = scores[i]
      if (item.performed_well || score <= bar) continue
      const r = await sb(`content_items?id=eq.${item.id}&workspace_id=eq.${ws.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ performed_well: true }),
      })
      if (r.ok) flagged.push({ id: item.id, platform, score, median: med })
    }
  }

  summary.workspaces.push({
    id: ws.id, slug: ws.slug, source: 'bundle',
    items: items.length, refreshed, flagged: flagged.length, flagged_detail: flagged,
    platform_outcomes: platformOutcomes,
  })
}

// GA4 walker — same shape as processWorkspace (Buffer), different source.
//
// Why a parallel function rather than generalising: Buffer scoring sums
// arbitrary numeric fields in `statistics`; GA4 scoring uses pageviews as
// the single signal (engaged_sessions and engagement_time go into the
// snapshot for later analysis but don't drive the auto-flag — pageviews
// is the signal that matters most for blog content and is the easiest to
// read across workspaces of different sizes). Forcing both into a generic
// scorer would obscure that distinction. Two clean walkers, one shared
// median + flag pattern.
async function processWorkspaceGA4(ws, summary) {
  if (!ws.ga4_property_id) {
    summary.workspaces.push({ id: ws.id, slug: ws.slug, source: 'ga4', skipped: 'no-ga4-property-id' })
    return
  }
  const serviceAccountJson = await getCredSecret(ws.id, 'ga4')
  if (!serviceAccountJson) {
    summary.workspaces.push({ id: ws.id, slug: ws.slug, source: 'ga4', skipped: 'no-ga4-credential' })
    return
  }

  // Pull recent published items that have a resolved_url (set by the
  // website-publish path; legacy rows without one are invisible to GA4
  // until they're republished or backfilled).
  const sinceIso = new Date(Date.now() - SCAN_WINDOW_D * 24 * 60 * 60 * 1000).toISOString()
  const itemsRes = await sb(
    `content_items?workspace_id=eq.${ws.id}` +
    `&status=eq.published` +
    `&resolved_url=not.is.null` +
    `&published_at=gte.${encodeURIComponent(sinceIso)}` +
    `&select=id,platform,resolved_url,performed_well,published_at`
  )
  if (!itemsRes.ok) {
    summary.workspaces.push({ id: ws.id, slug: ws.slug, source: 'ga4', error: `items fetch ${itemsRes.status}` })
    return
  }
  const items = await itemsRes.json()
  if (!Array.isArray(items) || items.length === 0) {
    summary.workspaces.push({ id: ws.id, slug: ws.slug, source: 'ga4', items: 0 })
    return
  }

  // Map URL → pagePath for GA4, and back so we can join the report rows
  // back to content_item ids. Multiple items at the same path is unlikely
  // (slugs collide in the publish layer) but handled by indexing as an
  // array.
  const pathToItems = new Map()
  for (const item of items) {
    const path = urlToPagePath(item.resolved_url)
    if (!path) continue
    item._pagePath = path
    if (!pathToItems.has(path)) pathToItems.set(path, [])
    pathToItems.get(path).push(item)
  }
  const pagePaths = [...pathToItems.keys()]
  if (pagePaths.length === 0) {
    summary.workspaces.push({ id: ws.id, slug: ws.slug, source: 'ga4', items: items.length, skipped: 'no-resolvable-paths' })
    return
  }

  let metricsByPath
  try {
    metricsByPath = await fetchGA4Metrics({
      serviceAccountJson,
      propertyId: ws.ga4_property_id,
      pagePaths,
    })
  } catch (e) {
    console.error('[cron/refresh-engagement] ga4 fetch failed:', e?.message)
    summary.workspaces.push({ id: ws.id, slug: ws.slug, source: 'ga4', error: 'ga4_fetch_failed' })
    return
  }

  // Decide which items need a fresh snapshot written. Reuse the same
  // 24h freshness gate as Buffer to avoid re-writing the same numbers
  // every cron tick, but always pull the latest GA4 numbers if we did
  // make the API call (already paid the cost).
  const freshCutoff = new Date(Date.now() - SNAPSHOT_MAX_AGE_H * 60 * 60 * 1000).toISOString()
  let refreshed = 0
  for (const item of items) {
    if (!item._pagePath) continue
    const stats = metricsByPath[item._pagePath]
    if (!stats) continue // GA4 has nothing for this path yet
    item._stats = stats

    const latestRes = await sb(
      `engagement_snapshots?content_item_id=eq.${item.id}&workspace_id=eq.${ws.id}&source=eq.ga4&order=fetched_at.desc&limit=1&select=fetched_at`
    )
    const latest = latestRes.ok ? (await latestRes.json().catch(() => []))?.[0] : null
    if (latest && latest.fetched_at > freshCutoff) continue

    // Enrich stats with package attribution extracted from UTM params on the
    // resolved_url. utm_content=pkg_<short_id> is set by the auto-publish
    // path at publish time; manual publishes without packageId carry no UTM.
    const pkgShortId = extractPackageShortId(item.resolved_url)
    const enrichedStats = pkgShortId ? { ...stats, pkg_short_id: pkgShortId } : stats

    const ins = await sb('engagement_snapshots', {
      method: 'POST',
      body: JSON.stringify({
        workspace_id:    ws.id,
        content_item_id: item.id,
        source:          'ga4',
        stats:           enrichedStats,
      }),
    })
    if (ins.ok) refreshed++
  }

  // Auto-flag against a workspace+platform pool (same MIN_SAMPLES /
  // SCORE_MULT heuristic as Buffer, scored on pageviews only). All website
  // publishes today land on platform='blog', but keying by platform here
  // keeps the heuristic future-proof for other URL-bearing platforms.
  const byPlatform = {}
  for (const item of items) {
    if (!item._stats) continue
    if (!byPlatform[item.platform]) byPlatform[item.platform] = []
    byPlatform[item.platform].push(item)
  }

  const flagged = []
  for (const [platform, pool] of Object.entries(byPlatform)) {
    if (pool.length < MIN_SAMPLES) continue
    const scores = pool.map((i) => i._stats.pageviews || 0)
    const med = median(scores)
    if (med <= 0) continue
    const bar = med * SCORE_MULT
    for (let i = 0; i < pool.length; i++) {
      const item = pool[i]
      const score = scores[i]
      if (item.performed_well) continue
      if (score < GA4_MIN_PAGEVIEWS) continue // absolute traffic floor
      if (score <= bar) continue
      const r = await sb(`content_items?id=eq.${item.id}&workspace_id=eq.${ws.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ performed_well: true }),
      })
      if (r.ok) flagged.push({ id: item.id, platform, pageviews: score, median: med })
    }
  }

  summary.workspaces.push({
    id: ws.id,
    slug: ws.slug,
    source: 'ga4',
    items: items.length,
    refreshed,
    flagged: flagged.length,
    flagged_detail: flagged,
  })
}

// GBP walker — matches published GBP content items to Google local posts and
// fetches view counts from the reportInsights API (direct Google API — GBP
// analytics does NOT come from bundle.social at all, bundle has none; see
// processWorkspaceBundle's platform skip-list above). Runs daily alongside
// the Buffer / bundle / GA4 walkers. Skipped silently when no GBP credential
// exists.
//
// NOTE: this used to bail immediately for every bundle-provider workspace
// (`if (ws.publish_provider === 'bundle') return`) — apparently on the
// assumption that bundle-provider engagement is fully covered by
// processWorkspaceBundle. It isn't: that walker explicitly skips GBP
// (`item.platform === 'gbp' ... continue`), since bundle has no GBP
// analytics. The two walkers are NOT redundant for GBP — this is the only
// path that ever fetches GBP post views, and the guard silenced it for the
// one workspace (movebetter) that actually has GBP analytics configured.
async function processWorkspaceGBP(ws, summary) {
  if (!ws.gbp_location_name) {
    // Not configured — skip silently (not an error; most workspaces won't have this).
    return
  }

  // Fetch the GBP analytics credential row (includes config.v4_location_name).
  const credRes = await fetch(
    `${SUPABASE_URL}/rest/v1/workspace_credentials?workspace_id=eq.${ws.id}&service=eq.gbp_analytics&status=eq.active&select=secret_ciphertext,config&order=created_at.desc&limit=1`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  )
  if (!credRes.ok) {
    summary.workspaces.push({ id: ws.id, slug: ws.slug, source: 'gbp', error: `cred fetch ${credRes.status}` })
    return
  }
  const creds = await credRes.json().catch(() => [])
  const cred  = creds?.[0]
  if (!cred?.secret_ciphertext) {
    summary.workspaces.push({ id: ws.id, slug: ws.slug, source: 'gbp', skipped: 'no-gbp-credential' })
    return
  }

  let refreshToken
  try { refreshToken = decryptSecret(cred.secret_ciphertext) } catch {
    summary.workspaces.push({ id: ws.id, slug: ws.slug, source: 'gbp', skipped: 'cred-decrypt-failed' })
    return
  }

  let accessToken
  try {
    accessToken = await refreshGbpToken(refreshToken)
  } catch (e) {
    console.error('[cron/refresh-engagement] gbp token-refresh failed:', e?.message)
    summary.workspaces.push({ id: ws.id, slug: ws.slug, source: 'gbp', error: 'token_refresh_failed' })
    return
  }

  const v4LocationName = cred.config?.v4_location_name
  if (!v4LocationName) {
    summary.workspaces.push({ id: ws.id, slug: ws.slug, source: 'gbp', skipped: 'no-v4-location-name' })
    return
  }

  // Pull recent GBP-platform content items (both matched and unmatched).
  const sinceIso = new Date(Date.now() - SCAN_WINDOW_D * 24 * 60 * 60 * 1000).toISOString()
  const itemsRes = await sb(
    `content_items?workspace_id=eq.${ws.id}` +
    `&status=eq.published` +
    `&platform=eq.gbp` +
    `&published_at=gte.${encodeURIComponent(sinceIso)}` +
    `&select=id,platform,published_at,gbp_post_name,performed_well`
  )
  if (!itemsRes.ok) {
    summary.workspaces.push({ id: ws.id, slug: ws.slug, source: 'gbp', error: `items fetch ${itemsRes.status}` })
    return
  }
  const items = await itemsRes.json().catch(() => [])
  if (!Array.isArray(items) || items.length === 0) {
    summary.workspaces.push({ id: ws.id, slug: ws.slug, source: 'gbp', items: 0 })
    return
  }

  // Step 1: match unmatched items to Google local posts by published_at proximity.
  const unmatched = items.filter((i) => !i.gbp_post_name)
  let matched = 0
  if (unmatched.length > 0) {
    let localPosts = []
    try {
      localPosts = await listLocalPosts(accessToken, v4LocationName, 50)
    } catch (e) {
      console.warn('[refresh-engagement/gbp] listLocalPosts failed:', e?.message)
    }

    const WINDOW_MS = 30 * 60 * 1000  // ±30 minutes proximity window
    for (const item of unmatched) {
      const pubAt = new Date(item.published_at).getTime()
      const match = localPosts.reduce((best, p) => {
        const created = new Date(p.createTime || p.updateTime || 0).getTime()
        const delta = Math.abs(created - pubAt)
        if (delta > WINDOW_MS) return best
        if (!best) return p
        const bestDelta = Math.abs(new Date(best.createTime || best.updateTime || 0).getTime() - pubAt)
        return delta < bestDelta ? p : best
      }, null)
      if (!match?.name) continue
      const patch = await sb(`content_items?id=eq.${item.id}&workspace_id=eq.${ws.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ gbp_post_name: match.name }),
      })
      if (patch.ok) {
        item.gbp_post_name = match.name
        matched++
      }
    }
  }

  // Step 2: refresh view snapshots for all matched items.
  const matchedItems = items.filter((i) => i.gbp_post_name)
  let refreshed = 0
  if (matchedItems.length > 0) {
    const freshCutoff = new Date(Date.now() - SNAPSHOT_MAX_AGE_H * 60 * 60 * 1000).toISOString()

    const toRefresh = []
    for (const item of matchedItems) {
      const latestRes = await sb(
        `engagement_snapshots?content_item_id=eq.${item.id}&workspace_id=eq.${ws.id}&source=eq.gbp&order=fetched_at.desc&limit=1&select=fetched_at`
      )
      const latest = latestRes.ok ? (await latestRes.json().catch(() => []))?.[0] : null
      if (latest && latest.fetched_at > freshCutoff) continue
      toRefresh.push(item)
    }

    if (toRefresh.length > 0) {
      let insights = {}
      try {
        insights = await fetchPostViewInsights(
          accessToken, v4LocationName,
          toRefresh.map((i) => i.gbp_post_name),
          90
        )
      } catch (e) {
        console.warn('[refresh-engagement/gbp] fetchPostViewInsights failed:', e?.message)
      }

      for (const item of toRefresh) {
        const data = insights[item.gbp_post_name]
        if (!data) continue
        const stats = { views: data.views || 0, actions: data.actions || 0, service: 'gbp' }
        const ins = await sb('engagement_snapshots', {
          method: 'POST',
          body: JSON.stringify({
            workspace_id:    ws.id,
            content_item_id: item.id,
            source:          'gbp',
            stats,
          }),
        })
        if (ins.ok) refreshed++
      }
    }
  }

  summary.workspaces.push({
    id: ws.id, slug: ws.slug, source: 'gbp',
    items: items.length, matched, refreshed,
  })
}

async function handler(req, res) {
    if (!verifyCronSecret(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(503).json({ error: 'Supabase env not configured' })
  }

  // Enumerate active workspaces.
  const wsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/workspaces?status=eq.active&select=id,slug,ga4_property_id,publish_provider,bundle_team_id,gbp_location_name`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  )
  if (!wsRes.ok) return res.status(500).json({ error: 'workspace fetch failed' })
  const workspaces = await wsRes.json()

  const summary = { startedAt: new Date().toISOString(), workspaces: [] }
  for (const ws of workspaces) {
    try {
      await processWorkspace(ws, summary)
    } catch (e) {
      console.error('[cron/refresh-engagement] buffer workspace threw:', e?.message)
      summary.workspaces.push({ id: ws.id, slug: ws.slug, source: 'buffer', error: 'workspace_error' })
    }
    try {
      await processWorkspaceBundle(ws, summary)
    } catch (e) {
      console.error('[cron/refresh-engagement] bundle workspace threw:', e?.message)
      summary.workspaces.push({ id: ws.id, slug: ws.slug, source: 'bundle', error: 'workspace_error' })
    }
    try {
      await processWorkspaceGA4(ws, summary)
    } catch (e) {
      console.error('[cron/refresh-engagement] ga4 workspace threw:', e?.message)
      summary.workspaces.push({ id: ws.id, slug: ws.slug, source: 'ga4', error: 'workspace_error' })
    }
    try {
      await processWorkspaceGBP(ws, summary)
    } catch (e) {
      console.error('[cron/refresh-engagement] gbp workspace threw:', e?.message)
      summary.workspaces.push({ id: ws.id, slug: ws.slug, source: 'gbp', error: 'workspace_error' })
    }
  }
  summary.finishedAt = new Date().toISOString()

  return res.status(200).json(summary)
}

export default withSentry(handler)
