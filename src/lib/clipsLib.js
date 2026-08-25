// Client helpers for multi-clip video v1 — transcript-based segment detection
// + review. One long source video → many proposed standalone clips, each kept
// segment rendered into its own story package.
//
// All requests go through apiFetch, which attaches the short-lived Clerk JWT;
// the editorial endpoints verify it and enforce video_pipeline_enabled +
// workspace scoping server-side.

import { apiFetch } from '@/lib/api'

/**
 * Kick off segment detection for a source video. Returns immediately (202);
 * the asset's segment_status flips 'detecting' → 'ready' | 'failed'. Poll
 * getSegments() to track progress.
 * @param {string} assetId
 * @param {number} [maxSegments]
 */
export function findClips(assetId, maxSegments) {
  return apiFetch('/api/editorial/find-clips', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assetId, ...(maxSegments ? { maxSegments } : {}) }),
  })
}

/**
 * Moment Miner feed — every PROPOSED segment across all source videos, flattened
 * and ranked strongest-first (by quotability score). See /api/editorial/moments.
 * @returns {Promise<{moments: object[]}>}
 */
export function listMoments() {
  return apiFetch('/api/editorial/moments')
}

/**
 * Fetch detection status + proposed/kept/rendered segments for a source asset.
 * @param {string} assetId
 * @returns {Promise<{assetId: string, status: string|null, error: string|null, detectedAt: string|null, segments: object[]}>}
 */
export function getSegments(assetId) {
  return apiFetch(`/api/editorial/segments?assetId=${encodeURIComponent(assetId)}`)
}

/**
 * Set a segment's review status (keep / discard / reset to proposed).
 *
 * `reasons`/`note` are the why-it-was-denied signal (migration 202) and only
 * apply to status='discarded' — the server ignores them otherwise and clears
 * them on any un-deny. Both optional: denying without a reason still denies.
 *
 * @param {string} segmentId
 * @param {'kept'|'discarded'|'proposed'} status
 * @param {{reasons?: string[], note?: string}} [why]
 */
export function updateSegment(segmentId, status, why = {}) {
  const body = { status }
  if (why.reasons?.length) body.discardReasons = why.reasons
  if (why.note?.trim()) body.discardNote = why.note.trim()
  return apiFetch(`/api/editorial/segments/${encodeURIComponent(segmentId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/**
 * Render the given segments into media_assets b-roll clips (one per segment,
 * parent_asset_id = source video). Returns 202 with { clips, skipped }; the
 * segments flip to status='rendering' then 'rendered' (poll getSegments). The
 * finished clips land in the Library and bump the source's "clips cut" count on
 * the Moment Miner.
 * @param {string[]} segmentIds
 */
export function renderSegments(segmentIds) {
  return apiFetch('/api/editorial/render-segments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ segmentIds }),
  })
}

/**
 * Async "Save to Library" clip export. Renders the edited clip on a fresh
 * worker budget instead of inline, so a long/hi-res clip can't 504. Returns
 * fast with 202 { assetId, status: 'rendering' } — the id of the destination
 * b-roll media_assets row. Poll that asset (getMediaAsset) until its
 * render_status flips 'rendering' → 'ready' | 'failed'.
 * @param {Object} body  the editor renderBody (assetId + edit params) plus
 *                       { captionText?, briefId? }
 * @returns {Promise<{ assetId: string, status: string }>}
 */
export function exportClipToBroll(body) {
  return apiFetch('/api/editorial/export-clip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/**
 * Kick off an async reel-bake render. Renders the edited clip on a FRESH worker
 * budget instead of inline, so a long/hi-res EDITED reel can't 504 the commit.
 * Returns fast with 202 { jobId, status: 'rendering' }. Poll getClipRenderJob()
 * until its status flips 'rendering' → 'ready' (blobUrl set) | 'failed'.
 *
 * The CLIENT finalizes on 'ready' (writes the baked media_urls entry with its
 * videoEditHash stamp + flushes the source-asset draft) — this only offloads the
 * raw render, so the WYSIWYG media construction stays in one place client-side.
 * @param {Object} body  the editor renderBody (assetId + edit params)
 * @returns {Promise<{ jobId: string, status: string }>}
 */
export function startClipRenderJob(body) {
  return apiFetch('/api/editorial/render-clip-job', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/**
 * Read an async reel-bake render job's status.
 * @param {string} jobId
 * @returns {Promise<{ status: string, blobUrl: string|null, width: number|null,
 *   height: number|null, sizeBytes: number|null, hadSubtitles: boolean|null,
 *   durationS: number|null, error: string|null }>}
 */
export function getClipRenderJob(jobId) {
  return apiFetch(`/api/editorial/render-clip-job?id=${encodeURIComponent(jobId)}`)
}

/**
 * Render the WHOLE source video as one keep-whole, landscape long-form story
 * package — the other explicit choice next to "Find clips". Returns 202 with
 * { packageId, status, channels }; the Moment Miner polls story_packages for
 * completion. Anything over the 120s long-form cap is trimmed until the
 * chunked-render follow-up.
 * @param {string} assetId
 */
export function renderWholeVideo(assetId) {
  return apiFetch('/api/editorial/render-longform', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assetId }),
  })
}

/**
 * Repurpose A2 — one-click campaign-bundled repurpose. Creates (or reuses) a
 * "Repurpose: <filename>" campaign, kicks the keep-whole long-form master render
 * AND social-clip detection — both tagged to the same campaign. Returns 202 with
 * { campaignId, campaignName, masterPackageId, clipsStatus, mode, channels }.
 * Track the master in the Moment Miner; review proposed clips in the ClipFinder panel.
 * @param {string} assetId
 * @param {number} [maxSegments]
 */
export function repurposeVideo(assetId, maxSegments) {
  return apiFetch('/api/editorial/repurpose-video', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assetId, ...(maxSegments ? { maxSegments } : {}) }),
  })
}
