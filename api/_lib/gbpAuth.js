// Google Business Profile OAuth helpers — mirrors gscAuth.js in structure.
//
// Uses the `business.manage` scope to read GBP account data, location-level
// performance metrics (Business Profile Performance API), and per-post
// insights (My Business v4 API).
//
// Client credentials: reuses GOOGLE_DRIVE_CLIENT_ID/SECRET if dedicated
// GOOGLE_GBP_CLIENT_ID/SECRET aren't set — the Drive OAuth client covers
// both with one additional redirect URI.
// Register https://withbernard.ai/api/integrations/gbp/callback in the
// Google Cloud Console OAuth client's Authorized redirect URIs.
//
// CRITICAL: four GBP APIs must be enabled in the same GCP project as the
// OAuth client (same "SC API disabled" class of gate as GSC):
//   - Business Profile Performance API (businessprofileperformance.googleapis.com)
//   - My Business Account Management API (mybusinessaccountmanagement.googleapis.com)
//   - My Business Information API (mybusinessinformation.googleapis.com)
//   - My Business API (mybusiness.googleapis.com) — legacy v4, for localPosts
// A 403 when the connected account owns the GBP listing = these APIs are
// disabled in the project, NOT a missing user-level permission.

import { createHmac, randomBytes } from 'node:crypto'
import { encryptSecret } from './credentialCrypto.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

export const GBP_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/business.manage',
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
]

const STATE_TTL_MS = 10 * 60 * 1000
const STATE_LABEL  = 'gbp_oauth_state_v1'

function getStateKey() {
  const hex = process.env.WORKSPACE_CREDENTIALS_KEY
  if (!hex || hex.length !== 64) {
    throw new Error('WORKSPACE_CREDENTIALS_KEY not set (required for GBP OAuth state signing)')
  }
  return createHmac('sha256', Buffer.from(hex, 'hex')).update(STATE_LABEL).digest()
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}
function b64urlDecode(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4))
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64')
}

export function signOAuthState({ workspaceId, slug, userId }) {
  const payload = { w: workspaceId, s: slug, u: userId, n: b64url(randomBytes(12)), e: Date.now() + STATE_TTL_MS }
  const body = b64url(JSON.stringify(payload))
  const sig  = b64url(createHmac('sha256', getStateKey()).update(body).digest())
  return `${body}.${sig}`
}

export function verifyOAuthState(state) {
  if (typeof state !== 'string' || !state.includes('.')) return null
  const [body, sig] = state.split('.')
  if (!body || !sig) return null
  const expected = b64url(createHmac('sha256', getStateKey()).update(body).digest())
  if (expected !== sig) return null
  let payload
  try { payload = JSON.parse(b64urlDecode(body).toString('utf8')) } catch { return null }
  if (!payload?.w || !payload?.s || !payload?.e) return null
  if (Date.now() > Number(payload.e)) return null
  return { workspaceId: payload.w, slug: payload.s, userId: payload.u || null }
}

function clientId()     { return process.env.GOOGLE_GBP_CLIENT_ID     || process.env.GOOGLE_DRIVE_CLIENT_ID }
function clientSecret() { return process.env.GOOGLE_GBP_CLIENT_SECRET  || process.env.GOOGLE_DRIVE_CLIENT_SECRET }

export function gbpRedirectUri() {
  return process.env.GOOGLE_GBP_REDIRECT_URI || 'https://withbernard.ai/api/integrations/gbp/callback'
}

export function buildAuthorizationUrl({ redirectUri, state }) {
  const id = clientId()
  if (!id) throw new Error('No Google OAuth client ID set (GOOGLE_GBP_CLIENT_ID or GOOGLE_DRIVE_CLIENT_ID)')
  const params = new URLSearchParams({
    client_id:    id,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope:        GBP_OAUTH_SCOPES.join(' '),
    access_type:  'offline',
    prompt:       'consent',
    state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

export async function exchangeCodeForTokens({ code, redirectUri }) {
  const id = clientId()
  const secret = clientSecret()
  if (!id || !secret) throw new Error('GBP OAuth client not configured')
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: id, client_secret: secret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
  })
  const data = await r.json().catch(() => null)
  if (!r.ok || !data?.access_token) {
    throw new Error(`token exchange failed: ${data?.error_description || data?.error || `HTTP ${r.status}`}`)
  }
  if (!data.refresh_token) {
    throw new Error('no refresh_token returned — re-grant consent with offline access')
  }
  return { access_token: data.access_token, refresh_token: data.refresh_token, expires_in: Number(data.expires_in) || 3600 }
}

const _cache = new Map()
export async function refreshGbpToken(refreshToken) {
  const key = refreshToken.slice(0, 24)
  const hit = _cache.get(key)
  if (hit && Date.now() < hit.expiresAt) return hit.accessToken

  const id = clientId()
  const secret = clientSecret()
  if (!id || !secret) throw new Error('GBP OAuth client not configured')
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ refresh_token: refreshToken, client_id: id, client_secret: secret, grant_type: 'refresh_token' }),
  })
  const data = await r.json().catch(() => null)
  if (!r.ok || !data?.access_token) {
    const reason = data?.error_description || data?.error || `HTTP ${r.status}`
    const err = new Error(`GBP refresh failed: ${reason}`)
    if (data?.error === 'invalid_grant') err.code = 'invalid_grant'
    throw err
  }
  const expiresInSec = Number(data.expires_in) || 3600
  _cache.set(key, { accessToken: data.access_token, expiresAt: Date.now() + Math.max(60, expiresInSec - 60) * 1000 })
  return data.access_token
}

async function fetchAccountEmail(accessToken) {
  try {
    const r = await fetch('https://www.googleapis.com/oauth2/v2/userinfo?fields=email', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!r.ok) return null
    const d = await r.json().catch(() => null)
    return d?.email || null
  } catch { return null }
}

// Detect all GBP locations for this Google account.
// Stores all locations in config.locations[] so the performance handler can
// fetch and sum metrics across every location.
// Also keeps top-level location_name/location_id for the legacy localPosts path
// and for workspaces.gbp_location_name (used as a "is configured?" sentinel).
// Retry a fetch up to maxRetries times on 429, waiting retryDelayMs between attempts.
async function fetchWithRetry(url, init, maxRetries = 3, retryDelayMs = 2000) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, init)
    if (res.status !== 429 || attempt === maxRetries) return res
    console.warn(`[gbpAuth] 429 from ${url} — retrying in ${retryDelayMs}ms (attempt ${attempt + 1}/${maxRetries})`)
    await new Promise((r) => setTimeout(r, retryDelayMs))
  }
}

async function detectAllLocations(accessToken) {
  try {
    // Step 1: list GBP accounts (retry up to 3× on 429 — the Accounts.list quota is low by default)
    const acctRes = await fetchWithRetry(
      'https://mybusinessaccountmanagement.googleapis.com/v1/accounts',
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )
    if (!acctRes.ok) {
      const text = await acctRes.text().catch(() => '')
      console.error('[gbpAuth] accounts list failed — likely GBP API not enabled in GCP project:', acctRes.status, text.slice(0, 300))
      return null
    }
    const acctData = await acctRes.json().catch(() => null)
    const accounts = Array.isArray(acctData?.accounts) ? acctData.accounts : []
    if (!accounts.length) {
      console.warn('[gbpAuth] accounts list returned 0 accounts for this Google user')
      return null
    }
    const account = accounts[0]  // take the first account
    const accountName = account.name  // e.g. "accounts/123456789"

    // Step 2: list ALL locations for the account
    // v1 readMask is required or the response body is empty
    const locRes = await fetch(
      `https://mybusinessinformation.googleapis.com/v1/${accountName}/locations?readMask=name,title,storefrontAddress,websiteUri,regularHours`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )
    if (!locRes.ok) {
      const text = await locRes.text().catch(() => '')
      console.error('[gbpAuth] locations list failed — likely My Business Information API not enabled:', locRes.status, text.slice(0, 300))
      return null
    }
    const locData = await locRes.json().catch(() => null)
    const rawLocations = Array.isArray(locData?.locations) ? locData.locations : []
    if (!rawLocations.length) {
      console.warn('[gbpAuth] locations list returned 0 locations for account', accountName)
      return null
    }

    const locations = rawLocations.map((loc) => {
      const locationName = loc.name  // "locations/{locationId}"
      const locationId   = locationName?.replace('locations/', '') || null
      return {
        location_name:    locationName,
        location_id:      locationId,
        location_title:   loc.title || null,
        v4_location_name: locationId ? `${accountName}/locations/${locationId}` : null,
      }
    })

    const primary = locations[0]
    return {
      account_name:     accountName,
      // Top-level fields kept for backward compat (localPosts cron, gbp_location_name sentinel)
      location_name:    primary.location_name,
      location_id:      primary.location_id,
      location_title:   primary.location_title,
      v4_location_name: primary.v4_location_name,
      // Full list — used by gbp-performance to fetch all locations in parallel
      locations,
    }
  } catch (e) {
    console.warn('[gbpAuth] detectAllLocations failed:', e?.message)
    return null
  }
}

// Re-detect all locations and update the stored credential config.
// Called from /api/integrations/gbp/refresh-locations when the initial
// detect failed (e.g. 429 during the OAuth callback).
export async function refreshGbpLocations(workspaceId) {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Supabase env not configured')
  const credRes = await fetch(
    `${SUPABASE_URL}/rest/v1/workspace_credentials?workspace_id=eq.${workspaceId}&service=eq.gbp_analytics&status=eq.active&select=id,secret_ciphertext,config&limit=1`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
  )
  if (!credRes.ok) throw new Error(`credential fetch failed: ${credRes.status}`)
  const row = (await credRes.json().catch(() => []))?.[0]
  if (!row?.secret_ciphertext) throw new Error('no active GBP credential found')

  const { decryptSecret } = await import('./credentialCrypto.js')
  const refreshToken = decryptSecret(row.secret_ciphertext)
  const accessToken = await refreshGbpToken(refreshToken)

  const locationInfo = await detectAllLocations(accessToken)
  if (!locationInfo) throw new Error('location detection failed — check Vercel logs for details')

  const newConfig = {
    ...row.config,
    location_detection: undefined,  // clear the failure marker
    ...locationInfo,
  }
  // Remove the failure marker key entirely
  delete newConfig.location_detection

  const patchRes = await fetch(
    `${SUPABASE_URL}/rest/v1/workspace_credentials?id=eq.${row.id}`,
    {
      method: 'PATCH',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: newConfig }),
    },
  )
  if (!patchRes.ok) throw new Error(`config patch failed: ${patchRes.status}`)

  await fetch(`${SUPABASE_URL}/rest/v1/workspaces?id=eq.${workspaceId}`, {
    method: 'PATCH',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ gbp_location_name: locationInfo.location_name }),
  }).catch(e => console.warn('[gbpAuth] gbp_location_name mirror failed:', e?.message))

  return locationInfo
}

export async function persistGbpCredential({ workspaceId, refreshToken, accessToken }) {
  if (!workspaceId || !refreshToken) throw new Error('workspaceId and refreshToken required')
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Supabase env not configured')

  const [accountEmail, locationInfo] = await Promise.all([
    fetchAccountEmail(accessToken),
    detectAllLocations(accessToken),
  ])

  const config = {
    token_type:    'oauth',
    account_email: accountEmail,
    connected_at:  new Date().toISOString(),
    // account_name, location_name, location_id, location_title, v4_location_name — first location (backward compat)
    // locations[] — all locations for parallel metrics fetch
    ...(locationInfo || { location_detection: 'failed' }),
  }
  const secret_ciphertext = encryptSecret(refreshToken)

  const check = await fetch(
    `${SUPABASE_URL}/rest/v1/workspace_credentials?workspace_id=eq.${workspaceId}&service=eq.gbp_analytics&select=id`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
  )
  const existing = check.ok ? (await check.json().catch(() => []))?.[0] : null

  let r
  if (existing?.id) {
    r = await fetch(`${SUPABASE_URL}/rest/v1/workspace_credentials?id=eq.${existing.id}`, {
      method: 'PATCH',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ config, secret_ciphertext, status: 'active' }),
    })
  } else {
    r = await fetch(`${SUPABASE_URL}/rest/v1/workspace_credentials`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ workspace_id: workspaceId, service: 'gbp_analytics', config, secret_ciphertext, status: 'active' }),
    })
  }
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    throw new Error(`persist failed: ${r.status} ${text}`)
  }

  // Mirror the location name to workspaces.gbp_location_name for fast lookups.
  const locationName = locationInfo?.location_name || null
  await fetch(`${SUPABASE_URL}/rest/v1/workspaces?id=eq.${workspaceId}`, {
    method: 'PATCH',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ gbp_location_name: locationName }),
  }).catch(e => console.warn('[gbpAuth] gbp_location_name mirror failed:', e?.message))

  _cache.delete(refreshToken.slice(0, 24))
}

export async function deleteGbpCredential(workspaceId) {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Supabase env not configured')
  await fetch(
    `${SUPABASE_URL}/rest/v1/workspace_credentials?workspace_id=eq.${workspaceId}&service=eq.gbp_analytics`,
    { method: 'DELETE', headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
  )
  await fetch(`${SUPABASE_URL}/rest/v1/workspaces?id=eq.${workspaceId}`, {
    method: 'PATCH',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ gbp_location_name: null }),
  }).catch(() => {})
}
