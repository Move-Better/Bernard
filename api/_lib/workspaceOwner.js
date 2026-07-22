// Resolve a workspace owner's email for background alerts.
//
// Extracted from notifyPublishFailure.js when a second alerter (channel health)
// needed the same lookup — one copy so the two notifiers can't drift on which
// address they consider the owner's. Recipient resolution is
// workspaces.created_by_clerk_user_id → Clerk primary email, matching what
// engagement-digest does.
//
// Never throws: a failed alert must never break the caller that triggered it.

import { createClerkClient } from '@clerk/backend'

const CLERK_SECRET = process.env.CLERK_SECRET_KEY

let _clerk = null
function clerk() {
  if (!_clerk) _clerk = createClerkClient({ secretKey: CLERK_SECRET })
  return _clerk
}

/**
 * @param {string|null|undefined} clerkUserId
 * @returns {Promise<string|null>} primary email, or null when it can't be resolved
 */
export async function ownerEmail(clerkUserId) {
  if (!clerkUserId) return null
  try {
    const user = await clerk().users.getUser(clerkUserId)
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
