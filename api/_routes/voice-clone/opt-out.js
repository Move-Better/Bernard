// POST /api/voice-clone/opt-out
//
// Self-serve "do not clone my voice" lock for a staff member.
//
// Body: { staffId: string, optOut: boolean }
//
//   optOut === true:
//     1. If a clone exists, DELETE it at ElevenLabs (idempotent — 404 is fine)
//        and NULL eleven_voice_id + set voice_clone_revoked_at (same as revoke).
//     2. Set voice_clone_opt_out = true, voice_clone_opt_out_at = now().
//     This is a hard prohibition: /create + /resume reject while it is set, and
//     tts.js / voice/pre-visit.js skip the clone (defense in depth).
//
//   optOut === false:
//     Clear voice_clone_opt_out + voice_clone_opt_out_at so the staff member can
//     train a new clone again. The written voice model is never touched here.
//
// Response: { ok: true, optOut: boolean }

export const config = { runtime: 'nodejs', maxDuration: 60 }

import { requireRole } from '../../_lib/auth.js'
import { workspaceContext } from '../../_lib/workspaceContext.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { deleteVoice } from '../../_lib/elevenLabsVoiceClone.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  if (!(await enforceLimit(req, res, 'media', ws.id))) return

  const { staffId, optOut } = req.body || {}
  if (!staffId) return res.status(400).json({ error: 'staffId required' })
  if (!UUID_RE.test(staffId)) return res.status(400).json({ error: 'invalid_staffId' })
  if (typeof optOut !== 'boolean') return res.status(400).json({ error: 'optOut must be a boolean' })

  const lookupRes = await sb(
    `staff?id=eq.${encodeURIComponent(staffId)}` +
    `&workspace_id=eq.${ws.id}` +
    `&select=id,eleven_voice_id,user_id&limit=1`
  )
  if (!lookupRes.ok) return res.status(502).json({ error: 'Could not look up staff member' })
  const [staffMember] = await lookupRes.json()
  if (!staffMember) return res.status(404).json({ error: 'Staff member not found in this workspace' })

  // Authorization: opting out permanently DELETES the voice clone at ElevenLabs
  // (irreversible). requireRole(req, null) above only authenticates the caller as
  // a workspace member — it does NOT scope to this staff row. Without this gate
  // any member could lock + destroy a colleague's clone. Allow only the staff
  // member themselves (matched by user_id, the canonical "which clinician am I?"
  // link — see useSelfStaffId / capture/token.js) or a workspace admin.
  const isSelf = staffMember.user_id && staffMember.user_id === auth.userId
  if (!isSelf && auth.role !== 'admin') {
    return res.status(403).json({ error: 'forbidden' })
  }

  const now = new Date().toISOString()
  const patch = optOut
    ? { voice_clone_opt_out: true,  voice_clone_opt_out_at: now }
    : { voice_clone_opt_out: false, voice_clone_opt_out_at: null }

  // Turning the lock ON destroys any existing clone — strongest "do not use my
  // voice" guarantee. Mirror the revoke path: delete upstream best-effort, then
  // null the id + stamp the audit trail in the same PATCH as the opt-out flag.
  if (optOut && staffMember.eleven_voice_id) {
    try {
      await deleteVoice(staffMember.eleven_voice_id)
    } catch (e) {
      console.warn(`[voice-clone] opt-out delete upstream failed for staff=${staffId}: ${e?.message}`)
      // Continue — a dangling upstream voice is better than keeping a usable
      // eleven_voice_id on a row the staff member just locked.
    }
    patch.eleven_voice_id = null
    patch.voice_clone_revoked_at = now
  }

  const patchRes = await sb(
    `staff?id=eq.${encodeURIComponent(staffId)}&workspace_id=eq.${ws.id}`,
    { method: 'PATCH', body: JSON.stringify(patch) },
  )
  if (!patchRes.ok) {
    const body = await patchRes.text().catch(() => '')
    console.error(`[voice-clone] opt-out PATCH ${patchRes.status}: ${body.slice(0, 300)}`)
    return res.status(502).json({ error: 'Could not save your preference — please try again.' })
  }

  return res.status(200).json({ ok: true, optOut })
}
