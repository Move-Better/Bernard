// Insights — GA4 website reads.
//
// Returns two structured reads derived from the workspace's connected GA4 property:
//
//   landingPages  — top pages by sessions (landingPage dimension), with
//                   engagement rate and optional key-event counts (bookings /
//                   inquiries). Drives the "which pages land well" card.
//
//   exitRisks     — published pages with high bounce rate and enough traffic
//                   (>= MIN_SESSIONS) to be meaningful. Drives the "pages where
//                   visitors leave fast" card.
//
// Returns { connected: false } when GA4 isn't configured; the SPA keeps the
// PendingRead placeholder in that case.
//
// Data is fetched live on each call — GA4 Data API is fast (~300ms) and the
// React Query layer caches aggressively (staleTime 1h). No DB persistence is
// needed here; the daily refresh-engagement cron writes engagement_snapshots
// for a different purpose (per-item exemplar scoring).
//
// Node runtime + Express-style (req, res) — mirrors website-health.js.
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole }      from '../../_lib/auth.js'
import { enforceLimit }     from '../../_lib/ratelimit.js'
import { decryptSecret }    from '../../_lib/credentialCrypto.js'
import {
  fetchGA4LandingPages,
  fetchGA4ExitAnalysis,
  urlToPagePath,
} from '../../_lib/ga4.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const MIN_SESSIONS = 10  // ignore pages below this threshold (noise floor)
const TOP_LANDING  = 5   // landing pages to return
const TOP_EXIT     = 3   // exit-risk pages to return

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

  if (!(await enforceLimit(req, res, 'insights-website-ga4'))) return

  if (!ws.ga4_property_id) return res.status(200).json({ connected: false })

  // Decrypt the service-account credential.
  const credRes = await sb(
    `workspace_credentials?workspace_id=eq.${ws.id}&service=eq.ga4&status=eq.active` +
    `&select=secret_ciphertext&limit=1`
  )
  if (!credRes.ok) return res.status(200).json({ connected: false, error: 'credential_fetch_failed' })
  const creds = await credRes.json().catch(() => [])
  const ct = creds?.[0]?.secret_ciphertext
  if (!ct) return res.status(200).json({ connected: false })

  let serviceAccountJson
  try {
    serviceAccountJson = decryptSecret(ct)
  } catch {
    return res.status(200).json({ connected: false, error: 'credential_decrypt_failed' })
  }

  // Published website pages for this workspace that have a URL.
  const itemsRes = await sb(
    `content_items?workspace_id=eq.${ws.id}&status=eq.published&resolved_url=not.is.null` +
    `&select=id,topic,resolved_url&order=published_at.desc.nullslast&limit=50`
  )
  const items = itemsRes.ok ? (await itemsRes.json().catch(() => [])) : []

  const pagePaths   = []
  const pathToTopic = {}
  for (const item of items) {
    const path = urlToPagePath(item.resolved_url)
    if (!path) continue
    pagePaths.push(path)
    if (!pathToTopic[path]) pathToTopic[path] = item.topic || null
  }

  let landingData = { pages: [], hasKeyEvents: false }
  let exitPages   = []

  try {
    ;[landingData, exitPages] = await Promise.all([
      fetchGA4LandingPages({ serviceAccountJson, propertyId: ws.ga4_property_id }),
      pagePaths.length > 0
        ? fetchGA4ExitAnalysis({ serviceAccountJson, propertyId: ws.ga4_property_id, pagePaths })
        : Promise.resolve([]),
    ])
  } catch (e) {
    console.error('[insights/website-ga4]', e?.message)
    return res.status(200).json({ connected: true, error: 'ga4_fetch_failed'})
  }

  // Landing pages: prefer our published pages; fall back to all property landing
  // pages when we have fewer than 3 published-page matches.
  const ourPaths = new Set(pagePaths)
  const ours = landingData.pages.filter((p) => ourPaths.has(p.path))
  const landing = (ours.length >= 3 ? ours : landingData.pages)
    .slice(0, TOP_LANDING)
    .map((p) => ({
      path:           p.path,
      topic:          pathToTopic[p.path] || null,
      sessions:       p.sessions,
      engagementRate: p.engagementRate,
      keyEvents:      p.keyEvents,
    }))

  // Exit risks: worst engagement among our published pages, min sessions gate.
  const exitRisks = exitPages
    .filter((p) => p.sessions >= MIN_SESSIONS)
    .sort((a, b) => b.bounceRate - a.bounceRate)
    .slice(0, TOP_EXIT)
    .map((p) => ({
      path:           p.path,
      topic:          pathToTopic[p.path] || null,
      sessions:       p.sessions,
      bounceRate:     p.bounceRate,
      engagementRate: p.engagementRate,
    }))

  // Total pageviews across published pages (for the "Website visits" stat).
  const totalPageviews = exitPages.reduce((s, p) => s + p.sessions, 0)

  return res.status(200).json({
    connected:    true,
    hasKeyEvents: landingData.hasKeyEvents,
    landingPages: landing,
    exitRisks,
    totalPageviews,
  })
}
