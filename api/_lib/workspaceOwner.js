// Resolve who receives a workspace's background alerts (a post failed to
// publish, a channel got disconnected).
//
// Extracted from notifyPublishFailure.js when a second alerter (channel health)
// needed the same lookup — one copy so the two notifiers can't drift on who
// they consider the owner.
//
// The recipient is the founder (workspaces.created_by_clerk_user_id) — unless
// their access has been switched off (staff.deactivated_at, migration 216) or
// their email can't be resolved. Then it is every active owner, so the alert
// still reaches someone who can act on it instead of a person who left, or
// nobody at all.
//
// Never throws: a failed alert must never break the caller that triggered it.

import { createClerkClient } from '@clerk/backend'
import { supabaseRest } from './supabaseRest.js'
import { listWorkspaceOwnerUserIds, listDeactivatedUserIds } from './workspaceOwners.js'

const CLERK_SECRET = process.env.CLERK_SECRET_KEY

let _clerk = null
function clerk() {
  if (!_clerk) _clerk = createClerkClient({ secretKey: CLERK_SECRET })
  return _clerk
}

/**
 * @param {string|null|undefined} clerkUserId
 * @param {() => any} [clerkFn] injectable for tests
 * @returns {Promise<string|null>} primary email, or null when it can't be resolved
 */
export async function ownerEmail(clerkUserId, clerkFn = clerk) {
  if (!clerkUserId) return null
  try {
    const user = await clerkFn().users.getUser(clerkUserId)
    return (
      user.emailAddresses?.find((a) => a.id === user.primaryEmailAddressId)?.emailAddress
      || user.emailAddresses?.[0]?.emailAddress
      || null
    )
  } catch (e) {
    console.warn('[workspaceOwner] clerk lookup failed:', e?.message)
    return null
  }
}

/**
 * Email addresses for a workspace's background alerts. Empty array = nobody
 * resolvable (caller logs and skips).
 *
 * @param {{ id: string, clerk_org_id?: string|null, created_by_clerk_user_id?: string|null }|null|undefined} workspace
 * @param {{ sb?: Function, clerkFn?: () => any, logTag?: string }} [opts]
 * @returns {Promise<string[]>}
 */
export async function alertRecipientEmails(workspace, { sb = supabaseRest, clerkFn = clerk, logTag = '[workspaceOwner]' } = {}) {
  if (!workspace?.id) return []
  try {
    const founder = workspace.created_by_clerk_user_id || null
    const gone = await listDeactivatedUserIds(workspace, sb, logTag)

    if (founder && !gone.has(founder)) {
      const email = await ownerEmail(founder, clerkFn)
      if (email) return [email]
    }

    // Founder switched off or unreachable → every active owner. The owners
    // helper already drops deactivated people; the founder is removed
    // explicitly in case they are listed but had no resolvable email.
    const owners = await listWorkspaceOwnerUserIds(workspace, sb, clerkFn, logTag)
    if (founder) owners.delete(founder)
    const emails = []
    for (const uid of owners) {
      const email = (await ownerEmail(uid, clerkFn))?.toLowerCase()
      if (email && !emails.includes(email)) emails.push(email)
    }
    return emails
  } catch (e) {
    console.warn(`${logTag} alert recipient resolution failed:`, e?.message)
    return []
  }
}
