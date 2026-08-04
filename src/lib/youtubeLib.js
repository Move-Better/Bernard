// Client helpers for the Library's "publish it whole" YouTube lane.
//
// The eligibility + size rules are duplicated from api/_lib/youtubeCopy.js
// rather than imported: src/ cannot import from api/ across the bundler
// boundary, the same reason gradeParams and postFrames exist in mirrored pairs
// (see CLAUDE.md "Client/server mirror pairs"). The SERVER copy is
// authoritative — youtube-create.js re-checks both before inserting, so a stale
// client can never publish something the server would reject. Change one, change
// the other; tests/lib/youtubeEligibility.test.js pins them to the same values.

import { apiFetch } from '@/lib/api'

// Mirror of YOUTUBE_MAX_UPLOAD_BYTES in api/_lib/youtubeCopy.js. Empirical:
// measured against bundle.social's live from-url endpoint 2026-08-03 — 2.26 GB
// uploaded in 90s, 5.9 GB failed with a gateway timeout at 125s.
export const YOUTUBE_MAX_UPLOAD_BYTES = 2.5 * 1024 * 1024 * 1024

export const YOUTUBE_TITLE_MAX = 100
export const YOUTUBE_DESCRIPTION_MAX = 5000

/** Landscape video only — a vertical source belongs in the Shorts/clip lane. */
export function isYouTubeEligible(asset) {
  if (!asset || asset.kind !== 'video') return false
  if (!asset.blob_url) return false
  if (asset.archived_at) return false
  const w = Number(asset.width) || 0
  const h = Number(asset.height) || 0
  if (!w || !h) return false
  return w > h
}

/**
 * Is the file small enough for the upload path? An unknown size passes — some
 * older rows have a null size_bytes, and blocking those would hide assets that
 * are probably fine.
 */
export function isWithinUploadLimit(asset) {
  const size = Number(asset?.size_bytes) || 0
  if (!size) return true
  return size <= YOUTUBE_MAX_UPLOAD_BYTES
}

/** Human-readable size for the dialog, e.g. "5.8 GB" / "466 MB". */
export function formatBytes(bytes) {
  const n = Number(bytes) || 0
  if (!n) return null
  const gb = n / (1024 * 1024 * 1024)
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  return `${Math.round(n / (1024 * 1024))} MB`
}

/** mm:ss / h:mm:ss for the thumbnail badge. */
export function formatDuration(seconds) {
  const t = Math.max(0, Math.floor(Number(seconds) || 0))
  if (!t) return null
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = String(t % 60).padStart(2, '0')
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${s}`
  return `${m}:${s}`
}

/** Draft a title + description (with chapters) from the asset's transcript. */
export function draftYouTubeCopy(assetId) {
  return apiFetch('/api/editorial/youtube-draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assetId }),
  })
}

/** Create the content_items row. Does NOT publish — the caller does that. */
export function createYouTubePiece({ assetId, title, description }) {
  return apiFetch('/api/editorial/youtube-create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assetId, title, description }),
  })
}
