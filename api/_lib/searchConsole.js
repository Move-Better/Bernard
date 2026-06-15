// Google Search Console API client — minimal, dependency-free.
//
// Uses the same service-account JWT auth pattern as ga4.js (createSign +
// token exchange) with a different OAuth scope and base URL. The service
// account must be granted "Full" or "Restricted" access on the Search
// Console property in the Search Console UI:
//   Search Console → Settings → Users and permissions → Add user
//   → <service_account_email> → Full (or Restricted for read-only).
//
// Site URL shapes Search Console accepts:
//   URL prefix:   "https://movebetter.co/"     (trailing slash required)
//   Domain:       "sc-domain:movebetter.co"
// We store whichever the admin provides; the API accepts both.

import { createSign } from 'node:crypto'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SCOPE     = 'https://www.googleapis.com/auth/webmasters.readonly'
const QUERY_URL = (siteUrl) =>
  `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`

function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function getAccessToken(serviceAccountJson) {
  let sa
  try {
    sa = typeof serviceAccountJson === 'string' ? JSON.parse(serviceAccountJson) : serviceAccountJson
  } catch (e) {
    throw new Error(`gsc: service-account JSON parse failed — ${e.message}`)
  }
  if (!sa?.client_email || !sa?.private_key) {
    throw new Error('gsc: service-account JSON is missing client_email or private_key')
  }

  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const claim  = { iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, exp: now + 3600, iat: now }
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`
  const signer = createSign('RSA-SHA256')
  signer.update(unsigned)
  const jwt = `${unsigned}.${b64url(signer.sign(sa.private_key))}`

  const r = await fetch(TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  })
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    throw new Error(`gsc: token exchange failed (${r.status}) — ${text.slice(0, 300)}`)
  }
  const data = await r.json()
  if (!data.access_token) throw new Error('gsc: token exchange returned no access_token')
  return data.access_token
}

// Fetch top search queries for a property over the last `days` days.
// Returns an array of { query, clicks, impressions, ctr, position } sorted
// by impressions descending. Capped at rowLimit rows.
export async function fetchSearchQueries({ serviceAccountJson, siteUrl, days = 28, rowLimit = 100 }) {
  if (!siteUrl) throw new Error('gsc: siteUrl is required')
  const token = await getAccessToken(serviceAccountJson)

  const endDate   = new Date()
  const startDate = new Date(endDate - days * 24 * 60 * 60 * 1000)
  const fmt = (d) => d.toISOString().slice(0, 10)

  const r = await fetch(QUERY_URL(siteUrl), {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      startDate:  fmt(startDate),
      endDate:    fmt(endDate),
      dimensions: ['query'],
      rowLimit,
      orderBy:    [{ fieldName: 'impressions', sortOrder: 'DESCENDING' }],
    }),
  })
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    if (r.status === 403) throw new Error(`gsc: access denied for ${siteUrl} (403). Add the service account email as a user in Search Console → Settings → Users and permissions.`)
    if (r.status === 400 || r.status === 404) throw new Error(`gsc: site not found (${r.status}) — check the Site URL matches your Search Console property exactly (including trailing slash for URL-prefix properties).`)
    throw new Error(`gsc: searchAnalytics query failed (${r.status}) — ${text.slice(0, 300)}`)
  }
  const data = await r.json()

  return (data.rows || []).map((row) => ({
    query:       row.keys[0],
    clicks:      row.clicks,
    impressions: row.impressions,
    ctr:         row.ctr,
    position:    row.position,
  }))
}

// Test-connection probe: exchange JWT for a token (proves JSON is valid) then
// run a minimal 1-row query (proves the service account has property access).
// Returns { siteUrl, totalImpressions } on success; throws on failure.
export async function testSearchConsoleAccess({ serviceAccountJson, siteUrl }) {
  if (!siteUrl) throw new Error('Search Console Site URL is required.')
  const token = await getAccessToken(serviceAccountJson)

  const endDate   = new Date()
  const startDate = new Date(endDate - 7 * 24 * 60 * 60 * 1000)
  const fmt = (d) => d.toISOString().slice(0, 10)

  const r = await fetch(QUERY_URL(siteUrl), {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ startDate: fmt(startDate), endDate: fmt(endDate), rowLimit: 1 }),
  })
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    if (r.status === 403) throw new Error(`Search Console denied access to ${siteUrl} (403). Add the service account email under Search Console → Settings → Users and permissions.`)
    if (r.status === 400 || r.status === 404) throw new Error(`Site "${siteUrl}" not found (${r.status}). The URL must match the property exactly — try "${siteUrl.endsWith('/') ? siteUrl : siteUrl + '/'}" or "sc-domain:${siteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}".`)
    throw new Error(`Search Console request failed (${r.status}) — ${text.slice(0, 200)}`)
  }
  const data = await r.json().catch(() => ({}))
  const totalImpressions = (data.rows || []).reduce((s, r) => s + (r.impressions || 0), 0)
  return { siteUrl, totalImpressions }
}
