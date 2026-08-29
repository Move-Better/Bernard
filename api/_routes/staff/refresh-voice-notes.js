// POST /api/staff/refresh-voice-notes  { staff_id }
//
// Distills how this clinician edits AI drafts into a short "voice notes" block
// that is injected into every future prompt for their content. Reads up to N
// recent content_items where ai_original_content !== content (i.e. the clinician
// actually edited the draft), asks an AI to summarize the consistent patterns,
// and saves the result to clinicians.voice_notes.
//
// Two triggers, ONE implementation: this manual button (clinician profile) and
// the automatic on-approve path in api/_routes/db/content.js both call
// refreshVoiceNotes() from api/_lib/voiceNotesRefresh.js. The analysis, the
// thresholds, and the persist all live there so the two callers cannot drift.
// This route keeps the auth + self/admin gate and maps the result to HTTP.
// The button passes force:true so a clinician can always refresh right now,
// bypassing the cooldown the approve path respects.
export const config = { runtime: 'nodejs', maxDuration: 60 }

import { refreshVoiceNotes } from '../../_lib/voiceNotesRefresh.js'
import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole } from '../../_lib/auth.js'
import { enforceLimit } from '../../_lib/ratelimit.js'

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

const ok  = (res, data, status = 200) => res.status(status).json(data)
const err = (res, msg, status = 400)  => res.status(status).json({ error: msg })

export default async function handler(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405)
  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'Workspace not resolved', 400)
  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  if (!(await enforceLimit(req, res, 'ai', ws.id))) return
  const wsFilter = `workspace_id=eq.${ws.id}`

  const staffId = req.body?.staff_id
  if (!staffId) return err(res, 'Missing staff_id')
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!UUID_RE.test(staffId)) return err(res, 'Invalid staff_id')

  // Fetch clinician (and confirm they belong to this workspace)
  const clinRes = await sb(`staff?id=eq.${staffId}&${wsFilter}&select=id,name,user_id`)
  if (!clinRes.ok) return err(res, 'Database error', 500)
  const clinRows = await clinRes.json()
  if (!clinRows.length) return err(res, 'Staff member not found', 404)
  const staffMember = clinRows[0]

  // Authorization: this AI-reads the clinician's edit history and overwrites
  // their voice_notes. requireRole(req, null) above only authenticates the caller
  // as a workspace member — without this gate any member could regenerate (and
  // clobber) a colleague's voice profile. Allow only the staff member themselves
  // (user_id, the canonical self link — see useSelfStaffId / capture/token.js) or
  // a workspace admin. (Same class as the voice-clone fix, PR #1806.)
  const isSelf = staffMember.user_id && staffMember.user_id === auth.userId
  if (!isSelf && auth.role !== 'admin') return err(res, 'forbidden', 403)

  // force:true — this is the explicit "refresh now" button, so it bypasses the
  // cooldown the automatic on-approve trigger respects.
  const result = await refreshVoiceNotes({
    sb,
    staffId,
    wsFilter,
    workspaceName: ws.display_name,
    force: true,
  })

  if (!result.ok) {
    const status = result.reason === 'ai_analysis_failed' ? 500
      : result.reason === 'staff_not_found' ? 404
      : 500
    return err(res, result.reason === 'ai_analysis_failed' ? 'ai_analysis_failed' : 'Database error', status)
  }

  // Preserve this route's original response shape — VoiceNotesPanel reads
  // edits_analyzed / voice_notes / reason / pairs_found / pairs_required.
  if (result.reason === 'insufficient_pairs') {
    return ok(res, {
      ok: true,
      edits_analyzed: result.edits_analyzed,
      voice_notes: null,
      reason: 'insufficient_pairs',
      pairs_found: result.edits_analyzed,
      pairs_required: result.pairs_required,
    })
  }

  return ok(res, {
    ok: true,
    edits_analyzed: result.edits_analyzed,
    voice_notes: result.voice_notes,
  })
}
