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

// bundle types whose post REQUIRES at least one media upload (IG/GBP rejected
// text-only live; TikTok and YouTube are video/image platforms and cannot post
// text-only either). Facebook/X/LinkedIn/Threads/Bluesky/Mastodon accept text-only.
const MEDIA_REQUIRED_TYPES = new Set(['INSTAGRAM', 'GOOGLE_BUSINESS', 'TIKTOK', 'YOUTUBE'])

// Default networks the brand connect portal lets a clinic link — the full set
// that connects AND posts end-to-end through this adapter (Buffer parity, Q's
// 2026-06-20 call). Each was checked against the SDK PostCreateData type defs:
// all post with text/media only (their extra fields are optional). Google
// Business is intentionally NOT here: bundle allows one active GBP per Team, so
// each location's GBP connects through its OWN per-location Team (see
// memory/project-bundle-social.md, Option B), via connect({ networks: ['gbp'] })
// on a location-scoped publisher. Pinterest/Reddit/Discord/Slack are also
// excluded: they require a board/subreddit/channel the publish flow doesn't
// collect yet (would 400) — a later add.
const CLINIC_NETWORKS = [
  'INSTAGRAM', 'FACEBOOK', 'TWITTER', 'THREADS',
  'TIKTOK', 'YOUTUBE', 'LINKEDIN', 'BLUESKY', 'MASTODON',
]

// Pull a human-readable failure reason out of a bundle.social post response.
// bundle surfaces failures on the post object (status=ERROR) and in the webhook
// payload identically: errorsVerbose (richest) -> error -> errors[]. Exported so
// the bundle webhook handler can reuse the exact same extraction.
//
// errorsVerbose and errors may be a flat string/array OR an object keyed by
// platform (e.g. { INSTAGRAM: { errorMessage, code, ... } }) — handle both.
function extractFromMap(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null
  const parts = Object.values(obj).map((v) => {
    if (typeof v === 'string') return v.trim()
    if (v && typeof v === 'object') {
      const msg = v.errorMessage || v.message || v.error || ''
      const code = v.code ? ` (${v.code})` : ''
      return msg ? `${msg}${code}` : ''
    }
    return ''
  }).filter(Boolean)
  return parts.length ? parts.join('; ') : null
}

export function bundleErrorText(res) {
  if (!res) return null
  // errorsVerbose: richest — may be a string or a platform-keyed object
  if (typeof res.errorsVerbose === 'string' && res.errorsVerbose.trim()) return res.errorsVerbose.trim()
  const verboseMap = extractFromMap(res.errorsVerbose)
  if (verboseMap) return verboseMap
  // error: flat string
  if (typeof res.error === 'string' && res.error.trim()) return res.error.trim()
  // errors: array of strings/objects OR platform-keyed object
  if (Array.isArray(res.errors) && res.errors.length) {
    const parts = res.errors
      .map((e) => (typeof e === 'string' ? e : e?.message || e?.error || ''))
      .filter(Boolean)
    if (parts.length) return parts.join('; ')
  }
  const errorsMap = extractFromMap(res.errors)
  if (errorsMap) return errorsMap
  return null
}

// Count media by the type bundle ITSELF assigned. bundle's upload response
// carries `type: 'image'|'video'|'document'`, decided after it downloads the
// URL — which is a far better signal than our own media_urls entry labels.
// Those are written by five different call sites that disagree on the spelling
// ('video' vs 'photo' vs 'image'), so deriving "is this a video post?" from them
// is exactly how a Reel ends up shipping as an in-feed POST.
function countMedia(uploads) {
  let video = 0
  let image = 0
  for (const u of uploads || []) {
    if (u?.type === 'video') video++
    else if (u?.type === 'image') image++
  }
  return { video, image }
}

// An all-video payload is a Reel on Instagram and Facebook. Mirrors the legacy
// Buffer path's rule exactly (buildMetadata in api/_routes/publish/buffer.js:
// `videoCount > 0 && imageCount === 0`): a mixed photo+video payload stays a
// POST, because neither network accepts a Reel with a still in it and this
// publisher can't produce a mixed carousel anyway.
export function isReelPayload(uploads) {
  const { video, image } = countMedia(uploads)
  return video > 0 && image === 0
}

// Build the per-platform `data` block for postCreate. Pure — takes the resolved
// bundle uploads (not our media entries) plus an optional already-uploaded cover
// URL — so the Reel-vs-POST decision is unit-testable without an API key.
export function buildDataBlock({ platform, type, text, uploads = [], coverUrl = null }) {
  const uploadIds = uploads.map((u) => u?.id).filter(Boolean)
  const media = uploadIds.length ? { uploadIds } : {}
  // bundle's `thumbnail` is "the URL to an image uploaded on bundle.social" —
  // i.e. the cover frame. Without it Instagram picks the first frame of the
  // video, which on a talking-head clip is usually a half-blink.
  const cover = coverUrl ? { thumbnail: coverUrl } : {}

  if (type === 'INSTAGRAM') {
    if (platform === 'instagram_story') return { type: 'STORY', text, ...media }
    if (isReelPayload(uploads)) {
      // shareToFeed puts the Reel in the main feed as well as the Reels tab.
      // The legacy Buffer path set the same flag (shouldShareToFeed).
      return { type: 'REEL', text, shareToFeed: true, ...media, ...cover }
    }
    return { type: 'POST', text, ...media }
  }
  if (type === 'GOOGLE_BUSINESS') {
    return { text, topicType: 'STANDARD', ...media }
  }
  if (type === 'FACEBOOK') {
    if (isReelPayload(uploads)) return { type: 'REEL', text, ...media, ...cover }
    return { type: 'POST', text, ...media }
  }
  if (type === 'YOUTUBE') {
    // Bernard distinguishes long-form (youtube) from Shorts (youtube_short);
    // both require a video upload (guarded by MEDIA_REQUIRED_TYPES).
    return { type: platform === 'youtube_short' ? 'SHORT' : 'VIDEO', text, ...media }
  }
  // X/Twitter, Threads, LinkedIn, TikTok, Bluesky, Mastodon: a generic
  // text(+media) block. Verified against the SDK PostCreateData type defs
  // (2026-06-20) that each posts with only text/media — their other fields are
  // optional (LinkedIn requires `text`, which the handler always provides;
  // TikTok requires media, guarded above). Networks that need extra required
  // fields (Pinterest boardName, Reddit sr, Discord/Slack channelId) are NOT
  // offered for connect (see CLINIC_NETWORKS) so this block is never hit for
  // them; adding one means collecting that field in the publish flow first.
  return { text, ...media }
}

// Networks whose Reel format accepts a separate cover image.
const REEL_COVER_TYPES = new Set(['INSTAGRAM', 'FACEBOOK'])

export class BundlePublisher extends SocialPublisher {
  /**
   * @param {Object} workspace Full `workspaces` row.
   * @param {{teamId?: string}} [opts] teamId overrides the resolved bundle Team —
   *   used to scope this publisher to a single LOCATION's GBP Team. The override
   *   MUST be a team id read server-side from a `workspace_locations` row that was
   *   already validated to belong to this workspace; it is NEVER caller input.
   *   This keeps the same authorization discipline as the workspace-team path.
   */
  constructor(workspace, { teamId = null } = {}) {
    super(workspace)
    const key = process.env.BUNDLE_API_KEY
    if (!key) throw publishError('BUNDLE_API_KEY is not configured', 503)
    this.sdk = new Bundlesocial(key)
    // Server-resolved location-Team override (see constructor doc). Defaults to
    // the workspace brand Team via the getter below.
    this._teamIdOverride = teamId
  }

  get provider() {
    return 'bundle'
  }

  // bundle teamId is an AUTHORIZATION boundary — derive ONLY from a server-resolved
  // row, never from caller input (a wrong teamId posts/reads another tenant's
  // accounts). Either the location-Team override (set at construction from a
  // validated workspace_locations row) or the workspace brand Team.
  get teamId() {
    const id = this._teamIdOverride || this.workspace.bundle_team_id
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

  // Hosted-portal connect (Phase 1 decision): hand the tenant ONE bundle-hosted
  // link to connect AND manage all their accounts, instead of a per-network
  // redirect. bundle owns the connect + reconnect UI, so Bernard never sees a
  // platform password. `networks` defaults to the clinic-relevant set; the
  // optional `redirectUrl` is where bundle returns the tenant afterward.
  async connect({ networks, redirectUrl, disableAutoLogin = false } = {}) {
    const socialAccountTypes = (networks?.length ? networks : CLINIC_NETWORKS).map((n) => this._bundleType(n))
    // When Instagram is among the networks, pin the DIRECT Instagram connection
    // method. The Facebook-linked method ("connect IG via Facebook") does NOT
    // expose per-post Media Insights through bundle — every
    // analyticsGetPostAnalytics({platformType:'INSTAGRAM'}) 400s — while the
    // direct method returns them (incl. carousels; confirmed live 2026-07-11).
    // This is the whole multi-tenant analytics fix: every tenant's IG connect
    // defaults to the working method, no per-tenant setup. `forceBrowserOAuth`
    // avoids the Instagram iOS-app deep-link bug on mobile connects. The two
    // fields are Instagram-only, so only send them when IG is requested (the
    // per-location GBP connect passes ['gbp'] and must not carry them).
    // See memory/project-bundle-social.md "RESOLVED — IG analytics".
    const wantsInstagram = socialAccountTypes.includes('INSTAGRAM')
    const res = await this.sdk.socialAccount.socialAccountCreatePortalLink({
      requestBody: {
        teamId: this.teamId,
        socialAccountTypes,
        disableAutoLogin,
        ...(wantsInstagram ? { instagramConnectionMethod: 'INSTAGRAM', forceBrowserOAuth: true } : {}),
        ...(redirectUrl ? { redirectUrl } : {}),
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

    let uploads = []
    if (Array.isArray(mediaUrls) && mediaUrls.length) {
      uploads = await this._uploadMedia(mediaUrls)
    }
    // Covers both "caller sent no media" and "every upload failed" — the latter
    // used to reach bundle as an empty uploadIds array and come back as an
    // opaque 400, so fail here with the reason instead.
    if (MEDIA_REQUIRED_TYPES.has(type) && uploads.length === 0) {
      throw publishError(`${platform} posts require at least one media item`, 400)
    }

    // A Reel gets an explicit cover frame; a photo post never needs one.
    const coverUrl = REEL_COVER_TYPES.has(type) && isReelPayload(uploads)
      ? await this._uploadCover(mediaUrls)
      : null

    const res = await this.sdk.post.postCreate({
      requestBody: {
        teamId: this.teamId,
        title: this._title(content),
        postDate,
        status: 'SCHEDULED',
        socialAccountTypes: [type],
        data: { [type]: this._dataBlock(platform, type, content || '', uploads, coverUrl) },
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

  // Fetch the current publish status of a bundle post by its id. Used by
  // sync-buffer-published cron to promote scheduled→published without a
  // webhook. Note: postGet does NOT use teamId (post ids are globally unique
  // within the org) — this works even before a workspace brand Team is set up.
  async getPostStatus({ postId } = {}) {
    if (!postId) throw publishError('getPostStatus requires postId', 400)
    const res = await this.sdk.post.postGet({ id: postId })
    const status = res?.status ?? null
    return {
      status,
      postedAt: res?.postedDate ?? null,
      isPosted: status === 'POSTED',
      // ERROR = bundle tried and the network rejected it → a real publish
      // failure we surface to the user. DELETED = removed in bundle (usually
      // intentional) → not a failure; the cron leaves it as-is.
      isError:  status === 'ERROR',
      isFailed: status === 'ERROR' || status === 'DELETED',
      error:    status === 'ERROR' ? bundleErrorText(res) : null,
    }
  }

  async checkConnection({ network } = {}) {
    if (!network) throw publishError('bundle checkConnection requires a network', 400)
    const type = this._bundleType(network)
    const res = await this.sdk.socialAccount.socialAccountConnectionCheck({
      requestBody: { teamId: this.teamId, type },
    })
    return { ok: !!res?.success, info: res }
  }

  // List the accounts connected to this workspace's bundle Team, each with a
  // coarse health flag for the settings status surface + reconnect prompt. NOT
  // part of the SocialPublisher contract — bundle-specific.
  // ponytail: the socialAccount health-field names aren't spike-verified; map
  // defensively (unknown status = connected) and confirm live when Move Better
  // connects in Phase 2.
  async listAccounts() {
    const team = await this.sdk.team.teamGetTeam({ id: this.teamId })
    const accounts = Array.isArray(team?.socialAccounts) ? team.socialAccounts : []
    return accounts.map((a) => ({
      type: a?.type ?? null,
      displayName: a?.displayName ?? a?.name ?? a?.username ?? null,
      status: a?.status ?? null,
      connected: a?.status ? !/disconnect|expired|error|revok|invalid/i.test(String(a.status)) : true,
    }))
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

  // Returns the FULL bundle upload records, not just ids — `type` (image/video)
  // drives the Reel decision in buildDataBlock, and width/height/videoLength are
  // there for future format checks.
  async _uploadMedia(mediaUrls) {
    const uploads = []
    for (const m of mediaUrls) {
      if (!m?.url) continue
      const up = await this.sdk.upload.uploadCreateFromUrl({
        requestBody: { teamId: this.teamId, url: m.url },
      })
      if (up?.id) uploads.push(up)
    }
    return uploads
  }

  // Upload the video's poster frame so the Reel ships with the cover the editor
  // showed. `thumbnail` must be a bundle-hosted URL, so our blob URL goes
  // through uploadCreateFromUrl first. A photo entry's thumbnailUrl is just its
  // own url (see mediaEntry.js), so require the two to differ.
  async _uploadCover(mediaUrls) {
    const entry = (mediaUrls || []).find((m) => m?.thumbnailUrl && m.thumbnailUrl !== m.url)
    if (!entry) return null
    try {
      const up = await this.sdk.upload.uploadCreateFromUrl({
        requestBody: { teamId: this.teamId, url: entry.thumbnailUrl },
      })
      return up?.url || null
    } catch (e) {
      // A missing cover is cosmetic — Instagram falls back to the first frame.
      // Never fail a publish over it.
      console.warn('[BundlePublisher] reel cover upload failed:', e?.message)
      return null
    }
  }

  _dataBlock(platform, type, text, uploads, coverUrl) {
    return buildDataBlock({ platform, type, text, uploads, coverUrl })
  }
}

// bundle reports a normalized engagement set across platforms. The force-analytics
// response carries the metrics flat on the root object. The (non-force) get-analytics
// response nests them one level deeper, in a top-level `items[]` time-series array —
// verified live against the real API 2026-07-09: `analyticsGetPostAnalytics` returns
// `{ post, profilePost, items: [{ impressions, likes, comments, ..., forced }] }`, with
// no `post.analytics` field at all (the earlier guess here was wrong and meant every
// non-force read silently normalized to all-zero metrics, regardless of the real
// numbers bundle held in `items[]`). Read the LAST item (most recent poll) first.
function normalizeBundleAnalytics(res) {
  const items = Array.isArray(res?.items) ? res.items : null
  const candidates = [
    res,
    items?.[items.length - 1],
    res?.post,
    res?.analytics,
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
