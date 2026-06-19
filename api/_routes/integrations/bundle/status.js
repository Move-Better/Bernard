import { withSentry } from '../../../_lib/sentry.js'
import { requireRole } from '../../../_lib/auth.js'
import { workspaceContext } from '../../../_lib/workspaceContext.js'
import { enforceLimit } from '../../../_lib/ratelimit.js'
import { BundlePublisher } from '../../../_lib/social/index.js'

// GET /api/integrations/bundle/status
//
// Returns whether the workspace has a bundle Team and the accounts connected to
// it (each with a coarse health flag for the reconnect prompt). teamId derives
// from workspaceContext — never client input. Cheap/safe: returns
// { connected: false, accounts: [] } when bundle isn't set up for the workspace.

export const config = { runtime: 'nodejs' }

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method-not-allowed' })

  const workspace = await workspaceContext(req)
  if (!workspace) return res.status(404).json({ error: 'no-workspace-context' })

  const auth = await requireRole(req, ['admin'], { orgId: workspace.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  if (!(await enforceLimit(req, res, 'generic'))) return

  if (!workspace.bundle_team_id || !process.env.BUNDLE_API_KEY) {
    return res.status(200).json({ connected: false, accounts: [] })
  }

  try {
    const publisher = new BundlePublisher(workspace)
    const accounts = await publisher.listAccounts()
    return res.status(200).json({ connected: accounts.length > 0, accounts })
  } catch (e) {
    console.error('[bundle/status] failed:', e?.stack || e?.message)
    return res.status(502).json({ error: 'bundle-status-failed', message: e?.message })
  }
}

export default withSentry(handler)
