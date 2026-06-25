import { withSentry } from '../../../_lib/sentry.js'
import { requireRole, requireCapability } from '../../../_lib/auth.js'
import { CAP_INTEGRATIONS_CONNECT } from '../../../_lib/capabilities.js'
import { workspaceContext } from '../../../_lib/workspaceContext.js'
import { enforceLimit } from '../../../_lib/ratelimit.js'
import { BundlePublisher } from '../../../_lib/social/index.js'
import { ensureLocationTeam, isMissingTeam } from '../../../_lib/social/bundleTeams.js'

// POST /api/integrations/bundle/connect-location  { locationId }
//
// Admin clicks "Connect Google Business" on a specific LOCATION row in the
// bundle.social card. bundle allows one active GBP per Team, so each location's
// Google Business listing connects through its own per-location Team
// (workspace_locations.bundle_team_id). Ensures that location's Team (creates +
// stores one on first use, self-heals a deleted one), then returns the hosted
// portal URL scoped to GOOGLE_BUSINESS only.
//
// SECURITY — locationId is client input and is validated two ways before it can
// scope a bundle Team: (1) UUID shape, (2) the workspace_locations row is fetched
// filtered by BOTH id AND the workspace_id resolved from workspaceContext, so an
// admin can only connect a location that belongs to their own workspace. The
// teamId then derives from that server-resolved row — never from the request.

export const config = { runtime: 'nodejs' }

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Fetch the location row scoped to the workspace (authorization filter). Returns
// null when the id doesn't belong to this workspace or doesn't exist.
async function fetchLocation(workspaceId, locationId) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null
  const params = new URLSearchParams({
    id: `eq.${locationId}`,
    workspace_id: `eq.${workspaceId}`,
    status: 'eq.active',
    select: 'id,label,status,bundle_team_id',
    limit: '1',
  })
  const r = await fetch(`${SUPABASE_URL}/rest/v1/workspace_locations?${params.toString()}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  })
  if (!r.ok) return null
  const rows = await r.json().catch(() => [])
  return Array.isArray(rows) && rows[0] ? rows[0] : null
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method-not-allowed' })

  const workspace = await workspaceContext(req)
  if (!workspace) return res.status(404).json({ error: 'no-workspace-context' })

  const auth = await requireRole(req, ['admin'], { orgId: workspace.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  const capAuth = await requireCapability(req, workspace, [CAP_INTEGRATIONS_CONNECT])
  if (!capAuth.ok) return res.status(403).json({ error: capAuth.reason, missing: capAuth.missing })

  if (!(await enforceLimit(req, res, 'generic', workspace.id))) return

  if (!process.env.BUNDLE_API_KEY) {
    return res.status(503).json({ error: 'bundle-not-configured', message: 'bundle.social is not set up on this deployment.' })
  }

  const body = (typeof req.body === 'object' && req.body) ? req.body : {}
  const locationId = body.locationId
  if (typeof locationId !== 'string' || !UUID_RE.test(locationId)) {
    return res.status(400).json({ error: 'invalid-location-id' })
  }

  const location = await fetchLocation(workspace.id, locationId)
  if (!location) return res.status(404).json({ error: 'location-not-found' })

  let publisher
  try {
    publisher = new BundlePublisher(workspace)
  } catch (_e) {
    return res.status(503).json({ error: 'bundle-not-configured' })
  }

  // Ensure a LIVE per-location Team, then return a GBP-only hosted-portal link.
  // Mirrors the brand connect's self-heal: create on first use, and if the
  // stored location Team is gone (404), recreate once and retry.
  const redirectUrl = `https://${workspace.slug}.withbernard.ai/settings/integrations?bundle=connected`

  // A location-scoped publisher whose teamId resolves to the location's Team
  // (set from the server-resolved row by ensureLocationTeam).
  const locPublisher = () => new BundlePublisher(workspace, { teamId: location.bundle_team_id })

  try {
    if (!location.bundle_team_id) await ensureLocationTeam(workspace, location, publisher)

    let url = null
    try {
      const r = await locPublisher().connect({ networks: ['gbp'], redirectUrl })
      url = r?.url
    } catch (e) {
      if (!isMissingTeam(e)) throw e
      console.warn('[bundle/connect-location] stored location Team is gone — recreating:', location.bundle_team_id)
      await ensureLocationTeam(workspace, location, publisher)
      const r = await locPublisher().connect({ networks: ['gbp'], redirectUrl })
      url = r?.url
    }
    if (!url) return res.status(502).json({ error: 'portal-link-failed' })
    return res.status(200).json({ url, locationId: location.id })
  } catch (e) {
    console.error('[bundle/connect-location] failed:', e?.stack || e?.message)
    return res.status(e?.status || 502).json({ error: e?.code || 'portal-link-failed' })
  }
}

export default withSentry(handler)
