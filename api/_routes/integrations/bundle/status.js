import { withSentry } from '../../../_lib/sentry.js'
import { requireRole } from '../../../_lib/auth.js'
import { workspaceContext } from '../../../_lib/workspaceContext.js'
import { enforceLimit } from '../../../_lib/ratelimit.js'
import { BundlePublisher } from '../../../_lib/social/index.js'

// GET /api/integrations/bundle/status
//
// Returns the workspace's bundle.social connection state:
//   - connected / accounts: the BRAND Team's Instagram + Facebook accounts (each
//     with a coarse health flag for the reconnect prompt).
//   - locations: per-location Google Business state — one entry per active
//     workspace_location, with whether its own bundle Team exists and whether its
//     GBP listing is connected. bundle allows one active GBP per Team, so each
//     location connects through its own Team (see memory/project-bundle-social.md).
//
// All Team ids derive from workspaceContext / a workspace-scoped location query —
// never client input. Cheap/safe: returns connected:false when bundle isn't set
// up for the workspace.

export const config = { runtime: 'nodejs' }

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

async function fetchActiveLocations(workspaceId) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return []
  const params = new URLSearchParams({
    workspace_id: `eq.${workspaceId}`,
    status: 'eq.active',
    select: 'id,label,is_primary,position,bundle_team_id',
    order: 'position.asc',
  })
  const r = await fetch(`${SUPABASE_URL}/rest/v1/workspace_locations?${params.toString()}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  })
  if (!r.ok) return []
  const rows = await r.json().catch(() => [])
  return Array.isArray(rows) ? rows : []
}

// Resolve a single location's Google Business connection state from its own
// bundle Team. Never throws — a dead/unreachable Team reads as not-connected so a
// slow location can't fail the whole status call.
async function locationGbpState(workspace, location) {
  const base = {
    id: location.id,
    label: location.label,
    isPrimary: !!location.is_primary,
    hasTeam: !!location.bundle_team_id,
    connected: false,
    displayName: null,
  }
  if (!location.bundle_team_id) return base
  try {
    const publisher = new BundlePublisher(workspace, { teamId: location.bundle_team_id })
    const accounts = await publisher.listAccounts()
    const gbp = accounts.find((a) => a.type === 'GOOGLE_BUSINESS')
    return { ...base, connected: !!gbp?.connected, displayName: gbp?.displayName || null }
  } catch (e) {
    console.warn('[bundle/status] location GBP check failed:', location.id, e?.message)
    return base
  }
}

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method-not-allowed' })

  const workspace = await workspaceContext(req)
  if (!workspace) return res.status(404).json({ error: 'no-workspace-context' })

  const auth = await requireRole(req, ['admin'], { orgId: workspace.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  if (!(await enforceLimit(req, res, 'generic', workspace.id))) return

  if (!process.env.BUNDLE_API_KEY) {
    return res.status(200).json({ connected: false, accounts: [], locations: [] })
  }

  try {
    // Brand Team accounts (Instagram/Facebook). GBP is intentionally excluded —
    // it lives on per-location Teams, surfaced via `locations` below.
    let accounts = []
    if (workspace.bundle_team_id) {
      const publisher = new BundlePublisher(workspace)
      const all = await publisher.listAccounts()
      accounts = all.filter((a) => a.type !== 'GOOGLE_BUSINESS')
    }

    // Per-location Google Business state (checked in parallel).
    const locationRows = await fetchActiveLocations(workspace.id)
    const locations = await Promise.all(locationRows.map((loc) => locationGbpState(workspace, loc)))

    return res.status(200).json({ connected: accounts.length > 0, accounts, locations })
  } catch (e) {
    console.error('[bundle/status] failed:', e?.stack || e?.message)
    return res.status(502).json({ error: 'bundle-status-failed' })
  }
}

export default withSentry(handler)
