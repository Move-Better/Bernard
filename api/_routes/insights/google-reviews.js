// Insights — Google review rating and count per clinic (Move Better only).
//
// Reads data/google-reviews.json from the private Movebetterco repo (api/_lib/googleReviews.js) and returns
// only the totals. Other workspaces get { enabled: false } and the client renders nothing.
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole }      from '../../_lib/auth.js'
import { enforceLimit }     from '../../_lib/ratelimit.js'
import { REVIEWS_WORKSPACES, getReviewsSummary } from '../../_lib/googleReviews.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  if (!(await enforceLimit(req, res, 'insights-google-reviews', ws.id))) return

  if (!REVIEWS_WORKSPACES.has(ws.slug)) return res.status(200).json({ enabled: false })

  const summary = await getReviewsSummary()
  if (!summary) return res.status(200).json({ enabled: true, error: 'unavailable' })
  return res.status(200).json({ enabled: true, ...summary })
}
