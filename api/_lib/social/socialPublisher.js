// Provider-agnostic social-publishing adapter interface.
//
// Bernard publishes to social + local-listing platforms through ONE of several
// providers (today: Buffer; migrating to: bundle.social). This module defines
// the seam so feature code NEVER imports a provider SDK directly — a handler
// asks getPublisher(workspace) (see ./index.js) for an adapter and calls these
// six methods. Swapping or adding a provider is one new adapter file, not a
// feature-code change. THE most important design decision in the bundle.social
// migration (see memory/project-bundle-social.md).
//
// SECURITY — the provider scope id is an authorization boundary, not a parameter.
// Each adapter is constructed FROM the resolved workspace row (getPublisher(ws))
// and derives its provider-side scope (bundle teamId / Buffer token) from that
// row ONLY — never from client input. A wrong bundle teamId is a cross-tenant
// leak with the same blast radius as a missing workspace_id filter. The
// workspace is bound here, at construction, where the caller has already
// resolved it via workspaceContext(req) / workspaceById(id). Subclasses must
// keep that discipline (derive scope from this.workspace, never from method args).

/**
 * @typedef {Object} PublishInput
 * @property {string} platform   Bernard platform id (instagram | instagram_story | facebook | gbp | ...).
 * @property {string} content    Post body text.
 * @property {Array<{url:string,type?:string,thumbnail?:string}>} [mediaUrls]
 * @property {string|null} [scheduledAt]  ISO time for a scheduled post; null/absent = publish now.
 * @property {boolean} [useQueue]         Provider queue slotting (Buffer shareNext); ignored by providers without a queue.
 * @property {string[]|null} [locationIds]            GBP only: workspace_locations row ids to fan out to.
 * @property {Object<string,string>|null} [locationContents]  GBP only: per-location body overrides keyed by location id.
 */

/**
 * @typedef {Object} PublishResult
 * @property {boolean} success
 * @property {string|null} postId        Provider post id (Buffer update id / bundle post id) for the first channel.
 * @property {string|null} scheduledAt   When the provider scheduled it (ISO), if known.
 * @property {string|null} status        Provider-native status string.
 * @property {number} profileCount       How many channels/locations the post fanned out to.
 */

/**
 * @typedef {Object} AnalyticsMetrics
 * @property {number} impressions
 * @property {number} impressionsUnique
 * @property {number} views
 * @property {number} viewsUnique
 * @property {number} likes
 * @property {number} dislikes
 * @property {number} comments
 * @property {number} shares
 * @property {number} saves
 */

/**
 * @typedef {Object} AnalyticsResult
 * @property {AnalyticsMetrics} metrics   Normalized across providers (0 where a provider doesn't report a field).
 * @property {string|null} fetchedAt
 * @property {*} [raw]                     Provider-native payload, for debugging only.
 */

const NOT_IMPLEMENTED = 'SocialPublisher subclass must implement this method'

/** Build an Error carrying an HTTP-ish `status` so a future handler can map it. */
export function publishError(message, status = 500) {
  return Object.assign(new Error(message), { status })
}

/** A zeroed metrics object — the normalized shape providers fill what they can into. */
export function emptyMetrics() {
  return {
    impressions: 0,
    impressionsUnique: 0,
    views: 0,
    viewsUnique: 0,
    likes: 0,
    dislikes: 0,
    comments: 0,
    shares: 0,
    saves: 0,
  }
}

/**
 * Abstract base. Concrete adapters (BufferPublisher, BundlePublisher) extend
 * this and implement every method. Calling an unimplemented method throws.
 */
export class SocialPublisher {
  /** @param {Object} workspace Full `workspaces` row (from workspaceContext/workspaceById). */
  constructor(workspace) {
    if (!workspace || !workspace.id) {
      throw new Error('SocialPublisher requires a resolved workspace row')
    }
    /** @type {Object} */
    this.workspace = workspace
  }

  /** Provider key for this adapter ('buffer' | 'bundle'). */
  get provider() {
    return 'unknown'
  }

  /**
   * Provision a provider-side container for this workspace (e.g. a bundle Team).
   * No-op for providers without that concept (Buffer).
   * @returns {Promise<{teamId: string|null, raw?: *}>}
   */
  async createTeam() {
    throw new Error(NOT_IMPLEMENTED)
  }

  /**
   * Begin connecting a social account; returns a URL to redirect the tenant to.
   * Param shape: `{ network, redirectUrl, ...providerOpts }` where `network` is a
   * Bernard platform id the adapter maps to its own account type.
   * @returns {Promise<{url: string}>}
   */
  async connect() {
    throw new Error(NOT_IMPLEMENTED)
  }

  /**
   * Publish (or schedule) one post. Param shape: {@link PublishInput}.
   * @returns {Promise<PublishResult>}
   */
  async publish() {
    throw new Error(NOT_IMPLEMENTED)
  }

  /**
   * Read post analytics. Param shape: `{ postId, platformType, force? }`.
   * @returns {Promise<AnalyticsResult>}
   */
  async getAnalytics() {
    throw new Error(NOT_IMPLEMENTED)
  }

  /**
   * Delete / cancel a post by its provider post id. Idempotent — treats an
   * already-gone post as success. Param shape: `{ postId }`.
   * @returns {Promise<{success: boolean, alreadyGone?: boolean}>}
   */
  async deletePost() {
    throw new Error(NOT_IMPLEMENTED)
  }

  /**
   * Check whether the workspace's provider connection(s) are live. Param shape:
   * `{ network? }` (some providers check per-network, others account-wide).
   * @returns {Promise<{ok: boolean, info?: *, error?: string}>}
   */
  async checkConnection() {
    throw new Error(NOT_IMPLEMENTED)
  }
}
