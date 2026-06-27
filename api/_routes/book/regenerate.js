// POST /api/book/regenerate
//
// Admin-only. Synthesizes the workspace's book from its raw source material
// (interviews, voice memos, original blogs, uploaded drafts), splices in any
// pinned chapters, and writes the result to workspace_books.
//
// Runtime: nodejs. Slow path — the Opus call alone can take 60–180s on a
// large workspace, so maxDuration is set to the platform max.
//
// Lifecycle (workspace_books.regen_status):
//   idle          — at rest, manuscript may or may not exist
//   regenerating  — set on entry; row is "locked" against concurrent regen
//   error         — set on failure, with regen_error populated
//
// On success: regen_status='idle', last_regen_at=now(), stale_at=NULL,
// manuscript_md / chapters / source_counts updated.

export const config = { runtime: 'nodejs', maxDuration: 300 }

import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole } from '../../_lib/auth.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { synthesizeBook } from '../../_lib/bookSynthesis.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    signal: AbortSignal.timeout(8_000),
    ...init,
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer:        'return=representation',
      ...init.headers,
    },
  })
}

async function logSbErr(prefix, r) {
  const body = await r.text().catch(() => '')
  console.error(`[book/regenerate] ${prefix} — supabase ${r.status}: ${body.slice(0, 300)}`)
}

async function upsertBookRow(workspaceId, patch) {
  // Upsert: ensures row exists on first regen, then PATCHes on subsequent.
  const r = await sb(`workspace_books?on_conflict=workspace_id`, {
    method: 'POST',
    headers: { Prefer: 'return=representation,resolution=merge-duplicates' },
    body: JSON.stringify({ workspace_id: workspaceId, ...patch }),
  })
  if (!r.ok) await logSbErr('upsertBookRow', r)
  return r.ok
}

async function markError(workspaceId, message) {
  await upsertBookRow(workspaceId, {
    regen_status: 'error',
    regen_error:  String(message || 'Unknown error').slice(0, 1000),
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  const auth = await requireRole(req, ['admin'], { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    const status = auth.reason === 'forbidden' ? 403 : 401
    return res.status(status).json({ error: auth.reason })
  }

  if (!(await enforceLimit(req, res, 'ai', ws.id))) return

  // Atomic lock: PATCH only when regen_status is NOT 'regenerating'.
  // If two requests arrive concurrently, only one will match this filter and
  // proceed; the other gets an empty return array and 409s immediately.
  const lockPatch = await sb(
    `workspace_books?workspace_id=eq.${ws.id}&regen_status=neq.regenerating`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ regen_status: 'regenerating', regen_error: null }),
    },
  )
  if (!lockPatch.ok) {
    console.error('[book/regenerate] lock PATCH failed:', lockPatch.status)
    return res.status(500).json({ error: 'lock_failed' })
  }
  const locked = await lockPatch.json().catch(() => [])
  if (!Array.isArray(locked) || locked.length === 0) {
    return res.status(409).json({ error: 'A regeneration is already in progress' })
  }

  let result
  try {
    result = await synthesizeBook({ workspaceId: ws.id, workspace: ws })
  } catch (e) {
    console.error('[book/regenerate] synthesizeBook failed:', e?.message)
    await markError(ws.id, e?.message)
    return res.status(500).json({ error: 'synthesis_failed' })
  }

  const ok = await upsertBookRow(ws.id, {
    manuscript_md:  result.manuscriptMd || null,
    chapters:       result.chapters || [],
    source_counts:  result.sourceCounts || {},
    last_regen_at:  new Date().toISOString(),
    stale_at:       null,
    regen_status:   'idle',
    regen_error:    null,
  })
  if (!ok) {
    await markError(ws.id, 'Failed to write manuscript')
    return res.status(500).json({ error: 'Failed to write manuscript' })
  }

  return res.status(200).json({
    ok:             true,
    chapters:       result.chapters.length,
    source_counts:  result.sourceCounts,
  })
}
