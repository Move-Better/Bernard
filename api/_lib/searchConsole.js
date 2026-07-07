// Google Search Console API client — minimal, dependency-free.
//
// Supports two auth modes:
//   OAuth (preferred): pass { credential: { secret: refreshToken, config: { token_type: 'oauth', ... } } }
//   Service-account:   pass { serviceAccountJson: '<json string>', siteUrl }  (legacy fallback)
//
// OAuth is required for domain properties (sc-domain:) — service accounts can
// never be verified owners and 403 on domain properties even when added as Full
// users in the SC UI. The OAuth connect flow lives in api/integrations/gsc/*.

import { createSign } from 'node:crypto'
import { refreshGscToken } from './gscAuth.js'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SCOPE     = 'https://www.googleapis.com/auth/webmasters.readonly'
const QUERY_URL = (siteUrl) =>
  `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`

function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function getServiceAccountToken(serviceAccountJson) {
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

// Resolve an access token from either a stored credential row or a bare SA JSON.
// credential = { secret, config } from workspace_credentials.
async function resolveToken({ credential, serviceAccountJson }) {
  if (credential?.config?.token_type === 'oauth') {
    return refreshGscToken(credential.secret)
  }
  const json = serviceAccountJson || credential?.secret
  if (!json) throw new Error('gsc: no credential provided')
  return getServiceAccountToken(json)
}

// Fetch top search queries for a property over the last `days` days.
// Returns an array of { query, clicks, impressions, ctr, position } sorted
// by impressions descending. Capped at rowLimit rows.
//
// Pass either: { credential, siteUrl }   (OAuth / new path)
//         or:  { serviceAccountJson, siteUrl }  (legacy SA path)
export async function fetchSearchQueries({ credential, serviceAccountJson, siteUrl, days = 28, rowLimit = 100 }) {
  const url = siteUrl || credential?.config?.site_url
  if (!url) throw new Error('gsc: siteUrl is required')
  const token = await resolveToken({ credential, serviceAccountJson })

  const endDate   = new Date()
  const startDate = new Date(endDate - days * 24 * 60 * 60 * 1000)
  const fmt = (d) => d.toISOString().slice(0, 10)

  const r = await fetch(QUERY_URL(url), {
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
    if (r.status === 403) throw new Error(`gsc: access denied for ${url} (403) — ${text.slice(0, 300)}`)
    if (r.status === 400 || r.status === 404) throw new Error(`gsc: site not found (${r.status}) — check the Site URL matches your Search Console property exactly.`)
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

// Fetch top (query, page) pairs — same window/auth as fetchSearchQueries, but
// with the `page` (URL) dimension so we can see which of the workspace's own
// pages rank for each query. Powers cannibalization detection. Returns
// [{ query, page, clicks, impressions, ctr, position }] sorted by impressions.
export async function fetchSearchQueriesByPage({ credential, serviceAccountJson, siteUrl, days = 28, rowLimit = 500 }) {
  const url = siteUrl || credential?.config?.site_url
  if (!url) throw new Error('gsc: siteUrl is required')
  const token = await resolveToken({ credential, serviceAccountJson })

  const endDate   = new Date()
  const startDate = new Date(endDate - days * 24 * 60 * 60 * 1000)
  const fmt = (d) => d.toISOString().slice(0, 10)

  const r = await fetch(QUERY_URL(url), {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      startDate:  fmt(startDate),
      endDate:    fmt(endDate),
      dimensions: ['query', 'page'],
      rowLimit,
      orderBy:    [{ fieldName: 'impressions', sortOrder: 'DESCENDING' }],
    }),
  })
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    if (r.status === 403) throw new Error(`gsc: access denied for ${url} (403) — ${text.slice(0, 300)}`)
    if (r.status === 400 || r.status === 404) throw new Error(`gsc: site not found (${r.status}) — check the Site URL matches your Search Console property exactly.`)
    throw new Error(`gsc: searchAnalytics (query,page) query failed (${r.status}) — ${text.slice(0, 300)}`)
  }
  const data = await r.json()

  return (data.rows || []).map((row) => ({
    query:       row.keys[0],
    page:        row.keys[1],
    clicks:      row.clicks,
    impressions: row.impressions,
    ctr:         row.ctr,
    position:    row.position,
  }))
}

// Test-connection probe: resolve a token (OAuth or SA) then run a minimal
// 1-row query to confirm property access. Returns { siteUrl, totalImpressions }.
// Pass either { credential, siteUrl } or { serviceAccountJson, siteUrl }.
export async function testSearchConsoleAccess({ credential, serviceAccountJson, siteUrl }) {
  const url = siteUrl || credential?.config?.site_url
  if (!url) throw new Error('Search Console Site URL is required.')
  const token = await resolveToken({ credential, serviceAccountJson })

  const endDate   = new Date()
  const startDate = new Date(endDate - 7 * 24 * 60 * 60 * 1000)
  const fmt = (d) => d.toISOString().slice(0, 10)

  const r = await fetch(QUERY_URL(url), {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ startDate: fmt(startDate), endDate: fmt(endDate), rowLimit: 1 }),
  })
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    if (r.status === 403) throw new Error(`Search Console denied access to ${url} (403) — ${text.slice(0, 300)}`)
    if (r.status === 400 || r.status === 404) throw new Error(`Site "${url}" not found (${r.status}). Check the property URL matches exactly.`)
    throw new Error(`Search Console request failed (${r.status}) — ${text.slice(0, 200)}`)
  }
  const data = await r.json().catch(() => ({}))
  const totalImpressions = (data.rows || []).reduce((s, r) => s + (r.impressions || 0), 0)
  return { siteUrl: url, totalImpressions }
}
