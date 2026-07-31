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
import { BundlePublisher } from './bundlePublisher.js'

export { BundlePublisher }
export { SocialPublisher, publishError, emptyMetrics } from './socialPublisher.js'

/** Known providers. Buffer was retired 2026-07-30 — see getPublisher. */
export const PUBLISH_PROVIDERS = ['bundle']

/**
 * Resolve the social publisher for a workspace.
 *
 * bundle.social is the only provider (2026-07-30). The factory is kept rather
 * than inlined because it is the seam a future second provider would re-enter
 * through — and because collapsing it to a bare `new BundlePublisher()` at ~10
 * call sites would make re-introducing one a 10-file change again, which is
 * how the two paths drifted apart the first time.
 *
 * @param {Object} workspace Full `workspaces` row (from workspaceContext/workspaceById).
 * @returns {BundlePublisher}
 */
export function getPublisher(workspace) {
  return new BundlePublisher(workspace)
}
