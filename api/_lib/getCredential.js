// Per-workspace publish credential lookup.
//
// Replaces process.env.{BUFFER_ACCESS_TOKEN, GOOGLE_SERVICE_ACCOUNT_KEY, ...} reads
// in api/publish/* with a workspace_id-scoped read from the shared
// workspace_credentials table. Each publish endpoint calls
// getCredential(workspaceId, service) and gets back { config, secret } or
// null when the workspace hasn't configured that service.
//
// Service names are stable strings the publish endpoints know about:
//   'buffer'        — Buffer queue (universal social + local path: IG / FB /
//                     LinkedIn / X / TikTok / YouTube Shorts /
//                     Threads / Bluesky / Mastodon / GBP) { secret: access_token }
//   'wordpress'     — WordPress REST publish (equine)
//                     { config: { site_url, user }, secret: app_password }
//   'astro_github'  — Astro+GitHub website publish (animals)
//                     { config: { repo, branch, ... }, secret: github_token }
//   'website'       — Generic webhook-based publish
//                     { config: { url }, secret: shared_secret }
//   'beehiiv'       — Beehiiv newsletter publish (drafts)
//                     { config: { publication_id }, secret: api_key }
//
// Decryption uses WORKSPACE_CREDENTIALS_KEY (see credentialCrypto.js).
//
// NOTE: there is deliberately NO process.env fallback. An earlier version, when
// a workspace had no row, read BUFFER_ACCESS_TOKEN / WORDPRESS_USER /
// WORDPRESS_APP_PASSWORD / WEBSITE_PUBLISH_URL to keep the pre-2026-05-10
// per-brand deployments working. On this shared multi-tenant deployment that
// would hand every unconfigured workspace the SAME process-wide credential — a
// cross-tenant leak — so it was removed once per-brand deployments were retired
// (Phase 1F). getCredential now returns null whenever no active, decryptable
// row exists; every caller guards on that (typically a 503 'not_configured').
// Do not re-add an env fallback here.

import { decryptSecret } from './credentialCrypto.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

async function fetchRow(workspaceId, service) {
  if (!workspaceId || !SUPABASE_URL || !SUPABASE_KEY) return null
  const url =
    `${SUPABASE_URL}/rest/v1/workspace_credentials` +
    `?workspace_id=eq.${encodeURIComponent(workspaceId)}` +
    `&service=eq.${encodeURIComponent(service)}` +
    `&status=eq.active` +
    `&select=config,secret_ciphertext&limit=1`
  let r
  try {
    r = await fetch(url, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    })
  } catch (e) {
    console.error('[getCredential] fetch error:', e?.message)
    return null
  }
  if (!r.ok) return null
  const rows = await r.json().catch(() => null)
  return Array.isArray(rows) && rows[0] ? rows[0] : null
}

export async function getCredential(workspaceId, service) {
  const row = await fetchRow(workspaceId, service)
  if (row && row.secret_ciphertext) {
    try {
      const secret = decryptSecret(row.secret_ciphertext)
      return { config: row.config || {}, secret }
    } catch (e) {
      console.error(`[getCredential] decrypt failed for service='${service}':`, e?.message)
      // A corrupted/undecryptable row is treated as not-configured: return null
      // and let the caller surface a 503 'not_configured' rather than serving a
      // stale or wrong credential.
    }
  }
  return null
}

// Lightweight existence check that doesn't require decrypting the secret.
// Used by the Settings UI to render which services are configured.
export async function listConfiguredServices(workspaceId) {
  if (!workspaceId || !SUPABASE_URL || !SUPABASE_KEY) return []
  const url =
    `${SUPABASE_URL}/rest/v1/workspace_credentials` +
    `?workspace_id=eq.${encodeURIComponent(workspaceId)}` +
    `&status=eq.active` +
    `&select=service,config,updated_at`
  const r = await fetch(url, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  })
  if (!r.ok) return []
  return (await r.json().catch(() => [])) || []
}
