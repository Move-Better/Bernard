// PATCH  /api/video-templates/:id  — update name, is_default, or config
// DELETE /api/video-templates/:id  — delete (refuses while a workspace pins it)
//
// Mirrors api/_routes/photo-templates/[id].js.
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole, requireCapability } from '../../_lib/auth.js'
import { EDITOR_ROLES } from '../../_lib/roles.js'
import { CAP_SETTINGS_EDIT } from '../../_lib/capabilities.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { sanitizeVideoTemplate } from '../../_lib/videoTemplates.js'

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

const ok  = (res, data, status = 200) => res.status(status).json(data)
const err = (res, msg, status = 400)  => res.status(status).json({ error: msg })

async function dbErr(res, r, msg = 'Database error') {
  const body = await r.text().catch(() => '')
  console.error(`[video-templates/:id] ${msg} — supabase ${r.status}: ${body.slice(0, 300)}`)
  return res.status(500).json({ error: msg })
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function handler(req, res) {
  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'Workspace not resolved', 400)

  const auth = await requireRole(req, EDITOR_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }
  const capAuth = await requireCapability(req, ws, [CAP_SETTINGS_EDIT])
  if (!capAuth.ok) {
    return res.status(403).json({ error: capAuth.reason, missing: capAuth.missing })
  }
  if (!(await enforceLimit(req, res, 'default', ws.id))) return

  // Parse from the URL PATH, not the query string.
  const id = String(req.url || '').split('?')[0].split('/').filter(Boolean).pop() || ''
  if (!UUID_RE.test(id)) return err(res, 'Invalid id')

  const chk = await sb(`workspace_video_templates?id=eq.${id}&workspace_id=eq.${ws.id}&select=id`)
  if (!chk.ok) return dbErr(res, chk)
  if (!(await chk.json()).length) return err(res, 'Template not found', 404)

  if (req.method === 'PATCH') {
    const { name, is_default, config: templateConfig } = req.body || {}
    const patch = {}
    if (name !== undefined) patch.name = String(name).trim().slice(0, 80)
    if (templateConfig !== undefined) {
      const clean = sanitizeVideoTemplate(templateConfig, { name: name || 'Untitled' })
      patch.config = { headline: clean.headline, captions: clean.captions, blocks: clean.blocks }
    }
    if (is_default !== undefined) patch.is_default = !!is_default
    if (!Object.keys(patch).length) return err(res, 'No fields to update')

    patch.updated_at = new Date().toISOString()

    if (patch.is_default) {
      const clr = await sb(
        `workspace_video_templates?workspace_id=eq.${ws.id}&is_default=eq.true&id=neq.${id}`,
        { method: 'PATCH', body: JSON.stringify({ is_default: false }) },
      )
      if (!clr.ok) return dbErr(res, clr, 'Failed to clear existing default')
    }

    const r = await sb(
      `workspace_video_templates?id=eq.${id}&workspace_id=eq.${ws.id}`,
      { method: 'PATCH', body: JSON.stringify(patch) },
    )
    if (!r.ok) return dbErr(res, r, 'Failed to update template')
    return ok(res, (await r.json())[0])
  }

  if (req.method === 'DELETE') {
    // The photo equivalent refuses while a story still references the template.
    // The reel analogue is the workspace pin: deleting a pinned template would
    // silently repoint every future reel to a look nobody chose.
    if (ws.reel_preset === id) return err(res, 'template_pinned', 409)

    const r = await sb(
      `workspace_video_templates?id=eq.${id}&workspace_id=eq.${ws.id}`,
      { method: 'DELETE', headers: { Prefer: 'return=minimal' } },
    )
    if (!r.ok) return dbErr(res, r, 'Failed to delete template')
    return ok(res, { deleted: true })
  }

  return err(res, 'Method not allowed', 405)
}
