import { withSentry } from '../../_lib/sentry.js'
export const config = { runtime: 'nodejs' }
// Buffer publish endpoint — Node.js runtime.
//
// Uses Buffer's GraphQL API (api.buffer.com/graphql) with a Personal Key or
// App Client token as Bearer auth. The old v1 REST API (api.bufferapp.com/1)
// only accepts classic OAuth tokens which are no longer issued.
//
// Resolves the Buffer access token per-workspace via getCredential() so each
// tenant brings its own token.
//
// GBP: channel IDs come from workspace_locations.gbp_location_id (Buffer
// channel IDs). Other platforms: channels are queried from the GraphQL API
// and matched by service name.

import { getCredential } from '../../_lib/getCredential.js'
import { workspaceScope } from '../../_lib/workspaceScope.js'
import { requireRole } from '../../_lib/auth.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { prepareMediaForBuffer } from '../../_lib/prepareMediaForBuffer.js'
import { BundlePublisher } from '../../_lib/social/index.js'

const BUFFER_GQL = 'https://api.buffer.com/graphql'
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Map our runtime platform IDs → Buffer service strings.
// Service strings match Buffer's GraphQL Service enum exactly.
const PLATFORM_TO_SERVICE = {
  instagram:       'instagram',
  instagram_story: 'instagram', // Stories use the same Buffer Instagram channel; type:story set in metadata
  facebook:        'facebook',
  linkedin:        'linkedin',
  twitter:         'twitter',
  tiktok:          'tiktok',
  threads:         'threads',
  youtube_short:   'youtube',
  youtube:         'youtube',   // long-form landscape video → same Buffer YouTube channel
  bluesky:         'bluesky',
  mastodon:        'mastodon',
  gbp:             'googlebusiness',
}

async function gql(token, query, variables = {}) {
  const r = await fetch(BUFFER_GQL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000),
  })
  const json = await r.json().catch(() => ({}))
  return { ok: r.ok, status: r.status, data: json.data, errors: json.errors }
}

// Returns { id: workspace_locations.id, channelId: gbp_location_id } pairs
// so the fan-out loop can look up per-location content overrides by UUID.
async function resolveGbpChannelIds(workspaceId, locationIds) {
  if (!SUPABASE_URL || !SUPABASE_KEY || !workspaceId) return []
  const params = new URLSearchParams({
    workspace_id: `eq.${workspaceId}`,
    status: 'eq.active',
    gbp_location_id: 'not.is.null',
    select: 'id,gbp_location_id',
  })
  if (Array.isArray(locationIds) && locationIds.length > 0) {
    const safeIds = locationIds.filter((id) => UUID_RE.test(String(id)))
    if (safeIds.length === 0) return []
    params.set('id', `in.(${safeIds.map((id) => `"${id}"`).join(',')})`)
  }
  const r = await fetch(`${SUPABASE_URL}/rest/v1/workspace_locations?${params.toString()}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    signal: AbortSignal.timeout(10_000),
  })
  if (!r.ok) return []
  const rows = await r.json().catch(() => [])
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => typeof row.gbp_location_id === 'string' && row.gbp_location_id.trim())
    .map((row) => ({ id: row.id, channelId: row.gbp_location_id }))
}

function buildAssets(mediaUrls) {
  return mediaUrls.map((m) => {
    if (m.type?.startsWith('video')) {
      return { video: { url: m.url, ...(m.thumbnail ? { thumbnailUrl: m.thumbnail } : {}) } }
    }
    return { image: { url: m.url } }
  })
}

// Some Buffer services require `metadata.<service>.type`. Pick a sensible
// default based on the media payload. Returns null when no metadata is needed.
function buildMetadata(platform, mediaUrls, _content = '') {
  const imageCount = mediaUrls.filter((m) => !m.type?.startsWith('video')).length
  const videoCount = mediaUrls.filter((m) => m.type?.startsWith('video')).length
  if (platform === 'instagram' || platform === 'instagram_story') {
    // Buffer accepts only post | story | reel here. Multi-image carousels
    // are encoded as type: 'post' with multiple assets.
    const type = platform === 'instagram_story' ? 'story'
      : videoCount > 0 && imageCount === 0 ? 'reel' : 'post'
    return { instagram: { type, shouldShareToFeed: type !== 'story' } }
  }
  if (platform === 'facebook') {
    const type = videoCount > 0 && imageCount === 0 ? 'reel' : 'post'
    return { facebook: { type } }
  }
  if (platform === 'gbp') {
    // GoogleBusinessWhatsNewMetaDataInput only accepts { button, link } — both
    // optional. The post text itself is the summary; there is no `summary`
    // field on this input type. Pass an empty object so Buffer sees the
    // expected shape without injecting fields it doesn't know about.
    // Buffer requires button on whats-new posts at create time.
    // LEARN_MORE is the safest default (no link URL required).
    return { google: { type: 'whats_new', detailsWhatsNew: { button: 'learn_more' } } }
  }
  return null
}

async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const scope = await workspaceScope(req)
  if (!scope) return res.status(404).json({ error: 'no_workspace' })
  const auth = await requireRole(req, null, { orgId: scope.workspace.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  if (!(await enforceLimit(req, res, 'publish', scope.workspace.id))) return

  // Provider routing: a workspace set to publish_provider='bundle' posts through
  // the bundle.social adapter. Buffer (the default) falls through to the
  // unchanged path below — byte-for-byte identical, so no Buffer tenant is
  // affected. (Dedup of the inline Buffer logic into BufferPublisher is a later
  // cleanup; kept inline here to make this routing flip provably safe.)
  if ((scope.workspace.publish_provider || 'buffer') === 'bundle') {
    return handleBundlePublish(req, res, scope.workspace)
  }

  const workspaceId = scope?.workspace?.id
  const cred = await getCredential(workspaceId, 'buffer')
  if (!cred?.secret) {
    return res.status(503).json({
      error: 'not_configured',
    })
  }
  const BUFFER_TOKEN = cred.secret

  // DELETE — cancel a scheduled Buffer post.
  //
  // Body: { bufferUpdateId: string }. Calls Buffer's deletePost mutation,
  // which removes the post from the channel's queue. Returns 200 on success
  // or when Buffer reports the post is already gone (idempotent). Other
  // failures bubble up as 502 with the upstream message.
  if (req.method === 'DELETE') {
    const body = (typeof req.body === 'object' && req.body) ? req.body : {}
    const { bufferUpdateId } = body
    if (!bufferUpdateId || typeof bufferUpdateId !== 'string') {
      return res.status(400).json({ error: 'Missing bufferUpdateId' })
    }
    if (bufferUpdateId.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(bufferUpdateId)) {
      return res.status(400).json({ error: 'invalid_buffer_update_id' })
    }
    // Verify the scheduled post belongs to this workspace before cancelling —
    // prevents a member of workspace A from cancelling workspace B's posts.
    if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(503).json({ error: 'Service not configured' })
    const ownerCheck = await fetch(
      `${SUPABASE_URL}/rest/v1/content_items?buffer_update_id=eq.${encodeURIComponent(bufferUpdateId)}&workspace_id=eq.${workspaceId}&select=id`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, signal: AbortSignal.timeout(10_000) },
    )
    if (!ownerCheck.ok) {
      console.error('[publish/buffer] ownership check failed:', ownerCheck.status)
      return res.status(503).json({ error: 'ownership_check_failed' })
    }
    const rows = await ownerCheck.json()
    if (!rows.length) return res.status(403).json({ error: 'Post not found in this workspace' })
    const r = await gql(BUFFER_TOKEN, `
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
    `, { input: { id: bufferUpdateId } })
    if (r.errors) {
      console.error('[publish/buffer DELETE] deletePost error', JSON.stringify(r.errors))
      return res.status(502).json({ error: 'buffer_cancel_failed' })
    }
    const payload = r.data?.deletePost
    if (payload && payload.__typename !== 'PostActionSuccess') {
      // Treat NotFoundError as success — post is already gone, which is what
      // the caller wants. Surface other typed errors as 502.
      if (payload.__typename === 'NotFoundError') {
        return res.status(200).json({ success: true, alreadyGone: true })
      }
      console.error('[publish/buffer DELETE] deletePost rejected', JSON.stringify(payload))
      return res.status(502).json({ error: 'buffer_cancel_failed' })
    }
    return res.status(200).json({ success: true })
  }

  const body = (typeof req.body === 'object' && req.body) ? req.body : {}
  // locationContents: { [workspace_locations.id]: string } — per-location body overrides.
  // Generated at draft time and stored in content_items.location_overrides.
  // Falls back to canonical `content` for any location without an override.
  const { platform, content, mediaUrls = [], scheduledAt, useQueue, locationIds, locationContents, contentItemId } = body
  if (!platform || !content) return res.status(400).json({ error: 'Missing platform or content' })

  // When the caller provides a content item ID, verify it belongs to this workspace.
  // This closes the editorial-bypass path where a member could publish arbitrary text
  // without the piece having gone through the approval workflow.
  if (contentItemId) {
    if (!UUID_RE.test(contentItemId)) return res.status(400).json({ error: 'Invalid contentItemId' })
    if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(503).json({ error: 'Service not configured' })
    const ciCheck = await fetch(
      `${SUPABASE_URL}/rest/v1/content_items?id=eq.${contentItemId}&workspace_id=eq.${workspaceId}&select=id`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, signal: AbortSignal.timeout(10_000) },
    )
    if (ciCheck.ok) {
      const rows = await ciCheck.json()
      if (!rows.length) return res.status(403).json({ error: 'Content item not found in this workspace' })
    }
  }

  const service = PLATFORM_TO_SERVICE[platform]
  if (!service) return res.status(400).json({ error: 'unsupported_platform' })

  // 1. Resolve target Buffer channel IDs.
  //    GBP: stored per-location in workspace_locations.gbp_location_id.
  //    Everything else: query the API and match by service name.
  // gbpChannels: { id: workspace_locations.id, channelId: Buffer channel id }[]
  // channelIds: bare Buffer channel id strings for non-GBP platforms
  let gbpChannels = []
  let channelIds  = []
  if (platform === 'gbp') {
    gbpChannels = await resolveGbpChannelIds(workspaceId, locationIds)
    if (gbpChannels.length === 0) {
      return res.status(404).json({
        error: 'No Buffer GBP channel configured for the selected location(s). Open Workspace Settings → Locations and paste the Buffer GBP channel ID for each listing.',
      })
    }
  } else {
    // Buffer's channels query requires an organizationId. Fetch the account's
    // first organization and use that as the scope.
    const acct = await gql(BUFFER_TOKEN, '{ account { organizations { id } } }')
    if (!acct.ok || acct.errors) {
      const errMsg = acct.errors?.[0]?.message || `Buffer account query returned ${acct.status}`
      console.error('[publish/buffer] account query failed', acct.status, errMsg, JSON.stringify(acct.errors))
      return res.status(502).json({ error: acct.status === 401 || acct.status === 403 ? 'buffer_auth_rejected' : 'buffer_account_query_failed' })
    }
    const organizationId = acct.data?.account?.organizations?.[0]?.id
    if (!organizationId) {
      return res.status(502).json({ error: 'Buffer account has no organizations associated with this token.' })
    }
    const result = await gql(
      BUFFER_TOKEN,
      'query Channels($input: ChannelsInput!) { channels(input: $input) { id service isDisconnected } }',
      { input: { organizationId } },
    )
    if (!result.ok || result.errors) {
      const errMsg = result.errors?.[0]?.message || `Buffer channels query returned ${result.status}`
      console.error('[publish/buffer] channels query failed', result.status, errMsg, JSON.stringify(result.errors))
      return res.status(502).json({ error: result.status === 401 || result.status === 403 ? 'buffer_auth_rejected' : 'buffer_channels_query_failed' })
    }
    const channels = result.data?.channels ?? []
    const match = channels.find((c) => c.service === service && !c.isDisconnected)
    if (!match) {
      return res.status(404).json({ error: 'no_buffer_channel' })
    }
    channelIds = [match.id]
  }

  // 2. Build post payload. Mode resolution:
  //    - scheduledAt set → customScheduled + dueAt (specific time we computed)
  //    - useQueue truthy → shareNext (Buffer slots it into the next open queue
  //                       position for the channel; ignores scheduledAt)
  //    - otherwise      → shareNow (immediate publish)
  // scheduledAt + useQueue together: useQueue wins, scheduledAt is ignored.
  const mode = useQueue ? 'shareNext' : (scheduledAt ? 'customScheduled' : 'shareNow')
  const includeDueAt = mode === 'customScheduled'
  const preparedMedia = await prepareMediaForBuffer(mediaUrls)
  const assets = buildAssets(preparedMedia)
  const metadata = buildMetadata(platform, preparedMedia, content)

  // 3. Create one post per channel (fan-out for GBP multi-location).
  // GBP: iterate gbpChannels pairs so we can look up the per-location body override.
  // Other platforms: iterate bare channelIds (single entry).
  const fanOut = platform === 'gbp'
    ? gbpChannels.map(({ id, channelId }) => ({ id, channelId }))
    : channelIds.map((channelId) => ({ id: null, channelId }))
  const posts = []
  for (const { id: locationId, channelId } of fanOut) {
    const rawText = (locationId && locationContents?.[locationId]) ? locationContents[locationId] : content
    // GBP enforces a 1500-character hard cap on post summaries.
    const postText = platform === 'gbp' ? rawText.slice(0, 1500) : rawText
    const input = {
      channelId,
      text: postText,
      schedulingType: 'automatic',
      mode,
      assets,
      ...(metadata ? { metadata } : {}),
      ...(includeDueAt ? { dueAt: new Date(scheduledAt).toISOString() } : {}),
    }
    const r = await gql(BUFFER_TOKEN, `
      mutation CreatePost($input: CreatePostInput!) {
        createPost(input: $input) {
          __typename
          ... on PostActionSuccess {
            post { id status dueAt sentAt sharedNow }
          }
          ... on NotFoundError { message }
          ... on UnauthorizedError { message }
          ... on UnexpectedError { message }
          ... on RestProxyError { message code link }
          ... on LimitReachedError { message }
          ... on InvalidInputError { message }
        }
      }
    `, { input })
    if (r.errors) {
      console.error('[publish/buffer] createPost error', JSON.stringify(r.errors))
      return res.status(502).json({ error: 'buffer_post_failed' })
    }
    const payload = r.data?.createPost
    if (payload && payload.__typename !== 'PostActionSuccess') {
      console.error('[publish/buffer] createPost rejected', JSON.stringify(payload))
      return res.status(502).json({ error: 'buffer_post_failed' })
    }
    posts.push(payload?.post)
  }

  const first = posts[0]
  return res.status(200).json({
    success: true,
    bufferId: first?.id,
    scheduledAt: first?.dueAt,
    status: first?.status,
    profileCount: fanOut.length,
  })
}

// Resolve the location → bundle Team targets for a GBP fan-out. Mirrors the
// Buffer resolveGbpChannelIds shape, but the per-location scope is the location's
// own bundle Team (workspace_locations.bundle_team_id) rather than a Buffer
// channel id. Only active locations that have a connected bundle Team are
// targeted; an unconnected location is silently skipped (the admin connects it in
// Settings). Optionally narrows to an explicit locationIds set (validated UUIDs).
async function resolveBundleGbpTargets(workspaceId, locationIds) {
  if (!SUPABASE_URL || !SUPABASE_KEY || !workspaceId) return []
  const params = new URLSearchParams({
    workspace_id: `eq.${workspaceId}`,
    status: 'eq.active',
    bundle_team_id: 'not.is.null',
    select: 'id,label,bundle_team_id',
  })
  if (Array.isArray(locationIds) && locationIds.length > 0) {
    // bare values inside in.() — quoted strings match zero rows (PostgREST gotcha)
    const ids = locationIds.filter((id) => UUID_RE.test(String(id)))
    if (ids.length === 0) return []
    params.set('id', `in.(${ids.join(',')})`)
  }
  const r = await fetch(`${SUPABASE_URL}/rest/v1/workspace_locations?${params.toString()}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    signal: AbortSignal.timeout(10_000),
  })
  if (!r.ok) return []
  const rows = await r.json().catch(() => [])
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => typeof row.bundle_team_id === 'string' && row.bundle_team_id.trim())
    .map((row) => ({ id: row.id, label: row.label, teamId: row.bundle_team_id }))
}

// Bundle.social publish path — invoked for workspaces with publish_provider='bundle'.
// Mirrors the Buffer handler's request/response contract so the client
// (src/lib/publish.js) needs no change: DELETE { bufferUpdateId }; POST
// { platform, content, mediaUrls, scheduledAt, locationIds?, locationContents? };
// response { success, bufferId, … } where bufferId carries the bundle post id
// (stored as buffer_update_id downstream).
//
// GBP multi-location fan-out: a Google Business post fans out across each active
// location that has its own connected bundle Team (one Team per location — bundle
// allows one active GBP per Team), mirroring the Buffer GBP fan-out. Non-GBP
// platforms post once to the workspace brand Team (Instagram/Facebook).
//
// ponytail: the Buffer-specific sync/engagement crons don't understand bundle
// post ids; for the manual-publish trial that's acceptable (they degrade, not
// corrupt).
async function handleBundlePublish(req, res, workspace) {
  let publisher
  try {
    publisher = new BundlePublisher(workspace)
  } catch (_e) {
    return res.status(503).json({ error: 'bundle_not_configured' })
  }

  if (req.method === 'DELETE') {
    const body = (typeof req.body === 'object' && req.body) ? req.body : {}
    const postId = body.bufferUpdateId
    if (!postId || typeof postId !== 'string') {
      return res.status(400).json({ error: 'Missing bufferUpdateId' })
    }
    try {
      const r = await publisher.deletePost({ postId })
      return res.status(200).json({ success: true, ...(r.alreadyGone ? { alreadyGone: true } : {}) })
    } catch (e) {
      console.error('[publish/bundle DELETE] failed:', e?.stack || e?.message)
      return res.status(502).json({ error: 'bundle_cancel_failed' })
    }
  }

  const body = (typeof req.body === 'object' && req.body) ? req.body : {}
  const { platform, content, mediaUrls = [], scheduledAt, locationIds, locationContents } = body
  if (!platform || !content) return res.status(400).json({ error: 'Missing platform or content' })

  // GBP fan-out: post to each active location that has its own connected bundle
  // Team. Each post uses the location's body override (locationContents keyed by
  // workspace_locations.id) or the canonical content. teamId for each post is
  // the location row's bundle_team_id — server-resolved, never client input.
  if (platform === 'gbp') {
    try {
      const targets = await resolveBundleGbpTargets(workspace.id, locationIds)
      if (targets.length === 0) {
        return res.status(404).json({
          error: 'No Google Business location is connected to bundle.social. Open Settings → Integrations and connect each location’s Google Business listing.',
        })
      }
      const posts = []
      for (const loc of targets) {
        const text = (locationContents && typeof locationContents === 'object' && locationContents[loc.id]) || content
        const locPublisher = new BundlePublisher(workspace, { teamId: loc.teamId })
        const r = await locPublisher.publish({ platform: 'gbp', content: text, mediaUrls, scheduledAt })
        posts.push(r)
      }
      const first = posts[0]
      return res.status(200).json({
        success: true,
        bufferId: first?.postId,
        scheduledAt: first?.scheduledAt,
        status: first?.status,
        profileCount: posts.length,
      })
    } catch (e) {
      console.error('[publish/bundle gbp] failed:', e?.stack || e?.message)
      return res.status(502).json({ error: 'bundle_gbp_post_failed' })
    }
  }

  try {
    const result = await publisher.publish({ platform, content, mediaUrls, scheduledAt })
    return res.status(200).json({
      success: result.success,
      bufferId: result.postId,
      scheduledAt: result.scheduledAt,
      status: result.status,
      profileCount: result.profileCount,
    })
  } catch (e) {
    console.error('[publish/bundle] failed:', e?.stack || e?.message)
    return res.status(502).json({ error: 'bundle_post_failed' })
  }
}

export default withSentry(handler)
