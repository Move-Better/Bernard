// Shared authz decision for writing/deleting a story (interview) the caller
// does NOT own. Extracted so the PATCH (approve-words / edit) and DELETE paths
// in api/_routes/db/interviews.js share ONE copy instead of two hand-synced
// conditions that can silently drift apart.
//
// A non-owner is allowed to write a story when ANY of:
//   (a) auth.isOrgAdmin        — a true Clerk org:admin, or
//   (b) auth.role === 'admin'  — the exact population the PUBLISH path already
//       trusts. publish/social.js calls requireRole(req, null), so every
//       authenticated member of an 'internal'-plan workspace resolves to role
//       'admin' and can publish. Approving or deleting an interview-sourced
//       story must not be STRICTER than the publish it gates — otherwise an
//       internal-plan producer can publish but can't approve the words that
//       unblock publishing, a hard block with no in-app path (feedback
//       a62c3bf2 / acf771c2, Q-confirmed fix 2026-08-14). On regular paid
//       workspaces role is 'admin' only for a genuine org admin or an explicit
//       metadata admin, so their behaviour is unchanged, or
//   (c) staff.permission_tier === 'owner' — a hand-set owner row. This is the
//       ONLY branch that needs a DB lookup, so callers check the two cheap
//       flags here first and only hit the DB when this returns false.
//
// Both auth.isOrgAdmin and auth.role come from requireRole's own return value
// (not from req.clerk / the client), so neither is spoofable.

/**
 * True when a non-owner may write/delete a story WITHOUT a permission_tier
 * lookup. When false, the caller must still consult staff.permission_tier for
 * the hand-set-owner fallback before denying.
 * @param {{ isOrgAdmin?: boolean, role?: string } | null | undefined} auth
 * @returns {boolean}
 */
export function allowsNonOwnerStoryWrite(auth) {
  return Boolean(auth?.isOrgAdmin) || auth?.role === 'admin'
}
