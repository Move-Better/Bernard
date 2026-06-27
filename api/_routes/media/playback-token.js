// Mint a short-lived Mux signed-playback JWT for a workspace-scoped media
// asset. The browser's <mux-player> reads playback-id; for signed playback
// it also needs a `playback-token` attribute. This endpoint is the only
// path that knows the MUX_SIGNING_KEY, so the key never leaves the server.
//
// GET /api/media/playback-token?id=<media_assets.id>
//
// Returns: { token: string, expiresAt: number } where expiresAt is unix-ms.
//
// Auth: any authenticated user in the workspace. We don't gate by role —
// if the user can see the row in the Library, they can play it.
// Workspace scoping is enforced by workspaceScope(req) + the row filter.

import { withSentry } from '../../_lib/sentry.js'
export const config = { runtime: 'nodejs' }

import { workspaceScope } from '../../_lib/workspaceScope.js'
import { requireRole } from '../../_lib/auth.js'
import { ALL_KNOWN_ROLES } from '../../_lib/roles.js'
import { mintPlaybackToken, muxSignedConfigured } from '../../_lib/muxClient.js'
import { enforceLimit } from '../../_lib/ratelimit.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// Playback tokens are short-lived on purpose — five minutes covers a player
// load plus a refresh, but a leaked token can't be replayed against the
// asset weeks later. Mux's docs recommend matching session length; we re-
// mint on each playback start, which is what <mux-player> does naturally.
const EXPIRES_IN_SEC = 300

async function sb(path) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  })
}

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method_not_allowed', message: 'GET only' })
  }

  const scope = await workspaceScope(req)
  if (!scope) return res.status(400).json({ error: 'workspace_not_resolved' })
  const auth = await requireRole(req, ALL_KNOWN_ROLES, { orgId: scope.workspace.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }
  if (!(await enforceLimit(req, res, 'media', scope.id))) return

  if (!muxSignedConfigured()) {
    return res.status(503).json({
      error: 'signed_playback_unavailable',
      message: 'MUX_SIGNING_KEY_ID / MUX_SIGNING_KEY are not set on this deployment.',
    })
  }

  const url = new URL(req.url, 'http://localhost')
  const id  = url.searchParams.get('id')
  if (!id) return res.status(400).json({ error: 'missing_id' })
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!UUID_RE.test(id)) return res.status(400).json({ error: 'invalid_id' })

  const where = `id=eq.${encodeURIComponent(id)}&${scope.column}=eq.${scope.id}`
  const r = await sb(`media_assets?${where}&select=id,mux_playback_id,transcode_status`)
  if (!r.ok) {
    return res.status(500).json({ error: 'database_error' })
  }
  const rows = await r.json().catch(() => [])
  const row = rows[0]
  if (!row) return res.status(404).json({ error: 'not_found' })
  if (!row.mux_playback_id) {
    return res.status(409).json({ error: 'no_playback_id' })
  }

  try {
    const token = mintPlaybackToken({
      playbackId:    row.mux_playback_id,
      expiresInSec:  EXPIRES_IN_SEC,
      audience:      'v',
    })
    return res.status(200).json({
      token,
      expiresAt: Date.now() + EXPIRES_IN_SEC * 1000,
    })
  } catch (e) {
    console.error('[playback-token] mint failed:', e?.message)
    return res.status(500).json({ error: 'mint_failed' })
  }
}

export default withSentry(handler)
