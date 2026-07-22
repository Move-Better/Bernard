export const config = { runtime: 'nodejs' }
// Cron: check every bundle.social workspace's connected channels and alert the
// owner about any that have gone dead (runs daily).
//
// Why this exists: Move Better's Facebook token was invalidated by Meta
// (190:460) around 2026-06-26. Publishing to Facebook simply stopped. There was
// no banner, no email, and no check anywhere that looked at connection state on
// its own — the outage was found weeks later during an audit, by noticing that
// no Facebook post had been created since early July. Connection health had no
// surface at all: /api/integrations/bundle/status could report it, but only if
// an admin happened to open the Integrations page and look.
//
// What counts as broken — see accountIsConnected in social/bundlePublisher.js —
// is bundle's own deletedAt / disconnectedCheckTryAt / deleteOn fields on the
// socialAccount object, confirmed against a live teamGetTeam call. An earlier
// version of this check read a `status` field that turns out not to exist on
// the real object at all, so it silently never fired for anyone; caught only
// by checking live bundle data, not by the unit tests written against it.
//
// Auth: Bearer CRON_SECRET (same as all other crons).

import { BundlePublisher } from '../../_lib/social/bundlePublisher.js'
import { notifyChannelHealth } from '../../_lib/notifyChannelHealth.js'
import { verifyCronSecret } from '../../_lib/auth.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// eslint-disable-next-line bernard/require-workspace-scope -- Cron — iterates every active workspace; each bundle call is scoped by that workspace's own bundle_team_id
function sb(path) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  })
}

export default async function handler(req, res) {
  if (!verifyCronSecret(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(503).json({ error: 'Supabase env not configured' })
  }
  if (!process.env.BUNDLE_API_KEY) {
    // Nothing to check without the fleet key; inert rather than noisy.
    return res.status(200).json({ checked: 0, skipped: 'no_bundle_api_key' })
  }

  const wsRes = await sb(
    'workspaces?status=eq.active&publish_provider=eq.bundle&bundle_team_id=not.is.null' +
    '&select=id,slug,display_name,bundle_team_id,created_by_clerk_user_id,producer_config'
  )
  if (!wsRes.ok) {
    console.error('[check-channel-health] workspace fetch failed:', wsRes.status)
    return res.status(500).json({ error: 'workspace fetch failed' })
  }
  const workspaces = (await wsRes.json().catch(() => [])) || []

  const summary = { checked: 0, healthy: 0, unhealthy: 0, errors: 0, alerted: 0, workspaces: [] }

  for (const ws of workspaces) {
    summary.checked++
    try {
      const publisher = new BundlePublisher(ws)
      const accounts = await publisher.listAccounts()
      const unhealthy = accounts.filter((a) => !a.connected)

      if (unhealthy.length === 0) {
        summary.healthy++
        continue
      }

      summary.unhealthy++
      const sent = await notifyChannelHealth({ workspace: ws, unhealthy })
      if (sent?.ok) summary.alerted++
      summary.workspaces.push({
        workspaceId: ws.id,
        // Log the types and the reason — derived from bundle's own
        // deletedAt/disconnectedCheckTryAt/deleteOn fields, the only clue to
        // WHY, and it isn't stored anywhere else.
        unhealthy: unhealthy.map((a) => ({ type: a.type, reason: a.reason })),
        alerted: !!sent?.ok,
      })
    } catch (e) {
      // One unreachable Team must not stop the sweep for every other workspace.
      summary.errors++
      console.error('[check-channel-health] check failed for workspace:', ws.id, e?.message)
    }
  }

  console.info('[check-channel-health]', JSON.stringify(summary))
  return res.status(200).json(summary)
}
