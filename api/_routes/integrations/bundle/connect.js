import { withSentry } from '../../../_lib/sentry.js'
import { requireRole, requireCapability } from '../../../_lib/auth.js'
import { CAP_INTEGRATIONS_CONNECT } from '../../../_lib/capabilities.js'
import { workspaceContext, invalidateWorkspaceCacheById } from '../../../_lib/workspaceContext.js'
import { enforceLimit } from '../../../_lib/ratelimit.js'
import { BundlePublisher } from '../../../_lib/social/index.js'

// POST /api/integrations/bundle/connect
//
// Admin clicks "Connect accounts" on the bundle.social card in Settings →
// Integrations. Ensures the workspace has a bundle Team (creates + stores one on
// first use), then returns the hosted-portal URL the browser opens so the tenant
// connects/manages their accounts in bundle's own UI — Bernard never sees a
// platform password.
//
// teamId is an authorization boundary: it is derived from / persisted on the
// workspace row resolved via workspaceContext, NEVER from client input.

export const config = { runtime: 'nodejs' }

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

async function persistTeamId(workspaceId, teamId) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return false
  const r = await fetch(`${SUPABASE_URL}/rest/v1/workspaces?id=eq.${encodeURIComponent(workspaceId)}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ bundle_team_id: teamId }),
  })
  return r.ok
}

// A deleted / unknown bundle Team surfaces as a 404 "No team found" from the
// SDK (teams can be deleted out-of-band in the bundle dashboard).
function isMissingTeam(e) {
  const status = e?.status ?? e?.statusCode ?? e?.body?.statusCode
  let blob = e?.message || ''
  try { blob += ' ' + JSON.stringify(e?.body) } catch { /* non-serializable */ }
  return status === 404 || /no team found/i.test(blob)
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method-not-allowed' })

  const workspace = await workspaceContext(req)
  if (!workspace) return res.status(404).json({ error: 'no-workspace-context' })

  const auth = await requireRole(req, ['admin'], { orgId: workspace.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  const capAuth = await requireCapability(req, workspace, [CAP_INTEGRATIONS_CONNECT])
  if (!capAuth.ok) return res.status(403).json({ error: capAuth.reason, missing: capAuth.missing })

  if (!(await enforceLimit(req, res, 'generic'))) return

  if (!process.env.BUNDLE_API_KEY) {
    return res.status(503).json({ error: 'bundle-not-configured', message: 'bundle.social is not set up on this deployment.' })
  }

  let publisher
  try {
    publisher = new BundlePublisher(workspace)
  } catch (e) {
    return res.status(503).json({ error: 'bundle-not-configured', message: e?.message })
  }

  // Ensure a LIVE bundle Team, then return the hosted-portal link. teamId is an
  // authorization boundary — created + persisted on the workspace row, never from
  // client input. Self-heals a dead team (deleted in the bundle dashboard leaves
  // bundle_team_id pointing at a 404): create on first use, and if the stored
  // team is gone, recreate it once and retry.
  async function ensureTeam() {
    const { teamId } = await publisher.createTeam({ name: workspace.display_name || workspace.slug })
    if (!teamId) throw Object.assign(new Error('team-create-failed'), { code: 'team-create-failed', status: 502 })
    if (!(await persistTeamId(workspace.id, teamId))) {
      throw Object.assign(new Error('team-persist-failed'), { code: 'team-persist-failed', status: 500 })
    }
    workspace.bundle_team_id = teamId // so publisher.teamId resolves for the connect call
    invalidateWorkspaceCacheById(workspace.id)
  }

  const redirectUrl = `https://${workspace.slug}.withbernard.ai/settings/integrations?bundle=connected`
  try {
    if (!workspace.bundle_team_id) await ensureTeam()

    let url = null
    try {
      const r = await publisher.connect({ redirectUrl })
      url = r?.url
    } catch (e) {
      if (!isMissingTeam(e)) throw e
      console.warn('[bundle/connect] stored bundle Team is gone — recreating:', workspace.bundle_team_id)
      await ensureTeam()
      const r = await publisher.connect({ redirectUrl })
      url = r?.url
    }
    if (!url) return res.status(502).json({ error: 'portal-link-failed' })
    return res.status(200).json({ url })
  } catch (e) {
    console.error('[bundle/connect] failed:', e?.stack || e?.message)
    return res.status(e?.status || 502).json({ error: e?.code || 'portal-link-failed', message: e?.message })
  }
}

export default withSentry(handler)
