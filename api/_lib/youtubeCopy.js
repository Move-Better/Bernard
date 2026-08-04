// api/_lib/youtubeCopy.js
//
// Pure helpers for the Library's "publish it whole" YouTube lane. Everything
// here is a plain function over plain data — no request, no workspace, no DB —
// so the rules that decide what publishes and how the description is shaped can
// be unit-tested (and mutation-tested) without standing up a handler.
//
// Two rules live here, both load-bearing:
//
//   1. Eligibility. Which assets the lane offers at all, and which it blocks.
//   2. Chapters. Reconstructing text + timestamps from transcript_words.
//
// WHY transcript_words AND NOT transcription: media_assets.transcription is
// unreliable on this corpus — measured 2026-08-03 across movebetter's eight
// long-form interviews, five had an EMPTY or near-empty value (three were '',
// one was 38 characters for a 3m26s video) while every one of the eight had a
// complete transcript_words array (212–809 tokens). Drafting from the text
// column would have produced a blank description on most of the library and read
// as a model failure rather than a data gap.

// bundle.social's upload/from-url endpoint pulls the file server-side and is
// bounded by a gateway timeout (~100s), NOT by a published size limit. Measured
// against the live API 2026-08-03: a 2,260 MB 4K mp4 returned 200 in 90s; a
// 5,897 MB one returned a Cloudflare 524 at 125s and left no upload record. At
// the observed ~25 MB/s ingest that puts the wall near 2.5 GB, so that is the
// number — empirical, hence one named constant rather than a literal sprinkled
// through the handlers. If bundle moves to the chunked init/finalize path for
// from-url ingestion, re-measure and raise this.
export const YOUTUBE_MAX_UPLOAD_BYTES = 2.5 * 1024 * 1024 * 1024

// YouTube ignores a chapter list unless the FIRST stamp is 00:00, there are at
// least three, and each runs 10s or longer. Below any of those it renders the
// lines as literal text in the description, which looks broken — so we emit
// chapters only when all three hold, and emit none otherwise.
export const MIN_CHAPTERS = 3
export const MIN_CHAPTER_SECONDS = 10

// Target spacing. Long enough that a 3-minute interview yields ~3 chapters
// rather than a stamp every breath; short enough that an 8-minute one is
// genuinely navigable.
const TARGET_CHAPTER_SECONDS = 60

/**
 * Should the Library offer the "publish it whole" panel for this asset?
 * Landscape video only — YouTube long-form is a 16:9 destination, and a vertical
 * source belongs in the Shorts/clip lane. Deliberately NOT gated on duration: a
 * short landscape clip is a legitimate YouTube video.
 *
 * @param {{kind?: string, width?: number, height?: number, blob_url?: string, archived_at?: string|null}} asset
 * @returns {boolean}
 */
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
 * Can this eligible asset actually be sent, or is the file too large for the
 * upload path? Separated from eligibility on purpose: an oversized asset still
 * SHOWS the panel, and the dialog explains why Publish is disabled. Silently
 * hiding the affordance would read as the feature being missing.
 *
 * @param {{size_bytes?: number|null}} asset
 * @returns {{ok: true} | {ok: false, reason: 'too_large', sizeBytes: number, maxBytes: number}}
 */
export function checkYouTubeUploadSize(asset) {
  const size = Number(asset?.size_bytes) || 0
  // An unknown size is allowed through rather than blocked — size_bytes is null
  // on some older rows, and refusing those would block assets that may be fine.
  // bundle's own error surfaces if it turns out to be too big.
  if (!size) return { ok: true }
  if (size > YOUTUBE_MAX_UPLOAD_BYTES) {
    return { ok: false, reason: 'too_large', sizeBytes: size, maxBytes: YOUTUBE_MAX_UPLOAD_BYTES }
  }
  return { ok: true }
}

/**
 * Flatten a transcript_words array into readable text.
 * Shape is [{ word, start, end }] — verified against live rows 2026-08-03.
 *
 * @param {Array<{word?: string, start?: number}>} words
 * @returns {string}
 */
export function transcriptText(words) {
  if (!Array.isArray(words)) return ''
  return words
    .map((w) => (typeof w?.word === 'string' ? w.word.trim() : ''))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .trim()
}

/**
 * Format seconds as a YouTube chapter stamp. Under an hour YouTube wants m:ss
 * (a leading 0:00 is required for the first one); past an hour, h:mm:ss.
 *
 * @param {number} totalSeconds
 * @returns {string}
 */
export function formatStamp(totalSeconds) {
  const t = Math.max(0, Math.floor(Number(totalSeconds) || 0))
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = t % 60
  const ss = String(s).padStart(2, '0')
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`
  return `${m}:${ss}`
}

/**
 * Slice transcript_words into chapter-sized segments, each carrying its start
 * time and the text spoken inside it. Titling the segments is the model's job
 * (see draftYouTubeCopy) — this function only decides WHERE the boundaries are,
 * which is the part worth pinning in a test.
 *
 * Returns [] when the source can't produce a chapter list YouTube would honour,
 * so callers can treat "no chapters" as a real, expected state.
 *
 * @param {Array<{word?: string, start?: number, end?: number}>} words
 * @param {{targetSeconds?: number}} [opts]
 * @returns {Array<{startSec: number, text: string}>}
 */
export function planChapters(words, { targetSeconds = TARGET_CHAPTER_SECONDS } = {}) {
  if (!Array.isArray(words) || words.length === 0) return []

  const timed = words.filter((w) => typeof w?.start === 'number' && typeof w?.word === 'string' && w.word.trim())
  if (timed.length === 0) return []

  const lastEnd = Number(timed[timed.length - 1].end ?? timed[timed.length - 1].start) || 0
  // Not enough runway for the minimum chapter count at the minimum length.
  if (lastEnd < MIN_CHAPTERS * MIN_CHAPTER_SECONDS) return []

  const segments = []
  let current = { startSec: 0, words: [] }

  for (const w of timed) {
    const start = Number(w.start) || 0
    const elapsed = start - current.startSec
    // Only break on a target-length boundary, and never produce a segment
    // shorter than the minimum YouTube honours.
    if (elapsed >= targetSeconds && elapsed >= MIN_CHAPTER_SECONDS && current.words.length > 0) {
      segments.push(current)
      current = { startSec: start, words: [] }
    }
    current.words.push(w)
  }
  if (current.words.length > 0) segments.push(current)

  // A trailing stub shorter than the minimum gets folded back into its
  // predecessor rather than shipped as a chapter YouTube would reject.
  if (segments.length > 1) {
    const last = segments[segments.length - 1]
    const lastLen = lastEnd - last.startSec
    if (lastLen < MIN_CHAPTER_SECONDS) {
      const prev = segments[segments.length - 2]
      prev.words = prev.words.concat(last.words)
      segments.pop()
    }
  }

  if (segments.length < MIN_CHAPTERS) return []

  // The first stamp MUST be 0:00 or YouTube ignores the whole list.
  segments[0].startSec = 0

  return segments.map((s) => ({ startSec: s.startSec, text: transcriptText(s.words) }))
}

/**
 * Append a titled chapter list to a description body.
 * Pure string assembly, separated from the model call so the exact output shape
 * is assertable.
 *
 * @param {string} body
 * @param {Array<{startSec: number, title: string}>} chapters
 * @returns {string}
 */
export function appendChapters(body, chapters) {
  const base = String(body || '').trim()
  if (!Array.isArray(chapters) || chapters.length < MIN_CHAPTERS) return base
  const lines = chapters
    .filter((c) => c && typeof c.title === 'string' && c.title.trim())
    .map((c) => `${formatStamp(c.startSec)} ${c.title.trim()}`)
  if (lines.length < MIN_CHAPTERS) return base
  return `${base}\n\nChapters\n${lines.join('\n')}`.trim()
}
