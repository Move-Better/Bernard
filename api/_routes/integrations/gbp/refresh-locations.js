// Retry GBP location detection without a full OAuth reconnect.
// Called when the initial detection failed (location_detection:'failed' in config),
// typically due to a transient 429 on mybusinessaccountmanagement.googleapis.com.
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../../../_lib/workspaceContext.js'
import { requireRole }      from '../../../_lib/auth.js'
import { enforceLimit }     from '../../../_lib/ratelimit.js'
import { refreshGbpLocations } from '../../../_lib/gbpAuth.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'workspace_not_resolved' })

  const auth = await requireRole(req, ['admin'], { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  if (!(await enforceLimit(req, res, 'gbp-refresh-locations'))) return

  try {
    const locationInfo = await refreshGbpLocations(ws.id)
    return res.status(200).json({ ok: true, locations: locationInfo.locations })
  } catch (e) {
    console.error('[gbp/refresh-locations]', e?.message)
    return res.status(200).json({ ok: false, error: e?.message })
  }
}
