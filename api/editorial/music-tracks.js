// GET /api/editorial/music-tracks
//
// Returns the licensed music library (WS3.3) for the video editor's music-bed
// picker: the SHARED starter set (workspace_id IS NULL) plus this workspace's own
// uploaded tracks (WS3.3-P2). Workspace- and role-gated.
//
// Response 200: { tracks: [{ id, title, mood, url, durationSec, shared }, ...], moods: [...] }

export const config = { runtime: 'nodejs' }

import { requireRole } from '../_lib/auth.js'
import { enforceLimit } from '../_lib/ratelimit.js'
import { ALL_KNOWN_ROLES } from '../_lib/roles.js'
import { workspaceContext } from '../_lib/workspaceContext.js'
import { listMusicTracks, MUSIC_MOODS } from '../_lib/musicLibrary.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })
  const auth = await requireRole(req, ALL_KNOWN_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  if (!(await enforceLimit(req, res, 'generic', ws.id))) return

  const tracks = await listMusicTracks(ws.id)
  return res.status(200).json({ tracks, moods: MUSIC_MOODS })
}
