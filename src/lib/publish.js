import { apiFetch } from '@/lib/api'

// ── Content items ────────────────────────────────────────────────────────────

export function fetchContentItems(filters = {}) {
  const params = new URLSearchParams()
  if (filters.status)      params.set('status', filters.status)
  if (filters.platform)    params.set('platform', filters.platform)
  if (filters.from)        params.set('from', filters.from)
  if (filters.to)          params.set('to', filters.to)
  if (filters.limit)       params.set('limit', String(filters.limit))
  if (filters.interviewId) params.set('interviewId', filters.interviewId)
  // 'post' → only one-off Post/Brief content (brief_id set, no interview). Powers
  // the Posts tab — content that buildStories() drops because it has no interview.
  if (filters.origin)   params.set('origin', String(filters.origin))
  // 'only' → archived rows only; 'all' → live + archived. Omitting hides
  // archived rows (the default the Hub wants).
  if (filters.archived) params.set('archived', String(filters.archived))
  const qs = params.toString()
  return apiFetch(`/api/db/content${qs ? `?${qs}` : ''}`)
}

export function fetchContentItem(id) {
  return apiFetch(`/api/db/content?id=${encodeURIComponent(id)}`)
}

export function fetchContentItemsByInterview(interviewId) {
  return apiFetch(`/api/db/content?interviewId=${encodeURIComponent(interviewId)}`)
}

export function updateContentItem(id, patch) {
  return apiFetch(`/api/db/content?id=${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

export function deleteContentItem(id) {
  return apiFetch(`/api/db/content?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function createContentItems(items) {
  return apiFetch('/api/db/content', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Array.isArray(items) ? items : [items]),
  })
}

// ── Media → content matching (Phase P0) ──────────────────────────────────────

// Ranked media candidates to attach to a draft, from the visual-memory matcher
// (api/content-items/suggest-media.js). Powers the in-editor suggestion strip
// and the "drafts needing media" worklist. `opts` may carry { kind, minScore, k }.
export function suggestMediaForDraft(id, opts = {}) {
  return apiFetch('/api/content-items/suggest-media', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ...opts }),
  })
}

// "Copy this post to other platforms" (feedback 21331b1d) — preview per-target
// fill/create/already-live state (no writes), or run the real copy. See
// api/content-items/copy-to-platforms.js for the full contract.
export function previewCopyToPlatforms(sourceId) {
  return apiFetch('/api/content-items/copy-to-platforms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceId, dryRun: true }),
  })
}

export function copyToPlatforms(sourceId, targets) {
  return apiFetch('/api/content-items/copy-to-platforms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceId, targets }),
  })
}

export function suggestHashtags(contentItemId) {
  return apiFetch('/api/content/suggest-hashtags', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contentItemId }),
  })
}

// ── Publishing ────────────────────────────────────────────────────────────────

// bundle.social is the universal distribution path — every social + local
// surface (including GBP) routes through it; there are no direct platform
// integrations left. To add a new supported platform: (1) add to
// SOCIAL_PLATFORMS, (2) add the matching entry to PLATFORM_TO_BUNDLE_TYPE in
// api/_lib/social/bundlePublisher.js, (3) add a prompt generator in
// src/lib/prompts.js.
//
// `locationIds` only applies to gbp: it carries an array of workspace_locations
// row UUIDs selected in the Review picker. The publish endpoint resolves those
// to per-location bundle Teams. Empty/missing means "fan out to every active
// location with a connected Google Business listing".
const SOCIAL_PLATFORMS = [
  'instagram', 'instagram_story', 'facebook', 'linkedin',
  'tiktok', 'youtube_short', 'youtube', 'twitter', 'threads', 'bluesky', 'mastodon',
  'gbp',
]

export async function publishItem(item, { scheduledAt, useQueue } = {}) {
  const { platform, content, mediaUrls = [], locationIds, location_overrides } = item
  const results = {}

  if (SOCIAL_PLATFORMS.includes(platform)) {
    const body = { platform, content, mediaUrls, scheduledAt, useQueue }
    // Explicit content_items.format ('post'|'carousel'|'reel'|'story') — lets
    // the bundle path publish e.g. a mixed photo+video carousel instead of
    // deriving Reel-vs-post from the media. Absent = legacy derived behavior.
    if (item.format) body.format = item.format
    // YouTube splits the words in two — `title` is the video title (capped at
    // 100 chars there) and the description is the body — where every other
    // channel has a single caption. Sent only when the caller has a real title
    // to give; without them the server keeps the legacy single-caption shape.
    if (platform === 'youtube' || platform === 'youtube_short') {
      if (item.youtubeTitle) body.title = item.youtubeTitle
      if (item.youtubeDescription) body.description = item.youtubeDescription
      if (item.youtubePrivacy) body.privacy = item.youtubePrivacy
    }
    // contentItemId — lets the server enforce the words-approval gate
    // (Phase 3, story-monitor redesign) and the pre-existing workspace-
    // ownership check. item.id is the content_items row id.
    if (item.id) body.contentItemId = item.id
    if (platform === 'gbp') {
      if (locationIds?.length) body.locationIds = locationIds
      // Pass per-location content overrides so the publish route posts distinct
      // copy to each Google listing instead of the same canonical body.
      if (location_overrides && typeof location_overrides === 'object') {
        body.locationContents = Object.fromEntries(
          Object.entries(location_overrides)
            .filter(([, v]) => v && typeof v === 'object')
            .map(([id, v]) => [id, v.content]),
        )
      }
    }
    results.social = await apiFetch('/api/publish/social', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  return results
}

// ── Website publish (workspace-agnostic; gated by workspace.capabilities.websitePublish) ─
// Server-side dispatcher in api/publish/website.js picks Astro or WordPress
// mode from env vars. Throws an Error whose `.code` is one of: slug_taken,
// invalid_payload, auth_failed, website_misconfigured, github_error,
// media_upload_failed, tag_resolve_failed, network_error, not_configured,
// upstream_error. The UI keys off `.code` to render the right message
// (slug-taken in particular needs to highlight the slug input).
export async function publishBlogToWebsite(post) {
  try {
    return await apiFetch('/api/publish/website', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(post),
    })
  } catch (err) {
    // Preserve the {code, status, details} shape callers branch on
    // (slug-taken UI needs `.code` to highlight the slug input).
    if (err?.name === 'ApiError') {
      const wrapped = new Error(err.payload?.message || err.message || `Publish failed (${err.status})`)
      wrapped.code = err.payload?.error || 'upstream_error'
      wrapped.status = err.status
      wrapped.details = err.payload
      throw wrapped
    }
    throw err
  }
}

// ── Beehiiv publish (newsletter draft) ──────────────────────────────────────
// Pushes a blog post to Beehiiv as a DRAFT. The tenant finishes the post in
// Beehiiv (thumbnail review, audience picker, scheduling). Throws an Error
// whose `.code` is one of: not_configured, auth_failed, publication_not_found,
// invalid_payload, rate_limited, network_error, upstream_error.
export async function sendBlogToBeehiiv(post) {
  try {
    return await apiFetch('/api/publish/beehiiv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(post),
    })
  } catch (err) {
    if (err?.name === 'ApiError') {
      const wrapped = new Error(err.payload?.message || err.message || `Beehiiv publish failed (${err.status})`)
      wrapped.code = err.payload?.error || 'upstream_error'
      wrapped.status = err.status
      wrapped.details = err.payload
      throw wrapped
    }
    throw err
  }
}

// Universal dispatch-eligible platform list — exposed so workbench UIs know
// which targets they can dispatch to. Mirrors PLATFORM_TO_BUNDLE_TYPE in
// api/_lib/social/bundlePublisher.js.
export const SOCIAL_DISPATCH_PLATFORMS = SOCIAL_PLATFORMS

// Cancel a scheduled post by its provider post id (stored as
// content_items.platform_post_id). The endpoint treats "already gone"
// (NotFoundError) as success — idempotent. Throws on real failures so callers
// can keep the row in 'scheduled' on error.
//
// The request field matches the column it mirrors. It was `bufferUpdateId`
// before migration 202; the route still accepts that spelling so a tab on the
// previous JS bundle can still cancel — see api/_routes/publish/social.js.
export async function cancelScheduledPost(platformPostId) {
  return apiFetch('/api/publish/social', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ platformPostId }),
  })
}

// ── Workbench dispatch (Media Hub editor briefs) ─────────────────────────────
// Materializes an edit brief into a content_items row and pushes it through the
// universal api/publish/social.js endpoint. Returns the new content_items row.
//
// Keeps content_items as the canonical published-post record while leaving the
// brief (content_pieces row) intact as the editor's draft surface — callers
// stamp brief.status='published' + published_target_id=<item.id> afterward.
export async function dispatchBrief({
  brief,
  asset,            // media_assets row for the final or source clip
  composedContent,  // caption + hashtags + cta string, prepared by the workbench
  scheduledAt,      // ISO string | null
  locationIds,      // optional, gbp only
  userId,
}) {
  if (!brief?.target_platform) throw new Error('Pick a target platform first')
  if (!composedContent?.trim()) throw new Error('Empty post body')

  const mediaUrls = asset?.blob_url
    ? [{ url: asset.blob_url, type: asset.kind === 'video' ? 'video' : 'photo' }]
    : []

  // 1. Create the canonical content_items row.
  const [created] = await apiFetch('/api/db/content', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([{
      platform: brief.target_platform,
      content: composedContent,
      // Always 'draft': the publish route's dispatch claim treats a stored
      // 'scheduled'/'published' status as "another path already dispatched
      // this" and returns alreadyDispatched WITHOUT posting — so a row born
      // 'scheduled' here made Schedule a silent no-op. The publish route's
      // claim-and-commit is the only writer of the terminal status.
      status: 'draft',
      media_urls: mediaUrls,
      scheduled_at: scheduledAt || null,
      notes: `Dispatched from brief ${brief.id}`,
    }]),
  })
  if (!created?.id) throw new Error('Failed to create content item')

  // 2. Dispatch through the publish endpoint (no parallel dispatcher logic).
  const item = {
    id: created.id,
    platform: brief.target_platform,
    content: composedContent,
    mediaUrls,
    scheduledAt,
    locationIds: brief.target_platform === 'gbp' ? locationIds : undefined,
  }
  const result = await publishAndTrack(item, userId)
  return { item: created, result }
}

// Publish one item to all relevant platforms at once.
//
// item.useQueue (boolean): when true, the post is added to the provider's
// existing queue instead of being given a specific dueAt or fired immediately.
// The resulting content_items row is marked `scheduled` even though we don't
// know the exact dueAt up-front — the provider returns one in the webhook
// payload and downstream sync fills it in.
// `_userId` is retained in the signature (callers pass it) but intentionally
// unused: the publish route derives the approver from auth server-side, and the
// client's approvedBy was already inert.
export async function publishAndTrack(item, _userId) {
  // The publish route (api/_routes/publish/social.js → dispatchCommitFields)
  // commits the row's terminal status, scheduled_at AND platform_post_id
  // server-side — sb-direct, in the same write that releases the dispatch claim,
  // so it bypasses the publish lock. We deliberately do NOT echo any of those
  // back through updateContentItem: that is the lock's route (/api/db/content),
  // the row is already 'scheduled' by this point, and the echo 409s — the false
  // "Post failed" / locked_scheduled bug. The server is the single source of
  // truth for what shipped; callers refetch to see it.
  return publishItem(item, { scheduledAt: item.scheduledAt, useQueue: item.useQueue })
}
