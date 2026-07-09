// POST /api/music/upload — two-phase Vercel Blob client upload for a workspace's
// own music tracks (WS3.3-P2). Same handshake→completion pattern as
// media/upload + brand-kit/upload:
//   • body.type='blob.generate-client-token' — resolve workspace + require ADMIN,
//     return an upload token scoped to music/<ws.id>/.
//   • body.type='blob.upload-completed'      — platform→server webhook; insert a
//     music_tracks row (workspace_id = this workspace) from the tokenPayload.
//
// Admins only (licensing is a per-clinic responsibility). Audio MP3 only.

export const config = { runtime: 'nodejs' }

import { withSentry } from '../_lib/sentry.js'
import { handleUpload } from '@vercel/blob/client'
import { requireRole } from '../_lib/auth.js'
import { ADMIN_ROLES } from '../_lib/roles.js'
import { workspaceScope } from '../_lib/workspaceScope.js'
import { workspaceById } from '../_lib/workspaceContext.js'
import { enforceLimit } from '../_lib/ratelimit.js'
import { MUSIC_MOODS } from '../_lib/musicLibrary.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const ALLOWED_MIME = ['audio/mpeg', 'audio/mp3']
const MAX_TRACK_BYTES = 15 * 1024 * 1024 // ~15MB — comfortably covers a 3-4 min MP3

async function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...init.headers,
    },
  })
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const body = req.body
  let scope = null
  if (body?.type === 'blob.generate-client-token') {
    scope = await workspaceScope(req)
    if (!scope) return res.status(400).json({ error: 'workspace_not_resolved' })
    const auth = await requireRole(req, ADMIN_ROLES, { orgId: scope.workspace.clerk_org_id })
    if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
    if (!(await enforceLimit(req, res, 'media', scope.workspace.id))) return
  }

  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        let meta = {}
        try { meta = clientPayload ? JSON.parse(clientPayload) : {} } catch { /* empty */ }
        const title = String(meta.title || pathname.split('/').pop() || 'Untitled').slice(0, 120)
        const mood = MUSIC_MOODS.includes(meta.mood) ? meta.mood : 'calm'
        const durationSec = Number.isFinite(+meta.durationSec) ? Math.max(0, Math.round(+meta.durationSec)) : null
        return {
          allowedContentTypes: ALLOWED_MIME,
          maximumSizeInBytes: MAX_TRACK_BYTES,
          allowedPathPrefixes: [`music/${scope.id}/`],
          tokenPayload: JSON.stringify({ scopeId: scope.id, title, mood, durationSec, uploadedBy: meta.uploadedBy || null }),
        }
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        let meta = {}
        try { meta = tokenPayload ? JSON.parse(tokenPayload) : {} } catch { /* empty */ }
        const scopeId = meta.scopeId
        if (!scopeId) { console.error('[music/upload] tokenPayload missing scopeId; refusing insert'); return }
        // Re-hydrate the workspace so a forged tokenPayload can't cross tenants.
        const workspace = await workspaceById(scopeId)
        if (!workspace) { console.error(`[music/upload] workspace ${scopeId} not found; refusing insert`); return }
        const r = await sb('music_tracks', {
          method: 'POST',
          body: JSON.stringify({
            workspace_id: scopeId,
            title: meta.title || 'Untitled',
            mood: MUSIC_MOODS.includes(meta.mood) ? meta.mood : 'calm',
            blob_url: blob.url,
            duration_sec: meta.durationSec ?? null,
            uploaded_by: meta.uploadedBy || null,
          }),
        })
        if (!r.ok) console.error('[music/upload] insert failed:', r.status, (await r.text()).slice(0, 200))
      },
    })
    return res.status(200).json(result)
  } catch (e) {
    console.error('[music/upload] error:', e?.message)
    return res.status(400).json({ error: 'upload_failed' })
  }
}

export default withSentry(handler)
