// Who owns a workspace?
//
// Bernard stores ownership in CLERK, not in Postgres. `auth.js` derives it from
// the session token (`payload.org_role === 'org:admin'`), `workspace/me.js`
// short-circuits org admins straight to the owner capability template, and
// `requireCapability` lets an org admin bypass the tier lookup entirely.
//
// `staff.permission_tier` is deliberately left NULL when a row is provisioned
// (see staff/ensure-self.js) so that provisioning can never change someone's
// authorization. The consequence, which bit us: NOTHING in the product ever
// writes 'owner' to that column. It is read in four places and written in none.
// So any code that answers "who owns this workspace?" by querying
// permission_tier finds nobody — on 6 of 7 live workspaces, all of which have
// a real Clerk org admin. Only `movebetter` worked, because a row there was set
// by hand at some point.
//
// This module is the single place that answers the question correctly:
// Clerk org admins, UNIONed with any explicit permission_tier='owner' rows so
// hand-set values (and any future write path) still count.
//
// Cheaper alternative for the common case: if you are asking "is the CALLER an
// owner?", do NOT call this — `requireRole()` already returns `isOrgAdmin` on
// the auth object, with no extra network call. Use this only when you need to
// enumerate owners, or to test a user OTHER than the caller.

const OWNER_TIER = 'owner'

/**
 * Owner Clerk user IDs for a workspace.
 *
 * Fails OPEN toward the staff table, never toward an empty set on a partial
 * failure: if Clerk is unreachable we still return explicit owner-tier rows
 * rather than silently reporting "this workspace has no owners", which is the
 * exact shape of the bug this module exists to fix.
 *
 * @param {{ id: string, clerk_org_id?: string|null }} workspace
 * @param {Function} sb — Supabase REST helper: (path, init) => Promise<Response>
 * @param {Function} clerk — returns a configured @clerk/backend client
 * @param {string} [logTag] — prefix for console.error, e.g. '[engagement-digest]'
 * @returns {Promise<Set<string>>} Clerk user IDs
 */
export async function listWorkspaceOwnerUserIds(workspace, sb, clerk, logTag = '[workspaceOwners]') {
  const owners = new Set()

  // 1. Clerk org admins — the real source of truth.
  if (workspace?.clerk_org_id) {
    try {
      const res = await clerk().organizations.getOrganizationMembershipList({
        organizationId: workspace.clerk_org_id,
        limit: 100,
      })
      // The SDK has returned both a bare array and a paginated { data } shape
      // across versions; accept either rather than pinning to one.
      const rows = res?.data ?? res ?? []
      for (const m of rows) {
        if (m?.role !== 'org:admin') continue
        const uid = m?.publicUserData?.userId ?? m?.publicUserData?.user_id
        if (uid) owners.add(uid)
      }
    } catch (e) {
      console.error(`${logTag} clerk org-admin lookup failed for ${workspace.clerk_org_id}:`, e?.message)
    }
  }

  // 2. UNION explicit owner-tier rows. Nothing writes these today, but
  //    movebetter has one set by hand and a future admin UI may add more.
  try {
    const r = await sb(
      `staff?workspace_id=eq.${workspace.id}&permission_tier=eq.${OWNER_TIER}` +
      `&user_id=not.is.null&select=user_id`,
    )
    if (r.ok) {
      for (const row of await r.json()) {
        if (row?.user_id) owners.add(row.user_id)
      }
    }
  } catch (e) {
    console.error(`${logTag} owner-tier staff lookup failed for ${workspace.id}:`, e?.message)
  }

  return owners
}

/**
 * Is one specific user an owner of this workspace?
 *
 * For a user OTHER than the caller. For the caller, prefer
 * `auth.isOrgAdmin` from requireRole() — no network call.
 *
 * @returns {Promise<boolean>}
 */
export async function isWorkspaceOwner(userId, workspace, sb, clerk, logTag) {
  if (!userId) return false
  const owners = await listWorkspaceOwnerUserIds(workspace, sb, clerk, logTag)
  return owners.has(userId)
}
