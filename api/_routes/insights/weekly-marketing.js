import { withSentry } from '../../_lib/sentry.js'
export const config = { runtime: 'nodejs' }

// GET /api/insights/weekly-marketing?week_ending=YYYY-MM-DD — one finished
// week's marketing numbers for a machine reader (Deep Thought's weekly
// Scorecard autofill). Contract: docs/weekly-marketing-read.md.
//
// Auth: `Authorization: Bearer <WEEKLY_MARKETING_KEY>` (Sensitive), compared in
// constant time. No Clerk session, no write of any kind: every query below is a
// GET. Same tenant wall as media/catalogue.js: the key only works on the hosts
// in WEEKLY_MARKETING_WORKSPACES, the workspace comes from workspaceScope(req)
// and every query filters by workspace_id.
// ponytail: allowlist hard-coded to Move Better; if a second tenant wants this,
// move key + allowlist onto workspace_credentials.
//
// The week is passed in, never derived from "now" (periodMath.js is untouched):
// the Sunday `week_ending` and the six days before it. Google reports are read
// by calendar date; timestamped rows (posts, interviews) by Pacific calendar
// date. Total Views and Total Engagement are deliberately absent: Bernard only
// holds reach/engagement for posts it published itself, not the account-level
// totals the Scorecard records.

import { decryptSecret } from '../../_lib/credentialCrypto.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { workspaceScope } from '../../_lib/workspaceScope.js'
import { supabaseRest } from '../../_lib/supabaseRest.js'
import { fetchGA4TotalSessions, fetchGA4OutboundClickCount } from '../../_lib/ga4.js'
import { fetchSearchTotalsByDate, fetchNonBrandedSearchTotalsByDate } from '../../_lib/searchConsole.js'
import { keyMatches } from '../media/catalogue.js'

export const WEEKLY_MARKETING_WORKSPACES = new Set(['movebetter'])
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const PACIFIC = 'America/Los_Angeles'
const REST = { timeoutMs: 8_000 }

const addDays = (s, n) => {
  const d = new Date(`${s}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// Today's calendar date in Pacific time, YYYY-MM-DD.
export function pacificToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: PACIFIC }).format(now)
}

// The UTC instant at which the given Pacific calendar day begins. Midnight is
// never ambiguous (DST changes happen at 2am), so one of the two offsets fits.
export function pacificDayStartUtc(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: PACIFIC, hourCycle: 'h23', hour: 'numeric', day: 'numeric' })
  for (const offset of [8, 7]) {
    const t = new Date(Date.UTC(y, m - 1, d, offset))
    const p = Object.fromEntries(fmt.formatToParts(t).map((x) => [x.type, x.value]))
    if (Number(p.hour) === 0 && Number(p.day) === d) return t
  }
  throw new Error(`pacific day start not found for ${dateStr}`)
}

// Returns { start, end, startUtc, endUtc } for a Sunday `week_ending`, or null
// when it is not a real YYYY-MM-DD Sunday. `end` = the Sunday itself; the UTC
// pair is [Monday 00:00 PT, next Monday 00:00 PT).
export function weekFor(weekEnding) {
  if (typeof weekEnding !== 'string' || !DATE_RE.test(weekEnding)) return null
  const d = new Date(`${weekEnding}T00:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== weekEnding) return null
  if (d.getUTCDay() !== 0) return null
  const start = addDays(weekEnding, -6)
  return {
    start,
    end: weekEnding,
    startUtc: pacificDayStartUtc(start),
    endUtc: pacificDayStartUtc(addDays(weekEnding, 1)),
  }
}

const num = (value) => ({ value, reason: null })
const missing = (reason) => ({ value: null, reason })

async function loadCredential(workspaceId, service) {
  const r = await supabaseRest(
    `workspace_credentials?workspace_id=eq.${workspaceId}&service=eq.${service}&status=eq.active&select=secret_ciphertext,config&limit=1`,
    {}, REST,
  )
  if (!r.ok) return { reason: 'credential_fetch_failed' }
  const row = (await r.json().catch(() => []))?.[0]
  if (!row?.secret_ciphertext) return { reason: 'not_connected' }
  try {
    return { secret: decryptSecret(row.secret_ciphertext), config: row.config || {} }
  } catch {
    return { reason: 'credential_decrypt_failed' }
  }
}

async function readWebsite(ws, week) {
  const out = { website_sessions: missing('ga4_not_connected'), book_now_clicks: missing('ga4_not_connected') }
  if (!ws.ga4_property_id) return out
  const cred = await loadCredential(ws.id, 'ga4')
  if (!cred.secret) {
    const reason = cred.reason === 'not_connected' ? 'ga4_not_connected' : `ga4_${cred.reason}`
    return { website_sessions: missing(reason), book_now_clicks: missing(reason) }
  }
  const base = { serviceAccountJson: cred.secret, propertyId: ws.ga4_property_id, startDate: week.start, endDate: week.end }
  try {
    out.website_sessions = num(await fetchGA4TotalSessions(base))
  } catch (e) {
    console.error('[insights/weekly-marketing] ga4 sessions failed:', e?.message)
    out.website_sessions = missing('ga4_fetch_failed')
  }
  if (!ws.booking_url) {
    out.book_now_clicks = missing('no_booking_url')
  } else {
    try {
      out.book_now_clicks = num(await fetchGA4OutboundClickCount({ ...base, domainContains: new URL(ws.booking_url).hostname }))
    } catch (e) {
      console.error('[insights/weekly-marketing] ga4 book-now failed:', e?.message)
      out.book_now_clicks = missing('ga4_fetch_failed')
    }
  }
  return out
}

async function readSearch(ws, week) {
  const fail = (reason) => ({ search_impressions: missing(reason), non_branded_search_clicks: missing(reason), lastDataDate: null })
  if (!ws.gsc_site_url) return fail('gsc_not_connected')
  const cred = await loadCredential(ws.id, 'searchconsole')
  if (!cred.secret) return fail(cred.reason === 'not_connected' ? 'gsc_not_connected' : `gsc_${cred.reason}`)
  const args = { credential: { secret: cred.secret, config: cred.config }, siteUrl: ws.gsc_site_url, startDate: week.start, endDate: week.end }
  try {
    // By-date rows, summed here: that is what the Insights page and the
    // measured Scorecard agree on (a no-dimension query is anonymised differently).
    const [days, nonBranded] = await Promise.all([fetchSearchTotalsByDate(args), fetchNonBrandedSearchTotalsByDate(args)])
    const inWeek = (d) => d.date >= week.start && d.date <= week.end
    const mine = days.filter(inWeek)
    return {
      search_impressions: num(mine.reduce((a, d) => a + d.impressions, 0)),
      non_branded_search_clicks: num(nonBranded.filter(inWeek).reduce((a, d) => a + d.clicks, 0)),
      lastDataDate: mine.map((d) => d.date).sort().pop() || null,
    }
  } catch (e) {
    console.error('[insights/weekly-marketing] gsc failed:', e?.message)
    return fail('gsc_fetch_failed')
  }
}

function tally(rows, keyOf) {
  const m = new Map()
  for (const r of rows) {
    const k = keyOf(r)
    m.set(k, (m.get(k) || 0) + 1)
  }
  return m
}

async function readPosts(ws, week) {
  const r = await supabaseRest(
    `content_items?workspace_id=eq.${ws.id}&status=eq.published` +
    `&published_at=gte.${encodeURIComponent(week.startUtc.toISOString())}` +
    `&published_at=lt.${encodeURIComponent(week.endUtc.toISOString())}` +
    `&select=platform&limit=1000`,
    {}, REST,
  )
  if (!r.ok) return missing('db_read_failed')
  const rows = await r.json().catch(() => null)
  if (!Array.isArray(rows)) return missing('db_read_failed')
  return num(Object.fromEntries([...tally(rows, (x) => x.platform || 'unknown')].sort(([a], [b]) => a.localeCompare(b))))
}

async function readInterviews(ws, week) {
  const r = await supabaseRest(
    `interviews?workspace_id=eq.${ws.id}` +
    `&created_at=gte.${encodeURIComponent(week.startUtc.toISOString())}` +
    `&created_at=lt.${encodeURIComponent(week.endUtc.toISOString())}` +
    `&select=kind,status&limit=1000`,
    {}, REST,
  )
  if (!r.ok) return missing('db_read_failed')
  const rows = await r.json().catch(() => null)
  if (!Array.isArray(rows)) return missing('db_read_failed')
  const counts = tally(rows, (x) => `${x.kind || 'unknown'}\u0000${x.status || 'unknown'}`)
  return num([...counts].map(([k, count]) => { const [kind, status] = k.split('\u0000'); return { kind, status, count } })
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.status.localeCompare(b.status)))
}

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  const scope = await workspaceScope(req)
  if (!scope) return res.status(404).json({ error: 'no_workspace' })
  const ws = scope.workspace
  if (!WEEKLY_MARKETING_WORKSPACES.has(ws?.slug)) return res.status(404).json({ error: 'not_found' })
  if (!keyMatches(req.headers?.authorization, process.env.WEEKLY_MARKETING_KEY)) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  if (!(await enforceLimit(req, res, 'generic', scope.id))) return

  const sp = new URL(req.url, 'http://localhost').searchParams
  const week = weekFor(sp.get('week_ending'))
  if (!week) return res.status(400).json({ error: 'invalid_week_ending', message: 'week_ending must be a Sunday, YYYY-MM-DD' })
  const today = pacificToday()
  if (week.end >= today) return res.status(400).json({ error: 'week_not_finished', message: 'week_ending must be before today (Pacific)' })

  const [website, search, posts, interviews] = await Promise.all([
    readWebsite(ws, week), readSearch(ws, week), readPosts(ws, week), readInterviews(ws, week),
  ])

  // Has Google finished reporting the week? Search Console: only when it returned a
  // row for the Sunday. GA4's API does not say, so it is a clock rule: a week that
  // ended 2 days ago or less may still be revised.
  const daysSince = Math.round((new Date(`${today}T00:00:00Z`) - new Date(`${week.end}T00:00:00Z`)) / 86_400_000)
  const gscDone = search.lastDataDate != null && search.lastDataDate >= week.end
  const { lastDataDate: _last, ...searchNumbers } = search

  return res.status(200).json({
    workspace: ws.slug,
    week_ending: week.end,
    week_start: week.start,
    timezone: PACIFIC,
    computed_at: new Date().toISOString(),
    numbers: { ...website, ...searchNumbers },
    data_status: {
      website: daysSince > 2 ? 'complete' : 'may_be_incomplete',
      search: gscDone ? 'complete' : 'may_be_incomplete',
    },
    components: {
      posts_published_by_platform: posts,
      interviews_by_kind_and_status: interviews,
    },
  })
}

export default withSentry(handler)
