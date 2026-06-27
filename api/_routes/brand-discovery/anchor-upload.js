import { withSentry } from '../../_lib/sentry.js'
import { handleUpload } from '@vercel/blob/client'
import { waitUntil } from '@vercel/functions'
import { requireRole } from '../../_lib/auth.js'
import { workspaceScope } from '../../_lib/workspaceScope.js'
import { enforceLimit } from '../../_lib/ratelimit.js'

// Brand-anchor screenshot upload — same two-phase Vercel Blob handshake as
// brand-kit/upload, but DELIBERATELY does NOT insert a brand_assets row. Anchor
// reference screenshots are NOT part of the workspace's logo/asset library; they
// live only on workspaces.brand_brief.visualAnchors (the client stores the
// returned blob URL via /api/brand-discovery/anchors). Keeping them out of
// brand_assets keeps the Brand Kit library clean (Q, 2026-06-27).
//
// Node runtime — @vercel/blob needs Node built-ins.
export const config = { runtime: 'nodejs' }

const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp']
// Screenshots are small; 10 MB fails fast in the browser before the PUT.
const MAX_ANCHOR_BYTES = 10 * 1024 * 1024

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const body = req.body

  // Resolve + auth only at handshake time (the completion webhook is
  // platform-to-server and carries no user session).
  let scope = null
  if (body?.type === 'blob.generate-client-token') {
    scope = await workspaceScope(req)
    if (!scope) return res.status(400).json({ error: 'workspace_not_resolved' })
    const auth = await requireRole(req, ['admin'], { orgId: scope.workspace.clerk_org_id })
    if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
    if (!(await enforceLimit(req, res, 'media'))) return
  }

  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ALLOWED_MIME,
        maximumSizeInBytes: MAX_ANCHOR_BYTES,
        allowedPathPrefixes: [`brand-anchors/${scope.id}/`],
        tokenPayload: JSON.stringify({ scopeId: scope.id }),
      }),
      // No DB write — the client already has blob.url from the upload() call and
      // persists it onto the brief via /api/brand-discovery/anchors.
      onUploadCompleted: async () => { waitUntil(Promise.resolve()) },
    })
    return res.status(200).json(result)
  } catch (_e) {
    return res.status(400).json({ error: 'upload_failed' })
  }
}

export default withSentry(handler)
