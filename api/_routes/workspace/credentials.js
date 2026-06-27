import { withSentry } from '../../_lib/sentry.js'
export const config = { runtime: 'nodejs' }
// Per-workspace publish credential management. Admin-only.
//
//   GET    /api/workspace/credentials          → list configured services (no secrets)
//   PUT    /api/workspace/credentials          → upsert one service { service, config, secret }
//   DELETE /api/workspace/credentials?service=  → remove one service
//
// Secrets are encrypted in Node with AES-256-GCM (see credentialCrypto.js)
// and stored as base64 text in workspace_credentials.secret_ciphertext.
// Plaintext never crosses the wire on read paths — the secret field is
// write-only. To rotate, the admin re-pastes the value.

import { requireRole, requireCapability } from '../../_lib/auth.js'
import { CAP_INTEGRATIONS_CONNECT } from '../../_lib/capabilities.js'
import { workspaceContext } from '../../_lib/workspaceContext.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { encryptSecret } from '../../_lib/credentialCrypto.js'
import { listConfiguredServices } from '../../_lib/getCredential.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// 'facebook' retired 2026-05-10 — FB routes through Buffer.
// 'gbp' retired 2026-05-11 — GBP routes through Buffer (per-location channel
//   IDs live on workspace_locations.gbp_location_id).
// 'drive' uses OAuth (api/integrations/drive/*) for write — listed here only
//   so the standard GET/DELETE paths can read/remove the row uniformly.
// 'beehiiv' newsletter publish via api/publish/beehiiv.js (creates drafts;
//   tenant finishes scheduling + audience picker inside Beehiiv).
// 'ga4' is read-only analytics (Google Analytics Data API), not a publish
//   target — its credential (service-account JSON) + property ID fuel the
//   engagement/outcome loop (refresh-engagement cron → engagement_snapshots).
//   The numeric property ID is mirrored to workspaces.ga4_property_id on save
//   because the cron reads it from the workspace row.
// 'searchconsole' read-only analytics (Google Search Console API), not a
// publish target. Service-account JSON + site URL fuel the insights/search-queries
// endpoint. The site URL is mirrored to workspaces.gsc_site_url on save/delete
// so the SPA can check ws.gsc_site_url without hitting this admin-gated endpoint.
const KNOWN_SERVICES = new Set(['buffer', 'wordpress', 'astro_github', 'website', 'tdc', 'drive', 'beehiiv', 'ga4', 'searchconsole'])

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    signal: AbortSignal.timeout(8_000),
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

async function handler(req, res) {
  const workspace = await workspaceContext(req)
  if (!workspace) return res.status(404).json({ error: 'no-workspace-context' })

  const auth = await requireRole(req, ['admin'], { orgId: workspace.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  // Phase 4 PR1: capability gate. Publish credentials are integrations, so
  // Producer (CAP_INTEGRATIONS_CONNECT in default template) is allowed.
  const capAuth = await requireCapability(req, workspace, [CAP_INTEGRATIONS_CONNECT])
  if (!capAuth.ok) {
    return res.status(403).json({ error: capAuth.reason, missing: capAuth.missing })
  }

  if (req.method === 'GET') {
    const services = await listConfiguredServices(workspace.id)
    return res.status(200).json({ services })
  }

  if (req.method === 'PUT' || req.method === 'POST' || req.method === 'DELETE') {
    if (!(await enforceLimit(req, res, 'default', workspace.id))) return
  }

  if (req.method === 'PUT' || req.method === 'POST') {
    const body = req.body || {}
    const { service, config, secret } = body
    if (!service || !KNOWN_SERVICES.has(service)) {
      return res.status(400).json({ error: 'unknown-service' })
    }
    // OAuth-only services: credential rows are written by their respective OAuth
    // callbacks, not by an admin pasting a secret. Refuse manual PUT so a
    // crafted request can't overwrite the refresh token with arbitrary text.
    if (service === 'drive') {
      return res.status(400).json({ error: 'oauth-only', message: 'Google Drive must be connected via /api/integrations/drive/connect.' })
    }
    if (service === 'searchconsole') {
      return res.status(400).json({ error: 'oauth-only', message: 'Search Console must be connected via /api/integrations/gsc/connect.' })
    }
    if (typeof secret !== 'string' || !secret) {
      return res.status(400).json({ error: 'secret-required' })
    }

    let secret_ciphertext
    try {
      secret_ciphertext = encryptSecret(secret)
    } catch (e) {
      console.error('[credentials PUT] encrypt failed:', e?.message)
      return res.status(500).json({ error: 'encrypt-failed' })
    }

    const safeConfig = config && typeof config === 'object' ? config : {}

    // PostgREST merge-duplicates upsert was returning 409 on this table despite
    // the on_conflict param. Use an explicit read-then-patch/insert instead.
    const check = await sb(
      `workspace_credentials?workspace_id=eq.${workspace.id}&service=eq.${encodeURIComponent(service)}&select=id`,
    )
    const existing = check.ok ? (await check.json().catch(() => []))?.[0] : null

    let r
    if (existing?.id) {
      r = await sb(`workspace_credentials?id=eq.${existing.id}&workspace_id=eq.${workspace.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ config: safeConfig, secret_ciphertext, status: 'active' }),
      })
    } else {
      r = await sb('workspace_credentials', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ workspace_id: workspace.id, service, config: safeConfig, secret_ciphertext, status: 'active' }),
      })
    }
    if (!r.ok) {
      const text = await r.text().catch(() => '')
      console.error('[credentials PUT] supabase error:', r.status, text)
      return res.status(500).json({ error: 'db-error' })
    }

    // GA4: mirror the numeric property ID onto the workspace row — the
    // refresh-engagement cron reads workspaces.ga4_property_id (not the
    // credential config) to decide whether to walk GA4 for this workspace.
    if (service === 'ga4') {
      const propertyId = String(safeConfig.property_id ?? '').trim()
      const wr = await sb(`workspaces?id=eq.${workspace.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ ga4_property_id: propertyId || null }),
      })
      if (!wr.ok) {
        const text = await wr.text().catch(() => '')
        console.error('[credentials PUT] ga4_property_id mirror failed:', wr.status, text)
        return res.status(200).json({ ok: true, service, warning: 'property-id-mirror-failed' })
      }
    }

    // Search Console: mirror the site URL onto the workspace row so the SPA
    // can gate the Search Console read card without hitting this admin endpoint.
    if (service === 'searchconsole') {
      const siteUrl = String(safeConfig.site_url ?? '').trim()
      const wr = await sb(`workspaces?id=eq.${workspace.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ gsc_site_url: siteUrl || null }),
      })
      if (!wr.ok) {
        const text = await wr.text().catch(() => '')
        console.error('[credentials PUT] gsc_site_url mirror failed:', wr.status, text)
        return res.status(200).json({ ok: true, service, warning: 'site-url-mirror-failed' })
      }
    }

    return res.status(200).json({ ok: true, service })
  }

  if (req.method === 'DELETE') {
    const url = new URL(req.url, 'http://localhost')
    const service = url.searchParams.get('service')
    if (!service || !KNOWN_SERVICES.has(service)) {
      return res.status(400).json({ error: 'unknown-service' })
    }
    const r = await sb(
      `workspace_credentials?workspace_id=eq.${workspace.id}&service=eq.${service}`,
      { method: 'DELETE' },
    )
    if (!r.ok) return res.status(500).json({ error: 'db-error' })

    // GA4: clear the mirrored property ID so the cron stops walking GA4 for
    // this workspace once the credential is removed.
    if (service === 'ga4') {
      await sb(`workspaces?id=eq.${workspace.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ ga4_property_id: null }),
      }).catch(() => {})
    }

    // Search Console: clear the mirrored site URL.
    if (service === 'searchconsole') {
      await sb(`workspaces?id=eq.${workspace.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ gsc_site_url: null }),
      }).catch(() => {})
    }

    return res.status(200).json({ ok: true })
  }

  return res.status(405).json({ error: 'method-not-allowed' })
}

export default withSentry(handler)
