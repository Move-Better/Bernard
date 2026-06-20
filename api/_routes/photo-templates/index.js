// GET  /api/photo-templates   — list built-ins + workspace custom templates
// POST /api/photo-templates   — create a new custom template { name, is_default, config }
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole, requireCapability } from '../../_lib/auth.js'
import { EDITOR_ROLES } from '../../_lib/roles.js'
import { CAP_SETTINGS_EDIT } from '../../_lib/capabilities.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { BUILTIN_THEMES } from '../../../src/lib/photoTemplates.js'

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
  console.error(`[photo-templates] ${msg} — supabase ${r.status}: ${body.slice(0, 300)}`)
  return res.status(500).json({ error: msg })
}

export default async function handler(req, res) {
  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'Workspace not resolved', 400)

  const allowedRoles = req.method === 'GET' ? null : EDITOR_ROLES
  const auth = await requireRole(req, allowedRoles, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  if (req.method !== 'GET') {
    const capAuth = await requireCapability(req, ws, [CAP_SETTINGS_EDIT])
    if (!capAuth.ok) {
      return res.status(403).json({ error: capAuth.reason, missing: capAuth.missing })
    }
  }

  if (req.method === 'GET') {
    const r = await sb(
      `workspace_photo_templates?workspace_id=eq.${ws.id}&select=id,name,is_default,config,created_at&order=created_at.asc`
    )
    if (!r.ok) return dbErr(res, r, 'Failed to load templates')
    const custom = await r.json()

    const builtins = Object.values(BUILTIN_THEMES).map((t) => ({ ...t, custom: false }))
    // Surface layout/palette/blocks at the top level for customs so resolveTheme()
    // → renderFreeformSlide (publish + ad bake paths) reads them the same way it
    // reads built-ins. Custom rows store these under `config`; without this the
    // renderer falls back to default geometry/typography and customs render wrong.
    const customOut = custom.map((t) => ({
      ...t,
      layout:    t.config?.layout    || undefined,
      palette:   t.config?.palette   || undefined,
      blocks:    t.config?.blocks    || {},
      structure: t.config?.structure || undefined,
      mode:      t.config?.mode      || undefined,
      builtin: false,
      custom:  true,
    }))
    return ok(res, { themes: [...builtins, ...customOut] })
  }

  if (req.method === 'POST') {
    if (!(await enforceLimit(req, res, 'default'))) return
    const { name, is_default, config: templateConfig } = req.body || {}
    if (!name || typeof name !== 'string') return err(res, 'Missing name')
    if (!templateConfig || typeof templateConfig !== 'object') return err(res, 'Missing config')

    if (is_default) {
      const clr = await sb(
        `workspace_photo_templates?workspace_id=eq.${ws.id}&is_default=eq.true`,
        { method: 'PATCH', body: JSON.stringify({ is_default: false }) }
      )
      if (!clr.ok) return dbErr(res, clr, 'Failed to clear existing default')
    }

    const r = await sb('workspace_photo_templates', {
      method: 'POST',
      body: JSON.stringify({
        workspace_id: ws.id,
        name: name.trim().slice(0, 80),
        is_default: !!is_default,
        config: templateConfig,
      }),
    })
    if (!r.ok) return dbErr(res, r, 'Failed to create template')
    return ok(res, (await r.json())[0], 201)
  }

  return err(res, 'Method not allowed', 405)
}
