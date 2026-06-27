// Buffer adapter — wraps Bernard's existing Buffer behavior behind the
// SocialPublisher interface, with NO change to the live publish path.
//
// The canonical, in-production Buffer logic still lives inline in
// api/_routes/publish/buffer.js (publish/delete), api/_routes/oauth/buffer/*
// (connect), and api/_lib/bufferPostStats.js (analytics). This adapter is a
// FAITHFUL mirror of that logic that reuses the already-shared helpers
// (getCredential, prepareMediaForBuffer, fetchPostStats) and replicates the
// Buffer-specific orchestration (channel resolution, GBP fan-out, the GraphQL
// mutations). Phase 0 wires nothing to it; a later phase points the route at
// getPublisher(ws).publish(...) and deletes the inline copy. Until then, keep
// this in sync with api/_routes/publish/buffer.js if that handler changes.
//
// Errors are thrown (not returned as HTTP) carrying `.status`, so the future
// route wrapper can map them to the same status codes the handler returns today.
import crypto from 'node:crypto'
import { getCredential } from '../getCredential.js'
import { prepareMediaForBuffer } from '../prepareMediaForBuffer.js'
import { fetchPostStats } from '../bufferPostStats.js'
import { SocialPublisher, publishError, emptyMetrics } from './socialPublisher.js'

const BUFFER_GQL = 'https://api.buffer.com/graphql'
const BUFFER_AUTHORIZE_URL = 'https://api.bufferapp.com/1/oauth2/authorize'
const BUFFER_REDIRECT_URI = 'https://withbernard.ai/api/oauth/buffer/callback'
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// Bernard platform id -> Buffer GraphQL Service enum (mirrors PLATFORM_TO_SERVICE
// in api/_routes/publish/buffer.js).
const PLATFORM_TO_SERVICE = {
  instagram: 'instagram',
  instagram_story: 'instagram',
  facebook: 'facebook',
  linkedin: 'linkedin',
  twitter: 'twitter',
  tiktok: 'tiktok',
  threads: 'threads',
  youtube_short: 'youtube',
  youtube: 'youtube',
  bluesky: 'bluesky',
  mastodon: 'mastodon',
  gbp: 'googlebusiness',
}

async function gql(token, query, variables = {}) {
  const r = await fetch(BUFFER_GQL, {
    signal: AbortSignal.timeout(30_000),
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  })
  const json = await r.json().catch(() => ({}))
  return { ok: r.ok, status: r.status, data: json.data, errors: json.errors }
}

function buildAssets(mediaUrls) {
  return mediaUrls.map((m) => {
    if (m.type?.startsWith('video')) {
      return { video: { url: m.url, ...(m.thumbnail ? { thumbnailUrl: m.thumbnail } : {}) } }
    }
    return { image: { url: m.url } }
  })
}

// Some Buffer services require metadata.<service>.type. Mirrors buildMetadata in
// api/_routes/publish/buffer.js. Returns null when no metadata is needed.
function buildMetadata(platform, mediaUrls) {
  const imageCount = mediaUrls.filter((m) => !m.type?.startsWith('video')).length
  const videoCount = mediaUrls.filter((m) => m.type?.startsWith('video')).length
  if (platform === 'instagram' || platform === 'instagram_story') {
    const type = platform === 'instagram_story' ? 'story'
      : videoCount > 0 && imageCount === 0 ? 'reel' : 'post'
    return { instagram: { type, shouldShareToFeed: type !== 'story' } }
  }
  if (platform === 'facebook') {
    const type = videoCount > 0 && imageCount === 0 ? 'reel' : 'post'
    return { facebook: { type } }
  }
  if (platform === 'gbp') {
    return { google: { type: 'whats_new', detailsWhatsNew: { button: 'learn_more' } } }
  }
  return null
}

export class BufferPublisher extends SocialPublisher {
  get provider() {
    return 'buffer'
  }

  // Buffer access token is per-workspace, looked up (and decrypted) lazily per
  // call — same as the live handler. Throws 503 when the workspace has no token.
  async _token() {
    const cred = await getCredential(this.workspace.id, 'buffer')
    if (!cred?.secret) {
      const where = this.workspace.slug ? ` (${this.workspace.slug})` : ''
      throw publishError(`Buffer is not configured for this workspace${where}.`, 503)
    }
    return cred.secret
  }

  // Buffer has no "team" concept — a workspace brings its own account token via
  // the OAuth flow. No-op so the interface is uniform.
  async createTeam() {
    return { teamId: null }
  }

  // Returns the Buffer OAuth authorize URL with a signed state encoding the
  // workspace id (mirrors api/_routes/oauth/buffer/start.js). The admin-role
  // gate stays at the route layer that calls this.
  async connect({ redirectUrl } = {}) {
    const clientId = process.env.BUFFER_CLIENT_ID
    const clientSecret = process.env.BUFFER_CLIENT_SECRET
    if (!clientId || !clientSecret) {
      throw publishError('Buffer OAuth not configured (BUFFER_CLIENT_ID / BUFFER_CLIENT_SECRET).', 500)
    }
    const nonce = crypto.randomBytes(16).toString('hex')
    const data = Buffer.from(JSON.stringify({ workspace_id: this.workspace.id, nonce })).toString('base64url')
    const sig = crypto.createHmac('sha256', clientSecret).update(data).digest('base64url')
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUrl || BUFFER_REDIRECT_URI,
      response_type: 'code',
      state: `${data}.${sig}`,
    })
    return { url: `${BUFFER_AUTHORIZE_URL}?${params}` }
  }

  async publish({ platform, content, mediaUrls = [], scheduledAt = null, useQueue = false, locationIds = null, locationContents = null } = {}) {
    if (!platform || !content) throw publishError('Missing platform or content', 400)
    const service = PLATFORM_TO_SERVICE[platform]
    if (!service) throw publishError(`Unsupported Buffer platform: ${platform}`, 400)
    const token = await this._token()

    // 1. Resolve target Buffer channel id(s).
    //    gbpChannels: { id: workspace_locations.id, channelId }[] (GBP fan-out)
    //    channelIds:  bare Buffer channel id strings (everything else)
    let gbpChannels = []
    let channelIds = []
    if (platform === 'gbp') {
      gbpChannels = await this._resolveGbpChannels(locationIds)
      if (gbpChannels.length === 0) {
        throw publishError('No Buffer GBP channel configured for the selected location(s).', 404)
      }
    } else {
      channelIds = [await this._resolveChannelId(token, service, platform)]
    }

    // 2. Mode + media (identical resolution to the live handler).
    const mode = useQueue ? 'shareNext' : (scheduledAt ? 'customScheduled' : 'shareNow')
    const includeDueAt = mode === 'customScheduled'
    const preparedMedia = await prepareMediaForBuffer(mediaUrls)
    const assets = buildAssets(preparedMedia)
    const metadata = buildMetadata(platform, preparedMedia)

    // 3. Fan out one createPost per channel (GBP multi-location).
    const fanOut = platform === 'gbp'
      ? gbpChannels.map(({ id, channelId }) => ({ id, channelId }))
      : channelIds.map((channelId) => ({ id: null, channelId }))
    const posts = []
    for (const { id: locationId, channelId } of fanOut) {
      const rawText = (locationId && locationContents?.[locationId]) ? locationContents[locationId] : content
      const postText = platform === 'gbp' ? rawText.slice(0, 1500) : rawText // GBP 1500-char cap
      const input = {
        channelId,
        text: postText,
        schedulingType: 'automatic',
        mode,
        assets,
        ...(metadata ? { metadata } : {}),
        ...(includeDueAt ? { dueAt: new Date(scheduledAt).toISOString() } : {}),
      }
      const r = await gql(token, CREATE_POST_MUTATION, { input })
      if (r.errors) throw publishError(r.errors[0]?.message || 'Buffer post failed', 502)
      const payload = r.data?.createPost
      if (payload && payload.__typename !== 'PostActionSuccess') {
        throw publishError(payload.message || `Buffer post failed (${payload.__typename})`, 502)
      }
      posts.push(payload?.post)
    }

    const first = posts[0]
    return {
      success: true,
      postId: first?.id ?? null,
      scheduledAt: first?.dueAt ?? null,
      status: first?.status ?? null,
      profileCount: fanOut.length,
    }
  }

  // Buffer's API exposes no per-post engagement yet (confirmed 2026-06-04 — see
  // bufferPostStats.js). We return the post status via fetchPostStats and a zeroed
  // normalized metrics block, faithful to current behavior. platformType is unused
  // (a bundle concept) — Buffer scopes by token + postId.
  async getAnalytics({ postId } = {}) {
    if (!postId) throw publishError('getAnalytics requires postId', 400)
    const token = await this._token()
    const result = await fetchPostStats(token, postId)
    return {
      metrics: emptyMetrics(),
      fetchedAt: new Date().toISOString(),
      raw: result?.post ?? null,
    }
  }

  async deletePost({ postId } = {}) {
    if (!postId || typeof postId !== 'string') throw publishError('Missing postId', 400)
    const token = await this._token()
    const r = await gql(token, DELETE_POST_MUTATION, { input: { id: postId } })
    if (r.errors) throw publishError(r.errors[0]?.message || 'Buffer cancel failed', 502)
    const payload = r.data?.deletePost
    if (payload && payload.__typename !== 'PostActionSuccess') {
      // Already gone is success — that's what the caller wants (idempotent).
      if (payload.__typename === 'NotFoundError') return { success: true, alreadyGone: true }
      throw publishError(payload.message || `Buffer cancel failed (${payload.__typename})`, 502)
    }
    return { success: true }
  }

  // Account-wide liveness check (Buffer connects the whole account, not per
  // network) — mirrors testBuffer in api/_routes/workspace/credentials/test.js.
  async checkConnection() {
    const token = await this._token()
    const r = await gql(token, '{ account { id name email } }')
    if (!r.ok || r.errors) {
      return { ok: false, error: r.errors?.[0]?.message || `Buffer account query returned ${r.status}` }
    }
    const acct = r.data?.account
    return { ok: true, info: { account: acct?.name || acct?.email || acct?.id } }
  }

  // ── Buffer-specific helpers ────────────────────────────────────────────────

  // Non-GBP: fetch the account's first organization, then match a connected
  // channel by service name. Mirrors the live handler's account+channels queries.
  async _resolveChannelId(token, service, platform) {
    const acct = await gql(token, '{ account { organizations { id } } }')
    if (!acct.ok || acct.errors) {
      throw publishError(this._authHint(acct, 'account'), 502)
    }
    const organizationId = acct.data?.account?.organizations?.[0]?.id
    if (!organizationId) {
      throw publishError('Buffer account has no organizations associated with this token.', 502)
    }
    const result = await gql(
      token,
      'query Channels($input: ChannelsInput!) { channels(input: $input) { id service isDisconnected } }',
      { input: { organizationId } },
    )
    if (!result.ok || result.errors) {
      throw publishError(this._authHint(result, 'channels'), 502)
    }
    const match = (result.data?.channels ?? []).find((c) => c.service === service && !c.isDisconnected)
    if (!match) {
      throw publishError(`No connected Buffer channel found for ${platform}. Connect it at buffer.com.`, 404)
    }
    return match.id
  }

  _authHint(result, label) {
    if (result.status === 401 || result.status === 403) {
      return 'Buffer access token rejected (401/403). Regenerate the token in Workspace Settings.'
    }
    return result.errors?.[0]?.message || `Buffer ${label} query returned ${result.status}`
  }

  // GBP channel ids live per-location on workspace_locations.gbp_location_id.
  // Scoped to THIS workspace (trust boundary) — mirrors resolveGbpChannelIds in
  // the live handler.
  async _resolveGbpChannels(locationIds) {
    if (!SUPABASE_URL || !SUPABASE_KEY) return []
    const params = new URLSearchParams({
      workspace_id: `eq.${this.workspace.id}`,
      status: 'eq.active',
      gbp_location_id: 'not.is.null',
      select: 'id,gbp_location_id',
    })
    if (Array.isArray(locationIds) && locationIds.length > 0) {
      params.set('id', `in.(${locationIds.map((id) => `"${id}"`).join(',')})`)
    }
    const r = await fetch(`${SUPABASE_URL}/rest/v1/workspace_locations?${params.toString()}`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    })
    if (!r.ok) return []
    const rows = await r.json().catch(() => [])
    return (Array.isArray(rows) ? rows : [])
      .filter((row) => typeof row.gbp_location_id === 'string' && row.gbp_location_id.trim())
      .map((row) => ({ id: row.id, channelId: row.gbp_location_id }))
  }
}

const CREATE_POST_MUTATION = `
  mutation CreatePost($input: CreatePostInput!) {
    createPost(input: $input) {
      __typename
      ... on PostActionSuccess { post { id status dueAt sentAt sharedNow } }
      ... on NotFoundError { message }
      ... on UnauthorizedError { message }
      ... on UnexpectedError { message }
      ... on RestProxyError { message code link }
      ... on LimitReachedError { message }
      ... on InvalidInputError { message }
    }
  }
`

const DELETE_POST_MUTATION = `
  mutation DeletePost($input: DeletePostInput!) {
    deletePost(input: $input) {
      __typename
      ... on PostActionSuccess { post { id } }
      ... on NotFoundError { message }
      ... on UnauthorizedError { message }
      ... on UnexpectedError { message }
      ... on InvalidInputError { message }
    }
  }
`
