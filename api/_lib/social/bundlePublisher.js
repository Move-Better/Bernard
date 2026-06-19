// bundle.social adapter — the ONLY file in Bernard that imports the bundle SDK.
//
// Wraps `bundlesocial` (v2) behind the SocialPublisher interface. Every call
// shape here was proven live in the de-risk spike (see
// /Users/qbook/Claude Projects/bundle-social-spike/ + memory/project-bundle-social.md)
// and re-verified against the installed SDK's type definitions:
//   - export is `Bundlesocial` (lowercase s); `new Bundlesocial(API_KEY)`.
//   - the codegen SDK wraps POST bodies in `{ requestBody: {...} }`; GET-style
//     path/query params are top-level (e.g. post.postDelete({ id }),
//     analytics.analyticsGetPostAnalytics({ postId, platformType })).
//
// ENV — BUNDLE_API_KEY (Sensitive, fleet-wide). One key can read/post to EVERY
// bundle team in the org, so it is guarded like WORKSPACE_CREDENTIALS_KEY: never
// logged, stored only as a Sensitive Vercel env var on the `bernard` project.
// It MUST be added there before any workspace is flipped to publish_provider
// 'bundle' (a later phase) — Phase 0 ships nothing that constructs this adapter
// in production (every workspace defaults to Buffer).
import { Bundlesocial } from 'bundlesocial'
import { SocialPublisher, publishError, emptyMetrics } from './socialPublisher.js'

// Bernard platform id -> bundle.social social account type (SDK enum, verified).
const PLATFORM_TO_BUNDLE_TYPE = {
  instagram: 'INSTAGRAM',
  instagram_story: 'INSTAGRAM', // STORY is set on the data block, not the type
  facebook: 'FACEBOOK',
  linkedin: 'LINKEDIN',
  tiktok: 'TIKTOK',
  youtube_short: 'YOUTUBE',
  youtube: 'YOUTUBE',
  twitter: 'TWITTER',
  threads: 'THREADS',
  bluesky: 'BLUESKY',
  mastodon: 'MASTODON',
  gbp: 'GOOGLE_BUSINESS',
}

// bundle types whose post REQUIRES at least one media upload (proven live in the
// spike: IG and GBP rejected text-only; Facebook/X/etc. accept text-only).
const MEDIA_REQUIRED_TYPES = new Set(['INSTAGRAM', 'GOOGLE_BUSINESS'])

export class BundlePublisher extends SocialPublisher {
  constructor(workspace) {
    super(workspace)
    const key = process.env.BUNDLE_API_KEY
    if (!key) throw publishError('BUNDLE_API_KEY is not configured', 503)
    this.sdk = new Bundlesocial(key)
  }

  get provider() {
    return 'bundle'
  }

  // bundle teamId is an AUTHORIZATION boundary — derive ONLY from the workspace
  // row, never from caller input (a wrong teamId posts/reads another tenant's
  // accounts). The `bundle_team_id` column is added by a later onboarding phase;
  // until then this throws, which is correct (no workspace is on bundle yet).
  get teamId() {
    const id = this.workspace.bundle_team_id
    if (!id) {
      throw publishError(`Workspace ${this.workspace.id} is not onboarded to bundle.social (no bundle_team_id)`, 503)
    }
    return id
  }

  async createTeam({ name } = {}) {
    const res = await this.sdk.team.teamCreateTeam({
      requestBody: { name: name || this.workspace.slug || this.workspace.id },
    })
    return { teamId: res?.id ?? null, raw: res }
  }

  async connect({ network, redirectUrl, withBusinessScope = true, disableAutoLogin = false, serverUrl } = {}) {
    if (!redirectUrl) throw publishError('connect requires a redirectUrl', 400)
    const type = this._bundleType(network)
    const res = await this.sdk.socialAccount.socialAccountConnect({
      requestBody: {
        teamId: this.teamId,
        type,
        redirectUrl,
        withBusinessScope,
        disableAutoLogin,
        ...(serverUrl ? { serverUrl } : {}), // Mastodon/Bluesky only
      },
    })
    return { url: res?.url }
  }

  async publish({ platform, content, mediaUrls = [], scheduledAt = null } = {}) {
    if (!platform) throw publishError('publish requires a platform', 400)
    const type = this._bundleType(platform)

    // bundle takes a single postDate + status SCHEDULED|DRAFT. "Now" = a
    // near-future timestamp the queue picks up immediately (mirrors the spike);
    // bundle promotes SCHEDULED -> POSTED itself.
    const postDate = scheduledAt
      ? new Date(scheduledAt).toISOString()
      : new Date(Date.now() + 60_000).toISOString()

    let uploadIds
    if (Array.isArray(mediaUrls) && mediaUrls.length) {
      uploadIds = await this._uploadMedia(mediaUrls)
    } else if (MEDIA_REQUIRED_TYPES.has(type)) {
      throw publishError(`${platform} posts require at least one media item`, 400)
    }

    const res = await this.sdk.post.postCreate({
      requestBody: {
        teamId: this.teamId,
        title: this._title(content),
        postDate,
        status: 'SCHEDULED',
        socialAccountTypes: [type],
        data: { [type]: this._dataBlock(platform, type, content || '', uploadIds) },
      },
    })
    return {
      success: true,
      postId: res?.id ?? null,
      scheduledAt: res?.postDate ?? postDate,
      status: res?.status ?? null,
      profileCount: 1,
    }
  }

  async getAnalytics({ postId, platformType, force = false } = {}) {
    // Both bundle analytics calls require postId AND platformType — postId alone
    // 400s (spike gotcha). platformType accepts a Bernard platform id or a bundle
    // type; the analytics enum omits TWITTER/DISCORD/SLACK.
    if (!postId || !platformType) {
      throw publishError('getAnalytics requires both postId and platformType', 400)
    }
    const type = PLATFORM_TO_BUNDLE_TYPE[platformType] || platformType

    if (force) {
      // Force-refresh is rate-limited (teams x 5/day) and 500s for GBP — never
      // let it fail the read. The force response itself carries the metrics.
      try {
        const forced = await this.sdk.analytics.analyticsForcePostAnalytics({
          requestBody: { postId, platformType: type },
        })
        if (forced) return normalizeBundleAnalytics(forced)
      } catch (e) {
        console.warn('[BundlePublisher] force analytics failed:', e?.message)
      }
    }
    const res = await this.sdk.analytics.analyticsGetPostAnalytics({ postId, platformType: type })
    return normalizeBundleAnalytics(res)
  }

  async deletePost({ postId } = {}) {
    if (!postId) throw publishError('deletePost requires postId', 400)
    await this.sdk.post.postDelete({ id: postId })
    return { success: true }
  }

  async checkConnection({ network } = {}) {
    if (!network) throw publishError('bundle checkConnection requires a network', 400)
    const type = this._bundleType(network)
    const res = await this.sdk.socialAccount.socialAccountConnectionCheck({
      requestBody: { teamId: this.teamId, type },
    })
    return { ok: !!res?.success, info: res }
  }

  // ── bundle-specific helpers ────────────────────────────────────────────────

  _bundleType(network) {
    // Accept a Bernard platform id, or a bare bundle enum (already-uppercase).
    const type = PLATFORM_TO_BUNDLE_TYPE[network]
      || (typeof network === 'string' && /^[A-Z_]+$/.test(network) ? network : null)
    if (!type) throw publishError(`Unsupported bundle.social network: ${network}`, 400)
    return type
  }

  _title(content) {
    const t = (content || '').trim().split('\n')[0].slice(0, 80)
    return t || 'Bernard post'
  }

  async _uploadMedia(mediaUrls) {
    const ids = []
    for (const m of mediaUrls) {
      if (!m?.url) continue
      const up = await this.sdk.upload.uploadCreateFromUrl({
        requestBody: { teamId: this.teamId, url: m.url },
      })
      if (up?.id) ids.push(up.id)
    }
    return ids
  }

  _dataBlock(platform, type, text, uploadIds) {
    if (type === 'INSTAGRAM') {
      return { type: platform === 'instagram_story' ? 'STORY' : 'POST', text, uploadIds }
    }
    if (type === 'GOOGLE_BUSINESS') {
      return { text, topicType: 'STANDARD', uploadIds }
    }
    if (type === 'FACEBOOK') {
      return { type: 'POST', text, ...(uploadIds ? { uploadIds } : {}) }
    }
    // ponytail: LinkedIn/TikTok/X/Threads/Bluesky/Mastodon/YouTube get a generic
    // text+media block. Only FB/IG/GBP were proven live in the spike; verify each
    // network's exact data shape against the SDK before enabling it for a bundle
    // workspace (Phase 2 publish-routing). Limit: a network needing extra
    // required fields (e.g. Pinterest boardName) will 400 until handled here.
    return { text, ...(uploadIds ? { uploadIds } : {}) }
  }
}

// bundle reports a normalized engagement set across platforms. The force-analytics
// response carries the metrics flat; the get-analytics response nests them. Read
// the named fields from whichever container holds them, defaulting to 0.
// ponytail: the exact get-response nesting is not yet spike-verified (GBP returns
// none; FB/IG confirmed the field NAMES). Confirm the read path live in the GBP
// analytics phase before surfacing these numbers in the UI.
function normalizeBundleAnalytics(res) {
  const candidates = [
    res,
    res?.post,
    res?.analytics,
    Array.isArray(res?.post?.analytics) ? res.post.analytics[res.post.analytics.length - 1] : res?.post?.analytics,
  ].filter(Boolean)
  const num = (key) => {
    for (const c of candidates) {
      if (typeof c[key] === 'number') return c[key]
    }
    return 0
  }
  const m = emptyMetrics()
  for (const key of Object.keys(m)) m[key] = num(key)
  return { metrics: m, fetchedAt: new Date().toISOString(), raw: res }
}
