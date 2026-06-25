import { withSentry } from '../../../_lib/sentry.js'
import { requireRole, requireCapability } from '../../../_lib/auth.js'
import { CAP_INTEGRATIONS_CONNECT } from '../../../_lib/capabilities.js'
import { workspaceContext } from '../../../_lib/workspaceContext.js'
import { deleteGbpCredential } from '../../../_lib/gbpAuth.js'

// DELETE /api/integrations/gbp/disconnect

export const config = { runtime: 'nodejs' }

async function handler(req, res) {
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'method-not-allowed' })

  const workspace = await workspaceContext(req)
  if (!workspace) return res.status(404).json({ error: 'no-workspace-context' })

  const auth = await requireRole(req, ['admin'], { orgId: workspace.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  const capAuth = await requireCapability(req, workspace, [CAP_INTEGRATIONS_CONNECT])
  if (!capAuth.ok) return res.status(403).json({ error: capAuth.reason, missing: capAuth.missing })

  try {
    await deleteGbpCredential(workspace.id)
  } catch (e) {
    console.error('[gbp/disconnect] failed:', e?.message)
    return res.status(500).json({ error: 'disconnect-failed' })
  }

  return res.status(200).json({ ok: true })
}

export default withSentry(handler)
