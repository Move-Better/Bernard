// PATCH  /api/photo-templates/:id  — update name, is_default, or config
// DELETE /api/photo-templates/:id  — delete (refuses if stories still use it)
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole, requireCapability } from '../../_lib/auth.js'
import { EDITOR_ROLES } from '../../_lib/roles.js'
import { CAP_SETTINGS_EDIT } from '../../_lib/capabilities.js'
import { enforceLimit } from '../../_lib/ratelimit.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    signal: AbortSignal.timeout(8_000),
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
  console.error(`[photo-templates/[id]] ${msg} — supabase ${r.status}: ${body.slice(0, 300)}`)
  return res.status(500).json({ error: msg })
}

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

  if (!(await enforceLimit(req, res, 'generic', ws.id))) return

  const { searchParams } = new URL(req.url, 'http://localhost')
  const id = searchParams.get('id')
  if (!id) return err(res, 'Missing id')
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!UUID_RE.test(id)) return err(res, 'Invalid id')

  const chk = await sb(
    `workspace_photo_templates?id=eq.${id}&workspace_id=eq.${ws.id}&select=id`
  )
  if (!chk.ok) return dbErr(res, chk)
  if (!(await chk.json()).length) return err(res, 'Template not found', 404)

  if (req.method === 'PATCH') {
    const { name, is_default, config: templateConfig } = req.body || {}
    const patch = {}
    if (name !== undefined)           patch.name       = String(name).trim().slice(0, 80)
    if (templateConfig !== undefined) patch.config     = templateConfig
    if (is_default !== undefined)     patch.is_default = !!is_default
    if (!Object.keys(patch).length) return err(res, 'No fields to update')

    patch.updated_at = new Date().toISOString()

    if (patch.is_default) {
      const clr = await sb(
        `workspace_photo_templates?workspace_id=eq.${ws.id}&is_default=eq.true&id=neq.${id}`,
        { method: 'PATCH', body: JSON.stringify({ is_default: false }) }
      )
      if (!clr.ok) return dbErr(res, clr, 'Failed to clear existing default')
    }

    const r = await sb(
      `workspace_photo_templates?id=eq.${id}&workspace_id=eq.${ws.id}`,
      { method: 'PATCH', body: JSON.stringify(patch) }
    )
    if (!r.ok) return dbErr(res, r, 'Failed to update template')
    return ok(res, (await r.json())[0])
  }

  if (req.method === 'DELETE') {
    const inUse = await sb(
      `content_items?workspace_id=eq.${ws.id}&photo_template_id=eq.${id}&select=id`
    )
    if (!inUse.ok) return dbErr(res, inUse)
    const rows = await inUse.json()
    if (rows.length > 0) {
      return err(res, 'template_in_use', 409)
    }

    const r = await sb(
      `workspace_photo_templates?id=eq.${id}&workspace_id=eq.${ws.id}`,
      { method: 'DELETE', headers: { Prefer: 'return=minimal' } }
    )
    if (!r.ok) return dbErr(res, r, 'Failed to delete template')
    return res.status(204).end()
  }

  return err(res, 'Method not allowed', 405)
}
