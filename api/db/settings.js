// Campaign settings endpoint (clinic_settings table).
//
// Phase 1A security lockdown (2026-05-11):
//   - requires verified Clerk JWT
//   - queries by workspace_id (the table's actual PK) instead of the legacy
//     `id=eq.default` filter, which was pre-multitenancy and silently returned
//     the static DEFAULT for every workspace.
//   - PATCH does a workspace-scoped UPSERT so a workspace without a row yet
//     gets one on first save (was previously a silent no-op).

import { requireRole } from '../_lib/auth.js'
import { workspaceScope } from '../_lib/workspaceScope.js'

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

const DEFAULT = { mode: 'bookings', notes: '' }

export default async function handler(req, res) {
  const auth = await requireRole(req)
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  let scope
  try {
    scope = await workspaceScope(req)
  } catch {
    return res.status(404).json({ error: 'workspace-unresolved' })
  }
  const wsFilter = `${scope.column}=eq.${scope.id}`

  if (req.method === 'GET') {
    const r = await sb(`clinic_settings?${wsFilter}&select=campaign_mode,campaign_notes`)
    if (!r.ok) return res.status(200).json(DEFAULT)
    const data = await r.json()
    if (!data.length) return res.status(200).json(DEFAULT)
    return res.status(200).json({
      mode:  data[0].campaign_mode  || 'bookings',
      notes: data[0].campaign_notes || '',
    })
  }

  if (req.method === 'PATCH') {
    const body = req.body || {}
    const row = {
      [scope.column]: scope.id,
      updated_at:     new Date().toISOString(),
      updated_by:     auth.userId,
    }
    if (body.mode) row.campaign_mode = body.mode
    if (body.notes !== undefined) row.campaign_notes = body.notes

    // Upsert on the workspace_id PK. Prefer: resolution=merge-duplicates lets
    // PostgREST do INSERT-or-UPDATE on conflict — clinic_settings.workspace_id
    // is the primary key.
    const r = await sb('clinic_settings', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(row),
    })
    if (!r.ok) return res.status(500).json({ error: 'Failed to save settings' })
    return res.status(200).json({ success: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
