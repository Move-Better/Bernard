// Clinicians CRUD endpoint.
//
// Phase 1A security lockdown (2026-05-11): every request requires a verified
// Clerk JWT and every Supabase query is filtered by workspace. The legacy
// `x-user-id` header is no longer trusted — userId comes from the verified JWT.

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

const INTERVIEW_FIELDS = 'id,topic,status,created_at,updated_at,owner_id,owner_email'
const SELECT = `id,name,created_by_id,created_by_email,created_at,interviews(${INTERVIEW_FIELDS})`

export default async function handler(req, res) {
  const auth = await requireRole(req)
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }
  const userId = auth.userId

  let scope
  try {
    scope = await workspaceScope(req)
  } catch {
    return res.status(404).json({ error: 'workspace-unresolved' })
  }
  const wsFilter = `${scope.column}=eq.${scope.id}`

  const { searchParams } = new URL(req.url, 'http://localhost')
  const id = searchParams.get('id')

  if (req.method === 'GET') {
    if (id) {
      const r = await sb(`clinicians?id=eq.${id}&${wsFilter}&select=${SELECT}`)
      if (!r.ok) return res.status(500).json({ error: 'Database error' })
      const data = await r.json()
      return res.status(200).json(data[0] ?? null)
    }
    const r = await sb(`clinicians?${wsFilter}&select=${SELECT}&order=name.asc`)
    if (!r.ok) return res.status(500).json({ error: 'Database error' })
    return res.status(200).json(await r.json())
  }

  if (req.method === 'POST') {
    const { name, createdByEmail } = req.body || {}
    if (!name?.trim()) return res.status(400).json({ error: 'Name required' })

    // Find existing by name within this workspace (case-insensitive).
    const findRes = await sb(`clinicians?${wsFilter}&name=ilike.${encodeURIComponent(name.trim())}&select=${SELECT}`)
    if (!findRes.ok) return res.status(500).json({ error: 'Database error' })
    const found = await findRes.json()
    if (found.length > 0) return res.status(200).json(found[0])

    const createRes = await sb('clinicians', {
      method: 'POST',
      body: JSON.stringify({
        [scope.column]:    scope.id,
        name:              name.trim(),
        created_by_id:     userId,
        created_by_email:  createdByEmail || null,
      }),
    })
    if (!createRes.ok) return res.status(500).json({ error: 'Create failed' })
    const data = await createRes.json()
    return res.status(201).json(data[0])
  }

  if (req.method === 'DELETE') {
    if (!id) return res.status(400).json({ error: 'Missing id' })

    const chk = await sb(`clinicians?id=eq.${id}&${wsFilter}&select=created_by_id`)
    if (!chk.ok) return res.status(500).json({ error: 'Database error' })
    const rows = await chk.json()
    if (!rows.length) return res.status(404).json({ error: 'Not found' })
    if (rows[0].created_by_id !== userId) return res.status(403).json({ error: 'Forbidden' })

    const r = await sb(`clinicians?id=eq.${id}&${wsFilter}`, { method: 'DELETE' })
    if (!r.ok) return res.status(500).json({ error: 'Delete failed' })
    return res.status(200).json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
