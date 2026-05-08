// Clerk-backed role gate for API routes.
//
// Reads a Bearer JWT from the inbound request, verifies it with @clerk/backend,
// looks up the user, then checks their `publicMetadata.role`. Returns a result
// object — the caller decides how to respond on failure so it can keep its own
// shape (some endpoints want 401 vs 403 split, some want a generic 'forbidden').
//
// Roles (Locked decisions in HANDOFF.md):
//   admin     — upload, edit, archive, restore, purge
//   editor    — upload, edit, archive, restore
//   clinician — upload, edit own metadata only
//
// Default role for users with no publicMetadata.role set is 'clinician' — the
// least-privileged tier. Only an admin can grant elevated roles via Clerk.
//
// Usage:
//   const auth = await requireRole(req, ['admin'])
//   if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401)
//                          .json({ error: auth.reason })
//   // req.clerk = { userId, role } is now populated for downstream code
//   // (audit log reads req.clerk.userId via actorFromRequest()).

import { createClerkClient, verifyToken } from '@clerk/backend'

const CLERK_SECRET = process.env.CLERK_SECRET_KEY

let _clerk = null
function clerk() {
  if (!_clerk) _clerk = createClerkClient({ secretKey: CLERK_SECRET })
  return _clerk
}

export async function requireRole(req, allowedRoles = null) {
  if (!CLERK_SECRET) {
    // Fail closed. A missing secret is an ops misconfiguration, not a reason
    // to grant access. Surface clearly in logs so it's easy to diagnose.
    console.error('[auth] CLERK_SECRET_KEY is not set; refusing request')
    return { ok: false, reason: 'server-misconfigured' }
  }

  const header = req.headers?.authorization || req.headers?.Authorization || ''
  const token  = header.startsWith('Bearer ') ? header.slice(7).trim() : null
  if (!token) return { ok: false, reason: 'no-token' }

  let payload
  try {
    payload = await verifyToken(token, { secretKey: CLERK_SECRET })
  } catch (e) {
    console.error('[auth] verifyToken failed:', e?.message)
    return { ok: false, reason: 'invalid-token' }
  }

  const userId = payload.sub
  if (!userId) return { ok: false, reason: 'no-user' }

  let user
  try {
    user = await clerk().users.getUser(userId)
  } catch (e) {
    console.error('[auth] getUser failed:', e?.message)
    return { ok: false, reason: 'no-user' }
  }
  if (!user) return { ok: false, reason: 'no-user' }

  const role = (user.publicMetadata?.role || 'clinician').toLowerCase()
  if (allowedRoles && allowedRoles.length && !allowedRoles.includes(role)) {
    return { ok: false, reason: 'forbidden', role, userId }
  }

  // Attach to req for downstream code (audit log).
  req.clerk = { userId, role }
  return { ok: true, user: { id: userId, role }, role, userId }
}
