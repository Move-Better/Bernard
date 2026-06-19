// Provider resolver for the social-publishing seam.
//
// Feature code (publish routes, crons, analytics endpoints) calls
// getPublisher(workspace) and uses the returned adapter — it never imports
// BufferPublisher / BundlePublisher (or a provider SDK) directly. That is the
// whole point of the seam: the provider is one switch here, not a change spread
// across feature code.
//
// The provider is chosen by workspaces.publish_provider (migration 132), which
// defaults to 'buffer'. So production behavior is byte-for-byte unchanged until
// a workspace is explicitly flipped to 'bundle' (a later phase). A missing or
// unknown value falls back to Buffer — never knock the publish path offline on a
// bad/absent flag.
import { BufferPublisher } from './bufferPublisher.js'
import { BundlePublisher } from './bundlePublisher.js'

export { BufferPublisher, BundlePublisher }
export { SocialPublisher, publishError, emptyMetrics } from './socialPublisher.js'

/** Known providers — the values workspaces.publish_provider is constrained to. */
export const PUBLISH_PROVIDERS = ['buffer', 'bundle']

/**
 * Resolve the social publisher for a workspace.
 * @param {Object} workspace Full `workspaces` row (from workspaceContext/workspaceById).
 * @returns {BufferPublisher|BundlePublisher}
 */
export function getPublisher(workspace) {
  const provider = workspace?.publish_provider || 'buffer'
  switch (provider) {
    case 'bundle':
      return new BundlePublisher(workspace)
    case 'buffer':
    default:
      return new BufferPublisher(workspace)
  }
}
