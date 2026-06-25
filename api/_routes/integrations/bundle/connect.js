import { withSentry } from '../../../_lib/sentry.js'
import { requireRole, requireCapability } from '../../../_lib/auth.js'
import { CAP_INTEGRATIONS_CONNECT } from '../../../_lib/capabilities.js'
import { workspaceContext } from '../../../_lib/workspaceContext.js'
import { enforceLimit } from '../../../_lib/ratelimit.js'
import { BundlePublisher } from '../../../_lib/social/index.js'
import { ensureWorkspaceTeam, isMissingTeam } from '../../../_lib/social/bundleTeams.js'

// POST /api/integrations/bundle/connect
//
// Admin clicks "Manage accounts" on the bundle.social card in Settings →
// Integrations. Ensures the workspace has a bundle brand Team (creates + stores
// one on first use), then returns the hosted-portal URL the browser opens so the
// tenant connects/manages Instagram + Facebook in bundle's own UI — Bernard never
// sees a platform password.
//
// Google Business is NOT connected here: bundle allows one active GBP per Team,
// so each location's GBP connects through its own per-location Team via
// /api/integrations/bundle/connect-location (see memory/project-bundle-social.md).
// This portal is scoped to the brand networks (Instagram/Facebook) by the
// publisher's default.
//
// teamId is an authorization boundary: it is derived from / persisted on the
// workspace row resolved via workspaceContext, NEVER from client input.

export const config = { runtime: 'nodejs' }

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

  let publisher
  try {
    publisher = new BundlePublisher(workspace)
  } catch (_e) {
    return res.status(503).json({ error: 'bundle-not-configured' })
  }

  // Ensure a LIVE bundle brand Team, then return the hosted-portal link.
  // Self-heals a dead team (deleted in the bundle dashboard leaves
  // bundle_team_id pointing at a 404): create on first use, and if the stored
  // team is gone, recreate it once and retry.
  const redirectUrl = `https://${workspace.slug}.withbernard.ai/settings/integrations?bundle=connected`
  try {
    if (!workspace.bundle_team_id) await ensureWorkspaceTeam(workspace, publisher)

    let url = null
    try {
      const r = await publisher.connect({ redirectUrl })
      url = r?.url
    } catch (e) {
      if (!isMissingTeam(e)) throw e
      console.warn('[bundle/connect] stored bundle Team is gone — recreating:', workspace.bundle_team_id)
      await ensureWorkspaceTeam(workspace, publisher)
      const r = await publisher.connect({ redirectUrl })
      url = r?.url
    }
    if (!url) return res.status(502).json({ error: 'portal-link-failed' })
    return res.status(200).json({ url })
  } catch (e) {
    console.error('[bundle/connect] failed:', e?.stack || e?.message)
    return res.status(e?.status || 502).json({ error: e?.code || 'portal-link-failed' })
  }
}

export default withSentry(handler)
