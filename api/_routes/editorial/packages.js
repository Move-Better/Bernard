// GET /api/editorial/packages
//
// List story packages for the workspace. Supports status filtering and
// pagination. Used by Phase 3 Story Director UI.
//
// Query params:
//   status?: 'pending'|'generating'|'complete'|'failed'  — filter by status
//   limit?:  number (default 20, max 100)
//   offset?: number (default 0)
//   staffId?: string  — filter by clinician
//
// Auth: Clerk JWT + workspace org-id.
//
// Response 200:
//   { packages: [...], total: number, limit, offset }

export const config = { runtime: 'nodejs' }

import { requireRole } from '../../_lib/auth.js'
import { ALL_KNOWN_ROLES } from '../../_lib/roles.js'
import { workspaceContext } from '../../_lib/workspaceContext.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

async function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'count=exact',
      ...init.headers,
    },
  })
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const ws = await workspaceContext(req)
  if (!ws) return res.status(404).json({ error: 'no_workspace' })
  const auth = await requireRole(req, ALL_KNOWN_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  const url = new URL(req.url, 'http://localhost')
  const status = url.searchParams.get('status')
  const staffId = url.searchParams.get('staffId')
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '20', 10), 1), 100)
  const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10), 0)

  const VALID_STATUSES = ['pending', 'generating', 'complete', 'failed']
  if (status && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'invalid_status' })
  }

  // Build query — embed consent fields from the source asset for the Slate UI.
  // PostgREST auto-resolves the single FK between story_packages and
  // media_assets (declared in migration 088); we use the alias prefix
  // (source_asset:) to keep a stable name even if the table is renamed later.
  let query = `story_packages?workspace_id=eq.${ws.id}&order=created_at.desc&limit=${limit}&offset=${offset}`
  // Embed chunk statuses for the keep-whole long-form lane so the Slate can show
  // piece-progress ("N of M") while a multi-minute chunked render runs. Only
  // chunked long-form packages have rows in story_package_chunks; for every other
  // package the embed is an empty array (negligible payload). We collapse it to a
  // compact { done, total } below rather than shipping the raw rows.
  query += `&select=id,topic,caption_text,similarity,channels,renders,status,error_message,created_at,source_asset_id,staff_id,campaign_id,voice_fidelity_score,voice_fidelity_breakdown,auto_publish_state,auto_published_at,source_asset:media_assets(consent_status,consent_notes),campaign:campaigns(id,name,content_style,event_at),story_package_chunks(status)`
  if (status) query += `&status=eq.${status}`
  if (staffId) query += `&staff_id=eq.${encodeURIComponent(staffId)}`

  const dbRes = await sb(query)
  if (!dbRes.ok) return res.status(500).json({ error: 'db_error' })

  const rawPackages = await dbRes.json()
  // Collapse the embedded chunk rows into a compact progress summary and drop the
  // raw array from the response.
  const packages = (Array.isArray(rawPackages) ? rawPackages : []).map((pkg) => {
    const chunkRows = Array.isArray(pkg.story_package_chunks) ? pkg.story_package_chunks : []
    const rest = { ...pkg }
    delete rest.story_package_chunks
    if (!chunkRows.length) return rest
    rest.chunk_progress = {
      done: chunkRows.filter((c) => c.status === 'done').length,
      total: chunkRows.length,
    }
    return rest
  })
  const totalHeader = dbRes.headers.get('Content-Range')
  // Supabase Content-Range: 0-19/143
  const total = totalHeader ? parseInt(totalHeader.split('/')[1], 10) : undefined

  return res.status(200).json({
    packages,
    total,
    limit,
    offset,
  })
}
