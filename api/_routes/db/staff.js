// Pinned to Node runtime so the Edge whole-graph bundler doesn't follow
// the ratelimit.js → @clerk/backend → node:crypto chain into middleware.
// Uses Express-style (req, res) handler — the Web-style (req) → Response
// pattern silently hangs on Vercel's Node runtime (response never sent;
// function times out at 300s). Match the convention used by /api/content-pieces/*.
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole } from '../../_lib/auth.js'
import { ADMIN_ROLES } from '../../_lib/roles.js'
import { enforceLimit } from '../../_lib/ratelimit.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

// Log a Supabase non-ok response body to function logs and return a generic
// 500 to the client. Public response stays opaque (no schema leak); details
// land in Vercel logs so the next "Database error" report is one log fetch
// away from a root cause.
async function dbErr(res, r, msg = 'Database error', status = 500) {
  const body = await r.text().catch(() => '')
  console.error(`[db/clinicians] ${msg} — supabase ${r.status}: ${body.slice(0, 500)}`)
  return res.status(status).json({ error: msg })
}

// Count rows matching a PostgREST filter without materializing them: ask for
// an exact count (Prefer: count=exact) and read the total from the
// Content-Range response header (`0-0/<total>` or `*/<total>`). Returns
// { ok:false, r } on a non-2xx so the caller can dbErr() with the response.
async function countRefs(table, query) {
  const r = await sb(`${table}?${query}&select=id&limit=1`, {
    headers: { Prefer: 'count=exact' },
  })
  if (!r.ok) return { ok: false, r }
  const range = r.headers.get('content-range') || ''
  const total = parseInt(range.split('/')[1] || '0', 10)
  return { ok: true, total: Number.isFinite(total) ? total : 0 }
}

const CLINICIAN_RECIPE_FIELDS = 'default_audience,default_story_type,default_tone,default_voice_mode'
const CLINICIAN_BASE_FIELDS = `id,name,user_id,created_by_id,created_by_email,created_at,voice_notes,voice_notes_refreshed_at,voice_notes_edits_analyzed,preferred_length,tts_settings,eleven_voice_id,voice_clone_consent_at,voice_clone_revoked_at,blog_review_enabled,${CLINICIAN_RECIPE_FIELDS}`
const INTERVIEW_FIELDS = 'id,topic,status,capture_mode,created_at,updated_at,owner_id,owner_email,verbatim_flags,messages,session_state,location_id,prototype_id,campaign_id,campaign:campaigns(id,name),summary_text,summary_generated_at'

// Slim shape for the Stories list. Drops the heavy `messages` and `session_state`
// JSON columns (full transcript per interview) which the list views never render —
// they are fetched separately by useStory() when a detail page opens.
// Includes a joined `campaign(id,name)` so the Stories card view can render the
// per-card campaign badge without a second hop.
// capture_mode included so the "Real moments" filter chip can work client-side.
const INTERVIEW_FIELDS_CARD = 'id,workspace_id,topic,status,capture_mode,session_state,created_at,updated_at,owner_id,owner_email,location_id,prototype_id,pull_quote_candidates,campaign_id,campaign:campaigns(id,name)'
const CLINICIAN_FIELDS_CARD = 'id,workspace_id,name,user_id,created_at'

export default async function handler(req, res) {
  const { searchParams } = new URL(req.url, 'http://localhost')
  const id = searchParams.get('id')
  const view = searchParams.get('view')   // 'card' = slim shape for Stories list

  if (id && !UUID_RE.test(id)) return err(res, 'Invalid id', 400)

  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'Workspace not resolved', 400)

  // All clinician CRUD requires a verified Clerk session bound to this
  // workspace's org. Previously trusted x-user-id / req.body.createdById,
  // which were unauthenticated client-controlled values — a privilege-
  // escalation bug fixed pre-launch (see audit 2026-05-17).
  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }
  const userId = auth.userId
  const wsFilter = `workspace_id=eq.${ws.id}`

  if (req.method === 'GET') {
    if (id) {
      // Single clinician with full interview list
      const r = await sb(`staff?id=eq.${id}&${wsFilter}&select=${CLINICIAN_BASE_FIELDS},interviews(${INTERVIEW_FIELDS})`)
      if (!r.ok) return dbErr(res, r)
      const data = await r.json()
      return ok(res, data[0] ?? null)
    }
    // All clinicians with interview summaries
    const staffSel = view === 'card' ? CLINICIAN_FIELDS_CARD : CLINICIAN_BASE_FIELDS
    const interviewSel = view === 'card' ? INTERVIEW_FIELDS_CARD : INTERVIEW_FIELDS
    const r = await sb(`staff?${wsFilter}&select=${staffSel},interviews(${interviewSel})&order=name.asc`)
    if (!r.ok) return dbErr(res, r)
    return ok(res, await r.json())
  }

  if (req.method === 'POST') {
    if (!(await enforceLimit(req, res, 'media'))) return

    const { name, createdByEmail, userId: requestedBindUserId } = req.body || {}
    if (!name?.trim()) return err(res, 'Name required')

    // Identity comes from the verified token, never the body. createdById is
    // always the calling user. bindUserId may be the calling user (Self
    // interview — the row will be looked up by user_id later) or null
    // (proxy interview — admin recording for a guest). Reject any attempt
    // to claim a different user_id.
    const createdById = userId
    if (requestedBindUserId && requestedBindUserId !== userId) {
      return err(res, 'Cannot bind clinician row to a different user', 403)
    }
    const bindUserId = requestedBindUserId ? userId : null

    const selectExpr = `${CLINICIAN_BASE_FIELDS},interviews(${INTERVIEW_FIELDS})`

    // Identity resolution — `user_id` wins when the caller flagged this as a
    // Self interview (typed name matches the user's display/full name).
    // The row's `name` field is treated as a free-floating label: if the
    // user is starting an interview as "Dr. Q" but the existing row says
    // "Dr. Michael Quasney", we update the label to match what they're
    // using right now. Phase 4 default_* columns predate the recipes
    // table and are untouched here.
    if (bindUserId) {
      const byUserRes = await sb(`staff?${wsFilter}&user_id=eq.${encodeURIComponent(bindUserId)}&select=${selectExpr}`)
      if (!byUserRes.ok) return dbErr(res, byUserRes)
      const byUser = await byUserRes.json()
      if (byUser.length > 0) {
        const existing = byUser[0]
        if (existing.name !== name.trim()) {
          // Label drifted — sync it. Don't return until the update lands,
          // otherwise the caller sees the old name and the UI flickers.
          const patchRes = await sb(`staff?id=eq.${existing.id}&${wsFilter}`, {
            method: 'PATCH',
            body: JSON.stringify({ name: name.trim(), updated_at: new Date().toISOString() }),
          })
          if (patchRes.ok) {
            const patched = await patchRes.json()
            return ok(res, { ...existing, ...patched[0] })
          }
          // Patch failed but we still have the row — return it with the
          // typed name so the caller's flow continues. Logged for visibility.
          console.warn(`[db/clinicians] name sync failed for ${existing.id}; returning unsynced row`)
        }
        return ok(res, existing)
      }
    }

    // Fallback / proxy path: find existing by name (case-insensitive) within
    // this workspace. Used when the caller didn't bind to a user_id
    // (admin recording an interview with a guest), or when the user is
    // self-interviewing but happens to have no user_id-bound row yet.
    const findRes = await sb(`staff?${wsFilter}&name=ilike.${encodeURIComponent(name.trim())}&select=${selectExpr}`)
    if (!findRes.ok) return dbErr(res, findRes)
    const found = await findRes.json()
    if (found.length > 0) {
      const existing = found[0]
      // If the caller bound a user_id and the matched row doesn't have one
      // yet, claim it — upgrades a proxy row into a Self row on first match.
      if (bindUserId && !existing.user_id) {
        const claim = await sb(`staff?id=eq.${existing.id}&${wsFilter}`, {
          method: 'PATCH',
          body: JSON.stringify({ user_id: bindUserId, updated_at: new Date().toISOString() }),
        })
        if (claim.ok) {
          const claimed = await claim.json()
          return ok(res, { ...existing, ...claimed[0] })
        }
      }
      return ok(res, existing)
    }

    // Create new
    const createRes = await sb('staff', {
      method: 'POST',
      body: JSON.stringify({
        workspace_id: ws.id,
        name: name.trim(),
        user_id: bindUserId || null,
        created_by_id: createdById,
        created_by_email: createdByEmail,
      }),
    })
    if (!createRes.ok) return dbErr(res, createRes, 'Create failed')
    const data = await createRes.json()
    return ok(res, data[0], 201)
  }

  if (req.method === 'PATCH') {
    if (!(await enforceLimit(req, res, 'media'))) return

    if (!id) return err(res, 'Missing id')

    const PATCHABLE = new Set(['default_audience', 'default_story_type', 'default_tone', 'default_voice_mode', 'voice_notes', 'preferred_length', 'tts_settings', 'blog_review_enabled'])
    const body = req.body || {}
    const patch = { updated_at: new Date().toISOString() }
    for (const [k, v] of Object.entries(body)) {
      if (!PATCHABLE.has(k)) continue
      // tts_settings is a JSONB blob — preserve object as-is; coerce ''→null
      // applies only to scalar columns.
      if (k === 'tts_settings') {
        patch[k] = (v && typeof v === 'object') ? v : {}
      } else {
        patch[k] = v === '' ? null : v
      }
    }
    if (Object.keys(patch).length <= 1) return err(res, 'No patchable fields')

    const r = await sb(`staff?id=eq.${id}&${wsFilter}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
    if (!r.ok) return dbErr(res, r, 'Update failed')
    const data = await r.json()
    return ok(res, data[0] ?? null)
  }

  if (req.method === 'DELETE') {
    if (!(await enforceLimit(req, res, 'media'))) return

    if (!id) return err(res, 'Missing id')

    // Hard-deleting a staff row CASCADE-destroys that person's interviews,
    // content_items, practice_memory_chunks, staff_recipes and
    // staff_voice_phrases (5 ON DELETE CASCADE FKs — see CLAUDE.md "Deleting or
    // merging a staff row"). That is an irreversible, workspace-altering op, so
    // gate it to workspace admins/owners. The prior check trusted only
    // created_by_id, which let any member who happened to create the row fire
    // the cascade regardless of role tier. requireRole maps Clerk org-admins +
    // internal-plan members to 'admin', so ADMIN_ROLES covers both.
    const adminAuth = await requireRole(req, ADMIN_ROLES, { orgId: ws.clerk_org_id })
    if (!adminAuth.ok) {
      return res.status(adminAuth.reason === 'forbidden' ? 403 : 401).json({ error: adminAuth.reason })
    }

    const chk = await sb(`staff?id=eq.${id}&${wsFilter}&select=id`)
    if (!chk.ok) return dbErr(res, chk)
    const rows = await chk.json()
    if (!rows.length) return err(res, 'Not found', 404)

    const mergeTo = searchParams.get('mergeTo')
    const force = searchParams.get('force') === 'true'

    // Preferred path for a staff row with attached history: route through the
    // atomic merge_staff() RPC (migration 112). It repoints all 12 staff_id FKs
    // + campaigns.target_staff_ids onto the target IN ONE TRANSACTION before
    // deleting the source, so no cascade fires and no learning is lost.
    if (mergeTo) {
      if (mergeTo === id) return err(res, 'Merge target must differ from the staff row being deleted')
      const tgt = await sb(`staff?id=eq.${mergeTo}&${wsFilter}&select=id`)
      if (!tgt.ok) return dbErr(res, tgt)
      const tgtRows = await tgt.json()
      if (!tgtRows.length) return err(res, 'Merge target not found in this workspace', 404)

      const rpc = await sb('rpc/merge_staff', {
        method: 'POST',
        body: JSON.stringify({ p_source: id, p_target: mergeTo, p_workspace: ws.id }),
      })
      if (!rpc.ok) return dbErr(res, rpc, 'Merge failed')
      return ok(res, { ok: true, merged: true, targetId: mergeTo })
    }

    // No merge target: count children across the 5 cascade tables + the
    // denormalized campaigns.target_staff_ids array. If anything is attached,
    // refuse the bare DELETE (409) unless the caller explicitly forces it —
    // otherwise the cascade would silently destroy interviews + voice learning.
    const childCounts = {}
    const countTargets = [
      ['content_items',          `staff_id=eq.${id}&${wsFilter}`],
      ['interviews',             `staff_id=eq.${id}&${wsFilter}`],
      ['practice_memory_chunks', `staff_id=eq.${id}&${wsFilter}`],
      ['staff_recipes',          `staff_id=eq.${id}&${wsFilter}`],
      ['staff_voice_phrases',    `staff_id=eq.${id}&${wsFilter}`],
      // PostgREST array-contains: target_staff_ids @> {<id>} (braces encoded).
      ['campaigns',              `target_staff_ids=cs.%7B${id}%7D&${wsFilter}`],
    ]
    for (const [table, query] of countTargets) {
      const c = await countRefs(table, query)
      if (!c.ok) return dbErr(res, c.r, `Child count failed (${table})`)
      childCounts[table] = c.total
    }
    const totalChildren = Object.values(childCounts).reduce((a, b) => a + b, 0)

    if (totalChildren > 0 && !force) {
      return res.status(409).json({
        error: 'staff_has_children',
        message:
          'This staff member still has interviews, content, or voice learning attached. ' +
          'Merge them into another staff member (pass mergeTo=<staffId>) to preserve that ' +
          'history, or pass force=true to permanently delete everything.',
        childCounts,
        totalChildren,
      })
    }

    const r = await sb(`staff?id=eq.${id}&${wsFilter}`, { method: 'DELETE' })
    if (!r.ok) return dbErr(res, r, 'Delete failed')
    return ok(res, { ok: true, forced: totalChildren > 0 })
  }

  return res.status(405).send('Method not allowed')
}
