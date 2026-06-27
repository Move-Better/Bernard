// Google Search Console OAuth helpers — mirrors driveAuth.js in structure.
//
// Service-account JWT auth for Search Console stopped working for domain
// properties (sc-domain:) due to an owner-verification requirement that
// service accounts can never satisfy. Per-workspace OAuth (where the workspace
// admin grants consent as their Google Account, which already owns the SC
// property) is the correct long-term architecture anyway.
//
// Client credentials: reuses GOOGLE_DRIVE_CLIENT_ID/SECRET if dedicated
// GOOGLE_SC_CLIENT_ID/SECRET aren't set — so the Drive OAuth client already
// registered can cover both integrations with one additional redirect URI.
// Register https://withbernard.ai/api/integrations/gsc/callback in the
// Google Cloud Console OAuth client's Authorized redirect URIs.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { encryptSecret } from './credentialCrypto.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

export const GSC_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/webmasters.readonly',
  // openid + email so we can label the credential with the connecting account
  // (fetchAccountEmail hits the userinfo endpoint, which needs the email scope).
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
]
const STATE_TTL_MS = 10 * 60 * 1000
const STATE_LABEL  = 'gsc_oauth_state_v1'

function getStateKey() {
  const hex = process.env.WORKSPACE_CREDENTIALS_KEY
  if (!hex || hex.length !== 64) {
    throw new Error('WORKSPACE_CREDENTIALS_KEY not set (required for GSC OAuth state signing)')
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
  if (expected.length !== sig.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null
  let payload
  try { payload = JSON.parse(b64urlDecode(body).toString('utf8')) } catch { return null }
  if (!payload?.w || !payload?.s || !payload?.e) return null
  if (Date.now() > Number(payload.e)) return null
  return { workspaceId: payload.w, slug: payload.s, userId: payload.u || null }
}

function clientId()     { return process.env.GOOGLE_SC_CLIENT_ID     || process.env.GOOGLE_DRIVE_CLIENT_ID }
function clientSecret() { return process.env.GOOGLE_SC_CLIENT_SECRET  || process.env.GOOGLE_DRIVE_CLIENT_SECRET }

export function gscRedirectUri() {
  return process.env.GOOGLE_SC_REDIRECT_URI || 'https://withbernard.ai/api/integrations/gsc/callback'
}

export function buildAuthorizationUrl({ redirectUri, state }) {
  const id = clientId()
  if (!id) throw new Error('No Google OAuth client ID set (GOOGLE_SC_CLIENT_ID or GOOGLE_DRIVE_CLIENT_ID)')
  const params = new URLSearchParams({
    client_id:    id,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope:        GSC_OAUTH_SCOPES.join(' '),
    access_type:  'offline',
    prompt:       'consent',
    state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

export async function exchangeCodeForTokens({ code, redirectUri }) {
  const id = clientId()
  const secret = clientSecret()
  if (!id || !secret) throw new Error('GSC OAuth client not configured')
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
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

// In-process access token cache keyed by first 24 chars of refresh token.
const _cache = new Map()
export async function refreshGscToken(refreshToken) {
  const key = refreshToken.slice(0, 24)
  const hit = _cache.get(key)
  if (hit && Date.now() < hit.expiresAt) return hit.accessToken

  const id = clientId()
  const secret = clientSecret()
  if (!id || !secret) throw new Error('GSC OAuth client not configured')
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ refresh_token: refreshToken, client_id: id, client_secret: secret, grant_type: 'refresh_token' }),
  })
  const data = await r.json().catch(() => null)
  if (!r.ok || !data?.access_token) {
    const reason = data?.error_description || data?.error || `HTTP ${r.status}`
    const err = new Error(`GSC refresh failed: ${reason}`)
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
      signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!r.ok) return null
    const d = await r.json().catch(() => null)
    return d?.email || null
  } catch { return null }
}

async function detectSiteUrl(accessToken) {
  try {
    // Canonical host. The legacy www.googleapis.com/webmasters host returns
    // null/404 for the sites list, which silently left config.site_url unset.
    const r = await fetch('https://searchconsole.googleapis.com/webmasters/v3/sites', {
      signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!r.ok) return null
    const d = await r.json().catch(() => null)
    const sites = d?.siteEntry || []
    const domain = sites.find(s => s.siteUrl?.startsWith('sc-domain:'))
    return domain?.siteUrl || sites[0]?.siteUrl || null
  } catch { return null }
}

export async function persistGscCredential({ workspaceId, refreshToken, accessToken }) {
  if (!workspaceId || !refreshToken) throw new Error('workspaceId and refreshToken required')
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Supabase env not configured')

  const [accountEmail, siteUrl] = await Promise.all([
    fetchAccountEmail(accessToken),
    detectSiteUrl(accessToken),
  ])

  const config = { token_type: 'oauth', account_email: accountEmail, site_url: siteUrl, connected_at: new Date().toISOString() }
  const secret_ciphertext = encryptSecret(refreshToken)

  const check = await fetch(
    `${SUPABASE_URL}/rest/v1/workspace_credentials?workspace_id=eq.${workspaceId}&service=eq.searchconsole&select=id`,
    { signal: AbortSignal.timeout(10_000), headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
  )
  const existing = check.ok ? (await check.json().catch(() => []))?.[0] : null

  let r
  if (existing?.id) {
    r = await fetch(`${SUPABASE_URL}/rest/v1/workspace_credentials?id=eq.${existing.id}&workspace_id=eq.${workspaceId}`, {
      method: 'PATCH',
      signal: AbortSignal.timeout(10_000),
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ config, secret_ciphertext, status: 'active' }),
    })
  } else {
    r = await fetch(`${SUPABASE_URL}/rest/v1/workspace_credentials`, {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ workspace_id: workspaceId, service: 'searchconsole', config, secret_ciphertext, status: 'active' }),
    })
  }
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    throw new Error(`persist failed: ${r.status} ${text}`)
  }

  if (siteUrl) {
    await fetch(`${SUPABASE_URL}/rest/v1/workspaces?id=eq.${workspaceId}`, {
      method: 'PATCH',
      signal: AbortSignal.timeout(10_000),
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ gsc_site_url: siteUrl }),
    }).catch(e => console.warn('[gscAuth] gsc_site_url mirror failed:', e?.message))
  }

  _cache.delete(refreshToken.slice(0, 24))
}

export async function deleteGscCredential(workspaceId) {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Supabase env not configured')
  await fetch(
    `${SUPABASE_URL}/rest/v1/workspace_credentials?workspace_id=eq.${workspaceId}&service=eq.searchconsole`,
    { method: 'DELETE', signal: AbortSignal.timeout(10_000), headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
  )
  await fetch(`${SUPABASE_URL}/rest/v1/workspaces?id=eq.${workspaceId}`, {
    method: 'PATCH',
    signal: AbortSignal.timeout(10_000),
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ gsc_site_url: null }),
  }).catch(e => console.error('[gscAuth] gsc_site_url clear failed:', e?.message))
}
