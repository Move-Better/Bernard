// POST /api/seminar/upload
//
// Direct-to-Blob client-upload token handshake for the Seminar / Talk lane.
// A 50–85 MB talk recording can't be POSTed through a request body (Vercel
// ~4.5 MB limit), so the browser uses @vercel/blob/client `upload()` pointed
// here to mint a short-lived token and PUT the file straight to Vercel Blob.
//
// Unlike /api/media/upload this records NO media_assets row — a seminar audio
// is raw source for transcription, not a library asset. The browser takes the
// returned blob URL and calls /api/seminar/create, which creates the interview
// and kicks the transcription worker.
//
// Two-phase, mirroring /api/media/upload:
//   Phase 1 — body.type='blob.generate-client-token': verify the Clerk role so
//             an unauthenticated request can't mint an upload token.
//   Phase 2 — body.type='blob.upload-completed': Blob platform webhook, no user
//             token; handleUpload() verifies it cryptographically. No-op here.
//
// Node runtime so the Edge bundler doesn't follow ratelimit.js → @clerk/backend.

export const config = { runtime: 'nodejs' }

import { withSentry } from '../../_lib/sentry.js'
import { handleUpload } from '@vercel/blob/client'
import { requireRole } from '../../_lib/auth.js'
import { ALL_KNOWN_ROLES } from '../../_lib/roles.js'
import { workspaceScope } from '../../_lib/workspaceScope.js'
import { enforceLimit } from '../../_lib/ratelimit.js'

const ALLOWED_MIME = [
  'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/m4a', 'audio/x-m4a',
  'audio/wav', 'audio/x-wav', 'audio/webm', 'audio/ogg', 'audio/aac', 'audio/flac',
  // Some browsers/devices report video containers for A/V recordings; the worker
  // strips video with `-vn` so a talk recorded as .mp4 still works.
  'video/mp4', 'video/quicktime', 'video/webm',
]

// 500 MB ceiling — a 2-hour talk at typical bitrates is well under this.
const MAX_BYTES = 500 * 1024 * 1024

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const body = req.body

  let scope = null
  if (body?.type === 'blob.generate-client-token') {
    scope = await workspaceScope(req)
    const auth = await requireRole(req, ALL_KNOWN_ROLES, { orgId: scope.workspace.clerk_org_id })
    if (!auth.ok) {
      return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
    }
    if (!(await enforceLimit(req, res, 'media'))) return
  }

  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        // Namespace blobs under the immutable workspace id (never the mutable
        // slug — see CLAUDE.md blob-path rule).
        return {
          allowedContentTypes: ALLOWED_MIME,
          maximumSizeInBytes: MAX_BYTES,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({
            scopeColumn: scope?.column || null,
            scopeId: scope?.id || null,
            filename: pathname.split('/').pop() || null,
          }),
        }
      },
      // No media_assets row — seminar audio is transcription source only.
      onUploadCompleted: async () => { /* intentionally no-op */ },
    })
    return res.status(200).json(result)
  } catch (e) {
    return res.status(400).json({ error: e.message || 'Upload handler failed' })
  }
}

export default withSentry(handler)
