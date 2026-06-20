import { withSentry } from '../../../_lib/sentry.js'
import { requireRole, requireCapability } from '../../../_lib/auth.js'
import { CAP_INTEGRATIONS_CONNECT } from '../../../_lib/capabilities.js'
import { workspaceContext } from '../../../_lib/workspaceContext.js'
import { enforceLimit } from '../../../_lib/ratelimit.js'
import { buildAuthorizationUrl, gbpRedirectUri, signOAuthState } from '../../../_lib/gbpAuth.js'

// POST /api/integrations/gbp/connect
//
// Admin clicks "Connect Google Business Profile" in Settings → Integrations.
// Returns an OAuth URL that the browser navigates to. Mirrors gsc/connect.js.

export const config = { runtime: 'nodejs' }

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method-not-allowed' })

  const workspace = await workspaceContext(req)
  if (!workspace) return res.status(404).json({ error: 'no-workspace-context' })

  const auth = await requireRole(req, ['admin'], { orgId: workspace.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  const capAuth = await requireCapability(req, workspace, [CAP_INTEGRATIONS_CONNECT])
  if (!capAuth.ok) return res.status(403).json({ error: capAuth.reason, missing: capAuth.missing })

  if (!(await enforceLimit(req, res, 'generic'))) return

  const id = process.env.GOOGLE_GBP_CLIENT_ID || process.env.GOOGLE_DRIVE_CLIENT_ID
  if (!id) {
    return res.status(503).json({ error: 'gbp-not-configured', message: 'Google OAuth credentials are not set up on this deployment.' })
  }

  let state
  try {
    state = signOAuthState({ workspaceId: workspace.id, slug: workspace.slug, userId: auth.userId })
  } catch (e) {
    console.error('[gbp/connect] state sign failed:', e?.message)
    return res.status(500).json({ error: 'state-sign-failed' })
  }

  const url = buildAuthorizationUrl({ redirectUri: gbpRedirectUri(), state })
  return res.status(200).json({ url })
}

export default withSentry(handler)
