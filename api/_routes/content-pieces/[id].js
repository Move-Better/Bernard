export const config = { runtime: 'nodejs' }

import { withSentry } from '../../_lib/sentry.js'
// GET / PATCH / DELETE for a single content_piece (edit brief).
// Runs on Node (Fluid Compute). All workspace-scoped.

import { requireRole } from '../../_lib/auth.js'
import { workspaceScope } from '../../_lib/workspaceScope.js'
import { EDITOR_ROLES } from '../../_lib/roles.js'
import { enforceLimit } from '../../_lib/ratelimit.js'

// Per-method role requirements — mirrors /api/media/[id]:
//   GET    → any authenticated user
//   PATCH  → staff (admin or publisher) — brief edits + status transitions
//   DELETE → staff (admin or publisher) — brief teardown
const ROLE_REQUIREMENTS = {
  GET:    null,
  PATCH:  EDITOR_ROLES,
  DELETE: EDITOR_ROLES,
}

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

function sb(path, init = {}) {
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

const SELECT_COMMON =
  'id,source_asset_id,source_trim_start,source_trim_end,source_quote,' +
  'ai_suggested_platform,ai_caption,ai_hashtags,ai_cta_text,ai_reasoning,' +
  'ai_model,ai_generated_at,final_caption,final_hashtags,final_cta_text,' +
  'final_cta_url,target_platform,final_asset_id,status,assigned_to,notes,' +
  'rejected_reason,created_at,updated_at,accepted_at,returned_at,' +
  'published_at,published_target_id'

async function handler(req, res) {
  if (!(req.method in ROLE_REQUIREMENTS)) {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const url = new URL(req.url, 'http://localhost')
  const id  = url.pathname.split('/').pop()
  if (!id) return res.status(400).json({ error: 'Missing id' })
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Invalid id' })

  const scope = await workspaceScope(req)
  if (!scope) return res.status(400).json({ error: 'workspace_not_resolved' })

  const auth = await requireRole(req, ROLE_REQUIREMENTS[req.method], { orgId: scope.workspace.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }
  if (req.method !== 'GET' && !(await enforceLimit(req, res, 'generic', scope.id))) return

  const SELECT = `${scope.column},${SELECT_COMMON}`
  const where = `id=eq.${id}&${scope.column}=eq.${scope.id}`

  if (req.method === 'GET') {
    const r = await sb(`content_pieces?${where}&select=${SELECT}`)
    if (!r.ok) return res.status(500).json({ error: 'Database error' })
    const data = await r.json()
    return res.status(200).json(data[0] ?? null)
  }

  if (req.method === 'PATCH') {
    const patch = req.body || {}
    const allowed = {
      status:           patch.status,
      target_platform:  patch.targetPlatform,
      final_caption:    patch.finalCaption,
      final_hashtags:   patch.finalHashtags,
      final_cta_text:   patch.finalCtaText,
      final_cta_url:    patch.finalCtaUrl,
      assigned_to:      patch.assignedTo,
      notes:            patch.notes,
      rejected_reason:  patch.rejectedReason,
      source_trim_start: patch.sourceTrimStart,
      source_trim_end:  patch.sourceTrimEnd,
    }
    const body = Object.fromEntries(Object.entries(allowed).filter(([, v]) => v !== undefined))

    // Status transitions stamp the relevant timestamp.
    if (patch.status === 'accepted')  body.accepted_at  = new Date().toISOString()
    if (patch.status === 'returned')  body.returned_at  = new Date().toISOString()
    if (patch.status === 'published') body.published_at = new Date().toISOString()
    if (patch.publishedTargetId !== undefined) body.published_target_id = patch.publishedTargetId

    const r = await sb(`content_pieces?${where}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
    if (!r.ok) {
      console.error('[[id].js] db error:', r.status)
      return res.status(500).json({ error: 'Update failed'})
    }
    const data = await r.json()
    return res.status(200).json(data[0] ?? null)
  }

  if (req.method === 'DELETE') {
    const r = await sb(`content_pieces?${where}`, { method: 'DELETE' })
    if (!r.ok) return res.status(500).json({ error: 'Delete failed' })
    return res.status(200).json({ deleted: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}

export default withSentry(handler)
