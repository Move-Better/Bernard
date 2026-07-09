// GA4 Data API client — minimal, dependency-free.
//
// We deliberately don't pull in @google-analytics/data: the cron only needs
// runReport, the SDK ships ~5MB of generated gRPC stubs, and every other GCP
// integration in this codebase already uses raw REST + a self-signed JWT
// (see api/publish/website.js etc.). Lighter cold start, fewer transitive deps.
//
// Auth: GA4 uses Google's standard service-account flow. The credential row
// (workspace_credentials.service='ga4', secret = full service-account JSON)
// is read by the caller; we only need the parsed JSON here. The service
// account must be granted "Viewer" on the GA4 property in the Admin UI:
// Property → Property Access Management → Add user → <service_account_email>.
//
// Property ID lives on workspaces.ga4_property_id (numeric string, NOT the
// "G-XXXXX" measurement ID — those identify data streams, not properties).

import { createSign } from 'node:crypto'

const TOKEN_URL  = 'https://oauth2.googleapis.com/token'
const REPORT_URL = (id) => `https://analyticsdata.googleapis.com/v1beta/properties/${id}:runReport`
const SCOPE      = 'https://www.googleapis.com/auth/analytics.readonly'

function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function getAccessToken(serviceAccountJson) {
  let sa
  try {
    sa = typeof serviceAccountJson === 'string' ? JSON.parse(serviceAccountJson) : serviceAccountJson
  } catch (e) {
    throw new Error(`ga4: service-account JSON parse failed — ${e.message}`)
  }
  if (!sa?.client_email || !sa?.private_key) {
    throw new Error('ga4: service-account JSON is missing client_email or private_key')
  }

  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const claim = {
    iss:   sa.client_email,
    scope: SCOPE,
    aud:   TOKEN_URL,
    exp:   now + 3600,
    iat:   now,
  }
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`
  const signer = createSign('RSA-SHA256')
  signer.update(unsigned)
  const signature = signer.sign(sa.private_key)
  const jwt = `${unsigned}.${b64url(signature)}`

  const r = await fetch(TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion:  jwt,
    }),
  })
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    throw new Error(`ga4: token exchange failed (${r.status}) — ${text.slice(0, 300)}`)
  }
  const data = await r.json()
  if (!data.access_token) throw new Error('ga4: token exchange returned no access_token')
  return data.access_token
}

// Pull the standard exemplar-scoring metrics for a list of pagePath values
// over the last `days` days (default 30 — long enough that newly-published
// posts get a fair shot, short enough that one ancient viral post doesn't
// drag the workspace median up forever).
//
// Returns a map keyed by pagePath: { pageviews, engaged_sessions, engagement_time }
// (engagement_time is total userEngagementDuration in seconds, NOT the per-
// session average — the cron computes per-session averaging downstream if it
// needs it). Paths with no GA4 data simply don't appear in the map.
//
// Pass explicit `startDate`/`endDate` (YYYY-MM-DD) for a specific calendar
// window (e.g. one week) — overrides the relative `days`-back default used
// by the exemplar-scoring cron.
export async function fetchGA4Metrics({ serviceAccountJson, propertyId, pagePaths, days = 30, startDate, endDate }) {
  if (!propertyId) throw new Error('ga4: propertyId is required')
  if (!Array.isArray(pagePaths) || pagePaths.length === 0) return {}

  const token = await getAccessToken(serviceAccountJson)
  const range = startDate && endDate
    ? { startDate, endDate }
    : { startDate: `${days}daysAgo`, endDate: 'today' }
  const r = await fetch(REPORT_URL(propertyId), {
    method:  'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      dateRanges: [range],
      dimensions: [{ name: 'pagePath' }],
      metrics: [
        { name: 'screenPageViews' },
        { name: 'engagedSessions' },
        { name: 'userEngagementDuration' },
      ],
      dimensionFilter: {
        filter: {
          fieldName:    'pagePath',
          inListFilter: { values: pagePaths },
        },
      },
      limit: '10000',
    }),
  })
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    throw new Error(`ga4: runReport failed (${r.status}) — ${text.slice(0, 300)}`)
  }
  const data = await r.json()

  const out = {}
  for (const row of data.rows || []) {
    const path = row.dimensionValues?.[0]?.value
    if (!path) continue
    const [pv, es, et] = (row.metricValues || []).map((m) => Number(m.value) || 0)
    out[path] = {
      pageviews:        pv,
      engaged_sessions: es,
      engagement_time:  et,
    }
  }
  return out
}

// Test-connection probe: verify a service-account JSON can actually read a
// GA4 property. Exchanges the JWT for a token (proves the JSON is valid) and
// runs a minimal property-wide totals report over the last 7 days (proves the
// service account has been granted Viewer on THIS property). Returns the
// pageview total so the admin sees real data in the "Test connection" result.
// Throws with a human-readable message on any failure.
export async function testGA4Access({ serviceAccountJson, propertyId }) {
  if (!propertyId) throw new Error('GA4 Property ID is required (the numeric ID, not the G-XXXX measurement ID).')
  const token = await getAccessToken(serviceAccountJson)
  const r = await fetch(REPORT_URL(propertyId), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
      metrics: [{ name: 'screenPageViews' }],
      limit: '1',
    }),
  })
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    if (r.status === 403) {
      throw new Error(`GA4 denied access to property ${propertyId} (403). Grant the service account "Viewer" in GA4 → Admin → Property Access Management.`)
    }
    if (r.status === 400 || r.status === 404) {
      throw new Error(`GA4 rejected property ${propertyId} (${r.status}). Check the numeric Property ID — ${text.slice(0, 160)}`)
    }
    throw new Error(`GA4 runReport failed (${r.status}) — ${text.slice(0, 200)}`)
  }
  const data = await r.json().catch(() => ({}))
  const pageviews = Number(data?.rows?.[0]?.metricValues?.[0]?.value) || 0
  return { propertyId: String(propertyId), pageviews }
}

// Fetch landing-page analysis: top pages by sessions, with engagement rate
// and optional key-event (booking/inquiry) counts. Used by the Insights
// "which pages people land on first" read. Returns { pages, hasKeyEvents }.
//
// We request keyEvents alongside sessions + engagementRate. GA4 returns an
// error when there are no key events configured on the property — in that
// case we silently retry without keyEvents and set hasKeyEvents=false, so
// the UI falls back to engagement rate as the quality proxy.
export async function fetchGA4LandingPages({ serviceAccountJson, propertyId, days = 30 }) {
  if (!propertyId) throw new Error('ga4: propertyId is required')
  const token = await getAccessToken(serviceAccountJson)

  const baseBody = {
    dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
    dimensions: [{ name: 'landingPage' }],
    metrics: [
      { name: 'sessions' },
      { name: 'engagementRate' },
      { name: 'keyEvents' },
    ],
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    limit: '25',
  }

  let data
  let hasKeyEvents = true
  const r = await fetch(REPORT_URL(propertyId), {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(baseBody),
  })

  if (!r.ok) {
    const text = await r.text().catch(() => '')
    // GA4 returns 400 when the property has no key events configured.
    if (r.status === 400) {
      hasKeyEvents = false
      const r2 = await fetch(REPORT_URL(propertyId), {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ...baseBody, metrics: [{ name: 'sessions' }, { name: 'engagementRate' }] }),
      })
      if (!r2.ok) {
        const t2 = await r2.text().catch(() => '')
        throw new Error(`ga4: landingPages report failed (${r2.status}) — ${t2.slice(0, 300)}`)
      }
      data = await r2.json()
    } else {
      throw new Error(`ga4: landingPages report failed (${r.status}) — ${text.slice(0, 300)}`)
    }
  } else {
    data = await r.json()
  }

  const pages = []
  for (const row of data.rows || []) {
    const path = row.dimensionValues?.[0]?.value
    if (!path) continue
    const vals = (row.metricValues || []).map((m) => Number(m.value) || 0)
    pages.push({
      path,
      sessions:       vals[0],
      engagementRate: vals[1], // 0–1 decimal (0.63 = 63%)
      keyEvents:      hasKeyEvents ? (vals[2] || 0) : null,
    })
  }
  return { pages, hasKeyEvents }
}

// Fetch exit/bounce analysis for our specific published page paths.
// Returns an array of { path, sessions, bounceRate, engagementRate } sorted
// by bounceRate descending. Callers filter to sessions >= MIN to avoid noise.
export async function fetchGA4ExitAnalysis({ serviceAccountJson, propertyId, pagePaths, days = 30 }) {
  if (!propertyId) throw new Error('ga4: propertyId is required')
  if (!Array.isArray(pagePaths) || pagePaths.length === 0) return []

  const token = await getAccessToken(serviceAccountJson)
  const r = await fetch(REPORT_URL(propertyId), {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
      dimensions: [{ name: 'pagePath' }],
      metrics: [
        { name: 'sessions' },
        { name: 'bounceRate' },
        { name: 'engagementRate' },
      ],
      dimensionFilter: {
        filter: {
          fieldName:    'pagePath',
          inListFilter: { values: pagePaths },
        },
      },
      orderBys: [{ metric: { metricName: 'bounceRate' }, desc: true }],
      limit: '25',
    }),
  })
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    throw new Error(`ga4: exitAnalysis report failed (${r.status}) — ${text.slice(0, 300)}`)
  }
  const data = await r.json()
  const pages = []
  for (const row of data.rows || []) {
    const path = row.dimensionValues?.[0]?.value
    if (!path) continue
    const [sessions, bounceRate, engagementRate] = (row.metricValues || []).map((m) => Number(m.value) || 0)
    pages.push({ path, sessions, bounceRate, engagementRate })
  }
  return pages
}

// Convenience: turn a stored content_items.resolved_url into the pagePath
// shape GA4 reports on (no protocol, no host, leading slash, no query/hash).
// GA4's pagePath dimension is the pathname only — so a URL like
// "https://movebetter.co/blog/why-mobility-matters?utm=foo" becomes
// "/blog/why-mobility-matters". Returns null for unparseable inputs.
export function urlToPagePath(url) {
  if (typeof url !== 'string' || !url) return null
  try {
    const u = new URL(url)
    return u.pathname || '/'
  } catch {
    // Already a path? Accept as-is if it starts with a slash.
    return url.startsWith('/') ? url.split(/[?#]/)[0] : null
  }
}
