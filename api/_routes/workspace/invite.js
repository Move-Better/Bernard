// POST /api/workspace/invite
//
// Sends a Clerk org invitation with redirect_url pointing directly to the
// workspace subdomain. This bypasses the apex onboarding wizard, which can
// strand invited users if Clerk's server-side membership propagates slowly.
//
// Body: { email: string, tier?: 'producer'|'clinician'|'viewer', staffType?: 'clinician'|'non_clinical_staff' }
//   tier      — Access: what they can do. 'clinician' is shown as "Team member".
//   staffType — Role: what they do. Every role can share their story.
// Both ride on the invitation's public_metadata, which Clerk copies onto the
// membership; /api/staff/ensure-self applies them when the person first signs
// in. Owners are Clerk org admins and are not set here.
//
// Auth: Bearer JWT, members.invite capability required.
// Runtime: nodejs

export const config = { runtime: 'nodejs' }

import { withSentry } from '../../_lib/sentry.js'
import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole, requireCapability } from '../../_lib/auth.js'
import { CAP_MEMBERS_INVITE } from '../../_lib/capabilities.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { INVITE_TIERS, STAFF_TYPES } from '../../_lib/teamAccess.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method-not-allowed' })

  const CLERK_SECRET = process.env.CLERK_SECRET_KEY
  if (!CLERK_SECRET) {
    console.error('[workspace/invite] CLERK_SECRET_KEY not configured')
    return res.status(500).json({ error: 'server-misconfigured' })
  }

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'workspace-not-resolved' })

  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  const capAuth = await requireCapability(req, ws, [CAP_MEMBERS_INVITE])
  if (!capAuth.ok) {
    return res.status(403).json({ error: capAuth.reason, missing: capAuth.missing })
  }

  if (!(await enforceLimit(req, res, 'generic', ws.id))) return

  const body = req.body || {}
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'invalid-email' })
  }
  const tier = body.tier ?? 'clinician'
  if (!INVITE_TIERS.includes(tier)) return res.status(400).json({ error: 'invalid-tier' })
  const staffType = body.staffType ?? 'clinician'
  if (!STAFF_TYPES.includes(staffType)) return res.status(400).json({ error: 'invalid-staff-type' })

  // Send via Clerk org invitations API. redirect_url goes to the workspace
  // subdomain so the invited user lands directly in the app — not the apex.
  const redirectUrl = `https://${ws.slug}.withbernard.ai`

  const r = await fetch(
    `https://api.clerk.com/v1/organizations/${ws.clerk_org_id}/invitations`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CLERK_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email_address: email,
        role: 'org:member',
        redirect_url: redirectUrl,
        public_metadata: { bernard_tier: tier, bernard_staff_type: staffType },
      }),
    }
  )

  if (!r.ok) {
    const text = await r.text().catch(() => '')
    // Clerk returns 422 if the user is already a member or already invited.
    if (r.status === 422) {
      const data = JSON.parse(text || '{}')
      const code = data?.errors?.[0]?.code || ''
      if (code === 'duplicate_record') {
        return res.status(409).json({ error: 'already-invited' })
      }
    }
    console.error(`[workspace/invite] Clerk ${r.status}: ${text.slice(0, 300)}`)
    return res.status(502).json({ error: 'clerk-error' })
  }

  const inv = await r.json().catch(() => null)
  return res.status(200).json({ id: inv?.id, email, tier, staffType })
}

export default withSentry(handler)
