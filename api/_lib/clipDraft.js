// Shared helper: turn a rendered clip into an approvable content_items DRAFT.
//
// T2 (reel spine). The reel factory already rendered karaoke-captioned MP4s and
// wrote them to the Library as b-roll (api/editorial/render-segments.js →
// saveBroll), but the only path that ever produced a video content_item was the
// editor-only "As a post" button (api/_routes/editorial/clip-to-post.js). That
// is why 172 detected moments produced 3 rendered clips and 2 published IG
// videos: the pipeline stopped one step before a draft.
//
// This helper is the missing step, factored out so BOTH the manual render path
// and the auto-reel cron insert an identical row. The insert shape is lifted
// from clip-to-post.js (a proven-good insert) with two deliberate changes:
//
//   • media_urls is built by clipToMediaEntry() rather than hand-rolled, so the
//     entry carries thumbnailUrl / name / duration_s and can never drift from
//     the canonical shape every preview + publisher reads (CLAUDE.md: never
//     store a raw clip or a bare string url).
//   • mediaAssetId points at the RENDERED clip asset, not the source video —
//     the url IS that asset's blob_url, so dedup (mediaEntryKey) and the Library
//     picker resolve to the right row. clip-to-post stamped the source id, which
//     made the entry key disagree with the url it carried.
//
// Nothing here publishes. The row lands as status='draft' and a human approves
// it through the normal Storyboard → publish flow.

import { clipToMediaEntry } from '../../src/lib/mediaEntry.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// IG's hard caption ceiling. Clamped here so a long generated caption becomes a
// short draft rather than a late publish-time hard failure (staff report,
// 2026-07-13: "auto-caption over character limit"). The publish path's own caps
// are T1's territory; this is the upstream stop.
const CAPTION_MAX = 2200

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...init.headers,
    },
  })
}

/**
 * Insert a draft content_item for a rendered clip.
 *
 * @param {Object}  p
 * @param {Object}  p.ws            — workspace context (must have .id)
 * @param {string}  p.videoUrl      — Blob url of the rendered mp4
 * @param {string}  [p.assetId]     — media_assets.id of the RENDERED clip
 * @param {string}  [p.thumbnailUrl]
 * @param {string}  [p.filename]
 * @param {number}  [p.durationS]
 * @param {string}  [p.caption]     — voice-faithful caption; becomes content
 * @param {string}  [p.staffId]
 * @param {string}  [p.platform]    — default 'instagram'
 * @param {string}  [p.notes]       — provenance note
 * @param {string}  [p.scheduledAt] — ISO timestamp to land it on a week slot
 * @returns {Promise<string|null>} the new content_items.id, or null on failure
 */
export async function createClipDraft({
  ws,
  videoUrl,
  assetId = null,
  thumbnailUrl = null,
  filename = null,
  durationS = null,
  caption = '',
  staffId = null,
  platform = 'instagram',
  notes = null,
  scheduledAt = null,
}) {
  if (!ws?.id || !videoUrl) return null

  // Route through the canonical normalizer so the stored entry is a real
  // media_urls object ({url,type,kind,thumbnailUrl,mediaAssetId,…}) and never a
  // raw clip — a raw clip stores url:null and breaks mediaEntryKey.
  const entry = clipToMediaEntry({
    kind: 'video',
    blobUrl: videoUrl,
    thumbnailUrl,
    assetId,
    filename,
    ...(durationS != null ? { durationS } : {}),
  })

  const text = String(caption || '').trim().slice(0, CAPTION_MAX)

  const row = {
    workspace_id: ws.id,
    status: 'draft',
    platform,
    media_urls: [entry],
    content: text,
    overlay_text: text,
    staff_id: staffId || null,
    notes: notes || null,
    ...(scheduledAt ? { scheduled_at: scheduledAt } : {}),
  }

  const res = await sb('content_items', { method: 'POST', body: JSON.stringify(row) })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error('[clipDraft] content_items insert failed:', res.status, body)
    return null
  }
  const items = await res.json().catch(() => null)
  return items?.[0]?.id || null
}
