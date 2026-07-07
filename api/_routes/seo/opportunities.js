// SEO Opportunities feed — the read behind /seo.
//
// Pulls the workspace's Search Console queries (live, 28d) and turns them into:
//   opportunities      — ranked content opportunities (striking-distance,
//                        demand-no-content) via the seoOpportunities engine.
//   websiteSuggestions — ADVISORY on-site technical fixes (schema/meta/title,
//                        plus a GSC-derived click-through suggestion). No
//                        action path — Bernard spots, the tenant fixes.
//   locked             — decay + cannibalization placeholders, unlocked once
//                        the weekly snapshot cron has accrued enough history.
//
// Returns { connected: false } when Search Console isn't configured.
// Node runtime + Express-style (req, res).
export const config = { runtime: 'nodejs' }

import { workspaceContext }   from '../../_lib/workspaceContext.js'
import { requireRole }        from '../../_lib/auth.js'
import { enforceLimit }       from '../../_lib/ratelimit.js'
import { decryptSecret }      from '../../_lib/credentialCrypto.js'
import { fetchSearchQueries } from '../../_lib/searchConsole.js'
import {
  classifyOpportunities, gscClickThroughSuggestion,
  classifyDecay, classifyCannibalization, matchPublishedQuery,
} from '../../_lib/seoOpportunities.js'
import { fetchAndAuditHomepage } from '../../_lib/onPageAudit.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// Two distinct snapshot weeks unlock week-over-week decay/cannibalization.
const MIN_SNAPSHOT_WEEKS = 2
// Post-publish "did it work?" only looks at recently-published website pieces —
// ranking movement right after publish is the signal; months later is confounded.
const POST_PUBLISH_MAX_AGE_DAYS = 56

// ISO-week key (YYYY-Www) — buckets snapshots by week so a mid-week re-run of the
// cron (two rows in one ISO week) doesn't inflate the distinct-week count the way
// a raw captured_at date would.
function isoWeekKey(input) {
  const d = new Date(input)
  if (Number.isNaN(d.getTime())) return ''
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const dayNum = (date.getUTCDay() + 6) % 7            // Mon=0 … Sun=6
  date.setUTCDate(date.getUTCDate() - dayNum + 3)      // shift to the week's Thursday
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4))
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3)
  const week = 1 + Math.round((date - firstThursday) / (7 * 24 * 60 * 60 * 1000))
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

// Latest row per query within a set of snapshot rows already ordered captured_at
// DESC — first occurrence of each query is its most recent row.
function latestPerQuery(rows) {
  const map = new Map()
  for (const r of rows || []) {
    if (r?.query && !map.has(r.query)) map.set(r.query, r)
  }
  return map
}

// Compute post-publish ranking deltas for recently-published website pieces.
// Pure over the shapes it's given so the time-join stays testable.
//   pieces:   [{ topic, published_at }]  (website/blog, status published)
//   snapRows: query-level snapshot rows [{ query, position, captured_at }]
//   universe: array of currently-ranking query strings (from the current week)
// Returns [{ topic, query, confidence, publishedAt, positionAtPublish,
//   positionNow, delta }] — only pieces with a before AND after snapshot.
function computePostPublish(pieces, snapRows, universe) {
  const byQuery = new Map()
  for (const r of snapRows || []) {
    if (!r?.query) continue
    if (!byQuery.has(r.query)) byQuery.set(r.query, [])
    byQuery.get(r.query).push(r)
  }
  for (const list of byQuery.values()) {
    list.sort((a, b) => new Date(a.captured_at) - new Date(b.captured_at)) // ascending
  }

  const out = []
  for (const piece of pieces || []) {
    if (!piece?.topic || !piece?.published_at) continue
    const publishedMs = new Date(piece.published_at).getTime()
    if (Number.isNaN(publishedMs)) continue

    // Best matching currently-ranking query for this piece's topic.
    let best = null
    for (const q of universe) {
      const conf = matchPublishedQuery(piece.topic, q)
      if (!conf) continue
      if (!best || (conf === 'exact' && best.confidence !== 'exact')) best = { query: q, confidence: conf }
      if (best.confidence === 'exact') break
    }
    if (!best) continue

    const rows = byQuery.get(best.query)
    if (!rows || rows.length === 0) continue
    const baseline = [...rows].reverse().find((r) => new Date(r.captured_at).getTime() <= publishedMs)
    const current  = rows[rows.length - 1]
    if (!baseline || !current) continue
    if (new Date(current.captured_at).getTime() <= publishedMs) continue // no post-publish snapshot yet

    const positionAtPublish = Math.round((baseline.position || 0) * 10) / 10
    const positionNow       = Math.round((current.position || 0) * 10) / 10
    out.push({
      topic:             piece.topic,
      query:             best.query,
      confidence:        best.confidence,
      publishedAt:       piece.published_at,
      positionAtPublish,
      positionNow,
      delta:             Math.round((positionAtPublish - positionNow) * 10) / 10, // + = improved
    })
  }

  out.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
  return out.slice(0, 8)
}

// A static best-practice the on-page fetch can't infer: internal linking.
const INTERNAL_LINK_SUGGESTION = {
  sev:    'low',
  source: 'Internal links',
  title:  'Link new blog posts to your booking & services pages',
  why:    'Posts that link to “book an appointment” and key service pages pass authority to the pages that convert — and give readers an obvious next step.',
}

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

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  if (!(await enforceLimit(req, res, 'seo-opportunities', ws.id))) return

  if (!ws.gsc_site_url) return res.status(200).json({ connected: false })

  // Search Console credential.
  const credRes = await sb(
    `workspace_credentials?workspace_id=eq.${ws.id}&service=eq.searchconsole&status=eq.active` +
    `&select=secret_ciphertext,config&limit=1`
  )
  if (!credRes.ok) return res.status(200).json({ connected: false, error: 'credential_fetch_failed' })
  const credRows = await credRes.json().catch(() => [])
  const credRow  = credRows?.[0]
  if (!credRow?.secret_ciphertext) return res.status(200).json({ connected: false })

  let secret
  try { secret = decryptSecret(credRow.secret_ciphertext) }
  catch { return res.status(200).json({ connected: false, error: 'credential_decrypt_failed' }) }
  const credential = { secret, config: credRow.config || {} }

  // Parallel reads — none depend on the live GSC fetch:
  //   topicRows    — published topics (hasPost matching for opportunities)
  //   dismissRows  — dismissed queries (filtered from opportunities + decay)
  //   snapRows     — QUERY-LEVEL snapshot history (page IS NULL) for decay +
  //                  post-publish; carries position/impressions/captured_at
  //   pageWeekRows — capture dates of PER-URL rows (page NOT NULL) — just enough
  //                  to know if cannibalization has ~2 weeks of history yet
  //   blogPieces   — recently-published website pieces for the "did it work?" card
  const postPublishSince = new Date(Date.now() - POST_PUBLISH_MAX_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const [topicRows, dismissRows, snapRows, pageWeekRows, blogPieces] = await Promise.all([
    sb(`content_items?workspace_id=eq.${ws.id}&status=eq.published&topic=not.is.null&select=topic&limit=200`)
      .then((r) => (r.ok ? r.json().catch(() => []) : [])),
    sb(`seo_opportunity_dismissals?workspace_id=eq.${ws.id}&select=query`)
      .then((r) => (r.ok ? r.json().catch(() => []) : [])),
    sb(`gsc_query_snapshots?workspace_id=eq.${ws.id}&page=is.null&select=query,position,impressions,captured_at&order=captured_at.desc&limit=1000`)
      .then((r) => (r.ok ? r.json().catch(() => []) : [])),
    sb(`gsc_query_snapshots?workspace_id=eq.${ws.id}&page=not.is.null&select=captured_at&order=captured_at.desc&limit=400`)
      .then((r) => (r.ok ? r.json().catch(() => []) : [])),
    sb(`content_items?workspace_id=eq.${ws.id}&status=eq.published&platform=eq.blog&published_at=not.is.null&published_at=gte.${postPublishSince}&topic=not.is.null&select=topic,published_at&order=published_at.desc&limit=50`)
      .then((r) => (r.ok ? r.json().catch(() => []) : [])),
  ])
  const topics    = (topicRows || []).map((r) => r.topic).filter(Boolean)
  const dismissed = new Set((dismissRows || []).map((r) => r.query).filter(Boolean))

  // Bucket query-level snapshots by ISO week; the two most recent weeks drive decay.
  const weekKeys = [...new Set((snapRows || []).map((r) => isoWeekKey(r.captured_at)).filter(Boolean))]
  weekKeys.sort().reverse() // newest first
  const distinctWeeks = weekKeys.length
  const [currentWeekKey, priorWeekKey] = weekKeys
  const currentRows = currentWeekKey ? [...latestPerQuery((snapRows || []).filter((r) => isoWeekKey(r.captured_at) === currentWeekKey)).values()] : []
  const priorRows   = priorWeekKey   ? [...latestPerQuery((snapRows || []).filter((r) => isoWeekKey(r.captured_at) === priorWeekKey)).values()]   : []

  // Live GSC queries.
  let queries
  try {
    queries = await fetchSearchQueries({ credential, siteUrl: ws.gsc_site_url, rowLimit: 200 })
  } catch (e) {
    console.error('[seo/opportunities]', e?.message)
    return res.status(200).json({ connected: true, error: 'gsc_fetch_failed' })
  }

  const opportunities = classifyOpportunities(queries, { topics, dismissed, limit: 12 })

  // Website suggestions: GSC click-through + on-page homepage audit + the static
  // internal-link nudge. The homepage fetch is best-effort and never blocks the
  // content opportunities.
  const websiteSuggestions = []
  const ctSuggestion = gscClickThroughSuggestion(queries)
  if (ctSuggestion) websiteSuggestions.push(ctSuggestion)
  try {
    const audit = await fetchAndAuditHomepage(ws.gsc_site_url)
    if (audit.suggestions?.length) websiteSuggestions.push(...audit.suggestions)
  } catch (e) {
    console.error('[seo/opportunities] on-page audit failed:', e?.message)
  }
  websiteSuggestions.push(INTERNAL_LINK_SUGGESTION)

  // Severity-ordered (high → low) so the most worthwhile lands first.
  const sevRank = { high: 0, med: 1, low: 2 }
  websiteSuggestions.sort((a, b) => (sevRank[a.sev] ?? 3) - (sevRank[b.sev] ?? 3))

  // Decay — week-over-week slippage from the two most recent snapshot weeks.
  const historyReady = distinctWeeks >= MIN_SNAPSHOT_WEEKS
  const decay = historyReady ? classifyDecay(currentRows, priorRows, { dismissed, limit: 12 }) : []

  // Post-publish "did it work?" — recent website pieces whose target query has a
  // snapshot both before and after publish. Empty until such a piece exists.
  const universe = currentRows.map((r) => r.query)
  const postPublish = historyReady ? computePostPublish(blogPieces || [], snapRows || [], universe) : []

  // Cannibalization — locked until ~2 weeks of PER-URL rows accrue. Only then do
  // we pull the most recent per-URL week and classify (avoids a heavy read while
  // the feature is still dark).
  const pageWeeks  = new Set((pageWeekRows || []).map((r) => isoWeekKey(r.captured_at)).filter(Boolean)).size
  const pagesReady = pageWeeks >= MIN_SNAPSHOT_WEEKS
  let cannibalization = []
  if (pagesReady) {
    const pageRows = await sb(
      `gsc_query_snapshots?workspace_id=eq.${ws.id}&page=not.is.null` +
      `&select=query,page,position,impressions,clicks,captured_at&order=captured_at.desc&limit=1000`
    ).then((r) => (r.ok ? r.json().catch(() => []) : []))
    const latestPageWeek = [...new Set((pageRows || []).map((r) => isoWeekKey(r.captured_at)).filter(Boolean))].sort().reverse()[0]
    const latestPageRows = (pageRows || []).filter((r) => isoWeekKey(r.captured_at) === latestPageWeek)
    cannibalization = classifyCannibalization(latestPageRows, { limit: 12 })
  }

  const summary = {
    open:             opportunities.length,
    strikingDistance: opportunities.filter((o) => o.type === 'striking_distance').length,
    demandNoContent:  opportunities.filter((o) => o.type === 'demand_no_content').length,
    decaying:         decay.length,
    cannibalization:  cannibalization.length,
  }

  return res.status(200).json({
    connected: true,
    opportunities,
    decay,
    postPublish,
    cannibalization,
    summary,
    websiteSuggestions,
    snapshotWeeks: distinctWeeks,
    locked: {
      // Decay needs ~2 query-level snapshot weeks; cannibalization needs ~2
      // PER-URL weeks (which start accruing only once this build ships).
      decay:           { ready: historyReady },
      cannibalization: { ready: pagesReady },
    },
  })
}
