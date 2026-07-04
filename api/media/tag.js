import { waitUntil } from '@vercel/functions'
import { withSentry } from '../_lib/sentry.js'
import { lookupAssetForTag, markTagging, tagInBackground } from '../_lib/tagAsset.js'
import { requireRole } from '../_lib/auth.js'
import { EDITOR_ROLES } from '../_lib/roles.js'
import { workspaceScope } from '../_lib/workspaceScope.js'
import { enforceLimit } from '../_lib/ratelimit.js'

// Manual AI auto-tagging endpoint. POST { id } → kicks off vision +
// transcription via the Vercel AI Gateway in the background and returns
// immediately. The shared logic lives in _lib/tagAsset.js so upload.js can
// call it directly via waitUntil without an HTTP roundtrip.
//
// Was synchronous (await the whole download+ffmpeg+model pipeline before
// responding) and 504'd on large videos that ran past the function's time
// cap. Now the response only covers the DB read + one status PATCH, and the
// actual tagging runs via waitUntil after the response is sent — same
// pattern as the auto-tag-on-upload path. The client polls the row (see
// MediaDetail.jsx pipelinePending) for status to leave 'tagging'.
//
// IMPORTANT: maxDuration bounds the WHOLE invocation, including the
// waitUntil work below — it is not a fresh budget per background task. A
// too-low maxDuration here silently kills tagInBackground mid-flight before
// it can either finish or hit its own catch (which would revert status +
// record tag_error), leaving the row stuck at status='tagging' forever with
// no error surfaced. (Hit exactly this in prod: dropped to 30 assuming only
// the response needed covering, and a 488MB video's ffmpeg-proxy + Gemini
// call got killed silently at the 30s mark.) Keep this at the platform max
// so the background job gets the same headroom the old synchronous path had.
//
// Runs on Node (Fluid Compute) — same constraint as the rest of the media
// routes. Uses the (req, res) handler shape; req.body is auto-parsed.

// Explicit Node runtime so the Edge whole-graph bundler doesn't follow
// the ratelimit.js → @clerk/backend → node:crypto chain into middleware.
export const config = { runtime: 'nodejs', maxDuration: 300 }

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const id = req.body?.id
  if (!id) return res.status(400).json({ error: 'Missing id' })

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!UUID_RE.test(id)) return res.status(400).json({ error: 'invalid_id' })

  const scope = await workspaceScope(req)
  if (!scope) return res.status(400).json({ error: 'workspace_not_resolved' })

  // Tagging mutates ai_tags + status — same gate as PATCH on the asset.
  const auth = await requireRole(req, EDITOR_ROLES, { orgId: scope.workspace.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  if (!(await enforceLimit(req, res, 'media', scope.workspace.id))) return

  try {
    const asset = await lookupAssetForTag(id, scope)
    const previousStatus = asset.status || 'raw'
    const updated = await markTagging(asset, scope)

    waitUntil(
      tagInBackground({ ...asset, status: 'tagging' }, scope, previousStatus)
        .catch((e) => console.error('[media/tag] background tagging failed:', e?.message)),
    )

    return res.status(202).json(updated)
  } catch (e) {
    const isNotFound = e?.message === 'Not found'
    console.error('[media/tag] tagging kickoff failed:', e?.message)
    return res.status(isNotFound ? 404 : 500).json({ error: isNotFound ? 'not_found' : 'tagging_failed' })
  }
}

export default withSentry(handler)
