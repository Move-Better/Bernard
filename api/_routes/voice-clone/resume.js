// POST /api/voice-clone/resume
//
// Retries voice cloning from a sample URL the client stashed after an
// earlier /api/voice-clone/create attempt where the upload succeeded but
// the upstream clone step failed (e.g., API key permissions, transient
// upstream 5xx). Skips the upload — calls the shared clone+persist core
// against the existing blob.
//
// Body: { staffId: string, sampleUrl: string }
// Response (success): { voiceId, sampleUrl }
// Response (failure): same shape as /create — includes sampleUrl so the
//   client can keep the stash and let the user retry.
//
// Security: sampleUrl must match the expected workspace + clinician path
// prefix. This prevents a malicious caller from asking us to clone an
// arbitrary blob URL (which we'd then bill to our ElevenLabs account).

export const config = { runtime: 'nodejs', maxDuration: 120 }

import { requireRole } from '../../_lib/auth.js'
import { workspaceContext } from '../../_lib/workspaceContext.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { cloneFromSampleUrl } from '../../_lib/voiceCloneActions.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

function sb(path) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  if (!(await enforceLimit(req, res, 'media', ws.id))) return

  const { staffId, sampleUrl } = req.body || {}
  if (!staffId) return res.status(400).json({ error: 'staffId required' })
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!UUID_RE.test(staffId)) return res.status(400).json({ error: 'invalid_staffId' })
  if (!sampleUrl || typeof sampleUrl !== 'string') {
    return res.status(400).json({ error: 'sampleUrl required' })
  }

  // Guard: the URL must be in our blob storage AND under the expected
  // voice-clone-samples/<workspace-id>/<staff-id>- prefix. This stops
  // a caller from cloning arbitrary URLs at our ElevenLabs expense.
  // Note: old slug-based blobs (written before this change) no longer pass
  // this guard. Callers stashing pre-change sample URLs must re-record.
  const expectedPrefix = `voice-clone-samples/${ws.id}/${staffId}-`
  const looksOk = /^https:\/\/[^/]+\.public\.blob\.vercel-storage\.com\//.test(sampleUrl)
    && sampleUrl.includes(expectedPrefix)
  if (!looksOk) {
    return res.status(400).json({ error: 'sampleUrl does not match expected workspace/staff path' })
  }

  const staffRes = await sb(
    `staff?id=eq.${encodeURIComponent(staffId)}` +
    `&workspace_id=eq.${ws.id}` +
    `&select=id,name,eleven_voice_id,voice_clone_revoked_at,voice_clone_opt_out&limit=1`
  )
  if (!staffRes.ok) {
    return res.status(502).json({ error: 'Could not look up staff member' })
  }
  const [staffMember] = await staffRes.json()
  if (!staffMember) return res.status(404).json({ error: 'Staff member not found in this workspace' })
  // Hard prohibition: refuse to resume a clone for a staff member who has
  // locked voice cloning (e.g. a stash from before they opted out).
  if (staffMember.voice_clone_opt_out) {
    return res.status(403).json({ error: 'voice_cloning_opted_out' })
  }

  // Verify the blob is actually reachable before we call ElevenLabs — fail
  // fast with a clear message so the client clears its stash instead of
  // looping on a 422 from upstream.
  try {
    const head = await fetch(sampleUrl, { method: 'HEAD' })
    if (!head.ok) {
      return res.status(410).json({ error: 'The earlier recording is no longer available — please record again.' })
    }
  } catch (e) {
    console.warn(`[voice-clone] HEAD check on stashed sample failed: ${e?.message}`)
    return res.status(410).json({ error: 'The earlier recording is no longer available — please record again.' })
  }

  const result = await cloneFromSampleUrl({ ws, staffMember, sampleUrl })
  if (!result.ok) return res.status(result.status).json(result.body)
  return res.status(200).json({ voiceId: result.voiceId, sampleUrl: result.sampleUrl })
}
